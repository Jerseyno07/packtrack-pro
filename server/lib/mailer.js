const nodemailer = require('nodemailer');

// Fire-and-log outbound email, same convention as notifyFlashFacilityCleared in
// index.js: never blocks or fails the caller's request on the email call, always
// records the outcome via the audit_log writer passed in.
//
// Sends via Gmail SMTP using an App Password on an existing Google account
// (no domain/DNS verification needed, unlike Resend/SES) — GMAIL_USER is the
// sending address, GMAIL_APP_PASSWORD the 16-character app password.
const transporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      // Railway's container resolves smtp.gmail.com to an IPv6 address that isn't
      // actually routable there (ENETUNREACH), a known Node 18 DNS-ordering issue
      // on hosts without real IPv6 egress. Forcing IPv4 avoids it entirely.
      family: 4,
    })
  : null;

const ROLE_LABEL = {
  ADMIN: 'Admin',
  PM_STORE_EXEC: 'PM Store Exec',
};

async function sendInviteEmail({ toEmail, role, invitedUserId, writeAudit, pool }) {
  if (!transporter) return; // GMAIL_USER/GMAIL_APP_PASSWORD unset — integration disabled, matches FLASH_OUTBOUND_URL convention

  const appUrl = process.env.FRONTEND_ORIGIN || '';
  const roleLabel = ROLE_LABEL[role] || role;

  let messageId = null;
  let errorMessage = null;
  try {
    const result = await transporter.sendMail({
      from: `PackTrack Pro <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: "You've been added to PackTrack Pro",
      html: `
        <p>Hi,</p>
        <p>You've been given <strong>${roleLabel}</strong> access to PackTrack Pro.</p>
        <p>Sign in with your Ninjacart Google account at
          <a href="${appUrl}">${appUrl}</a> — no password needed, just use the
          "Sign in with Google" button.</p>
        <p>— PackTrack Pro</p>
      `,
    });
    messageId = result.messageId || null;
  } catch (e) {
    errorMessage = e.message;
  }

  writeAudit(pool, {
    userId: null,
    action: errorMessage ? 'INVITE_EMAIL_FAILED' : 'INVITE_EMAIL_SENT',
    entityTable: 'users',
    entityId: invitedUserId,
    detail: { to: toEmail, role, message_id: messageId, error: errorMessage },
  }).catch(() => {});
}

module.exports = { sendInviteEmail };
