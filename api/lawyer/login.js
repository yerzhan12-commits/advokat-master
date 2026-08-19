const { verifyLawyerCredentials, createSession } = require('../_lib/cases');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { lawyerId, password } = req.body || {};
  if (typeof lawyerId !== 'string' || !lawyerId.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'lawyerId and password are required' });
    return;
  }

  try {
    const lawyer = await verifyLawyerCredentials(lawyerId.trim(), password);
    if (!lawyer) {
      // Одна и та же ошибка на неверный пароль/несуществующий логин/отключённый
      // доступ — не подсказываем злоумышленнику, какой из трёх случаев это был.
      res.status(401).json({ error: 'Неверный логин или пароль' });
      return;
    }
    const token = await createSession(lawyer.lawyerId);
    res.status(200).json({ token, name: lawyer.name });
  } catch (err) {
    console.error('lawyer login error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
