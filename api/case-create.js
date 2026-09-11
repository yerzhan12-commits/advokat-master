const { getLawyer, createCase } = require('./_lib/cases');
const { validateIinBin } = require('./_lib/legal-calc');

// Клиент адвоката открывает /?l={lawyerId}, заполняет структурные поля
// (контакты, ИИН/БИН, семейное положение, свободный текст ситуации) и этим
// запросом создаёт дело — дальше уточняющие вопросы ведёт /api/case-wizard.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { lawyerId, clientName, clientPhone, iinBin, familyStatus, situationText, attachedFiles, filledBy } = req.body || {};
  const isRelative = filledBy === 'relative';

  if (typeof lawyerId !== 'string' || !lawyerId.trim()) {
    res.status(400).json({ error: 'lawyerId is required' });
    return;
  }
  if (typeof clientName !== 'string' || !clientName.trim()) {
    res.status(400).json({ error: 'clientName is required' });
    return;
  }
  if (typeof clientPhone !== 'string' || !clientPhone.trim()) {
    res.status(400).json({ error: 'clientPhone is required' });
    return;
  }
  const iinCheck = validateIinBin(iinBin);
  if (!iinCheck.valid) {
    res.status(400).json({ error: `ИИН/БИН: ${iinCheck.reason}` });
    return;
  }
  if (typeof situationText !== 'string' || situationText.trim().length < 20) {
    res.status(400).json({ error: 'Опишите ситуацию подробнее (не менее 20 символов)' });
    return;
  }

  try {
    const lawyer = await getLawyer(lawyerId.trim());
    if (!lawyer || !lawyer.active) {
      res.status(404).json({ error: 'Ссылка недействительна. Уточните её у адвоката.' });
      return;
    }

    // Фото/PDF прикрепляются только на шаге первичной формы (не в ходе чата) —
    // упрощение Phase 1: закрывает основной сценарий (приложить расписку/
    // договор при описании ситуации), но не полный zhaloba-master паттерн
    // прикрепления файлов на каждом шаге переписки.
    // Клиент (особенно по уголовным делам) часто уже в СИЗО и не может сам
    // зайти по ссылке — тогда форму за него заполняет родственник. Явно
    // говорим об этом модели в самом первом сообщении, чтобы уточняющие
    // вопросы формулировались корректно ("узнайте у него", а не "у вас") —
    // дешевле и надёжнее, чем менять сам SYSTEM_PROMPT под оба случая.
    const situationPrefix = isRelative
      ? `[Форму заполняет родственник/близкий человек клиента, а не сам клиент — вероятно, клиент недоступен напрямую (например, находится в СИЗО). Формулируй уточняющие вопросы соответственно: "уточните у него/неё", а не "у вас".]\n\n`
      : '';
    const contentBlocks = [{ type: 'text', text: situationPrefix + situationText.trim() }];
    if (Array.isArray(attachedFiles)) {
      for (const f of attachedFiles) {
        if (!f || typeof f.base64 !== 'string' || !f.base64) continue;
        if (f.kind === 'image') {
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType || 'image/jpeg', data: f.base64 } });
        } else {
          contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
        }
      }
    }

    const newCase = await createCase({
      lawyerId: lawyer.lawyerId,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      intake: {
        iinBin: iinBin.replace(/\s+/g, ''),
        familyStatus: typeof familyStatus === 'string' ? familyStatus.trim() : '',
        filledBy: isRelative ? 'relative' : 'self',
      },
      messages: [{ role: 'user', content: contentBlocks }],
    });

    res.status(200).json({ caseId: newCase.caseId, messages: newCase.messages });
  } catch (err) {
    console.error('case-create error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
