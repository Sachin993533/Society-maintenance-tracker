// A complaint is "overdue" if it is not yet Resolved and has been open
// longer than OVERDUE_THRESHOLD_DAYS (configurable via .env).
// This is computed on read rather than stored, so changing the threshold
// takes effect immediately across all existing complaints.

function getThresholdDays() {
  return Number(process.env.OVERDUE_THRESHOLD_DAYS || 5);
}

function isOverdue(complaint, thresholdDays = getThresholdDays()) {
  if (complaint.status === 'Resolved') return false;
  const createdAt = new Date(complaint.created_at + 'Z'); // SQLite stores UTC naive strings
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > thresholdDays;
}

function annotateOverdue(complaints, thresholdDays = getThresholdDays()) {
  return complaints.map((c) => ({
    ...c,
    overdue: isOverdue(c, thresholdDays),
  }));
}

module.exports = { getThresholdDays, isOverdue, annotateOverdue };
