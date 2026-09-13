const { Resend } = require('resend');

// Fire-and-log outbound email, same convention as notifyFlashFacilityCleared in
// index.js: never blocks or fails the caller's request on the email call, always
// records the outcome via the audit_log writer passed in.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const ROLE_LABEL = {
  ADMIN: 'Admin',
  PM_STORE_EXEC: 'PM Store Exec',
};

async function sendInviteEmail({ toEmail, role, invitedUserId, writeAudit, pool }) {
  if (!resend) return; // RESEND_API_KEY unset — integration disabled, matches FLASH_OUTBOUND_URL convention

  const appUrl = process.env.FRONTEND_ORIGIN || '';
  const roleLabel = ROLE_LABEL[role] || role;
  const from = process.env.RESEND_FROM_EMAIL || 'PackTrack Pro <onboarding@resend.dev>';

  let responseId = null;
  let errorMessage = null;
  try {
    const result = await resend.emails.send({
      from,
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
    if (result.error) errorMessage = result.error.message;
    else responseId = result.data?.id || null;
  } catch (e) {
    errorMessage = e.message;
  }

  writeAudit(pool, {
    userId: null,
    action: errorMessage ? 'INVITE_EMAIL_FAILED' : 'INVITE_EMAIL_SENT',
    entityTable: 'users',
    entityId: invitedUserId,
    detail: { to: toEmail, role, resend_id: responseId, error: errorMessage },
  }).catch(() => {});
}

module.exports = { sendInviteEmail };
