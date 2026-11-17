const ExcelJS = require('exceljs');
const { previousOpsDay } = require('../config/pmStoreFacilities');
const { fmtMonDOrdinal } = require('./emailTemplate');

const REPORTS = {
  doi: { module: require('./doi'), subject: (d) => `PM Store SKU DOI — ${d}`, reportLabel: 'DOI Report' },
  auditLoss: { module: require('./auditLoss'), subject: (d) => `Central PM Store Audit-wise Loss — ${d}`, reportLabel: 'Audit Loss Report' },
};

async function generate(pool, reportKey, { asOfDate } = {}) {
  const entry = REPORTS[reportKey];
  if (!entry) throw new Error(`Unknown report key: ${reportKey}`);
  const date = asOfDate || previousOpsDay();

  const data = await entry.module.getData(pool, { asOfDate: date });
  const wb = entry.module.buildWorkbook(ExcelJS, data);
  const buffer = await wb.xlsx.writeBuffer();
  const html = entry.module.buildSummaryHtml(data);

  // Filename = <date generated, ordinal> - <report type>, e.g.
  // "Nov 20th - Audit Loss Report.xlsx" — per direct instruction.
  const filename = `${fmtMonDOrdinal(date)} - ${entry.reportLabel}.xlsx`;

  return {
    subject: entry.subject(date),
    html,
    attachments: [{ filename, buffer: Buffer.from(buffer) }],
  };
}

module.exports = { generate, REPORTS };
