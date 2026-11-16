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

function mondayOnOrBefore(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Previous ISO week (Mon-Sun) relative to asOfDate.
function previousWeekRange(asOfDate) {
  const thisMonday = mondayOnOrBefore(asOfDate);
  const prevMonday = addDays(thisMonday, -7);
  const prevSunday = addDays(prevMonday, 6);
  return { weekStart: prevMonday, weekEnd: prevSunday };
}

async function getData(pool, { asOfDate }) {
  const { weekStart, weekEnd } = previousWeekRange(asOfDate);

  const whRes = await pool.query(`SELECT id FROM warehouses WHERE code = $1`, [PM_STORE_CODE]);
  const warehouseId = whRes.rows[0]?.id;

  const auditsRes = await pool.query(
    `SELECT id, audit_ref, audit_date::text AS audit_date FROM audit_entries
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

  for (const audit of audits) {
    const prevRes = await pool.query(
      `SELECT id, audit_date::text AS audit_date FROM audit_entries
        WHERE warehouse_id = $1 AND audit_date < $2
        ORDER BY audit_date DESC, created_at DESC LIMIT 1`,
      [warehouseId, audit.audit_date]
    );
    const prevAudit = prevRes.rows[0] || null;
    const periodStart = prevAudit ? prevAudit.audit_date : null; // exclusive
    const periodEndExclusiveDate = audit.audit_date;

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

    const inwardParams = periodStart
      ? [warehouseId, periodStart, periodEndExclusiveDate]
      : [warehouseId, periodEndExclusiveDate];
    const inwardQuery = periodStart
      ? `SELECT gr.*, po.po_no FROM goods_receipts gr LEFT JOIN purchase_orders po ON po.id = gr.po_id
          WHERE gr.warehouse_id = $1 AND gr.status = 'POSTED' AND gr.grn_date > $2 AND gr.grn_date <= $3`
      : `SELECT gr.*, po.po_no FROM goods_receipts gr LEFT JOIN purchase_orders po ON po.id = gr.po_id
          WHERE gr.warehouse_id = $1 AND gr.status = 'POSTED' AND gr.grn_date <= $2`;
    const inwardRes = await pool.query(inwardQuery, inwardParams);

    const issueParams = periodStart
      ? [warehouseId, periodStart, periodEndExclusiveDate]
      : [warehouseId, periodEndExclusiveDate];
    const issueQuery = periodStart
      ? `SELECT si.*, w.code AS dest_code, w.name AS dest_name, w.warehouse_type AS dest_type
           FROM stock_issues si JOIN warehouses w ON w.id = si.to_warehouse_id
          WHERE si.from_warehouse_id = $1 AND si.status != 'CANCELLED' AND si.issue_date > $2 AND si.issue_date <= $3`
      : `SELECT si.*, w.code AS dest_code, w.name AS dest_name, w.warehouse_type AS dest_type
           FROM stock_issues si JOIN warehouses w ON w.id = si.to_warehouse_id
          WHERE si.from_warehouse_id = $1 AND si.status != 'CANCELLED' AND si.issue_date <= $2`;
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
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
const fmtDate = fmtDbDate;

function buildWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet('Summary');
  sum.addRow([`Central PM Store (Bangalore) - Audit-wise Loss Summary, ${data.weekStart} to ${data.weekEnd}`]);
  sum.addRow(['Loss Qty = (Opening + Inward) - (Closing + Issue). Positive = shortage, negative = gain. Quantities are in each PM\'s costing UoM; see PM_Audit_Backup for detail.']);
  sum.addRow([]);
  sum.addRow(['Audit Ref', 'Audit Date', 'Total Loss Value (Rs.)']);
  for (const s of data.summary) sum.addRow([s.auditRef, fmtDate(s.auditDate), round2(s.lossValue)]);

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

function buildSummaryHtml(data) {
  const rows = data.summary
    .map((s) => `<tr><td>${s.auditRef}</td><td>${fmtDate(s.auditDate)}</td><td style="text-align:right">${s.lossValue.toFixed(2)}</td></tr>`)
    .join('');
  return `
  <h3>Central PM Store Audit-wise Loss — ${data.weekStart} to ${data.weekEnd}</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px;">
    <tr><th>Audit Ref</th><th>Audit Date</th><th>Loss Value (Rs.)</th></tr>
    ${rows}
  </table>`;
}

module.exports = { getData, buildWorkbook, buildSummaryHtml };
