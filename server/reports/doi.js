// Report 2: PM Store SKU-wise DOI (Days of Inventory).
// Layout mirrors "31st Oct - DOI.xlsx" — sheets: Summary, PM Store SKU DOI, Unit Cost.

const { PM_STORE_CODE, BLR_FACILITY_CODES } = require('../config/pmStoreFacilities');
const { unitsPerUom, costingUom, conversionBasis, unitCostPerUom, fmtDbDate } = require('./materialCost');
const { fmtDMon, fmtNum, fmtMoney, table, sectionTitle, wrapEmail, COLOR, GUIDE_URL } = require('./emailTemplate');

// Same status->color mapping as the xlsx Summary sheet.
const STATUS_ROW_COLOR = {
  'Stock-out': [COLOR.bad, COLOR.badText],
  'Critical (≤3d)': [COLOR.bad, COLOR.badText],
  'Low (≤7d)': [COLOR.warn, COLOR.warnText],
  'No movement': [COLOR.neutral, COLOR.neutralText],
  'OK': [COLOR.good, COLOR.goodText],
};

const WINDOW_DAYS = 7;
const STATUS_ORDER = ['Stock-out', 'Critical (≤3d)', 'Low (≤7d)', 'OK', 'No movement'];
// Fixed go-live cutoff, per direct instruction — not relative to asOfDate.
// Only SKUs that actually held nonzero stock at CS-001 at some point in
// [ELIGIBILITY_START_DATE, this report's own audit date] are shown; a
// material that's been dormant/zero the whole time (dead catalog entry) is
// excluded, but one that's now a genuine Stock-out (had stock, now zero)
// still qualifies, since it did have nonzero inventory in that window.
const ELIGIBILITY_START_DATE = '2026-10-18';

function statusFor(avgDailyIssue, inventoryQty, doi) {
  if (avgDailyIssue === 0) return 'No movement';
  if (inventoryQty <= 0) return 'Stock-out';
  if (doi <= 3) return 'Critical (≤3d)';
  if (doi <= 7) return 'Low (≤7d)';
  return 'OK';
}

// Pure per-material row computation — no DB access, unit-testable directly.
// physicalQtyBase: audit physical qty in base units. dailyIssuesBase: array
// of per-day issue qty in base units, length = window size.
function computeRow(material, physicalQtyBase, dailyIssuesBase) {
  const upu = unitsPerUom(material);
  const inventoryQty = physicalQtyBase / upu;
  const unitCost = unitCostPerUom(material);
  const inventoryValue = inventoryQty * unitCost;
  const dailyIssuesUom = dailyIssuesBase.map((q) => q / upu);
  const issueQty7d = dailyIssuesUom.reduce((a, b) => a + b, 0);
  const avgDailyIssue = issueQty7d / dailyIssuesBase.length;
  const doi = avgDailyIssue === 0 ? null : inventoryQty / avgDailyIssue;
  const status = statusFor(avgDailyIssue, inventoryQty, doi ?? 0);
  return {
    skuCode: material.code,
    skuName: material.name,
    category: material.category,
    uom: costingUom(material),
    inventoryQty,
    unitCost,
    inventoryValue,
    dailyIssuesUom,
    issueQty7d,
    avgDailyIssue,
    doi,
    status,
    unitsPerUom: upu,
    conversionBasis: conversionBasis(material),
  };
}

async function getData(pool, { asOfDate }) {
  // "Latest audit" = the first one that captures the closing stock of asOfDate
  // (i.e. dated after it — an audit posted the morning after close, as in the
  // sample: a 1-Nov audit used as 31-Oct's closing stock). If none has been
  // posted yet after asOfDate (e.g. asOfDate is "today"), fall back to the
  // most recent audit overall, per the "no audit posted yet" rule.
  const auditRes = await pool.query(
    `SELECT ae.id, ae.audit_ref, ae.audit_date::text AS audit_date, ae.created_at
       FROM audit_entries ae JOIN warehouses w ON w.id = ae.warehouse_id
      WHERE w.code = $1 AND ae.audit_date > $2
      ORDER BY ae.audit_date ASC, ae.created_at ASC LIMIT 1`,
    [PM_STORE_CODE, asOfDate]
  );
  let audit = auditRes.rows[0] || null;
  if (!audit) {
    const fallbackRes = await pool.query(
      `SELECT ae.id, ae.audit_ref, ae.audit_date::text AS audit_date, ae.created_at
         FROM audit_entries ae JOIN warehouses w ON w.id = ae.warehouse_id
        WHERE w.code = $1
        ORDER BY ae.audit_date DESC, ae.created_at DESC LIMIT 1`,
      [PM_STORE_CODE]
    );
    audit = fallbackRes.rows[0] || null;
  }

  const windowEnd = asOfDate;
  const windowStartDate = new Date(`${asOfDate}T00:00:00Z`);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - (WINDOW_DAYS - 1));
  const windowStart = windowStartDate.toISOString().slice(0, 10);

  if (!audit) {
    return { asOfDate, audit: null, windowStart, windowEnd, rows: [], summary: [] };
  }

  // INNER JOIN, not LEFT — only materials actually counted in this specific
  // audit (confirmed against the sample: its own "SKUs listed vs SKUs with
  // audit stock or 7-day issues" check row ties the row count to the audit's
  // own line count, not the full, larger materials master). Additionally
  // restricted to materials with nonzero physical_qty in some CS-001 audit
  // between ELIGIBILITY_START_DATE and this audit's own date — per direct
  // instruction, excludes dead catalog entries that never actually held stock.
  const matRes = await pool.query(
    `SELECT m.code, m.name, m.category, m.unit, m.master_price,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            ael.physical_qty AS physical_qty
       FROM audit_entry_lines ael
       JOIN materials m ON m.id = ael.material_id
      WHERE ael.audit_entry_id = $1 AND m.is_active
        AND EXISTS (
          SELECT 1 FROM audit_entry_lines ael2
          JOIN audit_entries ae2 ON ae2.id = ael2.audit_entry_id
          JOIN warehouses w2 ON w2.id = ae2.warehouse_id
          WHERE ael2.material_id = m.id AND w2.code = $2
            AND ae2.audit_date BETWEEN $3 AND $4 AND ael2.physical_qty > 0
        )
      ORDER BY m.code`,
    [audit.id, PM_STORE_CODE, ELIGIBILITY_START_DATE, audit.audit_date]
  );

  // Destination restricted to the Bangalore pilot facilities — a dispatch to
  // a different city (rare adhoc issue) must not count toward this SKU's
  // 7-day issue rate, per direct instruction.
  const issueRes = await pool.query(
    `SELECT si.material_id, si.issue_date::text AS issue_date, SUM(si.issued_qty) AS qty
       FROM stock_issues si
       JOIN warehouses w ON w.id = si.from_warehouse_id
       JOIN warehouses dest ON dest.id = si.to_warehouse_id
      WHERE w.code = $1 AND si.status != 'CANCELLED' AND si.issue_date BETWEEN $2 AND $3
        AND dest.code = ANY($4)
      GROUP BY si.material_id, si.issue_date`,
    [PM_STORE_CODE, windowStart, windowEnd, BLR_FACILITY_CODES]
  );
  // material_id isn't selected above with its code, so join by re-querying with code — simplest: fetch id->code map.
  const idRes = await pool.query(`SELECT id, code FROM materials`);
  const codeById = new Map(idRes.rows.map((r) => [String(r.id), r.code]));

  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(`${windowStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const issuesByMaterialDay = new Map(); // code -> { date: qty }
  for (const r of issueRes.rows) {
    const code = codeById.get(String(r.material_id));
    if (!code) continue;
    if (!issuesByMaterialDay.has(code)) issuesByMaterialDay.set(code, {});
    issuesByMaterialDay.get(code)[String(r.issue_date).slice(0, 10)] = Number(r.qty);
  }

  const rows = matRes.rows.map((m) => {
    const dailyIssueBase = issuesByMaterialDay.get(m.code) || {};
    const dailyIssuesBase = days.map((d) => dailyIssueBase[d] || 0);
    return computeRow(m, Number(m.physical_qty), dailyIssuesBase);
  });

  // Detail table sorted by status, in the same order the Summary table lists
  // them (Stock-out, Critical, Low, No movement, OK) — per direct instruction.
  const statusRank = new Map(STATUS_ORDER.map((s, i) => [s, i]));
  rows.sort((a, b) => statusRank.get(a.status) - statusRank.get(b.status));

  const summaryMap = new Map();
  for (const r of rows) {
    const cur = summaryMap.get(r.status) || { status: r.status, count: 0, value: 0 };
    cur.count += 1;
    cur.value += r.inventoryValue;
    summaryMap.set(r.status, cur);
  }
  // Fixed status order (Stock-out, Critical, Low, No movement, OK) matching
  // the sample's Summary table, including zero-count statuses.
  const summary = STATUS_ORDER.map((status) => summaryMap.get(status) || { status, count: 0, value: 0 });

  return { asOfDate, audit, windowStart, windowEnd, days, rows, summary };
}

function buildWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();

  buildSummarySheet(wb, data);

  const ws = wb.addWorksheet('PM Store SKU DOI');
  ws.addRow([`PM Store – SKU-wise Inventory & Days of Inventory (DOI)`]);
  ws.addRow([`Window: rolling last ${data.days ? data.days.length : 7} days (${data.windowStart} to ${data.windowEnd}). Inventory = latest PM Store audit${data.audit ? ` (${data.audit.audit_ref}, dated ${fmtDbDate(data.audit.audit_date)})` : ' (none found)'}.`]);
  ws.addRow(['Days in window', null, data.days ? data.days.length : 7, '← divisor for avg daily issue (input)']);
  ws.addRow([]);
  const dayHeaders = (data.days || []).map((d) => d);
  ws.addRow([
    'PM Store', 'SKU Code', 'SKU Name', 'Category', 'UoM', 'Audit Inventory Qty',
    'Unit cost incl. GST (Rs.)', 'Inventory value (Rs.)', ...dayHeaders,
    '7-Day Issue Qty', 'Avg Daily Issue', 'Days of Inventory', 'Status', 'Units per Roll', 'Conversion Basis',
  ]);
  for (const r of data.rows) {
    ws.addRow([
      `Central PM Store — Bangalore (${PM_STORE_CODE})`, r.skuCode, r.skuName, r.category, r.uom,
      round3(r.inventoryQty), r.unitCost, round2(r.inventoryValue), ...r.dailyIssuesUom.map(round3),
      round3(r.issueQty7d), round3(r.avgDailyIssue), r.doi === null ? 'No issues' : round3(r.doi),
      r.status, r.unitsPerUom, r.conversionBasis,
    ]);
  }

  const cost = wb.addWorksheet('Unit Cost');
  cost.addRow(['PackTrack Code', 'PackTrack Name', 'UOM', 'Cost per UOM (Rs.)']);
  const seen = new Set();
  for (const r of data.rows) {
    if (seen.has(r.skuCode)) continue;
    seen.add(r.skuCode);
    cost.addRow([r.skuCode, r.skuName, r.uom, r.unitCost]);
  }

  return wb;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

// Colored, formatted Summary sheet — same visual language as the Audit Loss
// report's Summary sheet (title band, styled header, banded rows, status
// color coding, an Analysis block below the table).
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary');
  const ncols = 3;

  const COLOR = {
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
  const STATUS_COLOR = {
    'Stock-out': [COLOR.bad, COLOR.badText],
    'Critical (≤3d)': [COLOR.bad, COLOR.badText],
    'Low (≤7d)': [COLOR.warn, COLOR.warnText],
    'No movement': [COLOR.neutral, COLOR.neutralText],
    'OK': [COLOR.good, COLOR.goodText],
  };
  const thinBorder = { style: 'thin', color: { argb: COLOR.border } };

  ws.mergeCells(1, 1, 1, ncols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `PM Store DOI — Summary by Status (audit of ${data.audit ? fmtDbDate(data.audit.audit_date) : 'n/a'})`;
  titleCell.font = { bold: true, size: 14, color: { argb: COLOR.titleText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.title } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, ncols);
  const noteCell = ws.getCell(2, 1);
  noteCell.value = 'Status thresholds (on Days of Inventory, from a rolling 7-day average daily issue): Stock-out = zero inventory, Critical ≤ 3 days, Low ≤ 7 days, No movement = no issues in the window, OK = everything else. Only SKUs that held nonzero stock at CS-001 at some point since 18-Oct-2026 are included.';
  noteCell.font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  noteCell.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(2).height = 28;

  ws.addRow([]);

  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  ['Status', 'Count of SKU Code', 'Sum of Inventory value (Rs.)'].forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLOR.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  });
  headerRow.height = 24;
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }];

  for (const s of data.summary) {
    const row = ws.addRow([s.status, s.count, Number(s.value.toFixed(2))]);
    const [fill, text] = STATUS_COLOR[s.status] || [COLOR.band, 'FF000000'];
    row.eachCell((cell, colNum) => {
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.font = { color: { argb: text }, bold: colNum !== 1 };
      if (colNum === 3) cell.numFmt = '#,##0.00';
    });
  }

  const totalCount = data.summary.reduce((a, s) => a + s.count, 0);
  const totalValue = data.summary.reduce((a, s) => a + s.value, 0);
  const totalRow = ws.addRow(['Total', totalCount, Number(totalValue.toFixed(2))]);
  totalRow.eachCell((cell, colNum) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.totalRow } };
    cell.border = { top: { style: 'double', color: { argb: 'FF1F4E78' } }, bottom: thinBorder, left: thinBorder, right: thinBorder };
    if (colNum === 3) cell.numFmt = '#,##0.00';
  });

  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 24;

  // ── Analysis block ───────────────────────────────────────────────────
  const byStatus = (s) => data.summary.find((x) => x.status === s) || { count: 0, value: 0 };
  const atRiskCount = byStatus('Stock-out').count + byStatus('Critical (≤3d)').count;
  const atRiskValue = byStatus('Stock-out').value + byStatus('Critical (≤3d)').value;
  const noMovementCount = byStatus('No movement').count;

  let r = ws.rowCount + 2;
  ws.mergeCells(r, 1, r, ncols);
  const analysisTitle = ws.getCell(r, 1);
  analysisTitle.value = 'Analysis';
  analysisTitle.font = { bold: true, size: 13, color: { argb: COLOR.titleText } };
  analysisTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.title } };
  ws.getRow(r).height = 20;
  r += 1;

  const addInsight = (label, value, fillArgb, textArgb) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, ncols);
    const vCell = ws.getCell(r, 2);
    vCell.value = value;
    if (fillArgb) {
      vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      vCell.font = { bold: true, color: { argb: textArgb } };
    }
    r += 1;
  };

  addInsight('SKUs tracked', totalCount);
  addInsight('Total inventory value (Rs.)', Number(totalValue.toFixed(2)));
  addInsight(
    'Stock-out + Critical SKUs',
    `${atRiskCount} SKU(s), ₹${atRiskValue.toFixed(2)} at risk`,
    atRiskCount ? COLOR.bad : COLOR.good,
    atRiskCount ? COLOR.badText : COLOR.goodText
  );
  addInsight(
    'Non-moving SKUs (no issues in window)',
    noMovementCount,
    noMovementCount ? COLOR.neutral : COLOR.good,
    noMovementCount ? COLOR.neutralText : COLOR.goodText
  );

  r += 1;
  ws.mergeCells(r, 1, r, ncols);
  const takeaway = ws.getCell(r, 1);
  takeaway.value = atRiskCount
    ? `${atRiskCount} SKU(s) need attention this cycle (Stock-out or Critical ≤ 3 days) — see the highlighted rows in the Detail sheet, sorted to the top by status.`
    : `No SKU is in Stock-out or Critical this cycle — the lowest-coverage items are in the Low (≤7d) bucket; see the Detail sheet for the full breakdown.`;
  takeaway.font = { italic: true, bold: true, size: 11, color: { argb: atRiskCount ? COLOR.badText : COLOR.goodText } };
  takeaway.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: atRiskCount ? COLOR.bad : COLOR.good } };
  takeaway.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(r).height = 24;
}

// Matches "BLR QuickCom Central PM Store Holding Inventory Report" sample.
function buildSummaryHtml(data) {
  const totalCount = data.summary.reduce((a, s) => a + s.count, 0);
  const totalValue = data.summary.reduce((a, s) => a + s.value, 0);
  const summaryRows = [...data.summary.map((s) => [s.status, fmtNum(s.count), fmtMoney(s.value)]), ['Grand Total', fmtNum(totalCount), fmtMoney(totalValue)]];
  const summaryTable = table(
    ['Status', 'Count of SKU Code', 'Sum of Inventory value (Rs.)'],
    summaryRows,
    {
      rowBg: (i) => (i === summaryRows.length - 1 ? COLOR.totalBg : (STATUS_ROW_COLOR[data.summary[i]?.status] || [COLOR.band])[0]),
      cellText: (i) => (i === summaryRows.length - 1 ? null : (STATUS_ROW_COLOR[data.summary[i]?.status] || [null, null])[1]),
      bold: (i) => i === summaryRows.length - 1,
    }
  );

  const auditLabel = data.audit ? fmtDMon(data.audit.audit_date) : 'n/a';
  const dayHeaders = (data.days || []).map(fmtDMon);
  const detailTable = table(
    ['SKU Name', 'Category', 'UoM', `Audit Inventory Qty (${auditLabel})`, 'Unit cost incl. GST (Rs.)', 'Inventory value (Rs.)',
      ...dayHeaders, '7-Day Issue Qty', 'Avg Daily Issue', 'Days of Inventory', 'Status', 'Units per Roll', 'Conversion Basis'],
    data.rows.map((r) => [
      r.skuName, r.category, r.uom, fmtNum(r.inventoryQty, r.inventoryQty % 1 ? 1 : 0), fmtMoney(r.unitCost), fmtMoney(r.inventoryValue),
      ...r.dailyIssuesUom.map((q) => (q ? fmtNum(q, q % 1 ? 1 : 0) : '-')),
      fmtNum(r.issueQty7d, r.issueQty7d % 1 ? 1 : 0), fmtNum(r.avgDailyIssue, 1),
      r.doi === null ? 'No issues' : fmtNum(r.doi, 1), r.status,
      r.unitsPerUom === 1 ? '' : r.unitsPerUom, r.conversionBasis || '',
    ]),
    {
      // Only the Status cell (last-but-2 column, index 10) gets a strong
      // color fill, so the row stays readable while the status still jumps
      // out at a glance — same idea as the xlsx sheet's full-row shading,
      // toned down since this table has many more columns to scan.
      cellBg: (i, c) => (c === 10 ? (STATUS_ROW_COLOR[data.rows[i]?.status] || [null])[0] : null),
      cellText: (i, c) => (c === 10 ? (STATUS_ROW_COLOR[data.rows[i]?.status] || [null, null])[1] : null),
    }
  );

  const intro = `
  <p>PFB the daily Holding Inventory report for the Central PM Store in QuickCom BLR.</p>
  <p>This report tracks the current PM Store Inventory value and estimated Days of Inventory (DOI) based on a rolling 7-day average daily consumption, to identify stock-outs, critical shortages, and non-moving packing materials.</p>`;

  const bodyHtml = `
  ${sectionTitle('Summary')}
  ${summaryTable}
  ${sectionTitle('Detail')}
  ${detailTable}`;

  return wrapEmail({ intro, bodyHtml, guideUrl: GUIDE_URL });
}

module.exports = { getData, buildWorkbook, buildSummaryHtml, computeRow, statusFor };
