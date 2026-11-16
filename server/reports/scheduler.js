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

  cron.schedule('0 12 * * *', () => {
    runReport(pool, mailer, 'doi', { recipients: recipients.doi }).catch((e) => console.error('[reports/scheduler] doi run failed:', e.message));
  }, { timezone: 'Asia/Kolkata' });

  // TODO: register the Variance report's daily 12:00 IST cron once that
  // report module ships (reports 2 & 3 were built first, per instruction).

  cron.schedule('0 12 * * 5', () => {
    runReport(pool, mailer, 'auditLoss', { recipients: recipients.auditLoss }).catch((e) => console.error('[reports/scheduler] auditLoss run failed:', e.message));
  }, { timezone: 'Asia/Kolkata' });

  console.log('[reports/scheduler] Report crons registered (12:00 IST daily: doi; Fri 12:00 IST: auditLoss).');
}

module.exports = { registerReportCrons };
