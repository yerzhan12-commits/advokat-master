const { getSessionLawyerId, getLawyerCases } = require('../_lib/cases');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = req.headers['x-lawyer-session'];
  const lawyerId = await getSessionLawyerId(typeof token === 'string' ? token : '');
  if (!lawyerId) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }

  try {
    const cases = await getLawyerCases(lawyerId);
    res.status(200).json({ cases });
  } catch (err) {
    console.error('lawyer cases list error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
