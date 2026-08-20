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

// BetterStack — patch console so all existing logs stream via HTTP API.
// If BETTERSTACK_SOURCE_TOKEN is not set (local dev), this is a no-op.
if (process.env.BETTERSTACK_SOURCE_TOKEN) {
  const LOGTAIL_ENDPOINT = process.env.BETTERSTACK_ENDPOINT || 'https://in.logs.betterstack.com';
  const LOGTAIL_HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.BETTERSTACK_SOURCE_TOKEN}`,
  };
  const ship = (level, args) => {
    const message = args.map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    }).join(' ');
    fetch(LOGTAIL_ENDPOINT, {
      method: 'POST',
      headers: LOGTAIL_HEADERS,
      body: JSON.stringify({ dt: new Date().toISOString(), level, message }),
    }).then((r) => {
      if (!r.ok) process.stderr.write(`[BetterStack] HTTP ${r.status}\n`);
    }).catch((e) => process.stderr.write(`[BetterStack] fetch error: ${e.message}\n`));
  };
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _error = console.error.bind(console);
  console.log   = (...a) => { _log(...a);   ship('info',  a); };
  console.warn  = (...a) => { _warn(...a);  ship('warn',  a); };
  console.error = (...a) => { _error(...a); ship('error', a); };
}

const Sentry = require('@sentry/node');
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.2,
});

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
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Cloudflare R2 client ──────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

async function presignR2(key, filename) {
  return getSignedUrl(r2, new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  }), { expiresIn: 3600 });
}

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // 'unsafe-inline' needed for inline scripts in index.html (PWA manifest switcher, Clarity tag)
      // *.clarity.ms needed because Clarity dynamically loads a second script from c.clarity.ms
      'script-src': ["'self'", "'unsafe-inline'", 'https://*.clarity.ms'],
      // Clarity spins up a blob: web worker for off-thread data processing
      'worker-src': ["'self'", 'blob:'],
      // Clarity sends session data to e.clarity.ms; Sentry sends error reports to ingest.sentry.io
      'connect-src': ["'self'", 'https://*.clarity.ms', 'https://*.sentry.io'],
      'img-src':     ["'self'", 'data:', 'https://*.clarity.ms'],
    },
  },
}));
app.use(cors({ credentials: true, origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });


// Public health endpoint — no auth required, used by Railway healthcheck
app.get('/health', (req, res) => res.json({
  ok: true,
  consumption_env: {
    CONSUMPTION_DASHBOARD_URL: process.env.CONSUMPTION_DASHBOARD_URL ? 'SET' : 'MISSING',
    CONSUMPTION_DASHBOARD_API_KEY: process.env.CONSUMPTION_DASHBOARD_API_KEY ? 'SET' : 'MISSING',
    CONSUMPTION_QUERY_ID: process.env.CONSUMPTION_QUERY_ID ? 'SET' : 'MISSING',
    CONSUMPTION_CC_QUERY_ID: process.env.CONSUMPTION_CC_QUERY_ID ? 'SET' : 'MISSING',
  },
}));

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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (warehouse_id, material_id, ref_table, ref_id, movement_type) DO NOTHING`,
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

  let whRes = await pool.query(
    'SELECT warehouse_id FROM user_warehouses WHERE user_id = $1 ORDER BY warehouse_id',
    [user.id]
  );
  // Admins have no user_warehouses rows — default to all active PM Store warehouses
  if (!whRes.rows.length) {
    whRes = await pool.query(
      "SELECT id AS warehouse_id FROM warehouses WHERE is_active AND warehouse_type = 'PM_STORE' ORDER BY id"
    );
  }
  const warehouse_ids = whRes.rows.map((r) => Number(r.warehouse_id));

  res.json({
    token,
    expires_at: expiresAt,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, warehouse_ids },
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

const COLUMN_LABELS = {
  po_no: 'PO Number', vendor_name: 'Vendor Name', sku_code: 'SKU Code',
  pm_store_code: 'PM Store Code', po_qty: 'PO Qty', no_of_rolls: 'No. of Rolls',
  unit_price: 'Unit Price',
  po_date: 'PO Date', expected_delivery: 'Expected Delivery',
  facility_code: 'Facility Code', requested_qty: 'Requested Qty', remarks: 'Remarks',
};

function formatZodErrors(issues) {
  return issues.map((e) => {
    const col = e.path[0];
    const label = col ? (COLUMN_LABELS[col] || col) : null;
    const msg = e.message === 'Required' ? 'is required' : e.message.toLowerCase();
    return label ? `"${label}" ${msg}` : msg;
  }).join('; ');
}

function parseUploadedFile(file) {
  let rows;
  try {
    if (file.originalname.toLowerCase().endsWith('.csv')) {
      rows = parseCsv(file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    } else {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
  } catch (e) {
    throw new ApiError(400, 'FILE_PARSE_ERROR',
      `Could not read "${file.originalname}" — make sure it's a valid, uncorrupted CSV or Excel (.xlsx) file (not password-protected). If it was exported from Excel, try re-saving it and uploading again. (${e.message})`);
  }
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase().replace(/\s+/g, '_')] = typeof v === 'string' ? (v.trim() || undefined) : v;
    return out;
  });
}

function toIsoDateOrNull(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val.toISOString().slice(0, 10);
  // Excel serial date number (e.g. 46123) — days since 1899-12-30
  if (typeof val === 'number' || (typeof val === 'string' && /^\d{4,6}$/.test(val.trim()) && Number(val) > 40000)) {
    const d = new Date(Math.round((Number(val) - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  // Strip time component if present (e.g. "24/07/2026 10:30:00")
  const s = String(val).trim().split(/[\sT]/)[0];
  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (Indian formats)
  const dmy4 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy4) {
    const d = new Date(`${dmy4[3]}-${dmy4[2].padStart(2, '0')}-${dmy4[1].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  // DD/MM/YY, DD-MM-YY, DD.MM.YY (2-digit year → 2000s)
  const dmy2 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (dmy2) {
    const d = new Date(`${2000 + parseInt(dmy2[3], 10)}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
  if (ymd) {
    const d = new Date(`${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  // ISO YYYY-MM-DD and other formats native Date handles
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// CSV uploads parse everything as the JS type Excel infers — codes like "3202" often
// arrive as numbers. Empty/null cells become undefined (skipped); non-empty values
// are coerced to a trimmed string regardless of whether they arrived as string or number.
const csvStr = z.preprocess(
  (v) => (v == null || String(v).trim() === '' ? undefined : String(v).trim()),
  z.string().optional()
);

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 1: INDENT UPLOAD — facility-wise, SKU-wise, for a given date
// Expected columns: facility_code, sku_code, requested_qty, remarks (optional)
// ═══════════════════════════════════════════════════════════════════════════

const indentRowSchema = z.object({
  facility_code: csvStr,
  sku_code: csvStr,
  requested_qty: z.coerce.number().int('Must be a whole number').positive('Must be greater than 0').optional(),
  no_of_rolls: z.coerce.number().int('Must be a whole number').positive('Must be greater than 0').optional(),
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

      const whMap = new Map((await client.query('SELECT id, code FROM warehouses WHERE is_active')).rows.map((r) => [r.code, r.id]));
      const matMap = new Map((await client.query('SELECT id, code, unit, stickers_per_roll, meters_per_unit, pieces_per_kg FROM materials WHERE is_active')).rows.map((r) => [r.code, r]));

      // Pass 1: validate all rows — if any fail, reject the entire upload
      const errors = [];
      const validatedRows = [];
      const seenFacilitySku = new Set();

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = rawRows[i];
        const parsed = indentRowSchema.safeParse(row);
        if (!parsed.success) { errors.push({ row: rowNum, error: formatZodErrors(parsed.error.issues) }); continue; }
        const { facility_code, sku_code, requested_qty, no_of_rolls, remarks } = parsed.data;
        const warehouseId = whMap.get(facility_code);
        const mat = matMap.get(sku_code);
        if (!warehouseId) { errors.push({ row: rowNum, error: `Unknown facility_code '${facility_code}'` }); continue; }
        if (!mat) { errors.push({ row: rowNum, error: `Unknown sku_code '${sku_code}'` }); continue; }
        const dedupKey = `${facility_code}::${sku_code}`;
        if (seenFacilitySku.has(dedupKey)) { errors.push({ row: rowNum, error: `Duplicate: facility '${facility_code}' + SKU '${sku_code}' already appears earlier in this file` }); continue; }
        seenFacilitySku.add(dedupKey);

        let finalQty;
        if (mat.stickers_per_roll) {
          if (!no_of_rolls) { errors.push({ row: rowNum, error: `"No. of Rolls" is required for sticker roll material '${sku_code}'` }); continue; }
          finalQty = no_of_rolls * mat.stickers_per_roll;
        } else if (mat.unit === 'Roll') {
          if (!no_of_rolls) { errors.push({ row: rowNum, error: `Roll material '${sku_code}' requires no_of_rolls column` }); continue; }
          finalQty = no_of_rolls * Number(mat.meters_per_unit);
        } else if (mat.pieces_per_kg) {
          if (!requested_qty) { errors.push({ row: rowNum, error: `Butter paper '${sku_code}' requires requested_qty in Kg` }); continue; }
          finalQty = requested_qty * Number(mat.pieces_per_kg);
        } else {
          if (!requested_qty) { errors.push({ row: rowNum, error: `Non-roll material '${sku_code}' requires requested_qty column` }); continue; }
          finalQty = requested_qty;
        }
        validatedRows.push({ rowNum, warehouseId, matId: mat.id, finalQty, remarks, facility_code, sku_code });
      }

      // Reject any row whose (facility, material) already has an indent line for this
      // indent_date from a prior upload — the whole file is rejected (same all-or-nothing
      // path as other validation errors below), so the uploader has to remove those exact
      // lines from the file and re-upload rather than silently re-creating duplicates.
      if (validatedRows.length > 0) {
        const pairs = [...new Set(validatedRows.map((r) => `${r.warehouseId}::${r.matId}`))]
          .map((k) => k.split('::').map(Number));
        const existingRes = await client.query(
          `SELECT DISTINCT il.warehouse_id, il.material_id
           FROM indent_lines il
           WHERE il.indent_date = $1
             AND (il.warehouse_id, il.material_id) IN (SELECT * FROM unnest($2::bigint[], $3::bigint[]))`,
          [indentDate, pairs.map((p) => p[0]), pairs.map((p) => p[1])]
        );
        const existingSet = new Set(existingRes.rows.map((r) => `${r.warehouse_id}::${r.material_id}`));
        for (const r of validatedRows) {
          if (existingSet.has(`${r.warehouseId}::${r.matId}`)) {
            errors.push({
              row: r.rowNum,
              error: `Already uploaded: facility '${r.facility_code}' + SKU '${r.sku_code}' already has an indent for ${indentDate}. Remove this line from the file and re-upload.`,
            });
          }
        }
      }

      // If any row failed validation, reject the entire upload — nothing is inserted
      if (errors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ status: 'REJECTED', total_rows: rawRows.length, valid_rows: validatedRows.length, error_rows: errors.length, errors: errors.slice(0, 200) });
      }

      // All rows valid — upload source file to R2, then insert everything
      const r2Key = `indents/${batchRef}/${req.file.originalname}`;
      await uploadToR2(r2Key, req.file.buffer, req.file.mimetype || 'application/octet-stream');

      const batchIns = await client.query(
        `INSERT INTO indent_batches (batch_ref, source_filename, uploaded_by_user_id, indent_date, status, total_rows, source_file_key)
         VALUES ($1,$2,$3,$4,'UPLOADED',$5,$6) RETURNING id`,
        [batchRef, req.file.originalname, req.user.id, indentDate, rawRows.length, r2Key]
      );
      const batchId = batchIns.rows[0].id;

      // Pass 2: insert all validated rows
      for (const { rowNum, warehouseId, matId, finalQty, remarks } of validatedRows) {
        const indentRef = genRef('IND');
        await client.query(
          `INSERT INTO indent_lines (indent_ref, batch_id, row_number_in_file, warehouse_id, material_id, indent_date, requested_qty, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [indentRef, batchId, rowNum, warehouseId, matId, indentDate, finalQty, remarks || null]
        );
      }

      await client.query(
        `UPDATE indent_batches SET status='VALIDATED', valid_rows=$1, error_rows=0, error_detail='[]' WHERE id=$2`,
        [validatedRows.length, batchId]
      );
      await writeAudit(client, { userId: req.user.id, action: 'INDENT_BATCH_UPLOADED', entityTable: 'indent_batches', entityId: batchId, detail: { batchRef, validCount: validatedRows.length, errorCount: 0 } });
      await client.query('COMMIT');

      res.status(201).json({ batch_id: batchId, batch_ref: batchRef, status: 'VALIDATED', total_rows: rawRows.length, valid_rows: validatedRows.length, error_rows: 0, errors: [] });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  })
);

app.get('/api/v1/indents/batches/:ref/download', authenticate, requireRole('CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT source_file_key, source_filename FROM indent_batches WHERE batch_ref = $1', [req.params.ref]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'Batch not found');
  const { source_file_key, source_filename } = rows[0];
  if (!source_file_key) throw new ApiError(404, 'NO_FILE', 'No source file stored for this batch');
  const url = await presignR2(source_file_key, source_filename);
  res.json({ url });
}));

app.get('/api/v1/indents/uploaded-facilities', authenticate, requireRole('CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'), asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) throw new ApiError(400, 'DATE_REQUIRED', 'date query param (YYYY-MM-DD) is required');
  const rows = await pool.query(
    `SELECT w.code AS facility_code, w.name AS facility_name,
            COUNT(il.id)::int AS line_count,
            COUNT(DISTINCT ib.id)::int AS batch_count,
            MIN(ib.batch_ref) AS batch_ref
     FROM indent_lines il
     JOIN warehouses w ON w.id = il.warehouse_id
     JOIN indent_batches ib ON ib.id = il.batch_id
     WHERE il.indent_date = $1
     GROUP BY w.code, w.name
     ORDER BY w.name`,
    [date]
  );
  res.json(rows.rows);
}));

app.get('/api/v1/indents/pending-by-facility', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT il.id, il.indent_ref, il.indent_date,
           il.requested_qty::numeric, il.issued_qty::numeric,
           (il.requested_qty - il.issued_qty) AS pending_qty,
           il.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
           il.material_id, m.code AS material_code, m.name AS material_name, m.unit,
           m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
           COALESCE(pm_cs.on_hand_qty, 0) AS pm_on_hand_qty,
           COALESCE(fac_cs.on_hand_qty, 0) AS facility_on_hand_qty
    FROM indent_lines il
    JOIN warehouses w ON w.id = il.warehouse_id
    JOIN materials m ON m.id = il.material_id
    CROSS JOIN (SELECT id FROM warehouses WHERE warehouse_type='PM_STORE' AND is_active ORDER BY id LIMIT 1) pm_wh
    LEFT JOIN v_current_stock pm_cs ON pm_cs.warehouse_id = pm_wh.id AND pm_cs.material_id = il.material_id
    LEFT JOIN v_current_stock fac_cs ON fac_cs.warehouse_id = il.warehouse_id AND fac_cs.material_id = il.material_id
    WHERE il.status IN ('PENDING', 'PARTIALLY_ISSUED')
    ORDER BY w.name, m.name
  `);
  res.json(result.rows);
}));

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
//
// A po_no may repeat across multiple rows — one row per material — to
// represent a single PO covering several packaging materials. Uniqueness
// is enforced on (po_no, material_id), not po_no alone.
// ═══════════════════════════════════════════════════════════════════════════

const poRowSchema = z.object({
  po_no: csvStr,
  vendor_name: csvStr,
  sku_code: csvStr,
  pm_store_code: csvStr,
  po_qty: z.coerce.number().positive().optional(),
  no_of_rolls: z.coerce.number().positive().optional(),
  unit_price: z.coerce.number().nonnegative(),
  po_date: z.coerce.string().min(1),
  expected_delivery: z.coerce.string().optional(),
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

      const matMap = new Map((await client.query('SELECT id, code, unit, stickers_per_roll, meters_per_unit, pieces_per_kg FROM materials WHERE is_active')).rows.map((r) => [r.code, r]));
      const whMap = new Map((await client.query("SELECT id, code FROM warehouses WHERE is_active AND warehouse_type='PM_STORE'")).rows.map((r) => [r.code, r.id]));

      const errors = [];
      const validRows = [];
      const seenPoMaterialKeys = new Set();

      // Pass 1: validate all rows, no inserts yet
      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const row = rawRows[i];
        const parsed = poRowSchema.safeParse(row);
        if (!parsed.success) { errors.push({ row: rowNum, error: formatZodErrors(parsed.error.issues) }); continue; }
        const d = parsed.data;

        const mat = matMap.get(d.sku_code);
        const warehouseId = whMap.get(d.pm_store_code);
        if (!mat) { errors.push({ row: rowNum, error: `Unknown sku_code '${d.sku_code}'` }); continue; }
        if (!warehouseId) { errors.push({ row: rowNum, error: `Unknown or non-PM-Store pm_store_code '${d.pm_store_code}'` }); continue; }

        let finalQty;
        if (mat.stickers_per_roll) {
          if (!d.no_of_rolls) { errors.push({ row: rowNum, error: `"No. of Rolls" is required for sticker roll material '${d.sku_code}'` }); continue; }
          finalQty = d.no_of_rolls * mat.stickers_per_roll;
        } else if (mat.unit === 'Roll') {
          if (!d.no_of_rolls) { errors.push({ row: rowNum, error: `Roll material '${d.sku_code}' requires no_of_rolls column` }); continue; }
          finalQty = d.no_of_rolls * Number(mat.meters_per_unit);
        } else if (mat.pieces_per_kg) {
          if (!d.po_qty) { errors.push({ row: rowNum, error: `'${d.sku_code}' requires po_qty column (enter quantity in kg)` }); continue; }
          finalQty = d.po_qty * Number(mat.pieces_per_kg);
        } else {
          if (!d.po_qty) { errors.push({ row: rowNum, error: `Non-roll material '${d.sku_code}' requires po_qty column` }); continue; }
          finalQty = d.po_qty;
        }

        const poDate = toIsoDateOrNull(d.po_date);
        if (poDate === undefined) { errors.push({ row: rowNum, error: `Invalid po_date '${d.po_date}'` }); continue; }
        let expDelivery = null;
        if (d.expected_delivery) {
          expDelivery = toIsoDateOrNull(d.expected_delivery);
          if (expDelivery === undefined) { errors.push({ row: rowNum, error: `Invalid expected_delivery '${d.expected_delivery}'` }); continue; }
        }

        const dupKey = `${d.po_no}::${mat.id}`;
        if (seenPoMaterialKeys.has(dupKey)) { errors.push({ row: rowNum, error: `PO '${d.po_no}' already has a line for material '${d.sku_code}' earlier in this file` }); continue; }
        seenPoMaterialKeys.add(dupKey);

        validRows.push({ rowNum, d, mat, warehouseId, finalQty, poDate, expDelivery });
      }

      // Reject any row whose (po_no, material) already exists in purchase_orders —
      // one batched query instead of one round-trip per row (avoids the same slow
      // per-row-query pattern that caused a proxy timeout in SKU master upload).
      if (validRows.length > 0) {
        const poNos = [...new Set(validRows.map((r) => r.d.po_no))];
        const existingRes = await client.query(
          'SELECT po_no, material_id FROM purchase_orders WHERE po_no = ANY($1)',
          [poNos]
        );
        const existingSet = new Set(existingRes.rows.map((r) => `${r.po_no}::${r.material_id}`));
        for (const r of validRows) {
          if (existingSet.has(`${r.d.po_no}::${r.mat.id}`)) {
            errors.push({
              row: r.rowNum,
              error: `PO '${r.d.po_no}' already has a line for material '${r.d.sku_code}'. Remove this line from the file and re-upload.`,
            });
          }
        }
      }

      // If any row failed, reject the entire upload
      if (errors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ status: 'FAILED', total_rows: rawRows.length, valid_rows: validRows.length, error_rows: errors.length, errors: errors.slice(0, 200) });
      }

      // All rows valid — upload source file to R2, then insert everything
      const r2Key = `po/${batchRef}/${req.file.originalname}`;
      await uploadToR2(r2Key, req.file.buffer, req.file.mimetype || 'application/octet-stream');

      const batchIns = await client.query(
        `INSERT INTO po_batches (batch_ref, source_filename, uploaded_by_user_id, status, total_rows, source_file_key) VALUES ($1,$2,$3,'UPLOADED',$4,$5) RETURNING id`,
        [batchRef, req.file.originalname, req.user.id, rawRows.length, r2Key]
      );
      const batchId = batchIns.rows[0].id;

      // Pass 2: insert all validated rows
      for (const { rowNum, d, mat, warehouseId, finalQty, poDate, expDelivery } of validRows) {
        await client.query(
          `INSERT INTO purchase_orders (po_no, batch_id, row_number_in_file, vendor_name, material_id, pm_store_warehouse_id, po_qty, unit_price, po_date, expected_delivery)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [d.po_no, batchId, rowNum, d.vendor_name, mat.id, warehouseId, finalQty, d.unit_price, poDate, expDelivery]
        );
      }

      await client.query(`UPDATE po_batches SET status='VALIDATED', valid_rows=$1, error_rows=0, error_detail='[]' WHERE id=$2`,
        [validRows.length, batchId]);
      await writeAudit(client, { userId: req.user.id, action: 'PO_BATCH_UPLOADED', entityTable: 'po_batches', entityId: batchId, detail: { batchRef, validCount: validRows.length, errorCount: 0 } });
      await client.query('COMMIT');

      res.status(201).json({ batch_id: batchId, batch_ref: batchRef, status: 'VALIDATED', total_rows: rawRows.length, valid_rows: validRows.length, error_rows: 0, errors: [] });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  })
);

app.get('/api/v1/purchase-orders/batches/:ref/download', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT source_file_key, source_filename FROM po_batches WHERE batch_ref = $1', [req.params.ref]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'Batch not found');
  const { source_file_key, source_filename } = rows[0];
  if (!source_file_key) throw new ApiError(404, 'NO_FILE', 'No source file stored for this batch');
  const url = await presignR2(source_file_key, source_filename);
  res.json({ url });
}));

app.get('/api/v1/purchase-orders', authenticate, asyncHandler(async (req, res) => {
  const { status, warehouse_id, material_id } = req.query;
  const conditions = []; const params = [];
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    const placeholders = statuses.map((s) => { params.push(s); return `$${params.length}`; }).join(',');
    conditions.push(`po.status IN (${placeholders})`);
  }
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`po.pm_store_warehouse_id = $${params.length}`); }
  if (material_id) { params.push(material_id); conditions.push(`po.material_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT po.*, m.code AS material_code, m.name AS material_name, m.unit,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            w.name AS warehouse_name,
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
  force_complete_reason: z.string().optional(),
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

    const grnRef = genRef('GRN');
    const grnIns = await client.query(
      `INSERT INTO goods_receipts (grn_ref, po_id, warehouse_id, material_id, grn_qty, unit_price, grn_date, invoice_no, invoice_date, received_by_user_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [grnRef, po.id, po.pm_store_warehouse_id, po.material_id, d.grn_qty, po.unit_price, d.grn_date, d.invoice_no || null, d.invoice_date || null, req.user.id, d.notes || null]
    );
    const grnId = grnIns.rows[0].id;

    await postLedgerEntry(client, { warehouseId: po.pm_store_warehouse_id, materialId: po.material_id, movementType: 'GRN_INWARD', qtyDelta: d.grn_qty, unitCost: po.unit_price, refTable: 'goods_receipts', refId: grnId, movementDate: d.grn_date });
    await writeAudit(client, { userId: req.user.id, action: 'GRN_POSTED', entityTable: 'goods_receipts', entityId: grnId, detail: { grnRef, po_id: po.id, qty: d.grn_qty } });
    if (d.force_complete_reason) {
      await client.query(
        `UPDATE purchase_orders SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
        [req.user.id, d.force_complete_reason, po.id]
      );
      await writeAudit(client, { userId: req.user.id, action: 'PO_FORCE_COMPLETED', entityTable: 'purchase_orders', entityId: po.id, detail: { reason: d.force_complete_reason, via_grn: grnRef } });
    }
    await client.query('COMMIT');
    res.status(201).json({ grn_id: grnId, grn_ref: grnRef, po_id: po.id, status: d.force_complete_reason ? 'FORCE_COMPLETED' : 'POSTED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// ── GRN Invoice Image Upload ──────────────────────────────────────────────
const grnImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads', 'grn-images');
      require('fs').mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `grn-${req.params.id}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new ApiError(400, 'INVALID_FILE', 'Only image files are allowed'));
    cb(null, true);
  },
});

app.post('/api/v1/goods-receipts/:id/invoice-image', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'),
  grnImageUpload.single('invoice_image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'No image file uploaded under field "invoice_image"');
    const relPath = `uploads/grn-images/${req.file.filename}`;
    const r = await pool.query('UPDATE goods_receipts SET invoice_image_path=$1 WHERE id=$2 RETURNING id', [relPath, req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `GRN ${req.params.id} not found`);
    res.json({ ok: true, invoice_image_path: relPath });
  })
);

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
  const facilityOnHandQty = await getOnHandQty(pool, line.warehouse_id, line.material_id);
  const suggestedActualQty = Math.min(expectedQty, onHandQty);
  res.json({ expected_qty: expectedQty, on_hand_qty: onHandQty, facility_on_hand_qty: facilityOnHandQty, suggested_actual_qty: suggestedActualQty });
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

app.post('/api/v1/stock-issues/batch', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const batchSchema = z.object({
    issue_date: z.string().min(1),
    vehicle_no: z.string().optional(),
    force_complete_reason: z.string().optional(),
    items: z.array(z.object({
      indent_line_id: z.coerce.number().int().positive(),
      issued_qty: z.coerce.number().positive(),
    })).min(1),
  });
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid batch issue payload', parsed.error.issues);
  const { issue_date, vehicle_no, items, force_complete_reason } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pmWhRes = await client.query("SELECT id FROM warehouses WHERE warehouse_type='PM_STORE' AND is_active ORDER BY id LIMIT 1");
    const fromWhId = pmWhRes.rows[0]?.id;
    if (!fromWhId) throw new ApiError(422, 'NO_PM_STORE', 'No active PM Store warehouse configured');

    const lineIds = items.map((i) => i.indent_line_id);
    const linesRes = await client.query(
      `SELECT il.*, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, m.unit AS mat_unit, m.code AS mat_code
       FROM indent_lines il JOIN materials m ON m.id = il.material_id
       WHERE il.id = ANY($1) FOR UPDATE OF il`,
      [lineIds]
    );
    const lineMap = new Map(linesRes.rows.map((r) => [Number(r.id), r]));

    const fmtDispQty = (qty, line) => {
      if (line.meters_per_unit) return `${(qty / Number(line.meters_per_unit)).toFixed(2)} rolls`;
      if (line.stickers_per_roll) return `${Math.round(qty / Number(line.stickers_per_roll))} units`;
      if (line.pieces_per_kg) return `${(qty / Number(line.pieces_per_kg)).toFixed(3)} Kg`;
      return `${qty} ${line.mat_unit}`;
    };

    // Validate all lines and accumulate per-material totals for stock check
    const materialTotals = new Map();
    const lineDataList = [];
    for (const item of items) {
      const line = lineMap.get(item.indent_line_id);
      if (!line) throw new ApiError(404, 'INDENT_LINE_NOT_FOUND', `Indent line ${item.indent_line_id} not found`);
      if (['CANCELLED', 'FORCE_COMPLETED'].includes(line.status)) throw new ApiError(409, 'INDENT_LINE_CLOSED', `Indent line ${line.indent_ref} is ${line.status}`);
      const remaining = Number(line.requested_qty) - Number(line.issued_qty);
      materialTotals.set(line.material_id, (materialTotals.get(line.material_id) || 0) + item.issued_qty);
      lineDataList.push({ item, line, remaining });
    }

    // Validate stock per material (cumulative across all items)
    for (const [materialId, totalQty] of materialTotals) {
      const onHand = await getOnHandQty(client, fromWhId, materialId);
      if (totalQty > onHand && !force_complete_reason) {
        const sampleLine = lineDataList.find((ld) => ld.line.material_id === materialId)?.line;
        throw new ApiError(422, 'INSUFFICIENT_STOCK', `Insufficient stock for ${sampleLine?.mat_code ?? materialId}: need ${fmtDispQty(totalQty, sampleLine ?? {})}, have ${fmtDispQty(onHand, sampleLine ?? {})}`, { onHand, totalQty });
      }
    }

    // Pre-fetch average costs per material
    const avgCosts = new Map();
    for (const materialId of materialTotals.keys()) {
      const costRes = await client.query(
        `SELECT COALESCE(SUM(qty_delta*unit_cost),0) / NULLIF(SUM(CASE WHEN qty_delta>0 THEN qty_delta ELSE 0 END),0) AS avg_cost FROM stock_ledger WHERE warehouse_id=$1 AND material_id=$2`,
        [fromWhId, materialId]
      );
      avgCosts.set(materialId, Number(costRes.rows[0].avg_cost || 0));
    }

    // Insert stock_issues rows and post ledger entries
    const issueRefs = [];
    for (const { item, line, remaining } of lineDataList) {
      const unitCost = avgCosts.get(line.material_id);
      const issueRef = genRef('ISS');
      const issueIns = await client.query(
        `INSERT INTO stock_issues (issue_ref, indent_line_id, from_warehouse_id, to_warehouse_id, material_id, issued_qty, expected_qty, unit_cost_snapshot, issue_date, dispatched_by_user_id, vehicle_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [issueRef, line.id, fromWhId, line.warehouse_id, line.material_id, item.issued_qty, remaining, unitCost, issue_date, req.user.id, vehicle_no || null]
      );
      const issueId = issueIns.rows[0].id;
      await postLedgerEntry(client, { warehouseId: fromWhId, materialId: line.material_id, movementType: 'ISSUE_OUT', qtyDelta: -item.issued_qty, unitCost, refTable: 'stock_issues', refId: issueId, movementDate: issue_date });
      // Update issued_qty on indent line
      await client.query(
        `UPDATE indent_lines SET issued_qty = issued_qty + $1, updated_at = now() WHERE id = $2`,
        [item.issued_qty, line.id]
      );
      await writeAudit(client, { userId: req.user.id, action: 'STOCK_ISSUED', entityTable: 'stock_issues', entityId: issueId, detail: { issueRef, indent_line_id: line.id, qty: item.issued_qty } });
      issueRefs.push(issueRef);
    }

    // Force-complete indent lines when remark provided
    if (force_complete_reason) {
      for (const { line } of lineDataList) {
        const freshLine = await client.query('SELECT * FROM indent_lines WHERE id = $1', [line.id]);
        const fl = freshLine.rows[0];
        if (fl && !['FULLY_ISSUED', 'CANCELLED', 'FORCE_COMPLETED'].includes(fl.status)) {
          await client.query(
            `UPDATE indent_lines SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
            [req.user.id, force_complete_reason, fl.id]
          );
          await writeAudit(client, { userId: req.user.id, action: 'INDENT_LINE_FORCE_COMPLETED', entityTable: 'indent_lines', entityId: fl.id, detail: { reason: force_complete_reason, via_dispatch: true } });
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ count: issueRefs.length, issue_refs: issueRefs, status: force_complete_reason ? 'FORCE_COMPLETED' : 'POSTED' });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.post('/api/v1/stock-issues/adhoc', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const adhocSchema = z.object({
    to_warehouse_id: z.coerce.number().int().positive(),
    issue_date: z.string().min(1),
    vehicle_no: z.string().optional(),
    items: z.array(z.object({
      material_id: z.coerce.number().int().positive(),
      issued_qty: z.coerce.number().positive(),
    })).min(1),
  });
  const parsed = adhocSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid adhoc issue payload', parsed.error.issues);
  const { to_warehouse_id, issue_date, vehicle_no, items } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pmWhRes = await client.query("SELECT id FROM warehouses WHERE warehouse_type='PM_STORE' AND is_active ORDER BY id LIMIT 1");
    const fromWhId = pmWhRes.rows[0]?.id;
    if (!fromWhId) throw new ApiError(422, 'NO_PM_STORE', 'No active PM Store warehouse configured');

    const destRes = await client.query('SELECT id, warehouse_type FROM warehouses WHERE id = $1', [to_warehouse_id]);
    if (!destRes.rows.length) throw new ApiError(404, 'WAREHOUSE_NOT_FOUND', `Warehouse ${to_warehouse_id} not found`);
    if (destRes.rows[0].warehouse_type === 'PM_STORE') throw new ApiError(422, 'INVALID_DEST', 'Cannot issue to PM Store itself');

    const materialIds = items.map((i) => i.material_id);
    const matsRes = await client.query('SELECT id, code, unit FROM materials WHERE id = ANY($1)', [materialIds]);
    const matMap = new Map(matsRes.rows.map((r) => [Number(r.id), r]));
    for (const item of items) {
      if (!matMap.get(item.material_id)) throw new ApiError(404, 'MATERIAL_NOT_FOUND', `Material ${item.material_id} not found`);
    }

    const materialTotals = new Map();
    for (const item of items) materialTotals.set(item.material_id, (materialTotals.get(item.material_id) || 0) + item.issued_qty);

    for (const [materialId, totalQty] of materialTotals) {
      const onHand = await getOnHandQty(client, fromWhId, materialId);
      if (totalQty > onHand) {
        const mat = matMap.get(materialId);
        throw new ApiError(422, 'INSUFFICIENT_STOCK', `Insufficient stock for ${mat.code}: need ${totalQty}, have ${onHand}`, { onHand, totalQty });
      }
    }

    const avgCosts = new Map();
    for (const materialId of materialTotals.keys()) {
      const costRes = await client.query(
        `SELECT COALESCE(SUM(qty_delta*unit_cost),0) / NULLIF(SUM(CASE WHEN qty_delta>0 THEN qty_delta ELSE 0 END),0) AS avg_cost FROM stock_ledger WHERE warehouse_id=$1 AND material_id=$2`,
        [fromWhId, materialId]
      );
      avgCosts.set(materialId, Number(costRes.rows[0].avg_cost || 0));
    }

    const issueRefs = [];
    for (const item of items) {
      const unitCost = avgCosts.get(item.material_id);
      const issueRef = genRef('ISS');
      const issueIns = await client.query(
        `INSERT INTO stock_issues (issue_ref, indent_line_id, from_warehouse_id, to_warehouse_id, material_id, issued_qty, expected_qty, unit_cost_snapshot, issue_date, dispatched_by_user_id, vehicle_no)
         VALUES ($1,NULL,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING id`,
        [issueRef, fromWhId, to_warehouse_id, item.material_id, item.issued_qty, unitCost, issue_date, req.user.id, vehicle_no || null]
      );
      const issueId = issueIns.rows[0].id;
      await postLedgerEntry(client, { warehouseId: fromWhId, materialId: item.material_id, movementType: 'ISSUE_OUT', qtyDelta: -item.issued_qty, unitCost, refTable: 'stock_issues', refId: issueId, movementDate: issue_date });
      await writeAudit(client, { userId: req.user.id, action: 'STOCK_ISSUED_ADHOC', entityTable: 'stock_issues', entityId: issueId, detail: { issueRef, material_id: item.material_id, qty: item.issued_qty, to_warehouse_id } });
      issueRefs.push(issueRef);
    }

    await client.query('COMMIT');
    res.status(201).json({ count: issueRefs.length, issue_refs: issueRefs });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/api/v1/stock-issues', authenticate, asyncHandler(async (req, res) => {
  const { to_warehouse_id, status, date_from, date_to } = req.query;
  const conditions = []; const params = [];
  if (to_warehouse_id) { params.push(to_warehouse_id); conditions.push(`si.to_warehouse_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`si.status = $${params.length}`); }
  if (date_from) { params.push(date_from); conditions.push(`si.issue_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); conditions.push(`si.issue_date <= $${params.length}`); }
  if (['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP'].includes(req.user.role)) {
    params.push(req.user.warehouse_ids.length ? req.user.warehouse_ids : [-1]);
    conditions.push(`si.to_warehouse_id = ANY($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT si.*, m.code AS material_code, m.name AS material_name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            fw.name AS from_warehouse_name, tw.name AS to_warehouse_name, il.indent_ref, il.requested_qty,
            COALESCE((SELECT SUM(received_qty) FROM stock_receipts sr WHERE sr.stock_issue_id = si.id),0) AS received_qty_sum,
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
  force_complete_reason: z.string().optional(),
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

    if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.map(String).includes(String(issue.to_warehouse_id))) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not mapped to the destination warehouse for this issue');
    }
    if (['RECEIVED', 'CANCELLED', 'FORCE_COMPLETED'].includes(issue.status)) throw new ApiError(409, 'ISSUE_CLOSED', `Issue ${issue.issue_ref} is already ${issue.status}`);

    const accountedRes = await client.query(`SELECT COALESCE(SUM(received_qty+shortage_qty+damage_qty),0) AS total FROM stock_receipts WHERE stock_issue_id=$1`, [issue.id]);
    const alreadyAccounted = Number(accountedRes.rows[0].total);
    const thisTotal = d.received_qty + d.shortage_qty + d.damage_qty;
    const remaining = Number(issue.issued_qty) - alreadyAccounted;
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
    if (d.force_complete_reason) {
      await client.query(
        `UPDATE stock_issues SET status='FORCE_COMPLETED', force_completed_by=$1, force_completed_at=now(), force_complete_reason=$2, updated_at=now() WHERE id=$3`,
        [req.user.id, d.force_complete_reason, issue.id]
      );
      await writeAudit(client, { userId: req.user.id, action: 'STOCK_ISSUE_FORCE_COMPLETED', entityTable: 'stock_issues', entityId: issue.id, detail: { reason: d.force_complete_reason, via_receipt: receiptRef } });
    }
    await client.query('COMMIT');
    res.status(201).json({ receipt_id: receiptId, receipt_ref: receiptRef, status: d.force_complete_reason ? 'FORCE_COMPLETED' : 'POSTED' });
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
    if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.map(String).includes(String(issue.to_warehouse_id)))
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

// ── Purchase Orders (super-admin: reverse an accidental Force Complete) ────
// Recomputes the correct status from received_qty_cache (mirrors the logic in
// fn_sync_po_received_qty) rather than blindly resetting to OPEN, so a PO that
// had already received partial stock before being force-completed lands back
// in PARTIALLY_RECEIVED, not OPEN.
app.post('/api/v1/admin/purchase-orders/:id/reverse-force-complete', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) throw new ApiError(400, 'REASON_REQUIRED', 'reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', `PO ${req.params.id} not found`);
    const po = r.rows[0];
    if (po.status !== 'FORCE_COMPLETED') throw new ApiError(409, 'NOT_FORCE_COMPLETED', `PO is ${po.status}, not FORCE_COMPLETED — nothing to reverse`);

    const received = Number(po.received_qty_cache);
    const restoredStatus = received >= Number(po.po_qty) ? 'CLOSED' : received > 0 ? 'PARTIALLY_RECEIVED' : 'OPEN';

    await snapshotAndLog(client, { adminUserId: req.user.id, entityTable: 'purchase_orders', entityId: po.id, action: 'REVERSE_FORCE_COMPLETE', reason: reason.trim(), previousState: po });
    await client.query(
      `UPDATE purchase_orders SET status=$1, force_completed_by=NULL, force_completed_at=NULL, force_complete_reason=NULL, updated_at=now() WHERE id=$2`,
      [restoredStatus, po.id]
    );
    await writeAudit(client, { userId: req.user.id, action: 'ADMIN_PO_FORCE_COMPLETE_REVERSED', entityTable: 'purchase_orders', entityId: po.id, detail: { reason: reason.trim(), restoredStatus } });
    await client.query('COMMIT');
    res.json({ ok: true, id: po.id, status: restoredStatus });
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
app.get('/api/v1/ledger', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const { warehouse_id, date_from, date_to, material_id } = req.query;
  if (!warehouse_id) throw new ApiError(400, 'MISSING_PARAM', 'warehouse_id is required');
  if (!date_from || !date_to) throw new ApiError(400, 'MISSING_PARAM', 'date_from and date_to are required');

  const params = [warehouse_id, date_from, date_to];
  let matFilter = '';
  if (material_id) { params.push(material_id); matFilter = `AND sl.material_id = $${params.length}`; }

  const { rows } = await pool.query(`
    SELECT
      sl.id,
      sl.movement_date::text AS movement_date,
      sl.movement_type,
      sl.qty_delta,
      m.code  AS material_code,
      m.name  AS material_name,
      m.unit,
      m.stickers_per_roll,
      m.meters_per_unit,
      m.pieces_per_kg,
      CASE sl.movement_type::text
        WHEN 'GRN_INWARD'       THEN 'Vendor GRN' || COALESCE(' · PO ' || po.po_no, '')
        WHEN 'ISSUE_OUT'        THEN 'Dispatched to ' || COALESCE(dest_w.name || ' (' || dest_w.code || ')', 'facility')
        WHEN 'RECEIPT_IN'       THEN 'Received from PM Store' || COALESCE(' · ' || src_iss.issue_ref, '')
        WHEN 'CONSUMPTION'      THEN 'Consumed in operations · Run #' || sl.ref_id
        WHEN 'AUDIT_ADJUSTMENT' THEN 'Audit adjustment'
        ELSE sl.movement_type::text
      END AS reason
    FROM stock_ledger sl
    JOIN materials m ON m.id = sl.material_id
    LEFT JOIN goods_receipts        gr      ON sl.ref_table = 'goods_receipts'  AND sl.ref_id = gr.id
    LEFT JOIN purchase_orders       po      ON gr.po_id = po.id
    LEFT JOIN stock_issues          iss_out ON sl.ref_table = 'stock_issues'    AND sl.ref_id = iss_out.id
    LEFT JOIN warehouses            dest_w  ON dest_w.id = iss_out.to_warehouse_id
    LEFT JOIN stock_receipts        sr      ON sl.ref_table = 'stock_receipts'  AND sl.ref_id = sr.id
    LEFT JOIN stock_issues          src_iss ON sr.stock_issue_id = src_iss.id
    WHERE sl.warehouse_id = $1
      AND sl.movement_date BETWEEN $2 AND $3
      ${matFilter}
    ORDER BY sl.movement_date DESC, sl.id DESC
  `, params);

  res.json(rows);
}));

app.get('/api/v1/admin/downloads', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT 'indent' AS type, batch_ref, source_filename, created_at, total_rows, valid_rows
    FROM indent_batches WHERE source_file_key IS NOT NULL
    UNION ALL
    SELECT 'po' AS type, batch_ref, source_filename, created_at, total_rows, valid_rows
    FROM po_batches WHERE source_file_key IS NOT NULL
    ORDER BY created_at DESC
  `);
  res.json(rows);
}));

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
    pool.query(`SELECT po.*, m.code AS material_code, m.name AS material_name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, w.name AS warehouse_name FROM purchase_orders po JOIN materials m ON m.id=po.material_id JOIN warehouses w ON w.id=po.pm_store_warehouse_id WHERE 1=1 ${sincePoClause} ORDER BY po.po_date DESC`),
    pool.query(`SELECT cs.warehouse_id, w.name AS warehouse_name, cs.material_id, m.code AS material_code, m.name AS material_name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, cs.on_hand_qty, cs.weighted_avg_cost FROM v_current_stock cs JOIN warehouses w ON w.id=cs.warehouse_id JOIN materials m ON m.id=cs.material_id ORDER BY w.name, m.code`),
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
  const result = await pool.query(
    `SELECT il.warehouse_id, w.name AS warehouse_name, w.warehouse_type,
            il.material_id, m.code AS material_code, m.name AS material_name, m.unit,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            il.indent_date,
            SUM(il.requested_qty) AS total_requested,
            SUM(il.issued_qty)    AS total_issued,
            SUM(il.requested_qty - il.issued_qty) AS pending_qty,
            COUNT(*) AS line_count
     FROM indent_lines il
     JOIN warehouses w ON w.id = il.warehouse_id
     JOIN materials  m ON m.id = il.material_id
     WHERE il.status IN ('PENDING', 'PARTIALLY_ISSUED')
     GROUP BY il.warehouse_id, w.name, w.warehouse_type,
              il.material_id, m.code, m.name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, il.indent_date
     ORDER BY w.name, m.code`
  );
  res.json({ data: result.rows });
}));

app.get('/api/v1/dashboard/po-schedule', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT po.id, po.po_no, po.vendor_name,
            po.material_id, m.code AS material_code, m.name AS material_name,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, m.unit,
            po.pm_store_warehouse_id, w.name AS warehouse_name,
            po.po_qty, po.received_qty_cache,
            (po.po_qty - po.received_qty_cache) AS remaining_qty,
            po.po_date, po.expected_delivery, po.status, po.created_at
     FROM purchase_orders po
     JOIN materials  m ON m.id = po.material_id
     JOIN warehouses w ON w.id = po.pm_store_warehouse_id
     WHERE po.status IN ('OPEN', 'PARTIALLY_RECEIVED')
     ORDER BY po.expected_delivery NULLS LAST`
  );
  res.json({ data: result.rows });
}));

app.get('/api/v1/dashboard/low-stock-alerts', authenticate, requireRole('PM_STORE_EXEC', 'ADMIN'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT w.id AS warehouse_id, w.name AS warehouse_name, w.warehouse_type,
            m.id AS material_id, m.code AS material_code, m.name AS material_name, m.unit,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            COALESCE(cs.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(msl.min_qty, m.low_stock_qty) AS min_qty
     FROM warehouses w
     CROSS JOIN materials m
     LEFT JOIN v_current_stock cs ON cs.warehouse_id = w.id AND cs.material_id = m.id
     LEFT JOIN min_stock_levels msl ON msl.warehouse_id = w.id AND msl.material_id = m.id
     WHERE w.is_active AND m.is_active
       AND CASE WHEN m.meters_per_unit   IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.meters_per_unit
                WHEN m.stickers_per_roll IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.stickers_per_roll
                WHEN m.pieces_per_kg     IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.pieces_per_kg
                ELSE COALESCE(cs.on_hand_qty, 0)
           END <= COALESCE(msl.min_qty, m.low_stock_qty)
     ORDER BY w.name, m.code`
  );
  res.json({ data: result.rows });
}));

app.get('/api/v1/stock/current', authenticate, asyncHandler(async (req, res) => {
  const { warehouse_id } = req.query;
  const params = [];
  const conditions = [];
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`cs.warehouse_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT cs.warehouse_id, w.name AS warehouse_name, cs.material_id, m.code AS material_code, m.name AS material_name, m.unit,
            m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
            COALESCE(cs.on_hand_qty, 0) AS on_hand_qty, cs.weighted_avg_cost,
            COALESCE(msl.min_qty, m.low_stock_qty) AS min_qty,
            CASE WHEN
              CASE WHEN m.meters_per_unit   IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.meters_per_unit
                   WHEN m.stickers_per_roll IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.stickers_per_roll
                   WHEN m.pieces_per_kg     IS NOT NULL THEN COALESCE(cs.on_hand_qty, 0) / m.pieces_per_kg
                   ELSE COALESCE(cs.on_hand_qty, 0)
              END <= COALESCE(msl.min_qty, m.low_stock_qty)
            THEN true ELSE false END AS is_low_stock
     FROM v_current_stock cs
     JOIN warehouses w ON w.id = cs.warehouse_id
     JOIN materials m ON m.id = cs.material_id
     LEFT JOIN min_stock_levels msl ON msl.warehouse_id = cs.warehouse_id AND msl.material_id = cs.material_id
     ${where}
     ORDER BY w.name, m.code`,
    params
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
  const r = await pool.query('SELECT id, code, name, category, unit, master_price, meters_per_unit, stickers_per_roll, consumption_rate, pieces_per_kg FROM materials WHERE is_active ORDER BY code');
  res.json({ data: r.rows });
}));

app.post('/api/v1/materials', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { name, category, unit, master_price, low_stock_qty, meters_per_unit, stickers_per_roll, consumption_rate, pieces_per_kg } = req.body;
  if (!name || !unit) throw new ApiError(400, 'VALIDATION_ERROR', 'name and unit are required');

  // Auto-generate SKU code: first word of category (or name), up to 4 chars + sequential suffix
  const source = (category || name).trim();
  const prefix = source.split(/\s+/)[0].replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'PM';
  const existing = await pool.query(`SELECT code FROM materials WHERE code ~ $1`, [`^${prefix}-\\d+$`]);
  const maxN = existing.rows.reduce((m, r) => { const n = parseInt(r.code.split('-').pop(), 10); return n > m ? n : m; }, 0);
  const code = `${prefix}-${String(maxN + 1).padStart(2, '0')}`;

  const r = await pool.query(
    `INSERT INTO materials (code, name, category, unit, master_price, low_stock_qty, meters_per_unit, stickers_per_roll, consumption_rate, pieces_per_kg, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
    [code, name.trim(), category?.trim() || null, unit,
     master_price || null, low_stock_qty != null && low_stock_qty !== '' ? Number(low_stock_qty) : 0,
     meters_per_unit || null, stickers_per_roll || null, consumption_rate || null, pieces_per_kg || null]
  );
  await writeAudit(pool, { userId: req.user.id, action: 'MATERIAL_CREATED', entityTable: 'materials', entityId: r.rows[0].id, detail: { code, name, unit } });
  res.status(201).json({ data: r.rows[0] });
}));

// ─────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────

// Serve React frontend for all non-API routes (production)
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
// ═══════════════════════════════════════════════════════════════════════════
// MODULE: SKU PACKAGING MASTER UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

// CSV columns (after parseUploadedFile normalisation — lowercase, spaces→underscore):
//   fsn_id           → sku_code
//   sku_name         → sku_name
//   packing_material → primary material (looked up by name OR code, case-insensitive)
//   sec._packing_(*) → secondary / tertiary materials (any col matching this pattern,
//                       non-empty/non-zero value = material is used; name extracted
//                       from between the outer parentheses)
app.post('/api/v1/sku-packaging-master/upload', authenticate, requireRole('ADMIN'), upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
    const rawRows = parseUploadedFile(req.file);
    if (!rawRows.length) throw new ApiError(400, 'EMPTY_FILE', 'File contains no data rows');

    // Build lookup: lowercase(name) → code  AND  lowercase(code) → code
    const matRows = (await pool.query('SELECT code, name FROM materials WHERE is_active')).rows;
    const matByName = new Map(matRows.map((r) => [r.name.toLowerCase().trim(), r.code]));
    const matByCode = new Map(matRows.map((r) => [r.code.toLowerCase().trim(), r.code]));
    function resolveMaterial(val) {
      if (!val) return null;
      const v = String(val).toLowerCase().trim();
      return matByName.get(v) ?? matByCode.get(v) ?? null;
    }

    // Detect secondary packing column keys from first data row
    // Keys look like: sec._packing_(cling_wrap), sec._packing_(foam_roll), etc.
    const firstRowKeys = Object.keys(rawRows[0] ?? {});
    const secPackingCols = firstRowKeys.filter((k) => /^sec[._].*packing/i.test(k));

    const errors = [];
    const validRows = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2;
      const row = rawRows[i];

      const sku_code = String(row['fsn_id'] ?? row['fsn'] ?? row['sku_code'] ?? '').trim();
      const sku_name = String(row['sku_name'] ?? '').trim() || null;
      const primaryRaw = String(row['packing_material'] ?? row['primary_pm_code'] ?? '').trim();

      if (!sku_code) { errors.push({ row: rowNum, error: 'FSN ID is required' }); continue; }

      // Packing Material (col H) is optional: an FSN can be uploaded with no primary
      // material mapped at all (e.g. MRP-sticker-only SKUs). MRP sticker (barcode +
      // wax ribbon) deduction only requires the FSN to have a sku_packaging_master
      // row — it does not depend on primary_pm_code resolving to anything. If a
      // value IS provided, it must still resolve to a real material.
      let primary_pm_code = null;
      if (primaryRaw) {
        primary_pm_code = resolveMaterial(primaryRaw);
        if (!primary_pm_code) {
          errors.push({ row: rowNum, error: `Packing Material '${primaryRaw}' not found in materials (match by name or code)` });
          continue;
        }
      }

      // Collect sec. packing materials — any column with a non-empty, non-zero value
      const secCodes = [];
      for (const col of secPackingCols) {
        const val = row[col];
        const isEmpty = val === '' || val === null || val === undefined || Number(val) === 0;
        if (isEmpty) continue;
        // Extract material name from the column header, e.g. "sec._packing_(foam_roll)" → "Foam Roll"
        const nameMatch = col.match(/\(([^)]+)\)$/);
        const matName = nameMatch ? nameMatch[1].replace(/_/g, ' ') : col;
        const code = resolveMaterial(matName);
        if (code && code !== primary_pm_code && !secCodes.includes(code)) secCodes.push(code);
      }

      validRows.push({
        sku_code, sku_name, primary_pm_code,
        secondary_pm_code: secCodes[0] ?? null,
        tertiary_pm_code: secCodes[1] ?? null,
      });
    }

    // Dedupe by sku_code within this file (last occurrence wins, matching the previous
    // sequential-upsert behavior) — a single batched INSERT can't hit the same
    // ON CONFLICT row twice in one statement.
    const bySku = new Map();
    for (const r of validRows) bySku.set(r.sku_code, r);
    const dedupedRows = [...bySku.values()];

    // Batch upserts instead of one round-trip per row — a full FSN catalog can be
    // thousands of rows, and one query per row was slow enough to trip Railway's
    // proxy timeout (surfaces to the client as a non-JSON "upstream error" body).
    const BATCH_SIZE = 1000;
    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
      const chunk = dedupedRows.slice(i, i + BATCH_SIZE);
      await pool.query(
        `INSERT INTO sku_packaging_master (sku_code, sku_name, primary_pm_code, secondary_pm_code, tertiary_pm_code, uploaded_by, uploaded_at)
         SELECT sku_code, sku_name, primary_pm_code, secondary_pm_code, tertiary_pm_code, $6, now()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
           AS t(sku_code, sku_name, primary_pm_code, secondary_pm_code, tertiary_pm_code)
         ON CONFLICT (sku_code) DO UPDATE SET
           sku_name = EXCLUDED.sku_name,
           primary_pm_code = EXCLUDED.primary_pm_code,
           secondary_pm_code = EXCLUDED.secondary_pm_code,
           tertiary_pm_code = EXCLUDED.tertiary_pm_code,
           uploaded_by = EXCLUDED.uploaded_by,
           uploaded_at = EXCLUDED.uploaded_at`,
        [
          chunk.map((r) => r.sku_code),
          chunk.map((r) => r.sku_name),
          chunk.map((r) => r.primary_pm_code),
          chunk.map((r) => r.secondary_pm_code),
          chunk.map((r) => r.tertiary_pm_code),
          req.user.id,
        ]
      );
    }

    const upserted = dedupedRows.map((r) => r.sku_code);

    await writeAudit(pool, { userId: req.user.id, action: 'SKU_MASTER_UPLOADED', entityTable: 'sku_packaging_master', entityId: 0, detail: { upserted: upserted.length, errors: errors.length } });
    res.status(201).json({ total_rows: rawRows.length, upserted: upserted.length, error_rows: errors.length, errors: errors.slice(0, 200) });
  })
);

app.get('/api/v1/sku-packaging-master', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { page = 1, page_size = 100 } = req.query;
  const limit = Math.min(Number(page_size), 500);
  const offset = (Number(page) - 1) * limit;
  const r = await pool.query(
    `SELECT s.*, u.name AS uploaded_by_name FROM sku_packaging_master s LEFT JOIN users u ON u.id = s.uploaded_by ORDER BY s.sku_code LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ data: r.rows, page: Number(page), page_size: limit });
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: PHYSICAL AUDIT
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/v1/audits/prefill', authenticate, asyncHandler(async (req, res) => {
  const { warehouse_id } = req.query;
  if (!warehouse_id) throw new ApiError(400, 'WAREHOUSE_REQUIRED', 'warehouse_id query param is required');
  if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.map(String).includes(String(warehouse_id))) {
    throw new ApiError(403, 'FORBIDDEN', 'You are not mapped to this warehouse');
  }
  const r = await pool.query(
    `SELECT m.id AS material_id, m.code AS material_code, m.name AS material_name, m.unit,
            m.stickers_per_roll, m.meters_per_unit, m.pieces_per_kg,
            COALESCE(cs.on_hand_qty, 0) AS system_qty
     FROM materials m
     LEFT JOIN v_current_stock cs ON cs.material_id = m.id AND cs.warehouse_id = $1
     WHERE m.is_active
     ORDER BY m.code`,
    [warehouse_id]
  );
  res.json({ data: r.rows });
}));

app.post('/api/v1/audits', authenticate, requireRole('PM_STORE_EXEC', 'CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      warehouse_id: z.coerce.number().int().positive(),
      remarks: z.string().min(1),
      audit_date: z.string().optional(),
      lines: z.array(z.object({
        material_id: z.coerce.number().int().positive(),
        physical_qty: z.coerce.number().nonnegative(),
        remark: z.string().optional(),
      })).min(1),
    });
    const d = schema.parse(req.body);

    if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role) && !req.user.warehouse_ids.map(String).includes(String(d.warehouse_id))) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not mapped to this warehouse');
    }

    const auditDate = d.audit_date || new Date().toISOString().slice(0, 10);
    const auditRef = genRef('AUD');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const entryRes = await client.query(
        `INSERT INTO audit_entries (audit_ref, warehouse_id, conducted_by, remarks, audit_date)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [auditRef, d.warehouse_id, req.user.id, d.remarks, auditDate]
      );
      const entryId = entryRes.rows[0].id;

      const stockRes = await client.query(
        `SELECT material_id, COALESCE(on_hand_qty,0) AS on_hand_qty FROM v_current_stock WHERE warehouse_id=$1`,
        [d.warehouse_id]
      );
      const stockMap = new Map(stockRes.rows.map((r) => [String(r.material_id), Number(r.on_hand_qty)]));

      const summary = [];
      for (const line of d.lines) {
        const systemQty = stockMap.get(String(line.material_id)) ?? 0;
        const delta = line.physical_qty - systemQty;

        let ledgerId = null;
        if (delta !== 0) {
          const ledgerRes = await client.query(
            `INSERT INTO stock_ledger (warehouse_id, material_id, movement_type, qty_delta, unit_cost, ref_table, ref_id, movement_date)
             VALUES ($1,$2,'AUDIT_ADJUSTMENT',$3,0,'audit_entry_lines',0,$4) RETURNING id`,
            [d.warehouse_id, line.material_id, delta, auditDate]
          );
          ledgerId = ledgerRes.rows[0].id;
          // update ref_id now that we have the ledger row id
          await client.query(`UPDATE stock_ledger SET ref_id=$1 WHERE id=$1`, [ledgerId]);
        }

        await client.query(
          `INSERT INTO audit_entry_lines (audit_entry_id, material_id, system_qty, physical_qty, ledger_id, remark)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [entryId, line.material_id, systemQty, line.physical_qty, ledgerId, delta !== 0 ? (line.remark || null) : null]
        );
        summary.push({ material_id: line.material_id, system_qty: systemQty, physical_qty: line.physical_qty, delta });
      }

      await writeAudit(client, { userId: req.user.id, action: 'AUDIT_CONDUCTED', entityTable: 'audit_entries', entityId: entryId, detail: { auditRef, warehouse_id: d.warehouse_id, lines: d.lines.length } });
      await client.query('COMMIT');
      res.status(201).json({ audit_ref: auditRef, audit_entry_id: entryId, lines: summary });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  })
);

app.get('/api/v1/audits', authenticate, asyncHandler(async (req, res) => {
  const { warehouse_id, page = 1, page_size = 50 } = req.query;
  const conditions = []; const params = [];
  if (warehouse_id) { params.push(warehouse_id); conditions.push(`ae.warehouse_id = $${params.length}`); }
  if (!['ADMIN', 'PM_STORE_EXEC'].includes(req.user.role)) {
    params.push(req.user.warehouse_ids.length ? req.user.warehouse_ids : [-1]);
    conditions.push(`ae.warehouse_id = ANY($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(page_size), 200);
  const offset = (Number(page) - 1) * limit;
  const r = await pool.query(
    `SELECT ae.*, w.name AS warehouse_name, u.name AS conducted_by_name,
            json_agg(json_build_object('material_id', ael.material_id, 'material_code', m.code, 'material_name', m.name, 'unit', m.unit, 'system_qty', ael.system_qty, 'physical_qty', ael.physical_qty, 'delta', ael.delta) ORDER BY m.code) AS lines
     FROM audit_entries ae
     JOIN warehouses w ON w.id = ae.warehouse_id
     JOIN users u ON u.id = ae.conducted_by
     LEFT JOIN audit_entry_lines ael ON ael.audit_entry_id = ae.id
     LEFT JOIN materials m ON m.id = ael.material_id
     ${where}
     GROUP BY ae.id, w.name, u.name
     ORDER BY ae.audit_date DESC, ae.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  res.json({ data: r.rows, page: Number(page), page_size: limit });
}));

// ═══════════════════════════════════════════════════════════════════════════
// MODULE: CONSUMPTION RUNS (admin trigger + listing)
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/v1/admin/slack/send-daily-consumption', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { sendDailyConsumption } = require('./cron/slackReports');
  const runId = req.body?.run_id ? Number(req.body.run_id) : null;
  await sendDailyConsumption(runId);
  res.json({ ok: true, run_id: runId });
}));

app.post('/api/v1/admin/slack/send-indents-uploaded', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { sendIndentsUploadedReport } = require('./cron/slackReports');
  await sendIndentsUploadedReport();
  res.json({ ok: true });
}));

app.post('/api/v1/admin/slack/send-indent-fulfillment', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { sendIndentFulfillmentReport } = require('./cron/slackReports');
  await sendIndentFulfillmentReport();
  res.json({ ok: true });
}));

app.post('/api/v1/admin/consumption/run-now', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { runConsumption } = require('./cron/consumptionScraper');
  const { warehouseIds } = req.body ?? {};
  let facilityCodes = null;
  if (warehouseIds?.length) {
    const whs = await pool.query('SELECT code FROM warehouses WHERE id = ANY($1) AND is_active', [warehouseIds]);
    if (!whs.rows.length) throw new ApiError(404, 'NOT_FOUND', 'No matching warehouses found');
    facilityCodes = whs.rows.map((r) => r.code);
  }
  // Pre-create the RUNNING row HERE (before responding) so it exists in DB even if Railway
  // kills the process between the HTTP response and the setImmediate callback executing.
  const today = new Date();
  const runDate = today.toISOString().slice(0, 10);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const scraped_date = yest.toISOString().slice(0, 10);
  const facilityFilter = facilityCodes ? [...facilityCodes].sort().join(',') : null;

  // Delete child lines first (FK constraint), then the failed parent run
  await pool.query(
    `DELETE FROM consumption_run_lines WHERE run_id IN (
       SELECT id FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
       AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)
     )`,
    [runDate, facilityFilter]
  );
  await pool.query(
    `DELETE FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
     AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)`,
    [runDate, facilityFilter]
  );
  const runRes = await pool.query(
    `INSERT INTO consumption_runs (run_date, scraped_from, scraped_to, status, facility_filter, progress_pct, progress_msg)
     VALUES ($1,$2,$2,'RUNNING',$3,0,'Starting up…') RETURNING id`,
    [runDate, scraped_date, facilityFilter]
  );
  const runId = runRes.rows[0].id;

  res.json({ ok: true, message: 'Consumption run started in background', facilityCodes, runId });
  setImmediate(async () => {
    try {
      await runConsumption({ facilityCodes, runId });
    } catch (e) {
      console.error('[consumption] background run error:', e.message, e.stack);
      try {
        await pool.query(
          `UPDATE consumption_runs SET status='FAILED', last_error=$2, completed_at=now() WHERE id=$1`,
          [runId, e.message]
        );
      } catch { /* best-effort */ }
    }
  });
}));

app.get('/api/v1/admin/consumption/env-check', authenticate, requireRole('ADMIN'), (req, res) => {
  const vars = ['CONSUMPTION_DASHBOARD_URL', 'CONSUMPTION_DASHBOARD_API_KEY', 'CONSUMPTION_QUERY_ID', 'CONSUMPTION_CC_QUERY_ID'];
  const result = {};
  for (const k of vars) result[k] = process.env[k] ? `SET (${process.env[k].slice(0, 8)}…)` : 'MISSING';
  res.json(result);
});

// GET /api/v1/admin/consumption/runs/:id/summary — material-wise breakdown for a PENDING_REVIEW run
app.get('/api/v1/admin/consumption/runs/:id/summary', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id);
  const [summary, counts] = await Promise.all([
    pool.query(`
      SELECT
        crl.material_code, m.name AS material_name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg,
        SUM(crl.qty_deducted) AS total_deducted,
        COUNT(*) AS line_count,
        BOOL_OR(crl.status IN ('DEDUCTED', 'STOCK_BELOW_ZERO')) AS already_committed,
        COALESCE((
          SELECT SUM(sl.qty_delta)
          FROM stock_ledger sl
          JOIN materials mt ON mt.id = sl.material_id
          WHERE sl.warehouse_id = crl.warehouse_id AND mt.code = crl.material_code
        ), 0) AS current_stock
      FROM consumption_run_lines crl
      JOIN materials m ON m.code = crl.material_code
      WHERE crl.run_id = $1 AND crl.status IN ('PENDING', 'DEDUCTED', 'STOCK_BELOW_ZERO')
      GROUP BY crl.material_code, m.name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg, crl.warehouse_id
      ORDER BY total_deducted DESC
    `, [runId]),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
        COUNT(*) FILTER (WHERE status = 'UNMAPPED_SKU') AS unmapped,
        COUNT(*) FILTER (WHERE status = 'SKIPPED') AS skipped
      FROM consumption_run_lines WHERE run_id = $1
    `, [runId]),
  ]);
  res.json({ data: summary.rows, counts: counts.rows[0] });
}));

// POST /api/v1/admin/consumption/runs/:id/accept — commit pending lines to stock ledger
app.post('/api/v1/admin/consumption/runs/:id/accept', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id);
  const runRes = await pool.query('SELECT * FROM consumption_runs WHERE id = $1', [runId]);
  if (!runRes.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Run not found');
  const run = runRes.rows[0];
  if (run.status !== 'PENDING_REVIEW') throw new ApiError(400, 'BAD_REQUEST', `Run status is ${run.status}, expected PENDING_REVIEW`);

  // Group pending lines by warehouse + material for efficient batch ledger entries
  const groups = await pool.query(`
    SELECT crl.warehouse_id, crl.material_code, m.id AS material_id,
           SUM(crl.qty_deducted) AS total_qty, ARRAY_AGG(crl.id) AS line_ids
    FROM consumption_run_lines crl
    JOIN materials m ON m.code = crl.material_code
    WHERE crl.run_id = $1 AND crl.status = 'PENDING'
    GROUP BY crl.warehouse_id, crl.material_code, m.id
  `, [runId]);

  let committed = 0;
  const movementDate = new Date(run.scraped_to).toISOString().slice(0, 10);

  for (const g of groups.rows) {
    const totalQty = Number(g.total_qty);
    const stockRes = await pool.query(
      `SELECT COALESCE(SUM(qty_delta), 0) AS qty FROM stock_ledger WHERE warehouse_id = $1 AND material_id = $2`,
      [g.warehouse_id, g.material_id]
    );
    const onHand = Number(stockRes.rows[0].qty);
    const lineStatus = onHand - totalQty < 0 ? 'STOCK_BELOW_ZERO' : 'DEDUCTED';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ledger = await client.query(
        `INSERT INTO stock_ledger (warehouse_id, material_id, movement_type, qty_delta, unit_cost, ref_table, ref_id, movement_date)
         VALUES ($1,$2,'CONSUMPTION',$3,0,'consumption_runs',$4,$5) RETURNING id`,
        [g.warehouse_id, g.material_id, -totalQty, runId, movementDate]
      );
      const ledgerId = ledger.rows[0].id;
      await client.query(
        `UPDATE consumption_run_lines SET status = $1, ledger_id = $2 WHERE id = ANY($3)`,
        [lineStatus, ledgerId, g.line_ids]
      );
      await client.query('COMMIT');
      committed += g.line_ids.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  await pool.query(
    `UPDATE consumption_runs SET status = 'COMPLETED', deducted_lines = $1, completed_at = now() WHERE id = $2`,
    [committed, runId]
  );
  res.json({ ok: true, committed });
}));

// POST /api/v1/admin/consumption/runs/:id/cancel — discard pending run
app.post('/api/v1/admin/consumption/runs/:id/cancel', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const runId = Number(req.params.id);
  await pool.query('DELETE FROM consumption_run_lines WHERE run_id = $1', [runId]);
  await pool.query(`UPDATE consumption_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1`, [runId]);
  res.json({ ok: true });
}));

// GET /api/v1/consumption/history — per-facility, per-material daily consumption
// ADMIN sees all; other roles see only their assigned warehouses
app.get('/api/v1/consumption/history', authenticate, asyncHandler(async (req, res) => {
  const { from, to, warehouse_id } = req.query;
  const isAdmin = req.user.role === 'ADMIN';
  const allowedIds = isAdmin ? null : req.user.warehouse_ids.map(Number);
  const filterWh = warehouse_id ? Number(warehouse_id) : null;

  if (!isAdmin && filterWh && !allowedIds.includes(filterWh)) {
    throw new ApiError(403, 'FORBIDDEN', 'No access to this warehouse');
  }

  const rows = await pool.query(`
    SELECT
      cr.scraped_to::date          AS consumption_date,
      w.id                          AS warehouse_id,
      w.name                        AS warehouse_name,
      w.code                        AS warehouse_code,
      crl.material_code,
      m.name                        AS material_name,
      m.unit,
      m.meters_per_unit,
      m.stickers_per_roll,
      SUM(crl.qty_deducted)         AS qty_consumed
    FROM consumption_run_lines crl
    JOIN consumption_runs cr ON cr.id = crl.run_id
    JOIN warehouses w          ON w.id = crl.warehouse_id
    JOIN materials m           ON m.code = crl.material_code
    WHERE crl.status IN ('DEDUCTED', 'STOCK_BELOW_ZERO')
      AND cr.status = 'COMPLETED'
      AND ($1::date IS NULL OR cr.scraped_to::date >= $1::date)
      AND ($2::date IS NULL OR cr.scraped_to::date <= $2::date)
      AND ($3::int  IS NULL OR w.id = $3::int)
      AND ($4::int[] IS NULL OR w.id = ANY($4::int[]))
    GROUP BY cr.scraped_to::date, w.id, w.name, w.code, crl.material_code, m.name, m.unit, m.meters_per_unit, m.stickers_per_roll, m.pieces_per_kg
    ORDER BY cr.scraped_to::date DESC, w.name, crl.material_code
  `, [from || null, to || null, filterWh, allowedIds]);

  res.json({ data: rows.rows });
}));

app.get('/api/v1/admin/consumption/runs', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT cr.*, COUNT(crl.id) AS total_lines
     FROM consumption_runs cr
     LEFT JOIN consumption_run_lines crl ON crl.run_id = cr.id
     GROUP BY cr.id
     ORDER BY cr.run_date DESC
     LIMIT 30`
  );
  res.json({ data: r.rows });
}));

// GET /api/v1/admin/min-stock-levels — all warehouses × materials with current thresholds
app.get('/api/v1/admin/min-stock-levels', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const [warehouses, materials, levels] = await Promise.all([
    pool.query('SELECT id, code, name, warehouse_type, city FROM warehouses WHERE is_active ORDER BY warehouse_type, name'),
    pool.query('SELECT id, code, name, unit FROM materials WHERE is_active ORDER BY category, name'),
    pool.query('SELECT warehouse_id, material_id, min_qty FROM min_stock_levels'),
  ]);
  const levelMap = {};
  for (const l of levels.rows) {
    levelMap[`${l.warehouse_id}:${l.material_id}`] = Number(l.min_qty);
  }
  res.json({ warehouses: warehouses.rows, materials: materials.rows, levels: levelMap });
}));

// PUT /api/v1/admin/min-stock-levels — upsert one or many warehouse+material thresholds
app.put('/api/v1/admin/min-stock-levels', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  // body: { updates: [{ warehouse_id, material_id, min_qty }] }
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'updates must be a non-empty array' } });
  }
  for (const u of updates) {
    if (!u.warehouse_id || !u.material_id || u.min_qty == null || Number(u.min_qty) < 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Each update needs warehouse_id, material_id, min_qty >= 0' } });
    }
    await pool.query(
      `INSERT INTO min_stock_levels (warehouse_id, material_id, min_qty, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (warehouse_id, material_id)
       DO UPDATE SET min_qty=EXCLUDED.min_qty, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [u.warehouse_id, u.material_id, u.min_qty, req.user.id]
    );
  }
  res.json({ updated: updates.length });
}));

// ── Admin: User Management ────────────────────────────────────────────────
app.get('/api/v1/admin/users', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const r = await pool.query(
    'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY role, email'
  );
  res.json({ users: r.rows });
}));

app.put('/api/v1/admin/users/:id/reset-password', authenticate, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || typeof newPassword !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'newPassword is required');
  if (newPassword.length < 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
  const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
  if (!userRes.rows.length) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  await writeAudit(pool, { userId: req.user.id, action: 'ADMIN_PASSWORD_RESET', entityTable: 'users', entityId: Number(req.params.id), detail: { target_email: userRes.rows[0].email } });
  res.json({ message: 'Password reset successfully' });
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(frontendDist, 'index.html');
  existsSync(index) ? res.sendFile(index) : next();
});

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } }));
app.use(Sentry.expressErrorHandler());
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large — max 10MB. Try removing unnecessary formatting/images from the Excel file, or split it into smaller files.'
      : `File upload error: ${err.message}`;
    return res.status(400).json({ error: { code: err.code, message } });
  }
  console.error(err);
  if (process.env.SLACK_ERROR_WEBHOOK) {
    fetch(process.env.SLACK_ERROR_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *PackTrack 500*\n*${req.method} ${req.path}*\n\`\`\`${err.message}\n${(err.stack || '').slice(0, 800)}\`\`\``,
      }),
    }).catch(() => {});
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});

require('./cron/consumptionScraper');
require('./cron/slackReports');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PackTrack API listening on :${PORT}`));

module.exports = app;
