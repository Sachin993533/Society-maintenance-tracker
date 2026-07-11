# Society Maintenance Tracker

A complaint-tracking platform for apartment societies. Residents raise complaints
with photos, admins manage them through a status/priority workflow, and everyone
stays informed through a notice board and email notifications.

```
maintenance-tracker/
├── backend/     Express API + SQLite database
├── frontend/    Static HTML/CSS/JS single-page app (no build step)
├── README.md
└── SYSTEM_DESIGN.md
```

---

## 1. Setup Guide

### Prerequisites
- Node.js 18+
- npm

### Backend

```bash
cd backend
npm install
cp .env.example .env      # edit values as needed (see table below)
npm run seed               # creates a default admin account
npm run dev                 # or: npm start
```

The API starts on `http://localhost:5000` by default. Uploaded photos are served
from `http://localhost:5000/uploads/<filename>`.

Default seeded admin login (change this in any real deployment):
```
email:    admin@society.local
password: Admin@123
```

### Frontend

The frontend is plain HTML/CSS/JS — no build tooling required.

```bash
cd frontend
# open js/config.js and point API_BASE_OVERRIDE at your backend, e.g.
#   window.API_BASE_OVERRIDE = 'http://localhost:5000/api';
# then serve the folder with any static server, e.g.:
npx serve .
# or simply open index.html in a browser (with the backend running)
```

Residents can self-register from the login screen. Admin accounts are not
self-registrable for security — create additional admins directly in the
database, or via `backend/db/seed.js`.

### Environment variables (`backend/.env`)

| Variable | Purpose | Example |
|---|---|---|
| `PORT` | API port | `5000` |
| `JWT_SECRET` | Signing secret for auth tokens | long random string |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `DB_PATH` | SQLite file location | `./db/tracker.db` |
| `OVERDUE_THRESHOLD_DAYS` | Days before an open complaint is flagged overdue | `5` |
| `UPLOAD_DIR` | Where complaint photos are stored | `./uploads` |
| `MAX_UPLOAD_MB` | Max photo size | `5` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:3000` |
| `SMTP_HOST/PORT/SECURE/USER/PASS` | Email credentials (any free-tier SMTP: Gmail App Password, Brevo, Mailtrap, or Ethereal) | — |
| `MAIL_FROM` | From address on outgoing mail | `"Society Maintenance <no-reply@society.local>"` |
| `MAIL_DRY_RUN` | If `true`, emails are logged to console instead of sent (useful with no SMTP set up) | `true` |

### Deploying

- **Backend**: works as-is on Render, Railway, or Fly.io (Node web service).
  SQLite is file-based, so use a host with a persistent disk/volume for
  `db/` and `uploads/` (Render Disks, Railway Volumes, etc.), or swap
  `better-sqlite3` for a managed Postgres connection if you need multi-instance
  scaling.
- **Frontend**: deploy the `frontend/` folder as-is to Vercel, Netlify, or any
  static host. Set `js/config.js`'s `API_BASE_OVERRIDE` to your backend's public
  URL before deploying, and set the backend's `FRONTEND_URL` env var to your
  frontend's public URL (for CORS).

---

## 2. API Documentation

All endpoints are prefixed with `/api`. Authenticated routes require
`Authorization: Bearer <token>`.

### Auth

| Method | Route | Access | Body |
|---|---|---|---|
| POST | `/auth/register` | public | `{ name, email, password, flatNumber? }` — creates a **resident** |
| POST | `/auth/login` | public | `{ email, password }` → `{ user, token }` |
| GET | `/auth/me` | authenticated | returns the current user |

### Complaints

| Method | Route | Access | Notes |
|---|---|---|---|
| POST | `/complaints` | resident | multipart form: `category`, `description`, `photo?`. Starts as `Open` / `Medium` priority. |
| GET | `/complaints/mine` | resident | all complaints raised by the caller, with full history |
| GET | `/complaints` | admin | all complaints. Query params: `category`, `status`, `dateFrom`, `dateTo` (YYYY-MM-DD). Overdue items are sorted first, then by priority, then newest. |
| GET | `/complaints/:id` | owner or admin | complaint + full status history |
| PATCH | `/complaints/:id/status` | admin | `{ status: 'Open'|'In Progress'|'Resolved', note? }` — appends a history entry, emails the resident, and locks the complaint once `Resolved` |
| PATCH | `/complaints/:id/priority` | admin | `{ priority: 'Low'|'Medium'|'High' }` |

### Notices

| Method | Route | Access | Notes |
|---|---|---|---|
| GET | `/notices` | authenticated | important notices pinned first, then newest |
| POST | `/notices` | admin | `{ title, content, important? }` — if `important`, emails every resident |

### Dashboard

| Method | Route | Access | Returns |
|---|---|---|---|
| GET | `/dashboard` | admin | `{ total, byStatus[], byCategory[], overdue: { count, thresholdDays } }` |

All error responses are `{ "error": "message" }` with an appropriate HTTP status
(400 validation, 401 auth, 403 permission, 404 not found).

---

## 3. Database Schema

```
users
  id             INTEGER PK
  name           TEXT
  email          TEXT UNIQUE
  password_hash  TEXT
  role           TEXT  ('resident' | 'admin')
  flat_number    TEXT  NULL
  created_at     TEXT

complaints
  id             INTEGER PK
  resident_id    INTEGER  -> users.id
  category       TEXT
  description    TEXT
  photo_path     TEXT NULL   (e.g. /uploads/169...-abc.jpg)
  status         TEXT  ('Open' | 'In Progress' | 'Resolved')
  priority       TEXT  ('Low' | 'Medium' | 'High')
  created_at     TEXT
  updated_at     TEXT
  resolved_at    TEXT NULL

complaint_history
  id             INTEGER PK
  complaint_id   INTEGER  -> complaints.id
  status         TEXT               (status at this point in time)
  note           TEXT NULL
  actor_id       INTEGER  -> users.id
  actor_role     TEXT     ('resident' | 'admin')
  timestamp      TEXT

notices
  id             INTEGER PK
  title          TEXT
  content        TEXT
  important      INTEGER  (0 | 1)
  created_by     INTEGER  -> users.id
  created_at     TEXT
```

See `SYSTEM_DESIGN.md` for the reasoning behind the history model and overdue
detection.

---

## 4. Demo Walkthrough

1. Run the seed script, then log in as `admin@society.local` / `Admin@123`.
2. Register a second account as a resident (e.g. from an incognito window).
3. As the resident: raise a complaint with a photo.
4. As the admin: open the complaint, set priority to `High`, then move it
   `Open → In Progress` with a note. The resident gets an email (or a console
   log, if `MAIL_DRY_RUN=true`).
5. Wait past `OVERDUE_THRESHOLD_DAYS` (or lower it in `.env` to `0` for a quick
   demo) — the complaint now surfaces at the top of the admin list with an
   **Overdue** badge, and the dashboard's overdue count increases.
6. As the admin: post an important notice — all residents get an email, and it
   pins to the top of the notice board.
7. Resolve the complaint — it locks (no further status changes) and disappears
   from the overdue count.
