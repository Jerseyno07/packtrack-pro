// Slack daily reports — three scheduled reports posted to #packtrack-alerts.
// Env vars required:
//   SLACK_REPORTS_WEBHOOK  — Incoming Webhook URL for #packtrack-alerts (text messages)
//   SLACK_BOT_TOKEN        — xoxb-... Bot Token (for CSV file uploads)
//   SLACK_CHANNEL_ID       — Channel ID for #packtrack-alerts (e.g. C08XXXXXXXX)
//   DATABASE_URL           — Neon connection string (shared with index.js)
//
// Cron schedule (Asia/Kolkata / IST):
//   00:00  — auto-trigger consumption run (Bangalore facilities only) and auto-accept
//   01:00  — Daily Consumption Details report
//   21:00  — FC Dispatch vs CC GRN report
//   CC Balance vs Audit — sendCCBalanceVsAudit() is ready; cron TBD

// Bangalore FC (9382) + all Bangalore CCs — only these run in the nightly cron.
const BLR_FACILITIES = ['9382', '3202', '3404', '3949', '9924', '9948', '10013', '10023', '10070', '10147', '10152'];

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const cron = require('node-cron');
const { runConsumption } = require('./consumptionScraper');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayUnit(row) {
  return row.meters_per_unit ? 'm' : row.stickers_per_roll ? 'units' : row.pieces_per_kg ? 'Kg' : row.unit;
}

function fmt(n) {
  return Number(n).toLocaleString();
}

// Split text into ≤3900-char chunks on newline boundaries (Slack 4000-char limit).
function chunkText(text, max = 3900) {
  const chunks = [];
  while (text.length > max) {
    let cut = text.lastIndexOf('\n', max);
    if (cut <= 0) cut = max;
    chunks.push(text.slice(0, cut));
    text = text.slice(cut + 1);
  }
  if (text.trim()) chunks.push(text);
  return chunks;
}

async function postSlack(text) {
  const webhook = process.env.SLACK_REPORTS_WEBHOOK;
  if (!webhook) { console.warn('[slackReports] SLACK_REPORTS_WEBHOOK not set'); return; }
  for (const chunk of chunkText(text)) {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk }),
    }).catch((e) => console.error('[slackReports] Slack POST failed:', e.message));
  }
}

// Upload a CSV string as a file attachment to the Slack channel.
// Requires SLACK_BOT_TOKEN + SLACK_CHANNEL_ID; silently skips if either is missing.
async function uploadCsvToSlack(csvString, filename, title) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!token || !channelId) {
    console.warn('[slackReports] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not set — skipping CSV upload');
    return;
  }

  const byteLength = Buffer.byteLength(csvString, 'utf8');

  // Step 1: request an upload URL from Slack (requires form-encoded body)
  const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ filename, length: byteLength }).toString(),
  });
  const urlData = await urlRes.json();
  if (!urlData.ok) throw new Error(`Slack getUploadURL failed: ${urlData.error}`);

  // Step 2: PUT the file content to the pre-signed upload URL
  await fetch(urlData.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csvString,
  });

  // Step 3: complete the upload and share to channel
  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ id: urlData.file_id, title }], channel_id: channelId }),
  });
  const completeData = await completeRes.json();
  if (!completeData.ok) throw new Error(`Slack completeUpload failed: ${completeData.error}`);
}

function istDateLabel(d = new Date()) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// ── Auto-accept a PENDING_REVIEW run (mirrors the HTTP accept endpoint) ───────

async function acceptRun(runId) {
  const runRes = await pool.query('SELECT * FROM consumption_runs WHERE id = $1', [runId]);
  if (!runRes.rows.length) throw new Error(`Run ${runId} not found`);
  const run = runRes.rows[0];
  if (run.status !== 'PENDING_REVIEW') throw new Error(`Run ${runId} is ${run.status}, expected PENDING_REVIEW`);

  const groups = await pool.query(`
    SELECT crl.warehouse_id, crl.material_code, m.id AS material_id,
           SUM(crl.qty_deducted) AS total_qty, ARRAY_AGG(crl.id) AS line_ids
    FROM consumption_run_lines crl
    JOIN materials m ON m.code = crl.material_code
    WHERE crl.run_id = $1 AND crl.status = 'PENDING'
    GROUP BY crl.warehouse_id, crl.material_code, m.id
  `, [runId]);

  let committed = 0;
  const movementDate = new Date(new Date(run.scraped_to).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const g of groups.rows) {
    const totalQty = Number(g.total_qty);
    const { rows: [{ qty }] } = await pool.query(
      `SELECT COALESCE(SUM(qty_delta), 0) AS qty FROM stock_ledger WHERE warehouse_id = $1 AND material_id = $2`,
      [g.warehouse_id, g.material_id]
    );
    const lineStatus = Number(qty) - totalQty < 0 ? 'STOCK_BELOW_ZERO' : 'DEDUCTED';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [{ id: ledgerId }] } = await client.query(
        `INSERT INTO stock_ledger (warehouse_id, material_id, movement_type, qty_delta, unit_cost, ref_table, ref_id, movement_date)
         VALUES ($1,$2,'CONSUMPTION',$3,0,'consumption_runs',$4,$5) RETURNING id`,
        [g.warehouse_id, g.material_id, -totalQty, runId, movementDate]
      );
      await client.query(
        `UPDATE consumption_run_lines SET status = $1, ledger_id = $2 WHERE id = ANY($3)`,
        [lineStatus, ledgerId, g.line_ids]
      );
      await client.query('COMMIT');
      committed += g.line_ids.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  await pool.query(
    `UPDATE consumption_runs SET status = 'COMPLETED', deducted_lines = $1, completed_at = now() WHERE id = $2`,
    [committed, runId]
  );
  return committed;
}

// ── Nightly consumption run (00:00 IST) ───────────────────────────────────────
// Creates and auto-accepts a run for all facilities for the previous day.

async function runAndAcceptConsumption(facilityCodes = null) {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const runDate = nowIst.toISOString().slice(0, 10);
  const yest = new Date(nowIst);
  yest.setUTCDate(yest.getUTCDate() - 1);
  const scrapedDate = yest.toISOString().slice(0, 10);
  const facilityFilter = facilityCodes ? [...facilityCodes].sort().join(',') : null;

  // If a non-failed run already exists for today (matching same facility scope), accept or skip.
  const existing = await pool.query(
    `SELECT id, status FROM consumption_runs WHERE run_date = $1
     AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)
     AND status NOT IN ('FAILED','CANCELLED')`,
    [runDate, facilityFilter]
  );
  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    if (ex.status === 'PENDING_REVIEW') {
      console.log(`[slackReports] Existing PENDING_REVIEW run ${ex.id} — auto-accepting`);
      await acceptRun(ex.id);
    } else {
      console.log(`[slackReports] Run for ${runDate} already in status ${ex.status} — skipping`);
    }
    return ex.id;
  }

  // Clean up stale FAILED/CANCELLED rows so the INSERT doesn't hit a unique conflict.
  await pool.query(
    `DELETE FROM consumption_run_lines WHERE run_id IN (
       SELECT id FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
       AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)
     )`, [runDate, facilityFilter]
  );
  await pool.query(
    `DELETE FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
     AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)`,
    [runDate, facilityFilter]
  );

  const { rows: [{ id: runId }] } = await pool.query(
    `INSERT INTO consumption_runs (run_date, scraped_from, scraped_to, status, facility_filter, progress_pct, progress_msg)
     VALUES ($1,$2,$2,'RUNNING',$3,0,'Starting up…') RETURNING id`,
    [runDate, scrapedDate, facilityFilter]
  );

  console.log(`[slackReports] Nightly consumption run ${runId} started for ${scrapedDate} (facilities: ${facilityFilter ?? 'all'})`);
  await runConsumption({ runId, facilityCodes });
  const committed = await acceptRun(runId);
  console.log(`[slackReports] Run ${runId} accepted — ${committed} lines committed`);
  await sendDailyConsumption(runId);
  return runId;
}

// ── Report 1: FC Dispatch vs CC GRN (17:00 IST) ──────────────────────────────

async function sendFCDispatchVsCCGRN() {
  // Use IST date for "today"
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const dateLabel = istDateLabel();

  const { rows } = await pool.query(`
    SELECT
      fw.name AS fc_name, fw.code AS fc_code,
      tw.name AS cc_name, tw.code AS cc_code,
      m.code  AS material_code, m.unit, m.meters_per_unit, m.stickers_per_roll,
      si.issued_qty,
      COALESCE(SUM(sr.received_qty), 0)  AS received_qty,
      COALESCE(SUM(sr.shortage_qty), 0)  AS shortage_qty,
      COALESCE(SUM(sr.damage_qty),   0)  AS damage_qty,
      si.issued_qty
        - COALESCE(SUM(sr.received_qty + sr.shortage_qty + sr.damage_qty), 0) AS pending_qty,
      COALESCE(cs.on_hand_qty, 0) AS current_stock
    FROM stock_issues si
    JOIN warehouses fw  ON fw.id = si.from_warehouse_id
    JOIN warehouses tw  ON tw.id = si.to_warehouse_id
    JOIN materials  m   ON m.id  = si.material_id
    LEFT JOIN stock_receipts sr ON sr.stock_issue_id = si.id
    LEFT JOIN v_current_stock cs ON cs.warehouse_id = si.to_warehouse_id AND cs.material_id = si.material_id
    WHERE si.issue_date = $1
    GROUP BY fw.name, fw.code, tw.name, tw.code,
             m.code, m.unit, m.meters_per_unit, m.stickers_per_roll,
             si.issued_qty, cs.on_hand_qty
    ORDER BY tw.name, m.code
  `, [today]);

  if (rows.length === 0) {
    return postSlack(`📦 *FC Dispatch → CC GRN Report*  |  ${dateLabel}\n_No dispatches recorded for today._`);
  }

  // Group by CC facility
  const byCc = new Map();
  for (const r of rows) {
    const key = r.cc_code;
    if (!byCc.has(key)) byCc.set(key, { cc_name: r.cc_name, cc_code: r.cc_code, fc_name: r.fc_name, fc_code: r.fc_code, lines: [] });
    byCc.get(key).lines.push(r);
  }

  let text = `📦 *FC Dispatch → CC GRN Report*  |  ${dateLabel}\n\n`;
  let csv = 'FC,CC,Material,Unit,Dispatched,Received,Shortage,Pending,Current Stock\n';

  for (const { cc_name, cc_code, fc_name, fc_code, lines } of byCc.values()) {
    text += `*${cc_name} (${cc_code})* ← ${fc_name} (${fc_code})\n\`\`\``;
    text += `${'MATERIAL'.padEnd(14)}${'DISPATCHED'.padEnd(14)}${'RECEIVED'.padEnd(14)}${'SHORTAGE'.padEnd(12)}${'PENDING'.padEnd(12)}CURR STOCK\n`;
    for (const r of lines) {
      const u = displayUnit(r);
      const cell = (n) => `${fmt(n)} ${u}`.padEnd(14);
      const cell12 = (n) => `${fmt(n)} ${u}`.padEnd(12);
      text += `${r.material_code.padEnd(14)}${cell(r.issued_qty)}${cell(r.received_qty)}${cell12(r.shortage_qty)}${cell12(r.pending_qty)}${fmt(r.current_stock)} ${u}\n`;
      csv += `"${fc_name} (${fc_code})","${cc_name} (${cc_code})","${r.material_code}","${u}",${r.issued_qty},${r.received_qty},${r.shortage_qty},${r.pending_qty},${r.current_stock}\n`;
    }
    text += '```\n';
  }

  await postSlack(text);
  const dateSlug = today.replace(/-/g, '');
  await uploadCsvToSlack(csv, `fc-dispatch-cc-grn-${dateSlug}.csv`, `FC Dispatch → CC GRN — ${dateLabel}`);
}

// ── Report 2: Daily Consumption Details (00:15 IST) ──────────────────────────

async function sendDailyConsumption(runId = null) {
  // Resolve which run to report on:
  // - If runId provided (called from accept endpoint), use that run.
  // - Otherwise fall back to the most recently completed run.
  let runRow;
  if (runId) {
    const r = await pool.query('SELECT * FROM consumption_runs WHERE id = $1', [runId]);
    runRow = r.rows[0];
  } else {
    const r = await pool.query(`SELECT * FROM consumption_runs WHERE status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1`);
    runRow = r.rows[0];
  }

  if (!runRow) {
    return postSlack(`🏭 *Daily Consumption Report*\n_No completed consumption run found._`);
  }

  // Label using scraped_to converted to IST date
  const scrapedToIst = new Date(runRow.scraped_to).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
  const dateSlug = new Date(runRow.scraped_to).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');

  const { rows } = await pool.query(`
    SELECT
      w.name AS warehouse_name, w.code AS warehouse_code,
      crl.material_code, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
      SUM(crl.qty_deducted) AS qty_consumed
    FROM consumption_run_lines crl
    JOIN warehouses w ON w.id  = crl.warehouse_id
    JOIN materials  m ON m.code = crl.material_code
    WHERE crl.run_id = $1
      AND crl.status IN ('DEDUCTED', 'STOCK_BELOW_ZERO')
    GROUP BY w.name, w.code, crl.material_code, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg
    ORDER BY w.name, crl.material_code
  `, [runRow.id]);

  if (rows.length === 0) {
    return postSlack(`🏭 *Daily Consumption Report*  |  ${scrapedToIst}\n_No consumption lines found for this run._`);
  }

  const byWh = new Map();
  for (const r of rows) {
    if (!byWh.has(r.warehouse_code)) byWh.set(r.warehouse_code, { name: r.warehouse_name, code: r.warehouse_code, lines: [] });
    byWh.get(r.warehouse_code).lines.push(r);
  }

  let text = `🏭 *Daily Consumption Report*  |  ${scrapedToIst}\n\n`;
  let csv = 'Facility,Material Code,Unit,Qty Consumed\n';

  for (const { name, code, lines } of byWh.values()) {
    text += `*${name} (${code})*\n\`\`\``;
    text += `${'MATERIAL'.padEnd(16)}CONSUMED\n`;
    for (const r of lines) {
      const u = displayUnit(r);
      text += `${r.material_code.padEnd(16)}${fmt(r.qty_consumed)} ${u}\n`;
      csv += `"${name} (${code})","${r.material_code}","${u}",${r.qty_consumed}\n`;
    }
    text += '```\n';
  }

  await postSlack(text);
  await uploadCsvToSlack(csv, `consumption-${dateSlug}.csv`, `Daily Consumption — ${scrapedToIst}`);
}

// ── Report 3: CC Balance vs Audit (schema ready — cron TBD) ──────────────────

async function sendCCBalanceVsAudit() {
  const dateLabel = istDateLabel();

  const { rows } = await pool.query(`
    WITH latest_audits AS (
      SELECT DISTINCT ON (warehouse_id)
        id, warehouse_id, audit_date, audit_ref
      FROM audit_entries
      ORDER BY warehouse_id, audit_date DESC, id DESC
    )
    SELECT
      w.name  AS warehouse_name, w.code AS warehouse_code,
      ae.audit_ref, ae.audit_date,
      m.code  AS material_code, m.unit, m.meters_per_unit, m.stickers_per_roll,
      ael.physical_qty                          AS audit_qty,
      COALESCE(cs.on_hand_qty, 0)               AS current_balance,
      COALESCE(cs.on_hand_qty, 0) - ael.physical_qty AS delta
    FROM latest_audits la
    JOIN audit_entries ae     ON ae.id          = la.id
    JOIN warehouses w         ON w.id           = ae.warehouse_id
    JOIN audit_entry_lines ael ON ael.audit_entry_id = ae.id
    JOIN materials m          ON m.id           = ael.material_id
    LEFT JOIN v_current_stock cs ON cs.warehouse_id = ae.warehouse_id AND cs.material_id = m.id
    ORDER BY w.name, m.code
  `);

  if (rows.length === 0) {
    return postSlack(`📊 *CC Balance vs Audit*  |  ${dateLabel}\n_No audit data available._`);
  }

  const byWh = new Map();
  for (const r of rows) {
    const key = r.warehouse_code;
    if (!byWh.has(key)) byWh.set(key, { name: r.warehouse_name, code: r.warehouse_code, audit_ref: r.audit_ref, audit_date: r.audit_date, lines: [] });
    byWh.get(key).lines.push(r);
  }

  let text = `📊 *CC Balance vs Audit*  |  ${dateLabel}\n\n`;
  for (const { name, code, audit_ref, audit_date, lines } of byWh.values()) {
    const auditOn = String(audit_date).slice(0, 10);
    text += `*${name} (${code})*  |  Audit: ${audit_ref} (${auditOn})\n\`\`\``;
    text += `${'MATERIAL'.padEnd(14)}${'CURRENT'.padEnd(16)}${'AUDIT QTY'.padEnd(16)}DELTA\n`;
    for (const r of lines) {
      const u = displayUnit(r);
      const delta = Number(r.delta);
      const sign = delta >= 0 ? '+' : '';
      text += `${r.material_code.padEnd(14)}${`${fmt(r.current_balance)} ${u}`.padEnd(16)}${`${fmt(r.audit_qty)} ${u}`.padEnd(16)}${sign}${fmt(delta)} ${u}\n`;
    }
    text += '```\n';
  }

  return postSlack(text);
}

// ── Cron jobs (timezone: Asia/Kolkata / IST) ──────────────────────────────────

// 00:00 IST — auto-run and auto-accept consumption (Bangalore facilities only)
cron.schedule('0 0 * * *', () => {
  console.log('[slackReports] 00:00 IST — starting nightly consumption run (Bangalore only)');
  runAndAcceptConsumption(BLR_FACILITIES).catch((e) => console.error('[slackReports] Nightly run failed:', e.message));
}, { timezone: 'Asia/Kolkata' });

// 21:00 IST — FC Dispatch vs CC GRN
cron.schedule('0 21 * * *', () => {
  console.log('[slackReports] 21:00 IST — sending FC dispatch vs CC GRN report');
  sendFCDispatchVsCCGRN().catch((e) => console.error('[slackReports] FC vs CC report failed:', e.message));
}, { timezone: 'Asia/Kolkata' });

module.exports = { sendFCDispatchVsCCGRN, sendDailyConsumption, sendCCBalanceVsAudit, runAndAcceptConsumption };
