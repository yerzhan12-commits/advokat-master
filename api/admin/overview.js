const { getAllLawyersOverview, backfillLawyerIndex } = require('../_lib/cases');

// Сводка по всем адвокатам сразу — используется еженедельным авто-агентом
// (см. project memory), гейтится ADMIN_PASSWORD в query-параметре, тем же
// способом, что api/admin.js в zhaloba-master.
//
// ?backfill=1 — разовая миграция: регистрирует в индексе адвокатов, которые
// были созданы до появления ALL_LAWYERS_KEY (иначе их не видно в сводке).
// Безвредно вызывать повторно — просто не добавит уже известных.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const password = (req.query && req.query.password) || '';
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Доступ запрещён' });
    return;
  }

  try {
    if (req.query && req.query.backfill === '1') {
      const known = ['test', 'demo', 'aitubaev', 'chinyaeva', 'shalbayev', 'torekhanov'];
      const added = await backfillLawyerIndex(known);
      res.status(200).json({ backfilled: added });
      return;
    }

    const overview = await getAllLawyersOverview();
    res.status(200).json({ lawyers: overview, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('admin overview error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
