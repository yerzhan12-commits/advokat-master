const { getAllLawyersOverview, setLawyerActive } = require('../_lib/cases');

// Ручное включение/отключение доступа адвоката — та же идея, что и
// setLawyerActive в _lib/cases.js: доступ закрывается вручную (нет оплаты по
// договору/решили прекратить бесплатный доступ), без отдельной биллинг-системы.
// GET с query-параметрами специально, чтобы можно было вызвать прямо из
// адресной строки браузера — тем же способом, что уже используется для
// admin/overview.js?password=..., без терминала/curl.
//
// Два режима:
//  1) ?lawyerId=X&active=0|1 — переключить доступ ОДНОМУ адвокату.
//  2) ?keep=id1,id2 — отключить доступ ВСЕМ адвокатам, КРОМЕ перечисленных
//     (через запятую). Один клик вместо отключения по одному.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const q = req.query || {};
  const password = q.password || '';
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Доступ запрещён' });
    return;
  }

  try {
    if (typeof q.keep === 'string' && q.keep.trim()) {
      const keepIds = new Set(q.keep.split(',').map((s) => s.trim()).filter(Boolean));
      const all = await getAllLawyersOverview();
      const deactivated = [];
      const kept = [];
      for (const lawyer of all) {
        if (keepIds.has(lawyer.lawyerId)) {
          kept.push(lawyer.lawyerId);
          continue;
        }
        if (lawyer.active !== false) {
          await setLawyerActive(lawyer.lawyerId, false);
        }
        deactivated.push(lawyer.lawyerId);
      }
      res.status(200).json({ deactivated, kept });
      return;
    }

    const { lawyerId, active } = q;
    if (typeof lawyerId !== 'string' || !lawyerId.trim()) {
      res.status(400).json({ error: 'lawyerId or keep is required' });
      return;
    }
    const updated = await setLawyerActive(lawyerId, active === '1' || active === 'true');
    if (!updated) {
      res.status(404).json({ error: 'lawyer not found' });
      return;
    }
    res.status(200).json({ lawyerId: updated.lawyerId, active: updated.active });
  } catch (err) {
    console.error('set-lawyer-active error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
