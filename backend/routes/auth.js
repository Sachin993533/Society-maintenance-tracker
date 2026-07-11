const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
// Residents self-register. Admin accounts are seeded/created directly in the DB
// (see db/seed.js) rather than through public self-registration, for security.
router.post('/register', (req, res) => {
  const { name, email, password, flatNumber } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, flat_number) VALUES (?, ?, ?, 'resident', ?)`
    )
    .run(name, email.toLowerCase(), hash, flatNumber || null);

  const user = db.prepare('SELECT id, name, email, role, flat_number FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);

  res.status(201).json({ user, token });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user);
  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

// GET /api/auth/me
const { authenticate } = require('../middleware/auth');
router.get('/me', authenticate, (req, res) => {
  const user = db
    .prepare('SELECT id, name, email, role, flat_number, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ user });
});

module.exports = router;
