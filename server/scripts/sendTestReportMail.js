#!/usr/bin/env node
// One-off test send for the PM Store reports engine — NOT the official
// WorkflowMailer (that stays a stub until delivery is formally decided).
// Reuses the existing Ninjacart workflow-engine gmail-notification-sender
// integration (already proven for invite emails, server/lib/mailer.js) and
// the existing public R2 bucket pattern (uploadPmconfigPhoto in index.js) to
// get a public attachment link, since that workflow requires one.
//
// Usage: node scripts/sendTestReportMail.js <reportKey> <date> <to,comma,separated>

require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generate } = require('../reports/reportService');

const WORKFLOW_REALM = '669df6c5-83de-4ddf-8029-fbaab0c19fb7';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function uploadPublic(key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_PMCONFIG_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  return `${process.env.R2_PMCONFIG_PUBLIC_URL}/${key}`;
}

async function sendViaWorkflow({ to, subject, html, attachmentUrl }) {
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
      dataMap: { input: { to, subject, body: html, attachments: attachmentUrl ? [{ url: attachmentUrl }] : [], cc: [], bcc: [] } },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(`workflow send failed: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const [reportKey, date, toCsv] = process.argv.slice(2);
  if (!reportKey || !date || !toCsv) {
    console.error('Usage: node scripts/sendTestReportMail.js <reportKey> <date> <to,comma,separated>');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { subject, html, attachments } = await generate(pool, reportKey, { asOfDate: date });
  const file = attachments[0];
  const key = `test-reports/${Date.now()}-${file.filename}`;
  const url = await uploadPublic(key, file.buffer);
  console.log('Uploaded test attachment to:', url);

  for (const to of toCsv.split(',').map((s) => s.trim())) {
    const result = await sendViaWorkflow({ to, subject: `[TEST] ${subject}`, html, attachmentUrl: url });
    console.log('Sent to', to, '-', result.data?.action || result.status);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
