// Mailer interface for the PM Store reports engine. Two implementations;
// which one is active is picked by reportService from REPORT_MAILER env var.

// Default — never sends anything. Writes the generated workbook(s) to /tmp
// and logs what *would* have been sent, so reports/scheduler can be exercised
// end-to-end before real delivery is wired up.
class LogMailer {
  async send({ to, cc, subject, html, attachments }) {
    const fs = require('fs');
    const paths = (attachments || []).map((a) => {
      const p = `/tmp/${a.filename}`;
      fs.writeFileSync(p, a.buffer);
      return p;
    });
    console.log('[LogMailer] would send:', JSON.stringify({ to, cc, subject, attachments: paths }));
    console.log('[LogMailer] html body:\n', html);
    return { sent: false, mailer: 'LogMailer', attachmentPaths: paths };
  }
}

// Real delivery mechanism, proven via scripts/sendTestReportMail.js's many
// test sends this session: uploads each attachment to the public R2
// pmconfig bucket (workflow requires a URL, not a raw file), then sends one
// email (all recipients at once, not one call per recipient) via Ninjacart's
// internal workflow-engine gmail-notification-sender integration.
const WORKFLOW_REALM = '669df6c5-83de-4ddf-8029-fbaab0c19fb7';

class WorkflowMailer {
  async send({ to, cc, subject, html, attachments }) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const crypto = require('crypto');

    const r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });

    const attachmentUrls = [];
    for (const a of attachments || []) {
      const key = `report-mail/${Date.now()}-${a.filename}`;
      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_PMCONFIG_BUCKET_NAME,
        Key: key,
        Body: a.buffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      attachmentUrls.push({ url: `${process.env.R2_PMCONFIG_PUBLIC_URL}/${key}` });
    }

    // The gmail-notification-sender workflow takes `to` as a single email
    // string (proven by lib/mailer.js's invite emails) — passing an array,
    // as this used to, is accepted without error but silently sends nothing.
    // So: first `to` address goes in `to`, every other recipient (rest of
    // `to` + all of `cc`) is folded into `cc`.
    const [primaryTo, ...restTo] = to || [];
    if (!primaryTo) throw new Error('WorkflowMailer: no recipients given');
    const ccAll = [...restTo, ...(cc || [])];

    const userId = process.env.NC_WORKFLOW_USER_ID;
    const res = await fetch(`https://api.ninjacart.in/workflow-engine/realm/${WORKFLOW_REALM}/user/${userId}/v1/execution/request`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${process.env.NC_WORKFLOW_AUTH}`,
        'x-nc-system-user-id': userId,
        'x-nc-tool-id': process.env.NC_WORKFLOW_TOOL_ID,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        userId: Number(userId),
        requestId: crypto.randomUUID(),
        workflowName: 'gmail-notification-sender',
        dataMap: { input: { to: primaryTo, cc: ccAll, bcc: [], subject, body: html, attachments: attachmentUrls } },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(`WorkflowMailer send failed: ${JSON.stringify(data)}`);
    return { sent: true, mailer: 'WorkflowMailer', response: data };
  }
}

module.exports = { LogMailer, WorkflowMailer };
