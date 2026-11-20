// Cron registration for the PM Store reports engine. Gated by
// REPORT_CRON_ENABLED (default false) so nothing fires until explicitly
// turned on — mirrors the existing 5am consumption cron's node-cron +
// Asia/Kolkata pattern, but adds the env-flag gate that one lacks.

const cron = require('node-cron');
const { runReport } = require('./runner');
const recipients = require('../config/reportRecipients.json');

function registerReportCrons(pool, mailer) {
  if (process.env.REPORT_CRON_ENABLED !== 'true') {
    console.log('[reports/scheduler] REPORT_CRON_ENABLED not set to true — report crons not registered.');
    return;
  }

  // Variance (report 1) still has open data-correctness findings from the
  // 2026-11-20 vetting doc (STOCK_BELOW_ZERO handling, FC/CC double-counting,
  // unmapped PM rates) — gated separately so turning on reports 2 & 3 doesn't
  // also start sending report 1 before those are resolved.
  if (process.env.VARIANCE_CRON_ENABLED === 'true') {
    cron.schedule('0 12 * * *', () => {
      runReport(pool, mailer, 'variance', { recipients: recipients.variance }).catch((e) => console.error('[reports/scheduler] variance run failed:', e.message));
    }, { timezone: 'Asia/Kolkata' });
  }

  cron.schedule('0 12 * * *', () => {
    runReport(pool, mailer, 'doi', { recipients: recipients.doi }).catch((e) => console.error('[reports/scheduler] doi run failed:', e.message));
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('0 12 * * 5', () => {
    runReport(pool, mailer, 'auditLoss', { recipients: recipients.auditLoss }).catch((e) => console.error('[reports/scheduler] auditLoss run failed:', e.message));
  }, { timezone: 'Asia/Kolkata' });

  console.log(`[reports/scheduler] Report crons registered (12:00 IST daily: doi${process.env.VARIANCE_CRON_ENABLED === 'true' ? ', variance' : ''}; Fri 12:00 IST: auditLoss).`);
}

module.exports = { registerReportCrons };
