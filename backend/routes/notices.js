const express = require('express');
const db = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendMail, noticeEmail } = require('../utils/mailer');

const router = express.Router();
router.use(authenticate);

// GET /api/notices - everyone can view, important/pinned notices first
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, u.name as author_name FROM notices n
       LEFT JOIN users u ON u.id = n.created_by
       ORDER BY n.important DESC, n.created_at DESC`
    )
    .all();
  res.json({ notices: rows });
});

// POST /api/notices (admin) - post a notice, optionally mark important -> emails all residents
router.post('/', requireRole('admin'), (req, res) => {
  const { title, content, important } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const isImportant = important ? 1 : 0;

  const info = db
    .prepare(`INSERT INTO notices (title, content, important, created_by) VALUES (?, ?, ?, ?)`)
    .run(title, content, isImportant, req.user.id);

  if (isImportant) {
    const residents = db.prepare(`SELECT name, email FROM users WHERE role = 'resident'`).all();
    residents.forEach((resident) => {
      const { subject, text } = noticeEmail({ residentName: resident.name, title, content });
      sendMail({ to: resident.email, subject, text });
    });
  }

  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ notice });
});

module.exports = router;
