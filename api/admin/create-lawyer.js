const { createLawyer, getLawyer } = require('../_lib/cases');

// Ручное создание аккаунта адвоката — по образцу пароль-гейта в
// zhaloba-master/api/admin.js (?password=... сверяется с ADMIN_PASSWORD), но
// в виде POST-запроса с телом, а не GET, потому что здесь дополнительно
// передаётся пароль будущего адвоката, а GET-параметры логируются охотнее.
// Самостоятельной регистрации нет и не планируется — онбординг всегда через
// Ержана по договору (см. project memory: 40-50к + 10к/мес, вручную).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const adminPassword = (req.body && req.body.adminPassword) || '';
  if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Доступ запрещён' });
    return;
  }

  const { lawyerId, name, password } = req.body || {};
  if (typeof lawyerId !== 'string' || !/^[a-z0-9-]{3,40}$/.test(lawyerId)) {
    res.status(400).json({ error: 'lawyerId должен быть латиницей/цифрами/дефисом, 3-40 символов (используется в ссылке для клиентов)' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'password должен быть не короче 8 символов' });
    return;
  }

  try {
    const existing = await getLawyer(lawyerId);
    if (existing) {
      res.status(409).json({ error: 'lawyerId уже занят' });
      return;
    }
    const lawyer = await createLawyer({ lawyerId, name: name.trim(), password });
    res.status(200).json({
      lawyerId: lawyer.lawyerId,
      name: lawyer.name,
      shareLink: `/?l=${encodeURIComponent(lawyer.lawyerId)}`,
    });
  } catch (err) {
    console.error('create-lawyer error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
