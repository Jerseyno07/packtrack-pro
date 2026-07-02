// ═══════════════════════════════════════════════════════════════════════════
// PackTrack Production API — Node.js + Express + Postgres
// Modules: Indent Upload (CSV/Excel) | PO Upload (CSV/Excel)
//          | PM Store Inward (GRN vs uploaded PO) | Issue vs Indent
//          | CC/FC Receipt Confirmation | PM Store Exec Dashboard
//
//   npm install express pg multer csv-parse xlsx zod dotenv helmet cors bcrypt
//
// DB: any Postgres works. Free-tier hosted options: Neon (neon.tech),
// Supabase (supabase.com), or Railway — all give you a DATABASE_URL for free.
// Run 001_schema.sql (in correct table order) before starting this server.
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { z } = require('zod');
const path = require('path');
const { existsSync } = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
app.use(helmet());
app.use(cors({ credentials: true, origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Public health endpoint — no auth required, used by Railway healthcheck
app.get('/health', (req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function genRef(prefix) {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${year}-${rand}`;
}

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function writeAudit(client, { userId, action, entityTable, entityId, detail }) {
  await client.query(
    `INSERT INTO audit_log (user_id, action, entity_table, entity_id, detail) VALUES ($1,$2,$3,$4,$5)`,
    [userId || null, action, entityTable || null, entityId || null, detail ? JSON.stringify(detail) : null]
  );
}

async function postLedgerEntry(client, { warehouseId, materialId, movementType, qtyDelta, unitCost, refTable, refId, movementDate }) {
  await client.query(
    `INSERT INTO stock_ledger (warehouse_id, material_id, movement_type, qty_delta, unit_cost, ref_table, ref_id, movement_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (ref_table, ref_id, movement_type) DO NOTHING`,
    [warehouseId, materialId, movementType, qtyDelta, unitCost, refTable, refId, movementDate]
  );
}

async function getOnHandQty(client, warehouseId, materialId) {
  const r = await client.query(`SELECT COALESCE(SUM(qty_delta),0) AS qty FROM stock_ledger WHERE warehouse_id=$1 AND material_id=$2`, [warehouseId, materialId]);
  return Number(r.rows[0].qty);
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH — real sessions, bcrypt-hashed passwords, httpOnly cookie or bearer token
// ─────────────────────────────────────────────────────────────────────────

const SESSION_TTL_HOURS = 12;

app.post('/api/v1/auth/login', asyncHandler(async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'email and password are required');

  const userRes = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active', [parsed.data.email.toLowerCase()]);
  if (!userRes.rows.length) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const user = userRes.rows[0];

  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)', [token, user.id, expiresAt]);
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  res.json({
    token, // client stores this and sends as `Authorization: Bearer <token>`
    expires_at: expiresAt,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}));

app.post('/api/v1/auth/logout', asyncHandler(async (req, res) => {
  const token = (req.header('Authorization') || '').replace('Bearer ', '');
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
}));

const authenticate = asyncHandler(async (req, res, next) => {
  const token = (req.header('Authorization') || '').replace('Bearer ', '');
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing bearer token');

  const sessRes = await pool.query(
    `SELECT s.user_id, u.role, u.name, u.email,
            COALESCE(array_agg(uw.warehouse_id) FILTER (WHERE uw.warehouse_id IS NOT NULL), '{}') AS warehouse_ids
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_warehouses uw ON uw.user_id = u.id
     WHERE s.token = $1 AND s.expires_at > now() AND u.is_active
     GROUP BY s.user_id, u.role, u.name, u.email`,
    [token]
  );
  if (!sessRes.rows.length) throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired or invalid');
  req.user = { id: sessRes.rows[0].user_id, ...sessRes.rows[0] };
  next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', `Role ${req.user.role} cannot perform this action`));
    next();
  };
}

// Convenience for initial setup: create the first admin user if none exists.
// In production, gate this behind a setup token or remove after first run.
app.post('/api/v1/auth/bootstrap-admin', asyncHandler(async (req, res) => {
  const existing = await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (existing.rows.length) throw new ApiError(409, 'ADMIN_EXISTS', 'An admin user already exists');
  const schema = z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'name, email, password (min 8 chars) required');
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const r = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'ADMIN') RETURNING id, name, email, role`,
    [parsed.data.name, parsed.data.email.toLowerCase(), hash]
  );
  res.status(201).json({ user: r.rows[0] });
}));

// Admin creates other users (PM Store exec, CC/FC exec)
app.post('/api/v1/users', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['ADMIN', 'PM_STORE_EXEC', 'CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP']),
    warehouse_ids: z.array(z.number().int().positive()).optional().default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid user payload', parsed.error.issues);
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(d.password, 10);
    const userIns = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [d.name, d.email.toLowerCase(), hash, d.role]
    );
    const userId = userIns.rows[0].id;
    for (const whId of d.warehouse_ids) {
      await client.query('INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1,$2)', [userId, whId]);
    }
    await writeAudit(client, { userId: req.user.id, action: 'USER_CREATED', entityTable: 'users', entityId: userId, detail: { email: d.email, role: d.role } });
    await client.query('COMMIT');
    res.status(201).json({ user: userIns.rows[0] });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ─────────────────────────────────────────────────────────────────────────
// Shared CSV/Excel parsing helper
// ─────────────────────────────────────────────────────────────────────────

function parseUploadedFile(file) {
  let rows;
  if (file.originalname.toLowerCase().endsWith('.csv')) {
    rows = parseCsv(file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  } else {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase().replace(/\s+/g, '_')] = typeof v === 'string' ? v.trim() : v;
    return out;
  });
}

function toIsoDateOrNull(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10); // undefined = invalid (caller checks)
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 1: INDENT UPLOAD — facility-wise, SKU-wise, for a given date
// Expected columns: facility_code, sku_code, requested_qty, remarks (optional)
// ═══════════════════════════════════════════════════════════════════════════

const indentRowSchema = z.object({
  facility_code: z.string().min(1),
  sku_code: z.string().min(1),
  requested_qty: z.coerce.number().positive(),
  remarks: z.string().optional(),
});

app.post('/api/v1/indents/upload', authenticate, requireRole('CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'), upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
    const indentDate = req.body.indent_date; // the date this whole batch is "for" — required per request
    if (!indentDate || isNaN(new Date(indentDate).getTime())) {
      throw new ApiError(400, 'INDENT_DATE_REQUIRED', 'indent_date (YYYY-MM-DD) is required as a form field alongside the file');
    }

    const rawRows = parseUploadedFile(req.file);
    if (!rawRows.length) throw new ApiError(400, 'EMPTY_FILE', 'File contains no data rows');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const batchRef = genRef('INDB');
      const batchIns = await client.query(
        `INSERT INTO indent_batches (batch_ref, source_filename, uploaded_by_user_id, indent_date, status, total_rows)
         VALUES ($1,$2,$3,$4,'UPLOADED',$5) RETURNING id`,
        [batchRef, req.file.originalname, req.user.id, indentDate, rawRows.length]
      );
      const batchId = batchIns.rows[0].id;

      const whMap = new Map((await client.query('SELECT id, code FROM warehouses WHERE is_active')).rows.map((r) => [r.code, r.id]));
      const matMap = new Map((await client.query('SELECT id, code FROM materials WHERE is_active')).rows.map((r) => [r.code, r.id]));

      const errors = [];
      let validCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = rawRows[i];
        const parsed = indentRowSchema.safeParse(row);
        if (!parsed.success) { errors.push({ row: rowNum, error: parsed.error.issues.map((e) => e.message).join('; ') }); continue; }
        const { facility_code, sku_code, requested_qty, remarks } = parsed.data;
        const warehouseId = whMap.get(facility_code);
        const materialId = matMap.get(sku_code);
        if (!warehouseId) { errors.push({ row: rowNum, error: `Unknown facility_code '${facility_code}'` }); continue; }
        if (!materialId) { errors.push({ row: rowNum, error: `Unknown sku_code '${sku_code}'` }); continue; }

        const indentRef = genRef('IND');
        await client.query(
          `INSERT INTO indent_lines (indent_ref, batch_id, row_number_in_file, warehouse_id, material_id, indent_date, requested_qty, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [indentRef, batchId, rowNum, warehouseId, materialId, indentDate, requested_qty, remarks || null]
        );
        validCount++;
      }

      const finalStatus = errors.length === 0 ? 'VALIDATED' : validCount === 0 ? 'FAILED' : 'PARTIALLY_FAILED';
      await client.query(
        `UPDATE indent_batches SET status=$1, valid_rows=$2, error_rows=$3, error_detail=$4 WHERE id=$5`,
        [finalStatus, validCount, errors.length, JSON.stringify(errors.slice(0, 200)), batchId]
      );
      await writeAudit(client, { userId: req.user.id, action: 'INDENT_BATCH_UPLOADED', entityTable: 'indent_batches', entityId: batchId, detail: { batchRef, validCount, errorCount: errors.length } });
      await client.query('COMMIT');

      res.status(201).json({ batch_id: batchId, batch_ref: batchRef, status: finalStatus, total_rows: rawRows.length, valid_rows: validCount, error_rows: errors.length, errors: errors.slice(0, 200) });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  })
);

app.get('/api/v1/indents', authenticate, asyncHandler(async (req, res) => {
  const { warehouse_id, material_id, status, date_from, date_to, page = 1, page_size = 50 } = req.query;
  const conditions = []; const params = [];
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`il.warehouse_id = $${params.length}`); }
  if (material_id) { params.push(material_id); conditions.push(`il.material_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`il.status = $${params.length}`); }
  if (date_from) { params.push(date_from); conditions.push(`il.indent_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conditions.push(`il.indent_date <= $${params.length}`); }
  if (['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP'].includes(req.user.role)) {
    params.push(req.user.warehouse_ids.length ? req.user.warehouse_ids : [-1]);
    conditions.push(`il.warehouse_id = ANY($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(page_size), 200);
  const offset = (Number(page) - 1) * limit;
  const result = await pool.query(
    `SELECT il.*, w.name AS warehouse_name, w.code AS warehouse_code, m.code AS material_code, m.name AS material_name, m.unit
     FROM indent_lines il JOIN warehouses w ON w.id = il.warehouse_id JOIN materials m ON m.id = il.material_id
     ${where} ORDER BY il.indent_date DESC, il.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  res.json({ data: result.rows, page: Number(page), page_size: limit });
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 2: PO UPLOAD — CSV/Excel, free-text vendor name, for PM Store inward
// Expected columns: po_no, vendor_name, sku_code, pm_store_code, po_qty,
//                   unit_price, po_date, expected_delivery (optional)
// ═══════════════════════════════════════════════════════════════════════════

const poRowSchema = z.object({
  po_no: z.string().min(1),
  vendor_name: z.string().min(1),
  sku_code: z.string().min(1),
  pm_store_code: z.string().min(1),
  po_qty: z.coerce.number().positive(),
  unit_price: z.coerce.number().nonnegative(),
  po_date: z.string().min(1),
  expected_delivery: z.string().optional(),
});

app.post('/api/v1/purchase-orders/upload', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
    const rawRows = parseUploadedFile(req.file);
    if (!rawRows.length) throw new ApiError(400, 'EMPTY_FILE', 'File contains no data rows');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const batchRef = genRef('POB');
      const batchIns = await client.query(
        `INSERT INTO po_batches (batch_ref, source_filename, uploaded_by_user_id, status, total_rows) VALUES ($1,$2,$3,'UPLOADED',$4) RETURNING id`,
        [batchRef, req.file.originalname, req.user.id, rawRows.length]
      );
      const batchId = batchIns.rows[0].id;

      const matMap = new Map((await client.query('SELECT id, code FROM materials WHERE is_active')).rows.map((r) => [r.code, r.id]));
      const whMap = new Map((await client.query("SELECT id, code FROM warehouses WHERE is_active AND warehouse_type='PM_STORE'")).rows.map((r) => [r.code, r.id]));

      const errors = [];
      let validCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = rawRows[i];
        const parsed = poRowSchema.safeParse(row);
        if (!parsed.success) { errors.push({ row: rowNum, error: parsed.error.issues.map((e) => e.message).join('; ') }); continue; }
        const d = parsed.data;

        const materialId = matMap.get(d.sku_code);
        const warehouseId = whMap.get(d.pm_store_code);
        if (!materialId) { errors.push({ row: rowNum, error: `Unknown sku_code '${d.sku_code}'` }); continue; }
        if (!warehouseId) { errors.push({ row: rowNum, error: `Unknown or non-PM-Store pm_store_code '${d.pm_store_code}'` }); continue; }

        const poDate = toIsoDateOrNull(d.po_date);
        if (poDate === undefined) { errors.push({ row: rowNum, error: `Invalid po_date '${d.po_date}'` }); continue; }
        let expDelivery = null;
        if (d.expected_delivery) {
          expDelivery = toIsoDateOrNull(d.expected_delivery);
          if (expDelivery === undefined) { errors.push({ row: rowNum, error: `Invalid expected_delivery '${d.expected_delivery}'` }); continue; }
        }

        // Duplicate po_no within the same file or against existing data -> reported as a row error, not a hard crash,
        // so one bad row doesn't void the whole batch.
        const dupCheck = await client.query('SELECT id FROM purchase_orders WHERE po_no = $1', [d.po_no]);
        if (dupCheck.rows.length) { errors.push({ row: rowNum, error: `PO number '${d.po_no}' already exists` }); continue; }

        await client.query(
          `INSERT INTO purchase_orders (po_no, batch_id, row_number_in_file, vendor_name, material_id, pm_store_warehouse_id, po_qty, unit_price, po_date, expected_delivery)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [d.po_no, batchId, rowNum, d.vendor_name, materialId, warehouseId, d.po_qty, d.unit_price, poDate, expDelivery]
        );
        validCount++;
      }

      const finalStatus = errors.length === 0 ? 'VALIDATED' : validCount === 0 ? 'FAILED' : 'PARTIALLY_FAILED';
      await client.query(`UPDATE po_batches SET status=$1, valid_rows=$2, error_rows=$3, error_detail=$4 WHERE id=$5`,
        [finalStatus, validCount, errors.length, JSON.stringify(errors.slice(0, 200)), batchId]);
      await writeAudit(client, { userId: req.user.id, action: 'PO_BATCH_UPLOADED', entityTable: 'po_batches', entityId: batchId, detail: { batchRef, validCount, errorCount: errors.length } });
      await client.query('COMMIT');

      res.status(201).json({ batch_id: batchId, batch_ref: batchRef, status: finalStatus, total_rows: rawRows.length, valid_rows: validCount, error_rows: errors.length, errors: errors.slice(0, 200) });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  })
);

app.get('/api/v1/purchase-orders', authenticate, asyncHandler(async (req, res) => {
  const { status, warehouse_id, material_id } = req.query;
  const conditions = []; const params = [];
  if (status) { params.push(status); conditions.push(`po.status = $${params.length}`); }
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`po.pm_store_warehouse_id = $${params.length}`); }
  if (material_id) { params.push(material_id); conditions.push(`po.material_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT po.*, m.code AS material_code, m.name AS material_name, w.name AS warehouse_name,
            (po.po_qty - po.received_qty_cache) AS remaining_qty
     FROM purchase_orders po JOIN materials m ON m.id = po.material_id JOIN warehouses w ON w.id = po.pm_store_warehouse_id
     ${where} ORDER BY po.po_date DESC`, params
  );
  res.json({ data: result.rows });
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 3: PM STORE INWARD / GRN — against an uploaded PO
// ═══════════════════════════════════════════════════════════════════════════

const grnSchema = z.object({
  po_id: z.coerce.number().int().positive(),
  grn_qty: z.coerce.number().positive(),
  grn_date: z.string(),
  invoice_no: z.string().optional(),
  invoice_date: z.string().optional(),
  notes: z.string().optional(),
  has_invoice_attachment: z.boolean(),
});

app.post('/api/v1/goods-receipts', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = grnSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid GRN payload', parsed.error.issues);
  const d = parsed.data;
  if (!d.has_invoice_attachment) throw new ApiError(422, 'INVOICE_REQUIRED', 'Invoice copy attachment is mandatory for GRN posting');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [d.po_id]);
    if (!poRes.rows.length) throw new ApiError(404, 'PO_NOT_FOUND', `PO ${d.po_id} not found`);
    const po = poRes.rows[0];
    if (['CLOSED', 'CANCELLED', 'FORCE_COMPLETED'].includes(po.status)) throw new ApiError(409, 'PO_NOT_OPEN', `PO ${po.po_no} is ${po.status}, cannot post GRN`);

    const remaining = Number(po.po_qty) - Number(po.received_qty_cache);
    if (d.grn_qty > remaining) throw new ApiError(422, 'GRN_EXCEEDS_PO', `GRN qty ${d.grn_qty} exceeds remaining PO qty ${remaining}`, { remaining });
    if (d.grn_qty < remaining) throw new ApiError(422, 'PARTIAL_GRN_NOT_ALLOWED', `GRN qty (${d.grn_qty}) is less than remaining PO qty (${remaining}). Receive the full quantity or use Force Complete to close the PO with a shortage.`, { remaining });

    const grnRef = genRef('GRN');
    const grnIns = await client.query(
      `INSERT INTO goods_receipts (grn_ref, po_id, warehouse_id, material_id, grn_qty, unit_price, grn_date, invoice_no, invoice_date, received_by_user_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [grnRef, po.id, po.pm_store_warehouse_id, po.material_id, d.grn_qty, po.unit_price, d.grn_date, d.invoice_no || null, d.invoice_date || null, req.user.id, d.notes || null]
    );
    const grnId = grnIns.rows[0].id;

    await postLedgerEntry(client, { warehouseId: po.pm_store_warehouse_id, materialId: po.material_id, movementType: 'GRN_INWARD', qtyDelta: d.grn_qty, unitCost: po.unit_price, refTable: 'goods_receipts', refId: grnId, movementDate: d.grn_date });
    await writeAudit(client, { userId: req.user.id, action: 'GRN_POSTED', entityTable: 'goods_receipts', entityId: grnId, detail: { grnRef, po_id: po.id, qty: d.grn_qty } });
    await client.query('COMMIT');
    res.status(201).json({ grn_id: grnId, grn_ref: grnRef, po_id: po.id, status: 'POSTED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 4: ISSUE STOCK FROM PM STORE AGAINST INDENT
// ═══════════════════════════════════════════════════════════════════════════

const issueSchema = z.object({
  indent_line_id: z.coerce.number().int().positive(),
  issued_qty: z.coerce.number().positive(),
  issue_date: z.string(),
  from_warehouse_id: z.coerce.number().int().positive().optional(),
  vehicle_no: z.string().optional(),
  notes: z.string().optional(),
});

app.get('/api/v1/indent-lines/:id/issue-defaults', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const lineRes = await pool.query('SELECT * FROM indent_lines WHERE id = $1', [req.params.id]);
  if (!lineRes.rows.length) throw new ApiError(404, 'NOT_FOUND', `Indent line ${req.params.id} not found`);
  const line = lineRes.rows[0];
  const expectedQty = Number(line.requested_qty) - Number(line.issued_qty);
  const pmWhRes = await pool.query("SELECT id FROM warehouses WHERE warehouse_type='PM_STORE' AND is_active ORDER BY id LIMIT 1");
  const pmWhId = pmWhRes.rows[0]?.id;
  const onHandQty = pmWhId ? await getOnHandQty(pool, pmWhId, line.material_id) : 0;
  const suggestedActualQty = Math.min(expectedQty, onHandQty);
  res.json({ expected_qty: expectedQty, on_hand_qty: onHandQty, suggested_actual_qty: suggestedActualQty });
}));

app.post('/api/v1/stock-issues', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid issue payload', parsed.error.issues);
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lineRes = await client.query('SELECT * FROM indent_lines WHERE id = $1 FOR UPDATE', [d.indent_line_id]);
    if (!lineRes.rows.length) throw new ApiError(404, 'INDENT_LINE_NOT_FOUND', `Indent line ${d.indent_line_id} not found`);
    const line = lineRes.rows[0];
    if (['CANCELLED', 'FORCE_COMPLETED'].includes(line.status)) throw new ApiError(409, 'INDENT_LINE_CLOSED', `Indent line ${line.indent_ref} is ${line.status}`);

    const remainingOnIndent = Number(line.requested_qty) - Number(line.issued_qty);
    if (d.issued_qty > remainingOnIndent) throw new ApiError(422, 'ISSUE_EXCEEDS_INDENT', `Issue qty ${d.issued_qty} exceeds remaining indent qty ${remainingOnIndent}`, { remainingOnIndent });

    const fromWhId = d.from_warehouse_id || (await client.query("SELECT id FROM warehouses WHERE warehouse_type='PM_STORE' AND is_active ORDER BY id LIMIT 1")).rows[0]?.id;
    if (!fromWhId) throw new ApiError(422, 'NO_PM_STORE', 'No active PM Store warehouse configured');

    const onHand = await getOnHandQty(client, fromWhId, line.material_id);
    if (d.issued_qty > onHand) throw new ApiError(422, 'INSUFFICIENT_STOCK', `Insufficient stock at PM Store: available ${onHand}, requested ${d.issued_qty}`, { onHand });

    const costRes = await client.query(
      `SELECT COALESCE(SUM(qty_delta*unit_cost),0) / NULLIF(SUM(CASE WHEN qty_delta>0 THEN qty_delta ELSE 0 END),0) AS avg_cost FROM stock_ledger WHERE warehouse_id=$1 AND material_id=$2`,
      [fromWhId, line.material_id]
    );
    const unitCost = Number(costRes.rows[0].avg_cost || 0);

    const expectedQty = remainingOnIndent;
    const issueRef = genRef('ISS');
    const issueIns = await client.query(
      `INSERT INTO stock_issues (issue_ref, indent_line_id, from_warehouse_id, to_warehouse_id, material_id, issued_qty, expected_qty, unit_cost_snapshot, issue_date, dispatched_by_user_id, vehicle_no, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [issueRef, line.id, fromWhId, line.warehouse_id, line.material_id, d.issued_qty, expectedQty, unitCost, d.issue_date, req.user.id, d.vehicle_no || null, d.notes || null]
    );
    const issueId = issueIns.rows[0].id;

    await postLedgerEntry(client, { warehouseId: fromWhId, materialId: line.material_id, movementType: 'ISSUE_OUT', qtyDelta: -d.issued_qty, unitCost, refTable: 'stock_issues', refId: issueId, movementDate: d.issue_date });
    await writeAudit(client, { userId: req.user.id, action: 'STOCK_ISSUED', entityTable: 'stock_issues', entityId: issueId, detail: { issueRef, indent_line_id: line.id, qty: d.issued_qty } });
    await client.query('COMMIT');
    res.status(201).json({ issue_id: issueId, issue_ref: issueRef, status: 'DISPATCHED', unit_cost_snapshot: unitCost });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/api/v1/stock-issues', authenticate, asyncHandler(async (req, res) => {
  const { to_warehouse_id, status } = req.query;
  const conditions = []; const params = [];
  if (to_warehouse_id) { params.push(to_warehouse_id); conditions.push(`si.to_warehouse_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`si.status = $${params.length}`); }
  if (['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP'].includes(req.user.role)) {
    params.push(req.user.warehouse_ids.length ? req.user.warehouse_ids : [-1]);
    conditions.push(`si.to_warehouse_id = ANY($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT si.*, m.code AS material_code, m.name AS material_name, m.unit, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name, il.indent_ref,
            (si.issued_qty - COALESCE((SELECT SUM(received_qty+shortage_qty+damage_qty) FROM stock_receipts sr WHERE sr.stock_issue_id = si.id),0)) AS pending_qty
     FROM stock_issues si JOIN materials m ON m.id = si.material_id JOIN warehouses fw ON fw.id = si.from_warehouse_id
     JOIN warehouses tw ON tw.id = si.to_warehouse_id JOIN indent_lines il ON il.id = si.indent_line_id
     ${where} ORDER BY si.issue_date DESC`, params
  );
  res.json({ data: result.rows });
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 5: RECEIVE ISSUED STOCK AT CC/FC
// ═══════════════════════════════════════════════════════════════════════════

const receiptSchema = z.object({
  stock_issue_id: z.coerce.number().int().positive(),
  received_qty: z.coerce.number().nonnegative(),
  shortage_qty: z.coerce.number().nonnegative().default(0),
  damage_qty: z.coerce.number().nonnegative().default(0),
  shortage_reason: z.string().optional(),
  receipt_date: z.string(),
});

app.get('/api/v1/stock-issues/:id/receipt-defaults', authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT * FROM stock_issues WHERE id = $1', [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock issue ${req.params.id} not found`);
  const issue = r.rows[0];
  const accountedRes = await pool.query(`SELECT COALESCE(SUM(received_qty+shortage_qty+damage_qty),0) AS total FROM stock_receipts WHERE stock_issue_id=$1`, [issue.id]);
  const alreadyAccounted = Number(accountedRes.rows[0].total);
  const expectedQty = Number(issue.issued_qty) - alreadyAccounted;
  res.json({ expected_qty: expectedQty, suggested_received_qty: expectedQty });
}));

app.post('/api/v1/stock-receipts', authenticate, requireRole('CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = receiptSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid receipt payload', parsed.error.issues);
  const d = parsed.data;
  if ((d.shortage_qty > 0 || d.damage_qty > 0) && !d.shortage_reason) throw new ApiError(422, 'REASON_REQUIRED', 'shortage_reason is mandatory when shortage_qty or damage_qty > 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issueRes = await client.query('SELECT * FROM stock_issues WHERE id = $1 FOR UPDATE', [d.stock_issue_id]);
    if (!issueRes.rows.length) throw new ApiError(404, 'ISSUE_NOT_FOUND', `Stock issue ${d.stock_issue_id} not found`);
    const issue = issueRes.rows[0];

    if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.includes(Number(issue.to_warehouse_id))) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not mapped to the destination warehouse for this issue');
    }
    if (['RECEIVED', 'CANCELLED', 'FORCE_COMPLETED'].includes(issue.status)) throw new ApiError(409, 'ISSUE_CLOSED', `Issue ${issue.issue_ref} is already ${issue.status}`);

    const accountedRes = await client.query(`SELECT COALESCE(SUM(received_qty+shortage_qty+damage_qty),0) AS total FROM stock_receipts WHERE stock_issue_id=$1`, [issue.id]);
    const alreadyAccounted = Number(accountedRes.rows[0].total);
    const thisTotal = d.received_qty + d.shortage_qty + d.damage_qty;
    const remaining = Number(issue.issued_qty) - alreadyAccounted;
    if (thisTotal > remaining + 0.001) throw new ApiError(422, 'RECEIPT_EXCEEDS_ISSUE', `Receipt total ${thisTotal} exceeds remaining un-receipted qty ${remaining}`, { remaining });

    const expectedQtyForReceipt = remaining;
    const receiptRef = genRef('RCV');
    const receiptIns = await client.query(
      `INSERT INTO stock_receipts (receipt_ref, stock_issue_id, received_qty, shortage_qty, damage_qty, shortage_reason, received_by_user_id, receipt_date, expected_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [receiptRef, issue.id, d.received_qty, d.shortage_qty, d.damage_qty, d.shortage_reason || null, req.user.id, d.receipt_date, expectedQtyForReceipt]
    );
    const receiptId = receiptIns.rows[0].id;

    if (d.received_qty > 0) {
      await postLedgerEntry(client, { warehouseId: issue.to_warehouse_id, materialId: issue.material_id, movementType: 'RECEIPT_IN', qtyDelta: d.received_qty, unitCost: issue.unit_cost_snapshot, refTable: 'stock_receipts', refId: receiptId, movementDate: d.receipt_date });
    }
    if (d.shortage_qty + d.damage_qty > 0) {
      await postLedgerEntry(client, { warehouseId: issue.to_warehouse_id, materialId: issue.material_id, movementType: 'RECEIPT_SHORTAGE_WRITE_OFF', qtyDelta: 0, unitCost: issue.unit_cost_snapshot, refTable: 'stock_receipts', refId: receiptId, movementDate: d.receipt_date });
    }

    await writeAudit(client, { userId: req.user.id, action: 'STOCK_RECEIPT_CONFIRMED', entityTable: 'stock_receipts', entityId: receiptId, detail: { receiptRef, issue_id: issue.id, ...d } });
    await client.query('COMMIT');
    res.status(201).json({ receipt_id: receiptId, receipt_ref: receiptRef });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// FORCE COMPLETE endpoints
// ═══════════════════════════════════════════════════════════════════════════

const forceCompleteSchema = z.object({ reason: z.string().min(1, 'reason is required') });

app.post('/api/v1/purchase-orders/:id/force-complete', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = forceCompleteSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'reason is required', parsed.error.issues);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `PO ${req.params.id} not found`);
    const po = r.rows[0];
    if (['CLOSED', 'CANCELLED', 'FORCE_COMPLETED'].includes(po.status))
      throw new ApiError(409, 'ALREADY_TERMINAL', `PO is already ${po.status}`);
    await client.query(
      `UPDATE purchase_orders SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
      [req.user.id, parsed.data.reason, po.id]
    );
    await writeAudit(client, { userId: req.user.id, action: 'PO_FORCE_COMPLETED', entityTable: 'purchase_orders', entityId: po.id, detail: { reason: parsed.data.reason } });
    await client.query('COMMIT');
    res.json({ ok: true, po_id: po.id, status: 'FORCE_COMPLETED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/indent-lines/:id/force-complete', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = forceCompleteSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'reason is required', parsed.error.issues);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM indent_lines WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Indent line ${req.params.id} not found`);
    const line = r.rows[0];
    if (['FULLY_ISSUED', 'CANCELLED', 'FORCE_COMPLETED'].includes(line.status))
      throw new ApiError(409, 'ALREADY_TERMINAL', `Indent line is already ${line.status}`);
    await client.query(
      `UPDATE indent_lines SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
      [req.user.id, parsed.data.reason, line.id]
    );
    await writeAudit(client, { userId: req.user.id, action: 'INDENT_LINE_FORCE_COMPLETED', entityTable: 'indent_lines', entityId: line.id, detail: { reason: parsed.data.reason } });
    await client.query('COMMIT');
    res.json({ ok: true, indent_line_id: line.id, status: 'FORCE_COMPLETED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/stock-issues/:id/force-complete', authenticate, requireRole('CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'), asyncHandler(async (req, res) => {
  const parsed = forceCompleteSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'reason is required', parsed.error.issues);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM stock_issues WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock issue ${req.params.id} not found`);
    const issue = r.rows[0];
    if (['RECEIVED', 'CANCELLED', 'FORCE_COMPLETED'].includes(issue.status))
      throw new ApiError(409, 'ALREADY_TERMINAL', `Stock issue is already ${issue.status}`);
    if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.includes(Number(issue.to_warehouse_id)))
      throw new ApiError(403, 'FORBIDDEN', 'You are not mapped to the destination warehouse for this issue');
    await client.query(
      `UPDATE stock_issues SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
      [req.user.id, parsed.data.reason, issue.id]
    );
    await writeAudit(client, { userId: req.user.id, action: 'STOCK_ISSUE_FORCE_COMPLETED', entityTable: 'stock_issues', entityId: issue.id, detail: { reason: parsed.data.reason } });
    await client.query('COMMIT');
    res.json({ ok: true, issue_id: issue.id, status: 'FORCE_COMPLETED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN OVERRIDE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

async function snapshotAndLog(client, { adminUserId, entityTable, entityId, action, reason, previousState }) {
  await client.query(
    `INSERT INTO admin_reversals (admin_user_id, entity_table, entity_id, action, reason, previous_state) VALUES ($1,$2,$3,$4,$5,$6)`,
    [adminUserId, entityTable, entityId, action, reason, JSON.stringify(previousState)]
  );
}

// ── Goods Receipts ────────────────────────────────────────────────────────
app.patch('/api/v1/admin/goods-receipts/:id', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason, ...fields } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const allowed = ['grn_qty', 'grn_date', 'invoice_no', 'invoice_date', 'notes'];
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  }
  if (!sets.length) throw new ApiError(400, 'NO_FIELDS', 'No editable fields provided');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM goods_receipts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `GRN ${req.params.id} not found`);
    const grn = r.rows[0];
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'goods_receipts', entityId: grn.id, action: 'EDIT', reason, previousState: grn });
    vals.push(req.params.id);
    await client.query(`UPDATE goods_receipts SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    // Re-run PO sync trigger fires automatically; also re-sync ledger if grn_qty changed
    if (fields.grn_qty !== undefined) {
      await client.query(`UPDATE stock_ledger SET qty_delta=$1 WHERE ref_table='goods_receipts' AND ref_id=$2 AND movement_type='GRN_INWARD'`, [fields.grn_qty, grn.id]);
    }
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_GRN_EDITED', entityTable: 'goods_receipts', entityId: grn.id, detail: { reason, fields } });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/admin/goods-receipts/:id/cancel', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM goods_receipts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `GRN ${req.params.id} not found`);
    const grn = r.rows[0];
    if (grn.status === 'REVERSED') throw new ApiError(409, 'ALREADY_REVERSED', 'GRN is already reversed');
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'goods_receipts', entityId: grn.id, action: 'REVERSE', reason, previousState: grn });
    await client.query(`UPDATE goods_receipts SET status='REVERSED' WHERE id=$1`, [grn.id]);
    await postLedgerEntry(client, { warehouseId: grn.warehouse_id, materialId: grn.material_id, movementType: 'REVERSAL', qtyDelta: -Number(grn.grn_qty), unitCost: grn.unit_price, refTable: 'goods_receipts', refId: grn.id, movementDate: new Date().toISOString().slice(0, 10) });
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_GRN_REVERSED', entityTable: 'goods_receipts', entityId: grn.id, detail: { reason } });
    await client.query('COMMIT');
    res.json({ ok: true, status: 'REVERSED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ── Purchase Orders (admin cancel) ───────────────────────────────────────
app.post('/api/v1/admin/purchase-orders/:id/cancel', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `PO ${req.params.id} not found`);
    const po = r.rows[0];
    if (['CANCELLED', 'CLOSED', 'FORCE_COMPLETED'].includes(po.status))
      throw new ApiError(409, 'ALREADY_TERMINAL', `PO is already ${po.status}`);
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'purchase_orders', entityId: po.id, action: 'CANCEL', reason: reason.trim(), previousState: po });
    await client.query(`UPDATE purchase_orders SET status='CANCELLED', updated_at=now() WHERE id=$1`, [po.id]);
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_PO_CANCELLED', entityTable: 'purchase_orders', entityId: po.id, detail: { reason: reason.trim() } });
    await client.query('COMMIT');
    res.json({ ok: true, id: po.id, status: 'CANCELLED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ── Stock Issues ──────────────────────────────────────────────────────────
app.patch('/api/v1/admin/stock-issues/:id', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason, ...fields } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const allowed = ['issued_qty', 'issue_date', 'vehicle_no', 'notes'];
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  }
  if (!sets.length) throw new ApiError(400, 'NO_FIELDS', 'No editable fields provided');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM stock_issues WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock issue ${req.params.id} not found`);
    const issue = r.rows[0];
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'stock_issues', entityId: issue.id, action: 'EDIT', reason, previousState: issue });
    vals.push(req.params.id);
    await client.query(`UPDATE stock_issues SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length}`, vals);
    if (fields.issued_qty !== undefined) {
      await client.query(`UPDATE stock_ledger SET qty_delta=$1 WHERE ref_table='stock_issues' AND ref_id=$2 AND movement_type='ISSUE_OUT'`, [-Number(fields.issued_qty), issue.id]);
    }
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_ISSUE_EDITED', entityTable: 'stock_issues', entityId: issue.id, detail: { reason, fields } });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/admin/stock-issues/:id/cancel', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM stock_issues WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock issue ${req.params.id} not found`);
    const issue = r.rows[0];
    if (issue.status === 'CANCELLED') throw new ApiError(409, 'ALREADY_CANCELLED', 'Issue is already cancelled');
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'stock_issues', entityId: issue.id, action: 'CANCEL', reason, previousState: issue });
    await client.query(`UPDATE stock_issues SET status='CANCELLED', updated_at=now() WHERE id=$1`, [issue.id]);
    await postLedgerEntry(client, { warehouseId: issue.from_warehouse_id, materialId: issue.material_id, movementType: 'REVERSAL', qtyDelta: Number(issue.issued_qty), unitCost: issue.unit_cost_snapshot, refTable: 'stock_issues', refId: issue.id, movementDate: new Date().toISOString().slice(0, 10) });
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_ISSUE_CANCELLED', entityTable: 'stock_issues', entityId: issue.id, detail: { reason } });
    await client.query('COMMIT');
    res.json({ ok: true, status: 'CANCELLED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ── Stock Receipts ────────────────────────────────────────────────────────
app.patch('/api/v1/admin/stock-receipts/:id', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason, ...fields } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const allowed = ['received_qty', 'shortage_qty', 'damage_qty', 'shortage_reason', 'receipt_date'];
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  }
  if (!sets.length) throw new ApiError(400, 'NO_FIELDS', 'No editable fields provided');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM stock_receipts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock receipt ${req.params.id} not found`);
    const receipt = r.rows[0];
    const issueRes = await client.query('SELECT * FROM stock_issues WHERE id=$1', [receipt.stock_issue_id]);
    const issue = issueRes.rows[0];
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'stock_receipts', entityId: receipt.id, action: 'EDIT', reason, previousState: receipt });
    vals.push(req.params.id);
    await client.query(`UPDATE stock_receipts SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    if (fields.received_qty !== undefined) {
      await client.query(`UPDATE stock_ledger SET qty_delta=$1 WHERE ref_table='stock_receipts' AND ref_id=$2 AND movement_type='RECEIPT_IN'`, [Number(fields.received_qty), receipt.id]);
    }
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_RECEIPT_EDITED', entityTable: 'stock_receipts', entityId: receipt.id, detail: { reason, fields } });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/admin/stock-receipts/:id/cancel', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM stock_receipts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `Stock receipt ${req.params.id} not found`);
    const receipt = r.rows[0];
    const issueRes = await client.query('SELECT * FROM stock_issues WHERE id=$1', [receipt.stock_issue_id]);
    const issue = issueRes.rows[0];
    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'stock_receipts', entityId: receipt.id, action: 'REVERSE', reason, previousState: receipt });
    if (receipt.received_qty > 0) {
      await postLedgerEntry(client, { warehouseId: issue.to_warehouse_id, materialId: issue.material_id, movementType: 'REVERSAL', qtyDelta: -Number(receipt.received_qty), unitCost: issue.unit_cost_snapshot, refTable: 'stock_receipts', refId: receipt.id, movementDate: new Date().toISOString().slice(0, 10) });
    }
    await client.query(`DELETE FROM stock_receipts WHERE id=$1`, [receipt.id]);
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_RECEIPT_CANCELLED', entityTable: 'stock_receipts', entityId: receipt.id, detail: { reason } });
    await client.query('COMMIT');
    res.json({ ok: true, deleted: true });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ── Admin Audit Log ───────────────────────────────────────────────────────
app.get('/api/v1/admin/audit-log', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { entity_table, entity_id, user_id, date_from, date_to, page = 1, page_size = 50 } = req.query;
  const limit = Math.min(Number(page_size), 200);
  const offset = (Number(page) - 1) * limit;

  const buildWhere = (prefix, idField = 'entity_id', userField = 'user_id') => {
    const conds = []; const params = [];
    if (entity_table) { params.push(entity_table); conds.push(`${prefix}entity_table=$${params.length}`); }
    if (entity_id) { params.push(entity_id); conds.push(`${prefix}${idField}=$${params.length}`); }
    if (user_id) { params.push(user_id); conds.push(`${prefix}${userField}=$${params.length}`); }
    if (date_from) { params.push(date_from); conds.push(`${prefix}created_at>=$${params.length}`); }
    if (date_to) { params.push(date_to); conds.push(`${prefix}created_at<=$${params.length}`); }
    return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  };

  const aw = buildWhere('');
  const rw = buildWhere('', 'entity_id', 'admin_user_id');

  const [auditRows, reversalRows] = await Promise.all([
    pool.query(`SELECT 'audit' AS source, id, user_id, action, entity_table, entity_id, detail, created_at FROM audit_log ${aw.where} ORDER BY created_at DESC`, aw.params),
    pool.query(`SELECT 'reversal' AS source, id, admin_user_id AS user_id, action, entity_table, entity_id, reason AS detail, created_at FROM admin_reversals ${rw.where} ORDER BY created_at DESC`, rw.params),
  ]);

  const merged = [...auditRows.rows, ...reversalRows.rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(offset, offset + limit);

  res.json({ data: merged, page: Number(page), page_size: limit });
}));

// ── Admin Overview ────────────────────────────────────────────────────────
app.get('/api/v1/admin/overview', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { since } = req.query;
  const sinceClause = since ? `AND created_at >= '${since}'` : '';
  const sinceDateClause = since ? `AND indent_date >= '${since}'` : '';
  const sincePoClause = since ? `AND po_date >= '${since}'` : '';
  const sinceIssuedClause = since ? `AND issue_date >= '${since}'` : '';
  const sinceReceiptClause = since ? `AND receipt_date >= '${since}'` : '';

  const [indents, pos, stock, issues, receipts, lowStock] = await Promise.all([
    pool.query(`SELECT il.*, w.name AS warehouse_name, m.code AS material_code, m.name AS material_name, m.unit FROM indent_lines il JOIN warehouses w ON w.id=il.warehouse_id JOIN materials m ON m.id=il.material_id WHERE 1=1 ${sinceDateClause} ORDER BY il.indent_date DESC`),
    pool.query(`SELECT po.*, m.code AS material_code, m.name AS material_name, w.name AS warehouse_name FROM purchase_orders po JOIN materials m ON m.id=po.material_id JOIN warehouses w ON w.id=po.pm_store_warehouse_id WHERE 1=1 ${sincePoClause} ORDER BY po.po_date DESC`),
    pool.query(`SELECT cs.warehouse_id, w.name AS warehouse_name, cs.material_id, m.code AS material_code, m.name AS material_name, cs.on_hand_qty, cs.weighted_avg_cost FROM v_current_stock cs JOIN warehouses w ON w.id=cs.warehouse_id JOIN materials m ON m.id=cs.material_id ORDER BY w.name, m.code`),
    pool.query(`SELECT si.*, m.code AS material_code, m.name AS material_name, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name FROM stock_issues si JOIN materials m ON m.id=si.material_id JOIN warehouses fw ON fw.id=si.from_warehouse_id JOIN warehouses tw ON tw.id=si.to_warehouse_id WHERE 1=1 ${sinceIssuedClause} ORDER BY si.issue_date DESC`),
    pool.query(`SELECT sr.*, si.issue_ref, m.code AS material_code, m.name AS material_name FROM stock_receipts sr JOIN stock_issues si ON si.id=sr.stock_issue_id JOIN materials m ON m.id=si.material_id WHERE 1=1 ${sinceReceiptClause} ORDER BY sr.receipt_date DESC`),
    pool.query(`SELECT * FROM v_low_stock_alerts ORDER BY warehouse_name, material_code`),
  ]);

  res.json({
    indents: indents.rows,
    purchase_orders: pos.rows,
    current_stock: stock.rows,
    stock_issues: issues.rows,
    stock_receipts: receipts.rows,
    low_stock_alerts: lowStock.rows,
  });
}));

// MODULE 6: PM STORE EXEC DASHBOARD — read-only aggregates
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/v1/dashboard/indents-to-process', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM v_indent_to_process ORDER BY warehouse_name, material_code');
  res.json({ data: result.rows });
}));

app.get('/api/v1/dashboard/po-schedule', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM v_po_schedule');
  res.json({ data: result.rows });
}));

app.get('/api/v1/dashboard/low-stock-alerts', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM v_low_stock_alerts ORDER BY warehouse_name, material_code');
  res.json({ data: result.rows });
}));

app.get('/api/v1/stock/current', authenticate, asyncHandler(async (req, res) => {
  const { warehouse_id } = req.query;
  const params = [];
  const where = warehouse_id ? (params.push(warehouse_id), 'WHERE cs.warehouse_id = $1') : '';
  const result = await pool.query(
    `SELECT cs.warehouse_id, w.name AS warehouse_name, cs.material_id, m.code AS material_code, m.name AS material_name, cs.on_hand_qty, cs.weighted_avg_cost
     FROM v_current_stock cs JOIN warehouses w ON w.id = cs.warehouse_id JOIN materials m ON m.id = cs.material_id ${where} ORDER BY w.name, m.code`, params
  );
  res.json({ data: result.rows });
}));

// ─────────────────────────────────────────────────────────────────────────
// Reference data endpoints (for populating dropdowns in the upload UI)
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/v1/warehouses', authenticate, asyncHandler(async (req, res) => {
  const { type } = req.query;
  const params = [];
  // Build WHERE clause cleanly to avoid SQL fragmentation bugs
  const where = type ? (params.push(type), 'WHERE is_active AND warehouse_type = $1') : 'WHERE is_active';
  const r = await pool.query(
    `SELECT id, code, name, city, warehouse_type FROM warehouses ${where} ORDER BY name`, params
  );
  res.json({ data: r.rows });
}));

app.get('/api/v1/materials', authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query('SELECT id, code, name, category, unit, master_price FROM materials WHERE is_active ORDER BY code');
  res.json({ data: r.rows });
}));

// ─────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────

// Serve React frontend for all non-API routes (production)
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(frontendDist, 'index.html');
  existsSync(index) ? res.sendFile(index) : next();
});

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } }));
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PackTrack API listening on :${PORT}`));

module.exports = app;
