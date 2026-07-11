const express = require('express');
const db = require('../db/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { annotateOverdue, isOverdue } = require('../utils/overdue');
const { sendMail, statusChangeEmail } = require('../utils/mailer');

const router = express.Router();
router.use(authenticate);

const VALID_STATUSES = ['Open', 'In Progress', 'Resolved'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];

function getHistory(complaintId) {
  return db
    .prepare(
      `SELECT h.id, h.status, h.note, h.actor_id, h.actor_role, h.timestamp, u.name as actor_name
       FROM complaint_history h
       LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.complaint_id = ?
       ORDER BY h.timestamp ASC`
    )
    .all(complaintId);
}

function getComplaintOr404(id, res) {
  const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
  if (!complaint) {
    res.status(404).json({ error: 'Complaint not found' });
    return null;
  }
  return complaint;
}

// POST /api/complaints  (resident) - raise a new complaint, optional photo
router.post('/', requireRole('resident'), upload.single('photo'), (req, res) => {
  const { category, description } = req.body;
  if (!category || !description) {
    return res.status(400).json({ error: 'category and description are required' });
  }

  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

  const info = db
    .prepare(
      `INSERT INTO complaints (resident_id, category, description, photo_path, status, priority)
       VALUES (?, ?, ?, ?, 'Open', 'Medium')`
    )
    .run(req.user.id, category, description, photoPath);

  const complaintId = info.lastInsertRowid;

  db.prepare(
    `INSERT INTO complaint_history (complaint_id, status, note, actor_id, actor_role)
     VALUES (?, 'Open', 'Complaint raised', ?, 'resident')`
  ).run(complaintId, req.user.id);

  const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(complaintId);
  res.status(201).json({ complaint: { ...complaint, overdue: isOverdue(complaint) }, history: getHistory(complaintId) });
});

// GET /api/complaints/mine (resident) - all complaints raised by the logged-in resident
router.get('/mine', requireRole('resident'), (req, res) => {
  const rows = db
    .prepare('SELECT * FROM complaints WHERE resident_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const withOverdue = annotateOverdue(rows);
  const withHistory = withOverdue.map((c) => ({ ...c, history: getHistory(c.id) }));
  res.json({ complaints: withHistory });
});

// GET /api/complaints (admin) - all complaints, filterable, overdue surfaced first
router.get('/', requireRole('admin'), (req, res) => {
  const { category, status, dateFrom, dateTo } = req.query;

  let sql = `SELECT c.*, u.name as resident_name, u.flat_number, u.email as resident_email
             FROM complaints c JOIN users u ON u.id = c.resident_id WHERE 1=1`;
  const params = [];

  if (category) {
    sql += ' AND c.category = ?';
    params.push(category);
  }
  if (status) {
    sql += ' AND c.status = ?';
    params.push(status);
  }
  if (dateFrom) {
    sql += ' AND date(c.created_at) >= date(?)';
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ' AND date(c.created_at) <= date(?)';
    params.push(dateTo);
  }

  sql += ' ORDER BY c.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  const withOverdue = annotateOverdue(rows);

  // Overdue complaints surface at the top, then by priority (High first), then newest first.
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  withOverdue.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[a.priority] - priorityRank[b.priority];
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  res.json({ complaints: withOverdue });
});

// GET /api/complaints/:id - full detail + history (resident sees only their own; admin sees all)
router.get('/:id', (req, res) => {
  const complaint = getComplaintOr404(req.params.id, res);
  if (!complaint) return;

  if (req.user.role === 'resident' && complaint.resident_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own complaints' });
  }

  res.json({ complaint: { ...complaint, overdue: isOverdue(complaint) }, history: getHistory(complaint.id) });
});

// PATCH /api/complaints/:id/status (admin) - move through lifecycle, records history, emails resident
router.patch('/:id/status', requireRole('admin'), (req, res) => {
  const { status, note } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }

  const complaint = getComplaintOr404(req.params.id, res);
  if (!complaint) return;

  if (complaint.status === 'Resolved') {
    return res.status(400).json({ error: 'This complaint is already resolved and closed' });
  }

  const now = new Date().toISOString();
  const resolvedAt = status === 'Resolved' ? now : null;

  db.prepare(
    `UPDATE complaints SET status = ?, updated_at = datetime('now'), resolved_at = COALESCE(?, resolved_at) WHERE id = ?`
  ).run(status, resolvedAt, complaint.id);

  db.prepare(
    `INSERT INTO complaint_history (complaint_id, status, note, actor_id, actor_role) VALUES (?, ?, ?, ?, 'admin')`
  ).run(complaint.id, status, note || null, req.user.id);

  // Notify resident by email (best-effort; failures don't block the update)
  const resident = db.prepare('SELECT * FROM users WHERE id = ?').get(complaint.resident_id);
  if (resident) {
    const { subject, text } = statusChangeEmail({
      residentName: resident.name,
      complaintId: complaint.id,
      category: complaint.category,
      oldStatus: complaint.status,
      newStatus: status,
      note,
    });
    sendMail({ to: resident.email, subject, text });
  }

  const updated = db.prepare('SELECT * FROM complaints WHERE id = ?').get(complaint.id);
  res.json({ complaint: { ...updated, overdue: isOverdue(updated) }, history: getHistory(complaint.id) });
});

// PATCH /api/complaints/:id/priority (admin)
router.patch('/:id/priority', requireRole('admin'), (req, res) => {
  const { priority } = req.body;
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of ${VALID_PRIORITIES.join(', ')}` });
  }

  const complaint = getComplaintOr404(req.params.id, res);
  if (!complaint) return;

  db.prepare(`UPDATE complaints SET priority = ?, updated_at = datetime('now') WHERE id = ?`).run(
    priority,
    complaint.id
  );

  const updated = db.prepare('SELECT * FROM complaints WHERE id = ?').get(complaint.id);
  res.json({ complaint: { ...updated, overdue: isOverdue(updated) } });
});

module.exports = router;
