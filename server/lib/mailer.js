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

// Inline-styled, table-based layout — required for email clients (Gmail/Outlook
// strip <style> blocks and mis-render flexbox/box-shadow), no external images
// (no hosted logo to point at), matches the app's own blue package-icon branding.
function inviteEmailHtml({ appUrl, roleLabel }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:32px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:36px;height:36px;background:#2563eb;border-radius:10px;text-align:center;vertical-align:middle;font-size:18px;line-height:36px;">📦</td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;color:#0f172a;">PackTrack Pro</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 32px 8px 32px;font-size:15px;line-height:1.6;color:#334155;">
        <p style="margin:0 0 16px 0;">Hi,</p>
        <p style="margin:0 0 16px 0;">You've been given <strong style="color:#0f172a;">${roleLabel}</strong> access to PackTrack Pro. Sign in with your Ninjacart Google account — no password to set or remember.</p>
      </td></tr>
      <tr><td style="padding:8px 32px 32px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:10px;background:#2563eb;">
            <a href="${appUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Sign in with Google</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 32px 32px 32px;border-top:1px solid #f1f5f9;">
        <p style="margin:20px 0 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">
          Button not working? Copy this link: <a href="${appUrl}" style="color:#94a3b8;">${appUrl}</a><br/>
          You're receiving this because an admin added you to PackTrack Pro.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function inviteEmailText({ appUrl, roleLabel }) {
  return [
    'Hi,',
    '',
    `You've been given ${roleLabel} access to PackTrack Pro. Sign in with your Ninjacart Google account — no password to set or remember.`,
    '',
    `Sign in: ${appUrl}`,
    '',
    "You're receiving this because an admin added you to PackTrack Pro.",
  ].join('\n');
}

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
        htmlContent: inviteEmailHtml({ appUrl, roleLabel }),
        textContent: inviteEmailText({ appUrl, roleLabel }),
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
