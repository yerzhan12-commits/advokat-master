const { getSessionLawyerId, getCase, saveCase, deleteCase, CASE_STATUSES } = require('../_lib/cases');

module.exports = async (req, res) => {
  const token = req.headers['x-lawyer-session'];
  const lawyerId = await getSessionLawyerId(typeof token === 'string' ? token : '');
  if (!lawyerId) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }

  const caseId = (req.query && req.query.caseId) || (req.body && req.body.caseId);
  if (typeof caseId !== 'string' || !caseId.trim()) {
    res.status(400).json({ error: 'caseId is required' });
    return;
  }

  try {
    const stored = await getCase(caseId);
    // Не 403, а 404 — не подтверждаем даже факт существования чужого дела
    // (тот же выбор, что history-item.js в zhaloba-master делает для resultId).
    if (!stored || stored.lawyerId !== lawyerId) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({ case: stored });
      return;
    }

    if (req.method === 'POST') {
      const { status } = req.body || {};
      if (!CASE_STATUSES.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${CASE_STATUSES.join(', ')}` });
        return;
      }
      const updated = await saveCase(caseId, { ...stored, status });
      res.status(200).json({ case: updated });
      return;
    }

    if (req.method === 'DELETE') {
      // Клиент отказался от услуг / попросил удалить данные — полное
      // удаление без возможности восстановить, поэтому это отдельная,
      // явная кнопка в кабинете, а не побочный эффект смены статуса.
      await deleteCase(caseId, lawyerId);
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('lawyer case error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
};
