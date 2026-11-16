const ExcelJS = require('exceljs');
const { previousOpsDay } = require('../config/pmStoreFacilities');

const REPORTS = {
  doi: { module: require('./doi'), subject: (d) => `PM Store SKU DOI — ${d}`, filenamePrefix: 'PM_DOI' },
  auditLoss: { module: require('./auditLoss'), subject: (d) => `Central PM Store Audit-wise Loss — ${d}`, filenamePrefix: 'PM_Audit_Loss' },
};

async function generate(pool, reportKey, { asOfDate } = {}) {
  const entry = REPORTS[reportKey];
  if (!entry) throw new Error(`Unknown report key: ${reportKey}`);
  const date = asOfDate || previousOpsDay();

  const data = await entry.module.getData(pool, { asOfDate: date });
  const wb = entry.module.buildWorkbook(ExcelJS, data);
  const buffer = await wb.xlsx.writeBuffer();
  const html = entry.module.buildSummaryHtml(data);

  return {
    subject: entry.subject(date),
    html,
    attachments: [{ filename: `${entry.filenamePrefix}_${date}.xlsx`, buffer: Buffer.from(buffer) }],
  };
}

module.exports = { generate, REPORTS };
