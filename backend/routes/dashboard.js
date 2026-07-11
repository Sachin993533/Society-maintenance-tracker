const express = require('express');
const db = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getThresholdDays } = require('../utils/overdue');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/dashboard - counts by status, by category, and overdue count
router.get('/', (req, res) => {
  const byStatus = db
    .prepare(`SELECT status, COUNT(*) as count FROM complaints GROUP BY status`)
    .all();

  const byCategory = db
    .prepare(`SELECT category, COUNT(*) as count FROM complaints GROUP BY category ORDER BY count DESC`)
    .all();

  const thresholdDays = getThresholdDays();
  const overdueRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM complaints
       WHERE status != 'Resolved'
       AND julianday('now') - julianday(created_at) > ?`
    )
    .get(thresholdDays);

  const total = db.prepare('SELECT COUNT(*) as count FROM complaints').get();

  res.json({
    total: total.count,
    byStatus,
    byCategory,
    overdue: { count: overdueRow.count, thresholdDays },
  });
});

module.exports = router;
