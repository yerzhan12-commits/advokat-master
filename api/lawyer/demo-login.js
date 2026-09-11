const { createSession, getLawyer } = require('../_lib/cases');

// Автовход БЕЗ пароля — специально и единственно для тестового аккаунта
// 'demo', чтобы ссылка на презентации сразу открывала кабинет (не нужно
// диктовать логин/пароль в переписке). lawyerId жёстко зашит, не берётся из
// запроса — иначе это была бы дыра, позволяющая войти в ЛЮБОЙ аккаунт без
// пароля. Реальные аккаунты адвокатов через этот эндпоинт не заходят.
const DEMO_LAWYER_ID = 'demo';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const lawyer = await getLawyer(DEMO_LAWYER_ID);
    if (!lawyer || !lawyer.active) {
      res.status(404).json({ error: 'Демо-аккаунт недоступен' });
      return;
    }
    const token = await createSession(DEMO_LAWYER_ID);
    res.status(200).json({ token, name: lawyer.name });
  } catch (err) {
    console.error('demo-login error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
