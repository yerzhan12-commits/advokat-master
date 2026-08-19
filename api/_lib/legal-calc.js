// Детерминированные юридические расчёты — считаются кодом, а не моделью, тем
// же принципом, что и api/_lib/thresholds.js в zhaloba-master: модель может
// ошибиться или взять устаревшую цифру, код — нет (если сама формула верна).
//
// ВАЖНО: формула госпошлины и множители ниже взяты из чернового материала,
// присланного пользователем, и НЕ ПРОВЕРЕНЫ по действующей редакции ст.610 НК
// РК на adilet.zan.kz. Прежде чем полагаться на них в проде — свериться с
// актуальным текстом кодекса, см. TODO у computeGosposhlina.

function formatKzt(amount) {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₸`;
}

// Контрольная сумма ИИН/БИН РК — публичный, не завязанный на конкретную
// редакцию закона алгоритм (в отличие от номеров статей, тут перепроверять
// с adilet.zan.kz не нужно). 12 цифр, вес по двум наборам весов.
function validateIinBin(value) {
  const digits = String(value || '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(digits)) {
    return { valid: false, reason: 'Должно быть ровно 12 цифр' };
  }
  const nums = digits.split('').map(Number);
  const weights1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const weights2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

  const sum1 = nums.slice(0, 11).reduce((acc, d, i) => acc + d * weights1[i], 0);
  let control = sum1 % 11;

  if (control === 10) {
    const sum2 = nums.slice(0, 11).reduce((acc, d, i) => acc + d * weights2[i], 0);
    control = sum2 % 11;
    if (control === 10) {
      return { valid: false, reason: 'Некорректная контрольная сумма' };
    }
  }

  if (control !== nums[11]) {
    return { valid: false, reason: 'Некорректная контрольная сумма' };
  }
  return { valid: true };
}

// TODO(проверить перед продом): ст.610 НК РК — по присланному черновику,
// имущественные иски — 1% от суммы иска, но не менее 500 МРП; неимущественные
// — 50% от МРП. Нужна сверка с текущей редакцией на adilet.zan.kz — ставки и
// минимумы госпошлины меняются вместе с налоговым кодексом, не только с МРП.
const PROPERTY_CLAIM_RATE = 0.01;
const PROPERTY_CLAIM_MIN_MRP_MULTIPLIER = 500;
const NON_PROPERTY_CLAIM_MRP_MULTIPLIER = 0.5;

// isPropertyClaim: true — имущественный иск, false — неимущественный,
// null/undefined — гражданского иска в этом деле вообще нет (обычное дело для
// чисто уголовной защиты без потерпевшего/гражданского истца) — раньше это
// молча считалось как "неимущественный", что было ошибкой.
// isCriminalCase: true — дело уголовное (УК/УПК). Гражданский иск,
// заявленный В РАМКАХ уголовного процесса, освобождён от уплаты госпошлины
// (подтверждено: adilet.zan.kz, P05000001S_ "О рассмотрении гражданского
// иска в уголовном процессе") — не применять к нему формулы ниже.
function computeGosposhlina(claimAmountKzt, isPropertyClaim, mrpKzt, isCriminalCase) {
  if (isPropertyClaim === null || isPropertyClaim === undefined) {
    return {
      amountKzt: null,
      text: 'госпошлина не применима — гражданский иск в рамках этого дела не заявлен',
    };
  }

  if (isCriminalCase) {
    return {
      amountKzt: 0,
      text: 'гражданский иск заявлен в рамках уголовного процесса — истец освобождён от уплаты госпошлины',
    };
  }

  const mrp = Number(mrpKzt);
  if (!Number.isFinite(mrp) || mrp <= 0) {
    return {
      amountKzt: null,
      text: 'текущее значение МРП не задано в настройках сервера — не называть уверенно сумму госпошлины в тенге, только формулу',
    };
  }

  if (!isPropertyClaim) {
    const amount = NON_PROPERTY_CLAIM_MRP_MULTIPLIER * mrp;
    return {
      amountKzt: amount,
      text: `неимущественный иск — госпошлина ${formatKzt(amount)} (50% от МРП при текущем МРП = ${formatKzt(mrp)})`,
    };
  }

  const claim = Number(claimAmountKzt);
  if (!Number.isFinite(claim) || claim <= 0) {
    return {
      amountKzt: null,
      text: 'сумма иска не указана — не называть уверенно сумму госпошлины, сначала уточнить у клиента цену иска',
    };
  }

  const minAmount = PROPERTY_CLAIM_MIN_MRP_MULTIPLIER * mrp;
  const computed = claim * PROPERTY_CLAIM_RATE;
  const amount = Math.max(computed, minAmount);
  return {
    amountKzt: amount,
    text: `имущественный иск на сумму ${formatKzt(claim)} — госпошлина ${formatKzt(amount)} (1% от суммы иска, но не менее ${PROPERTY_CLAIM_MIN_MRP_MULTIPLIER}×МРП = ${formatKzt(minAmount)}, при текущем МРП = ${formatKzt(mrp)})`,
  };
}

module.exports = {
  validateIinBin,
  computeGosposhlina,
  PROPERTY_CLAIM_RATE,
  PROPERTY_CLAIM_MIN_MRP_MULTIPLIER,
  NON_PROPERTY_CLAIM_MRP_MULTIPLIER,
};
