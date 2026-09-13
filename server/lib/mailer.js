// Fire-and-log outbound email, same convention as notifyFlashFacilityCleared in
// index.js: never blocks or fails the caller's request on the email call, always
// records the outcome via the audit_log writer passed in.
//
// Sends via Brevo's transactional email HTTPS API (plain fetch, no SDK, matching
// the rest of this codebase's outbound-integration style). Deliberately NOT
// SMTP: Railway blocks outbound SMTP entirely (confirmed live — both IPv4 and
// IPv6 connections to smtp.gmail.com timed out), so this must be a REST call.
// BREVO_SENDER_EMAIL is a single verified sender (Brevo's "Single Sender"
// verification — a code emailed to that address, no DNS/domain ownership
// needed), not a verified domain, so deliverability is weaker than a fully
// DKIM-authenticated domain but functional for this volume.

const ROLE_LABEL = {
  ADMIN: 'Admin',
  PM_STORE_EXEC: 'PM Store Exec',
};

async function sendInviteEmail({ toEmail, role, invitedUserId, writeAudit, pool }) {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) return; // unset — integration disabled, matches FLASH_OUTBOUND_URL convention

  const appUrl = process.env.FRONTEND_ORIGIN || '';
  const roleLabel = ROLE_LABEL[role] || role;

  let messageId = null;
  let errorMessage = null;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: 'PackTrack Pro' },
        to: [{ email: toEmail }],
        subject: "You've been added to PackTrack Pro",
        htmlContent: `
          <p>Hi,</p>
          <p>You've been given <strong>${roleLabel}</strong> access to PackTrack Pro.</p>
          <p>Sign in with your Ninjacart Google account at
            <a href="${appUrl}">${appUrl}</a> — no password needed, just use the
            "Sign in with Google" button.</p>
          <p>— PackTrack Pro</p>
        `,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) errorMessage = data?.message || `HTTP ${res.status}`;
    else messageId = data?.messageId || null;
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
