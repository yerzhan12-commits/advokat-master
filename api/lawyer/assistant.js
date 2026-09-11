const Anthropic = require('@anthropic-ai/sdk');
const { getSessionLawyerId, getAssistantChat, saveAssistantChat, getCase } = require('../_lib/cases');

// Личный ИИ-помощник адвоката внутри кабинета — НЕ тот же ассистент, что ведёт
// интервью с клиентом (case-wizard.js). Это инструмент для самого адвоката:
// перепроверить статью, обсудить стратегию, помочь с формулировкой. Та же
// дисциплина по актуальности законодательства, что и в case-wizard.js —
// см. feedback_current_legislation в памяти.
const SYSTEM_PROMPT = `Ты — личный ИИ-помощник адвоката в Республике Казахстан, встроенный в его рабочий кабинет. Ты помогаешь САМОМУ адвокату — с исследованием практики, перепроверкой формулировок, обсуждением стратегии по делу, черновиками текста. Ты не заменяешь профессиональное суждение адвоката — это его рабочий инструмент, а не готовое решение.

ОБЯЗАТЕЛЬНОЕ ПРАВИЛО про актуальность НПА: никогда не называй уверенно номер статьи, сумму, ставку или срок, если не уверен в точности — честно скажи "нужно перепроверить на adilet.zan.kz" вместо того, чтобы гадать. Лучше дать верную по существу, но менее точную по номерам статей мысль, чем уверенно назвать неверную ссылку. Если адвокат просит текст документа или формулировку — дай черновик и явно отметь, что перед использованием нужно сверить актуальность цитируемых норм.

Отвечай кратко и по делу — это рабочий чат практикующего адвоката, а не обучающий материал для новичка. Не повторяй вопрос адвоката перед ответом.`;

const LANG_INSTRUCTIONS = {
  ru: 'Отвечай на русском языке.',
  kk: 'ТЕК қазақ тілінде жауап бер, табиғи әрі сауатты тілде.',
};

function buildMockReply(userText) {
  return `[MOCK] Ответ-заглушка на: "${String(userText).slice(0, 80)}". Реального вызова модели не было (MOCK_CASE_WIZARD=1).`;
}

module.exports = async (req, res) => {
  const token = req.headers['x-lawyer-session'];
  const lawyerId = await getSessionLawyerId(typeof token === 'string' ? token : '');
  if (!lawyerId) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const messages = await getAssistantChat(lawyerId);
      res.status(200).json({ messages });
    } catch (err) {
      console.error('assistant GET error:', err);
      res.status(500).json({ error: err.message || 'internal error' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { text, caseId, lang } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  try {
    const history = await getAssistantChat(lawyerId);

    // Необязательный контекст конкретного дела — коротко, только то, что уже
    // известно из первичного анализа, а не весь разговор с клиентом целиком.
    let caseContext = '';
    if (typeof caseId === 'string' && caseId.trim()) {
      const c = await getCase(caseId);
      if (c && c.lawyerId === lawyerId && c.result) {
        caseContext = `\n\nКОНТЕКСТ ТЕКУЩЕГО ДЕЛА (из первичного анализа, для справки — адвокат может уточнить детали в чате):\nКатегория: ${c.result.category || '—'}\nПравовая база: ${c.result.legalBasis || '—'}\nСтороны: ${c.result.partiesSummary || '—'}\nОценка: ${c.result.assessment || '—'}`;
      }
    }

    const langInstruction = LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.ru;
    const newMessages = [...history, { role: 'user', content: text.trim() }];

    let replyText;

    if (process.env.MOCK_CASE_WIZARD === '1') {
      replyText = buildMockReply(text);
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT + caseContext + '\n\n' + langInstruction,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: newMessages,
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock) {
        res.status(502).json({ error: 'Модель не вернула текстовый ответ' });
        return;
      }
      replyText = textBlock.text;
    }

    const updated = [...newMessages, { role: 'assistant', content: replyText }];
    await saveAssistantChat(lawyerId, updated);

    res.status(200).json({ reply: replyText, messages: updated });
  } catch (err) {
    console.error('lawyer assistant error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
