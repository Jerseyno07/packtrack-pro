// Fire-and-log outbound email, same convention as notifyFlashFacilityCleared in
// index.js: never blocks or fails the caller's request on the email call, always
// records the outcome via the audit_log writer passed in.
//
// Sends via Ninjacart's internal workflow-engine ("gmail-notification-sender"
// workflow), which relays through Google Workspace server-side — real
// authenticated Gmail sending, so no DNS/DKIM/DMARC setup needed (unlike the
// prior Brevo integration, which bounced on every @ninjacart.com recipient).
// NC_WORKFLOW_AUTH is a Basic-auth credential tied to a specific employee's
// workflow-engine identity, not a dedicated PackTrack service account —
// ask the workflow team for a dedicated credential if this needs to be
// decoupled from that person's account later.

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

const WORKFLOW_REALM = '669df6c5-83de-4ddf-8029-fbaab0c19fb7';

async function sendInviteEmail({ toEmail, role, invitedUserId, writeAudit, pool }) {
  if (!process.env.NC_WORKFLOW_AUTH || !process.env.NC_WORKFLOW_USER_ID || !process.env.NC_WORKFLOW_TOOL_ID) return; // unset — integration disabled, matches FLASH_OUTBOUND_URL convention

  const appUrl = process.env.FRONTEND_ORIGIN || '';
  const roleLabel = ROLE_LABEL[role] || role;
  const userId = process.env.NC_WORKFLOW_USER_ID;

  let requestId = null;
  let errorMessage = null;
  try {
    requestId = require('crypto').randomUUID();
    const res = await fetch(`https://api.ninjacart.in/workflow-engine/realm/${WORKFLOW_REALM}/user/${userId}/v1/execution/request`, {
      method: 'POST',
      headers: {
        'authorization': `Basic ${process.env.NC_WORKFLOW_AUTH}`,
        'x-nc-system-user-id': userId,
        'x-nc-tool-id': process.env.NC_WORKFLOW_TOOL_ID,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        userId: Number(userId),
        requestId,
        workflowName: 'gmail-notification-sender',
        dataMap: {
          input: {
            to: toEmail,
            subject: "You've been added to PackTrack Pro",
            body: inviteEmailHtml({ appUrl, roleLabel }),
            attachments: [],
            cc: [],
            bcc: [],
          },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) errorMessage = data?.message || `HTTP ${res.status}`;
  } catch (e) {
    errorMessage = e.message;
  }

  writeAudit(pool, {
    userId: null,
    action: errorMessage ? 'INVITE_EMAIL_FAILED' : 'INVITE_EMAIL_SENT',
    entityTable: 'users',
    entityId: invitedUserId,
    detail: { to: toEmail, role, request_id: requestId, error: errorMessage },
  }).catch(() => {});
}

module.exports = { sendInviteEmail };
