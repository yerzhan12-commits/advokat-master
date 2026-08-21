const { getClient } = require('./redis-client');
const { randomUUID, scryptSync, randomBytes, timingSafeEqual } = require('crypto');

// Статусы дела — те же, что в кабинете bankrot-master (Все статусы/Новые/В
// работе/Подано/Закрыто), чтобы адвокат не переучивался.
const CASE_STATUSES = ['new', 'in_review', 'submitted', 'closed'];

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 дней
const LAWYER_CASES_MAX = 2000; // защита от неограниченного роста одного списка в KV

function lawyerKey(lawyerId) {
  return `lawyer:${lawyerId}`;
}
function lawyerCasesKey(lawyerId) {
  return `lawyer:${lawyerId}:cases`;
}
function caseKey(caseId) {
  return `case:${caseId}`;
}
function sessionKey(token) {
  return `session:${token}`;
}

// node-redis всегда возвращает сырую строку (мы сами делаем JSON.stringify
// перед записью) — этот разбор на всякий случай терпим и к сырому объекту,
// если формат хранения когда-нибудь изменится.
function parseMaybeJson(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

// Пароль адвоката не хранится в открытом виде (в отличие от ADMIN_PASSWORD в
// zhaloba-master) — здесь под паролем реальные ПД клиентов, а не внутренний
// лог. scrypt + случайная соль, без внешних зависимостей.
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function createLawyer({ lawyerId, name, password }) {
  const record = {
    lawyerId,
    name,
    passwordHash: hashPassword(password),
    active: true,
    createdAt: new Date().toISOString(),
  };
  const client = await getClient();
  await client.set(lawyerKey(lawyerId), JSON.stringify(record));
  return record;
}

async function getLawyer(lawyerId) {
  const client = await getClient();
  const raw = await client.get(lawyerKey(lawyerId));
  return parseMaybeJson(raw);
}

async function setLawyerActive(lawyerId, active) {
  const lawyer = await getLawyer(lawyerId);
  if (!lawyer) return null;
  lawyer.active = !!active;
  const client = await getClient();
  await client.set(lawyerKey(lawyerId), JSON.stringify(lawyer));
  return lawyer;
}

// Единая точка входа для логина: проверяет и пароль, и то, что доступ не
// отключён вручную (см. setLawyerActive — так закрывается доступ, если
// оплата по договору не пришла, без отдельной биллинг-системы).
async function verifyLawyerCredentials(lawyerId, password) {
  const lawyer = await getLawyer(lawyerId);
  if (!lawyer || !lawyer.active) return null;
  if (!verifyPassword(password, lawyer.passwordHash)) return null;
  return lawyer;
}

async function createSession(lawyerId) {
  const token = randomUUID();
  const client = await getClient();
  await client.set(sessionKey(token), lawyerId, { EX: SESSION_TTL_SECONDS });
  return token;
}

async function getSessionLawyerId(token) {
  if (typeof token !== 'string' || !token.trim()) return null;
  const client = await getClient();
  const lawyerId = await client.get(sessionKey(token));
  return typeof lawyerId === 'string' ? lawyerId : null;
}

// В отличие от result:{id} в zhaloba-master (TTL 5 дней — расходный
// черновик), дело адвоката — его рабочий файл, поэтому без TTL: не должно
// исчезнуть само по себе, пока лицо (адвокат/клиент) не закрыло его вручную.
async function createCase({ lawyerId, clientName, clientPhone, intake, messages }) {
  const caseId = randomUUID();
  const record = {
    caseId,
    lawyerId,
    clientName: clientName || '',
    clientPhone: clientPhone || '',
    // Структурные поля с формы (ИИН/БИН, семейное положение и т.п.) — по
    // образцу bankrot-master, отдельно от messages (свободного разговора с ИИ).
    intake: intake || {},
    status: 'new',
    messages: Array.isArray(messages) ? messages : [],
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const client = await getClient();
  await client.set(caseKey(caseId), JSON.stringify(record));
  const key = lawyerCasesKey(lawyerId);
  await client.lPush(key, caseId);
  await client.lTrim(key, 0, LAWYER_CASES_MAX - 1);
  return record;
}

async function getCase(caseId) {
  const client = await getClient();
  const raw = await client.get(caseKey(caseId));
  return parseMaybeJson(raw);
}

async function saveCase(caseId, data) {
  const record = { ...data, updatedAt: new Date().toISOString() };
  const client = await getClient();
  await client.set(caseKey(caseId), JSON.stringify(record));
  return record;
}

// Полное удаление дела — на случай, если клиент отказался от услуг и попросил
// удалить его данные (актуально с учётом ст.12 Закона РК "О персональных
// данных" — данные не должны храниться дольше, чем нужно). Удаляет и сам
// объект дела, и ссылку на него из списка дел адвоката.
async function deleteCase(caseId, lawyerId) {
  const client = await getClient();
  await client.del(caseKey(caseId));
  await client.lRem(lawyerCasesKey(lawyerId), 0, caseId);
}

async function getLawyerCases(lawyerId) {
  const client = await getClient();
  const ids = await client.lRange(lawyerCasesKey(lawyerId), 0, -1);
  const items = await Promise.all(ids.map(async (caseId) => {
    const stored = await getCase(caseId);
    if (!stored) return null; // запись потерялась/битая — не показываем призрак в списке
    return {
      caseId,
      clientName: stored.clientName,
      clientPhone: stored.clientPhone,
      status: stored.status,
      category: (stored.result && stored.result.category) || null,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }));
  return items.filter(Boolean);
}

module.exports = {
  CASE_STATUSES,
  createLawyer,
  getLawyer,
  setLawyerActive,
  verifyLawyerCredentials,
  createSession,
  getSessionLawyerId,
  createCase,
  getCase,
  saveCase,
  deleteCase,
  getLawyerCases,
};
