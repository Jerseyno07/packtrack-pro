// Idempotent run wrapper: generates a report, sends it via the given mailer,
// and logs the attempt in report_runs (report_key, report_date, dry_run) so a
// cron overlap or a manual re-run can't double-send the same day's report.

const { generate } = require('./reportService');
const { previousOpsDay } = require('../config/pmStoreFacilities');

async function runReport(pool, mailer, reportKey, { asOfDate, dryRun = false, recipients } = {}) {
  const date = asOfDate || previousOpsDay();
  const start = Date.now();

  let runId;
  try {
    const ins = await pool.query(
      `INSERT INTO report_runs (report_key, report_date, status, dry_run) VALUES ($1,$2,'RUNNING',$3) RETURNING id`,
      [reportKey, date, dryRun]
    );
    runId = ins.rows[0].id;
  } catch (e) {
    if (e.code === '23505') { // unique_violation — already run for this report/date/dryRun
      return { skipped: true, reason: 'already run', reportKey, date, dryRun };
    }
    throw e;
  }

  try {
    const { subject, html, attachments } = await generate(pool, reportKey, { asOfDate: date });
    const to = recipients?.to;
    const cc = recipients?.cc;
    await mailer.send({ to, cc, subject, html, attachments });
    await pool.query(
      `UPDATE report_runs SET status='SUCCESS', duration_ms=$1, completed_at=now() WHERE id=$2`,
      [Date.now() - start, runId]
    );
    return { skipped: false, reportKey, date, dryRun, subject };
  } catch (e) {
    await pool.query(
      `UPDATE report_runs SET status='FAILED', duration_ms=$1, error=$2, completed_at=now() WHERE id=$3`,
      [Date.now() - start, e.message, runId]
    );
    throw e;
  }
}

module.exports = { runReport };
