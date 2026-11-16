// Report 2: PM Store SKU-wise DOI (Days of Inventory).
// Layout mirrors "31st Oct - DOI.xlsx" — sheets: Summary, PM Store SKU DOI, Unit Cost.

const { PM_STORE_CODE } = require('../config/pmStoreFacilities');
const { unitsPerUom, costingUom, conversionBasis, unitCostPerUom, fmtDbDate } = require('./materialCost');
const { fmtDMon, fmtNum, fmtMoney, table, wrapEmail } = require('./emailTemplate');

const WINDOW_DAYS = 7;
const STATUS_ORDER = ['Stock-out', 'Critical (≤3d)', 'Low (≤7d)', 'No movement', 'OK'];

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
  // own line count, not the full, larger materials master).
  const matRes = await pool.query(
    `SELECT m.code, m.name, m.category, m.unit, m.master_price,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            ael.physical_qty AS physical_qty
       FROM audit_entry_lines ael
       JOIN materials m ON m.id = ael.material_id
      WHERE ael.audit_entry_id = $1 AND m.is_active
      ORDER BY m.code`,
    [audit.id]
  );

  const issueRes = await pool.query(
    `SELECT si.material_id, si.issue_date::text AS issue_date, SUM(si.issued_qty) AS qty
       FROM stock_issues si JOIN warehouses w ON w.id = si.from_warehouse_id
      WHERE w.code = $1 AND si.status != 'CANCELLED' AND si.issue_date BETWEEN $2 AND $3
      GROUP BY si.material_id, si.issue_date`,
    [PM_STORE_CODE, windowStart, windowEnd]
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

  const sum = wb.addWorksheet('Summary');
  sum.addRow([`PM Store DOI – summary by status (audit of ${data.audit ? fmtDbDate(data.audit.audit_date) : 'n/a'})`]);
  sum.addRow([]);
  sum.addRow(['Status', 'Count of SKU Code', 'Sum of Inventory value (Rs.)']);
  for (const s of data.summary) sum.addRow([s.status, s.count, Number(s.value.toFixed(2))]);

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

// Matches "BLR QuickCom Central PM Store Holding Inventory Report" sample.
function buildSummaryHtml(data) {
  const totalCount = data.summary.reduce((a, s) => a + s.count, 0);
  const totalValue = data.summary.reduce((a, s) => a + s.value, 0);
  const summaryTable = table(
    ['Status', 'Count of SKU Code', 'Sum of Inventory value (Rs.)'],
    [
      ...data.summary.map((s) => [s.status, fmtNum(s.count), fmtMoney(s.value)]),
      [`<b>Grand Total</b>`, `<b>${fmtNum(totalCount)}</b>`, `<b>${fmtMoney(totalValue)}</b>`],
    ]
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
    ])
  );

  const intro = `
  <p>PFB the daily Holding Inventory report for the Central PM Store in QuickCom BLR.</p>
  <p>This report tracks the current PM Store Inventory value and estimated Days of Inventory (DOI) based on a rolling 7-day average daily consumption, to identify stock-outs, critical shortages, and non-moving packing materials.</p>
  <p>The Summary and Detail views are shown below along with the attached working file.</p>`;

  const bodyHtml = `
  <p><b>Summary</b></p>
  ${summaryTable}
  <p><b>Detail</b></p>
  ${detailTable}`;

  return wrapEmail({ intro, bodyHtml });
}

module.exports = { getData, buildWorkbook, buildSummaryHtml, computeRow, statusFor };
