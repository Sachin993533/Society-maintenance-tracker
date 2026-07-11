# System Design Write-Up

*(≈780 words)*

## Complaint History Model

Rather than storing status as a single mutable field, every change is appended
to a separate `complaint_history` table: `(complaint_id, status, note, actor_id,
actor_role, timestamp)`. The `complaints` row itself keeps a `status` column
too, but that's a **denormalized cache** of "the most recent history entry" —
it exists purely so list/filter queries don't need a join and subquery to know
current status. The history table is the source of truth.

This event-sourced-lite approach was chosen over a single mutable status field
for three reasons:

1. **Auditability.** Admins and residents can see exactly who changed what and
   when, including any note left. A single-column status would lose all of
   that the moment it's overwritten.
2. **Simple queries in both directions.** "What's the current state of
   complaint #42?" is `SELECT status FROM complaints WHERE id=?` (fast, no
   aggregation). "What's the full timeline?" is a straightforward indexed
   range scan on `complaint_history WHERE complaint_id=?`. Neither query has
   to reconstruct state from scratch.
3. **Extensibility.** Adding new event types later (e.g. "reassigned",
   "escalated") only means inserting new rows with a different `status`/`note`
   shape — no schema migration on the hot path.

On creation, a complaint immediately gets one history row (`status='Open'`,
note `'Complaint raised'`, `actor_role='resident'`), so the timeline always
starts at raise-time rather than at the first admin action. Every subsequent
`PATCH /complaints/:id/status` call does two things atomically-in-sequence:
update `complaints.status` (+ `updated_at`, and `resolved_at` if resolving),
then insert a history row. Once `status='Resolved'`, the API rejects further
status changes (`400`) — this is the "closed" lock the spec asks for. Priority
changes are tracked as a live field, not history, since priority is an
attribute of the complaint (how urgent it is *right now*) rather than a
lifecycle event to audit — the spec doesn't ask for a priority-change trail,
and adding one would blur two different concepts in one table.

## Overdue Detection

Overdue status is **computed on read, not stored**. `OVERDUE_THRESHOLD_DAYS`
lives in `.env` and is evaluated per-request against `created_at`:
`status != 'Resolved' AND (now − created_at) > threshold`. This was chosen
over a stored boolean flag or a cron job for one main reason: correctness
under configuration change. If an admin changes the threshold from 5 days to
3, a stored flag would be instantly stale for every existing complaint until
some batch job re-swept the table. A computed value is correct immediately,
for free, with no background job to schedule or fail silently.

The cost is a bit more arithmetic per request, but at society-complaint scale
(hundreds to low thousands of rows) `julianday(now) - julianday(created_at)`
in SQLite is trivial — there's no need to prematurely optimize with
materialized flags. The admin list endpoint sorts overdue-first, then by
priority (High → Low), then newest — so the most urgent, longest-neglected
work always surfaces at the top without the admin having to filter for it.
The dashboard's overdue count uses the same threshold via the same helper
logic, so the two views can never disagree with each other.

## Photo Handling

Complaint photos are handled with `multer`'s disk storage: files are validated
by MIME type (JPEG/PNG/WEBP/GIF only) and size (`MAX_UPLOAD_MB`, default 5MB)
at the middleware layer, before ever touching a route handler, and renamed to
a random hex string on disk (avoiding path traversal or filename collisions
from user input). The DB only stores a relative path (`/uploads/<file>`);
the actual bytes live on the filesystem, served statically by Express. This
keeps the database small and fast to query, and makes local development
trivial (no object-storage account needed). The tradeoff is that a
multi-instance/horizontally-scaled deployment needs a shared volume or a swap
to S3/Cloudinary-style storage — noted in the README as the natural next step,
since the spec's scope is a single hosted instance.

## Notification Flow

Two triggers fire emails, both **best-effort and non-blocking**: a status
change on a complaint (to that complaint's resident) and an important notice
(to *all* residents, fetched by role at post-time). Both go through one
`sendMail()` helper wrapping `nodemailer`, configured against any SMTP
provider via env vars. Failures are caught and logged rather than thrown —
a bounced or misconfigured email should never roll back the underlying status
update or notice post, since the write to the database is the operation the
admin actually asked for; email is a side effect, not a transaction
participant. A `MAIL_DRY_RUN` flag logs emails to the console instead of
sending them, so the whole flow is demoable and testable with zero SMTP setup.
