// Report 1: PM Issued vs Consumption — Variance Report (Daily).
// Layout mirrors "31st Oct - Variance.xlsx"'s "PM SKU Email View" sheet, which
// is what's actually in the email body/attachment — the workbook's separate
// "Facility SKU Variance" cut is Vishal's own internal working tab, never
// part of the sent email, so it's out of scope here (same precedent as DOI/
// Audit Loss, which also match the sent email content, not every helper tab).

const { PM_STORE_CODE, BLR_FACILITY_CODES } = require('../config/pmStoreFacilities');
const { unitsPerUom, costingUom, unitCostPerUom, fmtDbDate } = require('./materialCost');
const { fmtDMon, fmtNum, fmtMoney, table, sectionTitle, wrapEmail, COLOR, GUIDE_URL } = require('./emailTemplate');

const WINDOW_DAYS = 7; // for the rolling avg daily consumption used in the days metric
const DAY_BUCKETS = ['<=3 days', '<=7 days', '>7 days', 'No Consumption'];

function varianceStatus(issuedQty, consumedQty) {
  if (issuedQty === 0 && consumedQty > 0) return 'Consumed – not issued in period';
  if (consumedQty === 0 && issuedQty > 0) return 'Issued – no consumption captured';
  return issuedQty - consumedQty >= 0 ? 'Over-issued' : 'Under-issued';
}

function dayBucket(absVarianceQty, avgDailyConsumption) {
  if (avgDailyConsumption === 0) return 'No Consumption';
  const days = absVarianceQty / avgDailyConsumption;
  if (days <= 3) return '<=3 days';
  if (days <= 7) return '<=7 days';
  return '>7 days';
}

// Pure per-material row computation — no DB access, unit-testable directly.
// issuedQtyBase/consumedQtyBase: base-unit totals for asOfDate.
// consumedDailyBase: array of base-unit consumption per day over the trailing
// WINDOW_DAYS window (asOfDate inclusive), used for the rolling avg.
function computeRow(material, issuedQtyBase, consumedQtyBase, consumedDailyBase) {
  const upu = unitsPerUom(material);
  const issuedQty = issuedQtyBase / upu;
  const consumedQty = consumedQtyBase / upu;
  const varianceQty = issuedQty - consumedQty;
  const unitCost = unitCostPerUom(material);
  const value = varianceQty * unitCost;
  const absVarianceQty = Math.abs(varianceQty);
  const absVariancePct = issuedQty === 0 ? null : absVarianceQty / issuedQty;
  const avgDailyConsumption = consumedDailyBase.reduce((a, b) => a + b, 0) / upu / consumedDailyBase.length;
  const status = varianceStatus(issuedQty, consumedQty);
  const bucket = dayBucket(absVarianceQty, avgDailyConsumption);
  const absVarianceDays = avgDailyConsumption === 0 ? null : absVarianceQty / avgDailyConsumption;
  return {
    skuCode: material.code,
    skuName: material.name,
    category: material.category,
    uom: costingUom(material),
    issuedQty,
    consumedQty,
    varianceQty,
    unitCost,
    value,
    absVariancePct,
    absVarianceQty,
    status,
    avgDailyConsumption,
    absVarianceDays,
    bucket,
  };
}

async function getData(pool, { asOfDate }) {
  const windowStartDate = new Date(`${asOfDate}T00:00:00Z`);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - (WINDOW_DAYS - 1));
  const windowStart = windowStartDate.toISOString().slice(0, 10);

  // Issued — PM Store (CS-001) dispatches to Bangalore pilot facilities on asOfDate.
  const issueRes = await pool.query(
    `SELECT si.material_id, SUM(si.issued_qty) AS qty
       FROM stock_issues si
       JOIN warehouses w ON w.id = si.from_warehouse_id
       JOIN warehouses dest ON dest.id = si.to_warehouse_id
      WHERE w.code = $1 AND si.status != 'CANCELLED' AND si.issue_date = $2
        AND dest.code = ANY($3)
      GROUP BY si.material_id`,
    [PM_STORE_CODE, asOfDate, BLR_FACILITY_CODES]
  );
  const matIdRes = await pool.query(`SELECT id, code FROM materials`);
  const codeById = new Map(matIdRes.rows.map((r) => [String(r.id), r.code]));
  const issuedByCode = new Map();
  for (const r of issueRes.rows) {
    const code = codeById.get(String(r.material_id));
    if (code) issuedByCode.set(code, Number(r.qty));
  }

  // Consumed — accepted scraper runs (consumption_runs.status='COMPLETED',
  // lines actually posted i.e. status='DEDUCTED'), restricted to the same
  // Bangalore pilot facilities, per day over the rolling window.
  const consRes = await pool.query(
    `SELECT crl.material_code, cr.scraped_from::text AS day, SUM(crl.qty_deducted) AS qty
       FROM consumption_run_lines crl
       JOIN consumption_runs cr ON cr.id = crl.run_id
      WHERE cr.status = 'COMPLETED' AND crl.status = 'DEDUCTED'
        AND cr.scraped_from = cr.scraped_to AND cr.scraped_from BETWEEN $1 AND $2
        AND crl.facility_id = ANY($3)
      GROUP BY crl.material_code, cr.scraped_from`,
    [windowStart, asOfDate, BLR_FACILITY_CODES]
  );
  const consumedByCodeDay = new Map(); // code -> { day: qty }
  for (const r of consRes.rows) {
    if (!consumedByCodeDay.has(r.material_code)) consumedByCodeDay.set(r.material_code, {});
    consumedByCodeDay.get(r.material_code)[r.day] = Number(r.qty);
  }

  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(`${windowStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  // Only materials with some issued or consumed activity on asOfDate — a
  // material untouched either way has nothing to report.
  const activeCodes = new Set([...issuedByCode.keys(), ...[...consumedByCodeDay.entries()].filter(([, byDay]) => byDay[asOfDate] > 0).map(([c]) => c)]);
  if (!activeCodes.size) return { asOfDate, windowStart, rows: [], valueSummary: [], daySummary: [] };

  const matRes = await pool.query(
    `SELECT code, name, category, unit, master_price, meters_per_unit, stickers_per_roll, pieces_per_kg
       FROM materials WHERE code = ANY($1)`,
    [[...activeCodes]]
  );
  const materials = matRes.rows;

  const rows = materials.map((m) => {
    const issuedQtyBase = issuedByCode.get(m.code) || 0;
    const byDay = consumedByCodeDay.get(m.code) || {};
    const consumedQtyBase = byDay[asOfDate] || 0;
    const consumedDailyBase = days.map((d) => byDay[d] || 0);
    return computeRow(m, issuedQtyBase, consumedQtyBase, consumedDailyBase);
  });
  rows.sort((a, b) => (a.bucket === b.bucket ? b.absVarianceQty - a.absVarianceQty : DAY_BUCKETS.indexOf(a.bucket) - DAY_BUCKETS.indexOf(b.bucket)));

  const posRows = rows.filter((r) => r.value >= 0);
  const negRows = rows.filter((r) => r.value < 0);
  const valueSummary = [
    { category: 'Positive', count: posRows.length, value: posRows.reduce((a, r) => a + r.value, 0) },
    { category: 'Negative', count: negRows.length, value: negRows.reduce((a, r) => a + r.value, 0) },
  ];
  valueSummary.push({ category: 'Total', count: rows.length, value: valueSummary.reduce((a, s) => a + s.value, 0) });

  const daySummary = DAY_BUCKETS.map((bucket) => {
    const bucketRows = rows.filter((r) => r.bucket === bucket);
    return { bucket, count: bucketRows.length, value: bucketRows.reduce((a, r) => a + r.value, 0) };
  });
  daySummary.push({ bucket: 'Total', count: rows.length, value: daySummary.reduce((a, s) => a + s.value, 0) });

  return { asOfDate, windowStart, days, rows, valueSummary, daySummary };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

const DAY_BUCKET_COLOR = {
  '<=3 days': [COLOR.bad, COLOR.badText],
  '<=7 days': [COLOR.warn, COLOR.warnText],
  '>7 days': [COLOR.neutral, COLOR.neutralText],
  'No Consumption': [COLOR.neutral, COLOR.neutralText],
};
const STATUS_COLOR = {
  'Over-issued': [COLOR.bad, COLOR.badText],
  'Under-issued': [COLOR.warn, COLOR.warnText],
  'Issued – no consumption captured': [COLOR.neutral, COLOR.neutralText],
  'Consumed – not issued in period': [COLOR.neutral, COLOR.neutralText],
};

function buildWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();

  buildSummarySheet(wb, data);

  const ws = wb.addWorksheet('PM Store SKU Variance');
  ws.addRow([`PM SKU-wise Issued vs Consumption (${data.asOfDate}, ops date)`]);
  ws.addRow([`Variance = Issued − Consumed (UoM) × Cost per UoM. Days = |Variance| ÷ rolling 7-day avg daily consumption (${data.windowStart} to ${data.asOfDate}).`]);
  ws.addRow([]);
  ws.addRow([
    'PM Store', 'PM SKU Code', 'PM SKU Name', 'Category', 'UoM', 'Issued Qty (UoM)', 'Consumption Derived Qty (UoM)',
    'Variance Qty (UoM) Issued − Consumed', 'Cost per UoM', 'Value', 'Absolute Variance % of Issued', 'Abs Variance (UoM)',
    'Variance Status', 'Rolling 7-day Avg Daily Consumption (UoM)', 'Absolute Variance in Days ÷ 7-day Avg Consumption',
  ]);
  for (const r of data.rows) {
    ws.addRow([
      `Central PM Store — Bangalore (${PM_STORE_CODE})`, r.skuCode, r.skuName, r.category, r.uom,
      round2(r.issuedQty), round2(r.consumedQty), round2(r.varianceQty), r.unitCost, round2(r.value),
      r.absVariancePct === null ? 'No issuances' : round4(r.absVariancePct), round2(r.absVarianceQty),
      r.status, round4(r.avgDailyConsumption), r.absVarianceDays === null ? 'No Consumption' : round2(r.absVarianceDays),
    ]);
  }

  return wb;
}

// ExcelJS needs 8-char ARGB fills/fonts; the shared COLOR from emailTemplate.js
// is plain #rrggbb for HTML/CSS — a separate ARGB palette here, same values,
// mirrors the pattern doi.js/auditLoss.js use for their own Summary sheets.
const XLSX_COLOR = {
  title: 'FF1F4E78', titleText: 'FFFFFFFF',
  header: 'FF2E75B6', headerText: 'FFFFFFFF',
  band: 'FFF2F2F2',
  totalRow: 'FFD9E1F2',
  bad: 'FFFFC7CE', badText: 'FF9C0006',
  warn: 'FFFFEB9C', warnText: 'FF9C6500',
  neutral: 'FFD9D9D9', neutralText: 'FF595959',
  good: 'FFC6EFCE', goodText: 'FF006100',
  border: 'FFBFBFBF',
};
const XLSX_DAY_BUCKET_COLOR = {
  '<=3 days': [XLSX_COLOR.bad, XLSX_COLOR.badText],
  '<=7 days': [XLSX_COLOR.warn, XLSX_COLOR.warnText],
  '>7 days': [XLSX_COLOR.neutral, XLSX_COLOR.neutralText],
  'No Consumption': [XLSX_COLOR.neutral, XLSX_COLOR.neutralText],
};

function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary');
  const ncols = 3;
  const thinBorder = { style: 'thin', color: { argb: XLSX_COLOR.border } };

  ws.mergeCells(1, 1, 1, ncols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `PM Issued vs Consumption — Summary (${data.asOfDate})`;
  titleCell.font = { bold: true, size: 14, color: { argb: XLSX_COLOR.titleText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLOR.title } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, ncols);
  const noteCell = ws.getCell(2, 1);
  noteCell.value = `Ops date ${data.asOfDate} · Bengaluru · Variance = Issued − Consumed (UoM) × Cost per UoM · Days = |Variance| ÷ rolling 7-day avg daily consumption (${data.windowStart} to ${data.asOfDate}).`;
  noteCell.font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  noteCell.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(2).height = 28;
  ws.addRow([]);

  let r = 4;
  const writeTable = (title, headers, rowsData, colorFn) => {
    ws.mergeCells(r, 1, r, ncols);
    const t = ws.getCell(r, 1);
    t.value = title;
    t.font = { bold: true, size: 12, color: { argb: XLSX_COLOR.titleText } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLOR.title } };
    ws.getRow(r).height = 20;
    r += 1;

    const headerRow = ws.getRow(r);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: XLSX_COLOR.headerText } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XLSX_COLOR.header } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    });
    headerRow.height = 22;
    r += 1;

    for (const row of rowsData) {
      const isTotal = row[0] === 'Total';
      const excelRow = ws.addRow(row.map((v, i) => (i === 2 && typeof v === 'number' ? Number(v.toFixed(2)) : v)));
      const [fill, text] = isTotal ? [XLSX_COLOR.totalRow, null] : (colorFn(row[0]) || [XLSX_COLOR.band, null]);
      excelRow.eachCell((cell, colNum) => {
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { bold: isTotal || colNum !== 1, color: text ? { argb: text } : undefined };
        if (colNum === 3) cell.numFmt = '#,##0.00';
      });
      r += 1;
    }
    r += 1;
  };

  writeTable(
    'Variance value summary', ['Variance Value Category', 'Count of PM Code', 'Value (₹)'],
    data.valueSummary.map((s) => [s.category, s.count, s.value]),
    (cat) => (cat === 'Positive' ? [XLSX_COLOR.good, XLSX_COLOR.goodText] : cat === 'Negative' ? [XLSX_COLOR.bad, XLSX_COLOR.badText] : null)
  );
  writeTable(
    'Absolute variance days distribution summary (basis consumption)', ['Absolute Variance Days', 'Count of PM Code', 'Value (₹)'],
    data.daySummary.map((s) => [s.bucket, s.count, s.value]),
    (bucket) => XLSX_DAY_BUCKET_COLOR[bucket]
  );

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 20;
}

function buildSummaryHtml(data) {
  const valueTable = table(
    ['Variance Value Category', 'Count of PM Code', 'Value (₹)'],
    data.valueSummary.map((s) => [s.category, fmtNum(s.count), fmtMoney(s.value)]),
    {
      rowBg: (i) => (data.valueSummary[i].category === 'Total' ? COLOR.totalBg : data.valueSummary[i].category === 'Positive' ? COLOR.good : COLOR.bad),
      cellText: (i) => (data.valueSummary[i].category === 'Total' ? null : data.valueSummary[i].category === 'Positive' ? COLOR.goodText : COLOR.badText),
      bold: (i) => data.valueSummary[i].category === 'Total',
    }
  );

  const dayTable = table(
    ['Absolute Variance Days', 'Count of PM Code', 'Value (₹)'],
    data.daySummary.map((s) => [s.bucket, fmtNum(s.count), fmtMoney(s.value)]),
    {
      rowBg: (i) => (data.daySummary[i].bucket === 'Total' ? COLOR.totalBg : (DAY_BUCKET_COLOR[data.daySummary[i].bucket] || [COLOR.band])[0]),
      cellText: (i) => (data.daySummary[i].bucket === 'Total' ? null : (DAY_BUCKET_COLOR[data.daySummary[i].bucket] || [null, null])[1]),
      bold: (i) => data.daySummary[i].bucket === 'Total',
    }
  );

  const detailTable = table(
    ['PM SKU Name', 'Category', 'UoM', 'Issued Qty (UoM)', 'Consumption Derived Qty (UoM)', 'Variance Qty (UoM)', 'Cost per UoM', 'Value',
      'Absolute Variance % of Issued', 'Abs Variance (UoM)', 'Variance Status'],
    data.rows.map((r) => [
      r.skuName, r.category, r.uom, fmtNum(r.issuedQty, 2), fmtNum(r.consumedQty, 2), fmtNum(r.varianceQty, 2),
      fmtMoney(r.unitCost), fmtMoney(r.value), r.absVariancePct === null ? 'No issuances' : `${(r.absVariancePct * 100).toFixed(1)}%`,
      fmtNum(r.absVarianceQty, 2), r.status,
    ]),
    {
      cellBg: (i, c) => (c === 10 ? (STATUS_COLOR[data.rows[i]?.status] || [null])[0] : null),
      cellText: (i, c) => (c === 10 ? (STATUS_COLOR[data.rows[i]?.status] || [null, null])[1] : null),
    }
  );

  const introLines = [
    `PFB the daily PM Issue vs Consumption report for QuickCom BLR, ops date ${fmtDMon(data.asOfDate)}.`,
    'This report tracks PackTrack PM Store issuances vs consumption based on the FSN-PM mapping.',
  ];

  const bodyHtml = `
  ${sectionTitle('Variance value summary')}
  ${valueTable}
  ${sectionTitle('Absolute variance days distribution summary (basis consumption)')}
  ${dayTable}
  ${sectionTitle('Detail')}
  ${detailTable}`;

  return wrapEmail({ introLines, bodyHtml, guideUrl: GUIDE_URL });
}

module.exports = { getData, buildWorkbook, buildSummaryHtml, computeRow, varianceStatus, dayBucket };
