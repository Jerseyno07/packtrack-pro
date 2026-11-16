// ADMIN-only endpoints for the PM Store reports engine. Registered from
// index.js with a single `registerReportRoutes(app, { pool, authenticate,
// requireRole, asyncHandler })` call — kept in its own module so index.js
// itself doesn't grow a new report-specific block per report added.

const { generate } = require('./reportService');
const { runReport } = require('./runner');
const { LogMailer } = require('./mailer');

const defaultMailer = new LogMailer();

function registerReportRoutes(app, { pool, authenticate, requireRole, asyncHandler }) {
  app.get('/api/reports/:key/download', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { date } = req.query;
    const { attachments } = await generate(pool, key, { asOfDate: date });
    const file = attachments[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }));

  app.post('/api/reports/:key/run', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const { key } = req.params;
    const dryRun = req.query.dryRun === 'true';
    const { date } = req.query;
    const result = await runReport(pool, defaultMailer, key, { asOfDate: date, dryRun });
    res.json(result);
  }));
}

module.exports = { registerReportRoutes };
