// Report 3: Central PM Store Audit-wise Loss, weekly (Mon-Sun).
// Layout mirrors "Central_PM_Store_Audit_Loss_15Oct_29Oct.xlsx" — sheets:
// Summary, Materials, Inward_Detail, Issue_Detail, PM_Audit_Backup.
//
// Opening (base) for an audit = the immediately preceding audit's physical_qty
// for that material (not audit_entry_lines.system_qty — that's the ledger's
// running balance at post time, which already includes every movement since
// the dawn of the ledger, not just this audit's period). For the very first
// audit in history there's no prior period to anchor on, so system_qty is
// used as a fallback opening.

const { PM_STORE_CODE } = require('../config/pmStoreFacilities');
const { unitsPerUom, costingUom, conversionBasis, unitCostPerUom, fmtDbDate } = require('./materialCost');
const { fmtDMonY, fmtDMon, fmtIstDateTime, fmtNum, fmtMoney, table, wrapEmail } = require('./emailTemplate');

function datesBetweenExclusive(startStr, endStr) {
  const out = [];
  const d = new Date(`${startStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(`${endStr}T00:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Rolling 7-day window ending the day before asOfDate (the report's
// reference date) — NOT a calendar Mon-Sun week. Per direct correction: a
// report referenced to the 20th covers the previous Friday (13th) through
// this Thursday (19th) — i.e. [asOfDate-7, asOfDate-1].
function previousWeekRange(asOfDate) {
  const weekEnd = addDays(asOfDate, -1);
  const weekStart = addDays(weekEnd, -6);
  return { weekStart, weekEnd };
}

async function getData(pool, { asOfDate }) {
  const { weekStart, weekEnd } = previousWeekRange(asOfDate);

  const whRes = await pool.query(`SELECT id FROM warehouses WHERE code = $1`, [PM_STORE_CODE]);
  const warehouseId = whRes.rows[0]?.id;

  const auditsRes = await pool.query(
    `SELECT id, audit_ref, audit_date::text AS audit_date, created_at FROM audit_entries
      WHERE warehouse_id = $1 AND audit_date BETWEEN $2 AND $3
      ORDER BY audit_date ASC, created_at ASC`,
    [warehouseId, weekStart, weekEnd]
  );
  const audits = auditsRes.rows;

  const matRes = await pool.query(
    `SELECT id, code, name, category, unit, master_price, meters_per_unit, stickers_per_roll, pieces_per_kg
       FROM materials WHERE is_active ORDER BY code`
  );
  const materials = matRes.rows;

  const inwardRows = [];
  const issueRows = [];
  const backupRows = [];
  const summaryByAudit = [];

  for (const audit of audits) {
    const prevRes = await pool.query(
      `SELECT id, audit_date::text AS audit_date, created_at FROM audit_entries
        WHERE warehouse_id = $1 AND audit_date < $2
        ORDER BY audit_date DESC, created_at DESC LIMIT 1`,
      [warehouseId, audit.audit_date]
    );
    const prevAudit = prevRes.rows[0] || null;
    // Period boundary is each audit's own *posting* timestamp (created_at),
    // not audit_date/grn_date/issue_date — a GRN/issue is assigned to the
    // audit it was actually posted before, by wall-clock sequence, not by
    // which calendar day it's nominally dated for (backdated/late-entered
    // rows were landing in the wrong audit's loss figures under date-based
    // assignment). periodStart is exclusive, periodEnd (this audit's own
    // created_at) is inclusive.
    const periodStart = prevAudit ? prevAudit.created_at : null;
    const periodEnd = audit.created_at;

    // "Opening Period From" label, matching the sample's "Audit DD-Mon (no
    // audit on DD-Mon)" format when there's a gap of skipped calendar days.
    let openingPeriodFrom = 'No prior audit';
    if (prevAudit) {
      openingPeriodFrom = `Audit ${fmtDMon(prevAudit.audit_date)}`;
      const missing = datesBetweenExclusive(prevAudit.audit_date, audit.audit_date);
      if (missing.length) openingPeriodFrom += ` (no audit on ${missing.map(fmtDMon).join(', ')})`;
    }

    const lineRes = await pool.query(
      `SELECT material_id, system_qty, physical_qty FROM audit_entry_lines WHERE audit_entry_id = $1`,
      [audit.id]
    );
    const lineByMaterial = new Map(lineRes.rows.map((r) => [String(r.material_id), r]));

    let prevLineByMaterial = new Map();
    if (prevAudit) {
      const prevLineRes = await pool.query(
        `SELECT material_id, physical_qty FROM audit_entry_lines WHERE audit_entry_id = $1`,
        [prevAudit.id]
      );
      prevLineByMaterial = new Map(prevLineRes.rows.map((r) => [String(r.material_id), r]));
    }

    // Joined to stock_ledger and filtered on *its* created_at (the actual
    // posting timestamp, single source of truth per this codebase's own
    // convention) rather than grn_date/issue_date — a backdated or
    // late-entered GRN/issue now lands in the audit period it was really
    // posted into, not the one its nominal date happens to fall in.
    const inwardParams = periodStart
      ? [warehouseId, periodStart, periodEnd]
      : [warehouseId, periodEnd];
    const inwardQuery = periodStart
      ? `SELECT gr.*, po.po_no FROM goods_receipts gr
           JOIN stock_ledger sl ON sl.ref_table = 'goods_receipts' AND sl.ref_id = gr.id AND sl.movement_type = 'GRN_INWARD'
           LEFT JOIN purchase_orders po ON po.id = gr.po_id
          WHERE gr.warehouse_id = $1 AND gr.status = 'POSTED' AND sl.created_at > $2 AND sl.created_at <= $3`
      : `SELECT gr.*, po.po_no FROM goods_receipts gr
           JOIN stock_ledger sl ON sl.ref_table = 'goods_receipts' AND sl.ref_id = gr.id AND sl.movement_type = 'GRN_INWARD'
           LEFT JOIN purchase_orders po ON po.id = gr.po_id
          WHERE gr.warehouse_id = $1 AND gr.status = 'POSTED' AND sl.created_at <= $2`;
    const inwardRes = await pool.query(inwardQuery, inwardParams);

    const issueParams = periodStart
      ? [warehouseId, periodStart, periodEnd]
      : [warehouseId, periodEnd];
    const issueQuery = periodStart
      ? `SELECT si.*, w.code AS dest_code, w.name AS dest_name, w.warehouse_type AS dest_type
           FROM stock_issues si
           JOIN stock_ledger sl ON sl.ref_table = 'stock_issues' AND sl.ref_id = si.id AND sl.movement_type = 'ISSUE_OUT'
           JOIN warehouses w ON w.id = si.to_warehouse_id
          WHERE si.from_warehouse_id = $1 AND si.status != 'CANCELLED' AND sl.created_at > $2 AND sl.created_at <= $3`
      : `SELECT si.*, w.code AS dest_code, w.name AS dest_name, w.warehouse_type AS dest_type
           FROM stock_issues si
           JOIN stock_ledger sl ON sl.ref_table = 'stock_issues' AND sl.ref_id = si.id AND sl.movement_type = 'ISSUE_OUT'
           JOIN warehouses w ON w.id = si.to_warehouse_id
          WHERE si.from_warehouse_id = $1 AND si.status != 'CANCELLED' AND sl.created_at <= $2`;
    const issueRes = await pool.query(issueQuery, issueParams);

    const inwardByMaterial = new Map(); // material_id -> { normal, adhoc }
    for (const gr of inwardRes.rows) {
      const key = String(gr.material_id);
      if (!inwardByMaterial.has(key)) inwardByMaterial.set(key, { normal: 0, adhoc: 0 });
      const bucket = inwardByMaterial.get(key);
      const isAdhoc = !!gr.grn_type;
      if (isAdhoc) bucket.adhoc += Number(gr.grn_qty);
      else bucket.normal += Number(gr.grn_qty);
      inwardRows.push({
        auditRef: audit.audit_ref,
        auditDate: audit.audit_date,
        grnRef: gr.grn_ref,
        grnPostedAt: gr.created_at,
        materialId: gr.material_id,
        inwardType: isAdhoc ? 'Adhoc' : 'Normal',
        inwardSubtype: isAdhoc ? gr.grn_type : 'Against PO',
        sourceVendor: gr.vendor_name || null,
        poNo: gr.po_no || null,
        invoiceNo: gr.invoice_no || null,
        qtyBase: Number(gr.grn_qty),
      });
    }

    const issueByMaterial = new Map();
    for (const si of issueRes.rows) {
      const key = String(si.material_id);
      if (!issueByMaterial.has(key)) issueByMaterial.set(key, { normal: 0, adhoc: 0 });
      const bucket = issueByMaterial.get(key);
      const isAdhoc = si.indent_line_id === null;
      if (isAdhoc) bucket.adhoc += Number(si.issued_qty);
      else bucket.normal += Number(si.issued_qty);
      issueRows.push({
        auditRef: audit.audit_ref,
        auditDate: audit.audit_date,
        materialId: si.material_id,
        issueType: isAdhoc ? 'Adhoc' : 'Normal',
        issueSubtype: isAdhoc ? `Adhoc - to ${si.dest_type}` : 'Against Indent',
        destCode: si.dest_code,
        destName: si.dest_name,
        destType: si.dest_type,
        qtyBase: Number(si.issued_qty),
      });
    }

    for (const m of materials) {
      const key = String(m.id);
      const line = lineByMaterial.get(key);
      const prevLine = prevLineByMaterial.get(key);
      if (!line) continue; // material not part of this audit
      const upu = unitsPerUom(m);
      const openingBase = prevLine ? Number(prevLine.physical_qty) : Number(line.system_qty);
      const inward = inwardByMaterial.get(key) || { normal: 0, adhoc: 0 };
      const issue = issueByMaterial.get(key) || { normal: 0, adhoc: 0 };
      const closingBase = Number(line.physical_qty);
      const lossBase = (openingBase + inward.normal + inward.adhoc) - (closingBase + issue.normal + issue.adhoc);
      const unitCost = unitCostPerUom(m);
      backupRows.push({
        auditRef: audit.audit_ref,
        auditDate: audit.audit_date,
        materialCode: m.code,
        materialName: m.name,
        costingUom: costingUom(m),
        baseUnit: m.unit,
        unitsPerUom: upu,
        openingBase,
        inwardNormalBase: inward.normal,
        inwardAdhocBase: inward.adhoc,
        issueNormalBase: issue.normal,
        issueAdhocBase: issue.adhoc,
        closingBase,
        lossBase,
        openingUom: openingBase / upu,
        inwardNormalUom: inward.normal / upu,
        inwardAdhocUom: inward.adhoc / upu,
        issueNormalUom: issue.normal / upu,
        issueAdhocUom: issue.adhoc / upu,
        closingUom: closingBase / upu,
        lossQtyUom: lossBase / upu,
        unitCost,
        lossValue: (lossBase / upu) * unitCost,
        costFlag: unitCost === 0 ? 'NO COST' : '',
      });
    }

    // Summary qty columns are in each PM's costing UoM (rolls/kg/pieces),
    // not base units (meters/stickers/pieces) — per direct instruction, since
    // base-unit totals were inflating the numbers without adding information
    // (still adds different UoMs together across materials; same caveat the
    // original sample itself notes — use Loss Value / PM_Audit_Backup for
    // real per-material decisions, this total is a rough at-a-glance figure).
    const auditRows = backupRows.filter((r) => r.auditRef === audit.audit_ref);
    const sum = (field) => auditRows.reduce((a, r) => a + r[field], 0);
    summaryByAudit.push({
      auditRef: audit.audit_ref,
      auditDate: audit.audit_date,
      postedAt: audit.created_at,
      openingPeriodFrom,
      openingQty: sum('openingUom'),
      inwardNormal: sum('inwardNormalUom'),
      inwardAdhoc: sum('inwardAdhocUom'),
      totalInward: sum('inwardNormalUom') + sum('inwardAdhocUom'),
      issueNormal: sum('issueNormalUom'),
      issueAdhoc: sum('issueAdhocUom'),
      totalIssue: sum('issueNormalUom') + sum('issueAdhocUom'),
      closingQty: sum('closingUom'),
      lossQtyNet: sum('lossQtyUom'),
      grossLossQty: auditRows.filter((r) => r.lossQtyUom > 0).reduce((a, r) => a + r.lossQtyUom, 0),
      lossValueNet: sum('lossValue'),
      pmLinesWithLoss: auditRows.filter((r) => r.lossQtyUom !== 0).length,
      lossLinesWithNoCost: auditRows.filter((r) => r.lossQtyUom !== 0 && r.costFlag === 'NO COST').length,
    });
  }

  const summaryMap = new Map(); // auditRef -> { auditRef, auditDate, lossValue }
  for (const r of backupRows) {
    const cur = summaryMap.get(r.auditRef) || { auditRef: r.auditRef, auditDate: r.auditDate, lossValue: 0 };
    cur.lossValue += r.lossValue;
    summaryMap.set(r.auditRef, cur);
  }

  return {
    asOfDate,
    weekStart,
    weekEnd,
    audits,
    materials,
    inwardRows,
    issueRows,
    backupRows,
    summary: [...summaryMap.values()],
    summaryByAudit,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
const fmtDate = fmtDbDate;

const SUMMARY_HEADERS = [
  'Audit Date', 'Audit Ref', 'Posted (IST)', 'Opening Period From', 'Opening Qty', 'Inward - Normal', 'Inward - Adhoc', 'Total Inward',
  'Issue - Normal', 'Issue - Adhoc', 'Total Issue', 'Closing Qty (Physical)', 'Loss Qty (Net)', 'Gross Loss Qty (shortages only)',
  'Loss Value (Net, INR)', 'PM Lines with Loss', 'Loss Lines with No Cost',
];

// Colored, formatted Summary sheet — numeric cells stay numbers (not
// pre-formatted strings) with numFmt applied, so Excel can still sort/filter/
// sum them; loss cells are conditionally shaded (red=shortage, green=gain);
// an Analysis block below the table gives an at-a-glance readout instead of
// making the reader work it out from 17 raw columns.
function buildSummarySheet(wb, data) {
  const ws = wb.addWorksheet('Summary');
  const rows = data.summaryByAudit || [];
  const ncols = SUMMARY_HEADERS.length;
  const total = (field) => rows.reduce((a, r) => a + r[field], 0);
  const colLetter = (n) => String.fromCharCode(64 + n); // 1-indexed -> 'A','B',...

  const COLOR = {
    title: 'FF1F4E78', titleText: 'FFFFFFFF',
    header: 'FF2E75B6', headerText: 'FFFFFFFF',
    band: 'FFF2F2F2',
    totalRow: 'FFD9E1F2',
    shortage: 'FFFFC7CE', shortageText: 'FF9C0006',
    gain: 'FFC6EFCE', gainText: 'FF006100',
    clean: 'FFE2EFDA', cleanText: 'FF375623',
    border: 'FFBFBFBF',
  };
  const thinBorder = { style: 'thin', color: { argb: COLOR.border } };

  // Title
  ws.mergeCells(1, 1, 1, ncols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Central PM Store (Bangalore) — Audit-wise Loss Summary, ${fmtDMonY(data.weekStart)} to ${fmtDMonY(data.weekEnd)}`;
  titleCell.font = { bold: true, size: 14, color: { argb: COLOR.titleText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.title } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 26;

  // Legend / method note
  ws.mergeCells(2, 1, 2, ncols);
  const noteCell = ws.getCell(2, 1);
  noteCell.value = 'Loss Qty = (Opening + Inward) − (Closing + Issue), in each PM’s costing UoM. Positive = shortage (red), negative = gain (green), zero = reconciled (green). Rows assigned by ledger posting time (stock_ledger.created_at), not nominal GRN/issue date. See PM_Audit_Backup for the per-material breakdown.';
  noteCell.font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  noteCell.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(2).height = 28;

  ws.addRow([]);

  // Header row
  const headerRowNum = 4;
  const headerRow = ws.getRow(headerRowNum);
  SUMMARY_HEADERS.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLOR.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  });
  headerRow.height = 32;
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }];

  // Data rows
  rows.forEach((r, idx) => {
    const row = ws.addRow([
      fmtDMonY(r.auditDate), r.auditRef, fmtIstDateTime(r.postedAt), r.openingPeriodFrom,
      r.openingQty, r.inwardNormal, r.inwardAdhoc, r.totalInward,
      r.issueNormal, r.issueAdhoc, r.totalIssue, r.closingQty,
      r.lossQtyNet, r.grossLossQty, r.lossValueNet, r.pmLinesWithLoss, r.lossLinesWithNoCost,
    ]);
    const band = idx % 2 === 1 ? COLOR.band : 'FFFFFFFF';
    row.eachCell((cell, colNum) => {
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      if (colNum >= 5) cell.numFmt = '#,##0.00';
      if (colNum >= 5 && colNum !== 16 && colNum !== 17) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } };
      } else if (colNum < 5) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } };
      }
    });
    // Conditional shading on the two loss-qty columns (13, 14) and loss value (15).
    for (const colNum of [13, 14, 15]) {
      const cell = row.getCell(colNum);
      const val = colNum === 15 ? r.lossValueNet : (colNum === 13 ? r.lossQtyNet : r.grossLossQty);
      if (val > 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.shortage } };
        cell.font = { color: { argb: COLOR.shortageText }, bold: true };
      } else if (val < 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.gain } };
        cell.font = { color: { argb: COLOR.gainText }, bold: true };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.clean } };
        cell.font = { color: { argb: COLOR.cleanText } };
        cell.value = 0;
      }
    }
  });

  // Total row
  const totalRow = ws.addRow([
    'Total (all audits)', '', '', '', '',
    total('inwardNormal'), total('inwardAdhoc'), total('totalInward'),
    total('issueNormal'), total('issueAdhoc'), total('totalIssue'), '',
    total('lossQtyNet'), total('grossLossQty'), total('lossValueNet'),
    total('pmLinesWithLoss'), total('lossLinesWithNoCost'),
  ]);
  totalRow.eachCell((cell, colNum) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.totalRow } };
    cell.border = { top: { style: 'double', color: { argb: 'FF1F4E78' } }, bottom: thinBorder, left: thinBorder, right: thinBorder };
    if (colNum >= 6) cell.numFmt = '#,##0.00';
  });

  // Column widths
  const widths = [13, 20, 18, 26, 12, 13, 13, 12, 12, 12, 11, 15, 12, 16, 14, 11, 12];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // ── Analysis block ──────────────────────────────────────────────────────
  const anyLoss = rows.some((r) => r.lossQtyNet !== 0);
  const auditsWithLoss = rows.filter((r) => r.lossQtyNet !== 0);
  const worst = auditsWithLoss.length
    ? auditsWithLoss.reduce((a, b) => (Math.abs(b.lossValueNet) > Math.abs(a.lossValueNet) ? b : a))
    : null;

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

  addInsight('Audits reviewed', `${rows.length} (${fmtDMonY(data.weekStart)} – ${fmtDMonY(data.weekEnd)})`);
  addInsight('Total Inward (UoM, all PMs)', Number(total('totalInward').toFixed(2)));
  addInsight('Total Issue (UoM, all PMs)', Number(total('totalIssue').toFixed(2)));
  addInsight(
    'Net Loss Value (INR)',
    Number(total('lossValueNet').toFixed(2)),
    anyLoss ? COLOR.shortage : COLOR.clean,
    anyLoss ? COLOR.shortageText : COLOR.cleanText
  );
  addInsight(
    'Audits with a loss',
    `${auditsWithLoss.length} of ${rows.length}`,
    auditsWithLoss.length ? COLOR.shortage : COLOR.clean,
    auditsWithLoss.length ? COLOR.shortageText : COLOR.cleanText
  );
  if (worst) {
    addInsight('Largest single-audit loss', `${worst.auditRef} (${fmtDMonY(worst.auditDate)}) — ₹${worst.lossValueNet.toFixed(2)}`, COLOR.shortage, COLOR.shortageText);
  }

  r += 1;
  ws.mergeCells(r, 1, r, ncols);
  const takeaway = ws.getCell(r, 1);
  takeaway.value = anyLoss
    ? `${auditsWithLoss.length} of ${rows.length} audits this week showed a net stock discrepancy totaling ₹${total('lossValueNet').toFixed(2)} — see the highlighted rows above and PM_Audit_Backup for which materials drove it.`
    : `Every audit this week reconciled perfectly — Opening + Inward matched Closing + Issue for all ${rows.length} audits, with zero net loss or gain.`;
  takeaway.font = { italic: true, bold: true, size: 11, color: { argb: anyLoss ? COLOR.shortageText : COLOR.cleanText } };
  takeaway.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: anyLoss ? COLOR.shortage : COLOR.clean } };
  takeaway.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(r).height = 24;
}

function buildWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();

  buildSummarySheet(wb, data);

  const mat = wb.addWorksheet('Materials');
  mat.addRow(['PM Code', 'PM Name', 'Costing UoM', 'Cost per UoM (INR)', 'Base unit in PackTrack', 'Units per UoM', 'Conversion basis', 'Cost Status']);
  for (const m of data.materials) {
    const cost = unitCostPerUom(m);
    mat.addRow([m.code, m.name, costingUom(m), cost, m.unit, unitsPerUom(m), conversionBasis(m), cost === 0 ? 'NO COST' : 'OK']);
  }

  const inward = wb.addWorksheet('Inward_Detail');
  inward.addRow(['Audit Ref', 'Audit Date', 'GRN Ref', 'GRN Posted (IST)', 'PM Code', 'Inward Type', 'Inward Subtype', 'Source / Vendor', 'PO No', 'Invoice No', 'Qty (base units)']);
  for (const r of data.inwardRows) {
    inward.addRow([r.auditRef, fmtDate(r.auditDate), r.grnRef, r.grnPostedAt, materialCode(data, r.materialId), r.inwardType, r.inwardSubtype, r.sourceVendor, r.poNo, r.invoiceNo, r.qtyBase]);
  }

  const issue = wb.addWorksheet('Issue_Detail');
  issue.addRow(['Audit Ref', 'Audit Date', 'PM Code', 'Issue Type', 'Issue Subtype', 'Destination Code', 'Destination Facility', 'Destination Type', 'Issue Qty (base units)']);
  for (const r of data.issueRows) {
    issue.addRow([r.auditRef, fmtDate(r.auditDate), materialCode(data, r.materialId), r.issueType, r.issueSubtype, r.destCode, r.destName, r.destType, r.qtyBase]);
  }

  const backup = wb.addWorksheet('PM_Audit_Backup');
  backup.addRow([
    'Audit Ref', 'Audit Date', 'PM Code', 'PM Name', 'Costing UoM', 'Base Unit', 'Units per UoM',
    'Opening (base)', 'Inward Normal (base)', 'Inward Adhoc (base)', 'Issue Normal (base)', 'Issue Adhoc (base)', 'Closing Physical (base)',
    'Opening (UoM)', 'Inward Normal (UoM)', 'Inward Adhoc (UoM)', 'Issue Normal (UoM)', 'Issue Adhoc (UoM)', 'Closing Physical (UoM)',
    'Loss Qty (UoM)', 'Cost per UoM (INR)', 'Loss Value (INR)', 'Cost Flag',
  ]);
  for (const r of data.backupRows) {
    backup.addRow([
      r.auditRef, fmtDate(r.auditDate), r.materialCode, r.materialName, r.costingUom, r.baseUnit, r.unitsPerUom,
      round3(r.openingBase), round3(r.inwardNormalBase), round3(r.inwardAdhocBase), round3(r.issueNormalBase), round3(r.issueAdhocBase), round3(r.closingBase),
      round3(r.openingUom), round3(r.inwardNormalUom), round3(r.inwardAdhocUom), round3(r.issueNormalUom), round3(r.issueAdhocUom), round3(r.closingUom),
      round3(r.lossQtyUom), r.unitCost, round2(r.lossValue), r.costFlag,
    ]);
  }

  return wb;
}

function materialCode(data, materialId) {
  const m = data.materials.find((x) => String(x.id) === String(materialId));
  return m ? m.code : String(materialId);
}

// Matches "BLR QuickCom Central PM Store Audit Loss Report" sample — a
// single per-audit table (no separate Summary/Detail split in the email
// body; per-PM breakdown is attachment-only, in PM_Audit_Backup).
function buildSummaryHtml(data) {
  const rows = data.summaryByAudit || [];
  const total = (field) => rows.reduce((a, r) => a + r[field], 0);
  const anyLoss = rows.some((r) => r.lossQtyNet !== 0);

  const mainTable = table(
    SUMMARY_HEADERS,
    [
      ...rows.map((r) => [
        fmtDMonY(r.auditDate), r.auditRef, fmtIstDateTime(r.postedAt), r.openingPeriodFrom,
        fmtNum(r.openingQty, 2), fmtNum(r.inwardNormal, 2), fmtNum(r.inwardAdhoc, 2), fmtNum(r.totalInward, 2),
        fmtNum(r.issueNormal, 2), fmtNum(r.issueAdhoc, 2), fmtNum(r.totalIssue, 2), fmtNum(r.closingQty, 2),
        r.lossQtyNet === 0 ? '-' : fmtNum(r.lossQtyNet, 2), r.grossLossQty === 0 ? '-' : fmtNum(r.grossLossQty, 2),
        r.lossValueNet === 0 ? '-' : fmtMoney(r.lossValueNet),
        r.pmLinesWithLoss === 0 ? '-' : fmtNum(r.pmLinesWithLoss), r.lossLinesWithNoCost === 0 ? '-' : fmtNum(r.lossLinesWithNoCost),
      ]),
      ['<b>Total (all audits)</b>', '', '', '', '', fmtNum(total('inwardNormal'), 2), fmtNum(total('inwardAdhoc'), 2), fmtNum(total('totalInward'), 2),
        fmtNum(total('issueNormal'), 2), fmtNum(total('issueAdhoc'), 2), fmtNum(total('totalIssue'), 2), '',
        total('lossQtyNet') === 0 ? '-' : fmtNum(total('lossQtyNet'), 2), total('grossLossQty') === 0 ? '-' : fmtNum(total('grossLossQty'), 2),
        total('lossValueNet') === 0 ? '-' : fmtMoney(total('lossValueNet')),
        total('pmLinesWithLoss') === 0 ? '-' : fmtNum(total('pmLinesWithLoss')), total('lossLinesWithNoCost') === 0 ? '-' : fmtNum(total('lossLinesWithNoCost'))],
    ]
  );

  const intro = `
  <p>PFB the weekly Central PM Store Audit Loss Report for QuickCom BLR.</p>
  <p>This report tracks daily audit losses for the Central PM store between consecutive audits and reports them on a weekly basis.</p>
  <p>The Summary and Loss/Gain details are shown below along with the attached working file.</p>`;

  const bodyHtml = `
  ${mainTable}
  ${anyLoss ? '' : '<p>No Audit loss or gain occurred during this time period.</p>'}`;

  return wrapEmail({ intro, bodyHtml });
}

module.exports = { getData, buildWorkbook, buildSummaryHtml };
