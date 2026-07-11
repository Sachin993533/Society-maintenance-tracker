// Seeds a default admin account so the app is usable immediately after setup.
// Run with: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const ADMIN_EMAIL = 'admin@society.local';
const ADMIN_PASSWORD = 'Admin@123';

function seed() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    console.log('Admin user already exists, skipping seed.');
    return;
  }

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(
    `INSERT INTO users (name, email, password_hash, role, flat_number) VALUES (?, ?, ?, 'admin', NULL)`
  ).run('Society Admin', ADMIN_EMAIL, hash);

  console.log('Seeded admin user:');
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log('Please log in and change this password in a real deployment.');
}

seed();
