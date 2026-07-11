const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const dryRun = process.env.MAIL_DRY_RUN === 'true' || !process.env.SMTP_USER;

  if (dryRun) {
    // Local/dev fallback: don't fail the request just because SMTP isn't configured.
    console.log('--- [MAIL_DRY_RUN] Email not actually sent ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('-----------------------------------------------');
    return { dryRun: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    return info;
  } catch (err) {
    // Email failures should never break the underlying business action
    // (e.g. a status update should still succeed even if the email bounces).
    console.error('Failed to send email:', err.message);
    return { error: err.message };
  }
}

function statusChangeEmail({ residentName, complaintId, category, oldStatus, newStatus, note }) {
  const subject = `Complaint #${complaintId} status updated: ${newStatus}`;
  const text =
    `Hi ${residentName},\n\n` +
    `Your complaint #${complaintId} (${category}) status has changed from "${oldStatus}" to "${newStatus}".\n` +
    (note ? `Note from admin: ${note}\n\n` : '\n') +
    `You can view the full history in the Society Maintenance Tracker.\n\n` +
    `Thank you.`;
  return { subject, text };
}

function noticeEmail({ residentName, title, content }) {
  const subject = `Important notice: ${title}`;
  const text =
    `Hi ${residentName},\n\n` +
    `A new important notice has been posted:\n\n"${title}"\n\n${content}\n\n` +
    `Please check the notice board for more details.`;
  return { subject, text };
}

module.exports = { sendMail, statusChangeEmail, noticeEmail };
