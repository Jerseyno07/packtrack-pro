import { useState, useMemo, useEffect, useCallback } from 'react';
import { Upload, FileSpreadsheet, Package, AlertTriangle, CheckCircle2, Clock, TrendingUp, LogOut, ChevronRight, Truck, Box, Calendar, Download, Shield, RefreshCw, X } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// PackTrack Portal — three sections:
//   1. Indent Upload (CC/FC Exec)       -> POST /api/v1/indents/upload
//   2. PO Upload (PM Store Exec)        -> POST /api/v1/purchase-orders/upload
//   3. PM Store Dashboard (PM Store Exec/Admin)
//        -> GET /api/v1/dashboard/indents-to-process
//        -> GET /api/v1/dashboard/po-schedule
//        -> GET /api/v1/dashboard/low-stock-alerts
//
// This artifact uses mock data/login so you can click through the full flow.
// Replace MOCK_API calls with real fetch() against your Express server —
// request/response shapes match the API built alongside this portal exactly.
// ═══════════════════════════════════════════════════════════════════════════

const MOCK_USERS = {
  'pmstore@packtrack.local': { password: 'demo1234', name: 'Kiran Kumar', role: 'PM_STORE_EXEC' },
  'ccexec@packtrack.local': { password: 'demo1234', name: 'Jagadish H', role: 'CC_EXEC' },
  'admin@packtrack.local': { password: 'demo1234', name: 'Admin', role: 'ADMIN' },
};

const MOCK_INDENT_TO_PROCESS = [
  { warehouse_name: 'Bangalore CC', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', total_requested: 800, total_issued: 300, pending_qty: 500, line_count: 3 },
  { warehouse_name: 'Bangalore CC', material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', total_requested: 60, total_issued: 0, pending_qty: 60, line_count: 1 },
  { warehouse_name: 'Bangalore FC', material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', total_requested: 20, total_issued: 14, pending_qty: 6, line_count: 2 },
];

const MOCK_PO_SCHEDULE = [
  { po_no: 'PO-2026-0091', vendor_name: 'Shree Plastics Pvt Ltd', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', warehouse_name: 'Central PM Store — Bangalore', po_qty: 2000, received_qty_cache: 0, remaining_qty: 2000, expected_delivery: '2026-07-02', status: 'OPEN' },
  { po_no: 'PO-2026-0092', vendor_name: 'Karnataka Packaging Co', material_code: 'NTRLL-01', material_name: 'Net Roll', warehouse_name: 'Central PM Store — Bangalore', po_qty: 150, received_qty_cache: 50, remaining_qty: 100, expected_delivery: '2026-06-30', status: 'PARTIALLY_RECEIVED' },
];

const MOCK_LOW_STOCK = [
  { warehouse_name: 'Bangalore CC', warehouse_type: 'CC', material_code: 'WXRB-01', material_name: 'Wax Ribbon', on_hand_qty: 4, min_qty: 10 },
  { warehouse_name: 'Bangalore FC', warehouse_type: 'FC', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', on_hand_qty: 60, min_qty: 100 },
];

const MOCK_API = {
  async login(email, password) {
    await new Promise((r) => setTimeout(r, 400));
    const u = MOCK_USERS[email];
    if (!u || u.password !== password) throw new Error('Invalid email or password');
    return { token: 'mock-token', user: { name: u.name, role: u.role, email } };
  },
  async uploadIndent(file, indentDate) {
    await new Promise((r) => setTimeout(r, 700));
    return { batch_ref: 'INDB-2026-7F2A', status: 'VALIDATED', total_rows: 14, valid_rows: 13, error_rows: 1, errors: [{ row: 9, error: "Unknown sku_code 'XYZ-99'" }] };
  },
  async uploadPO(file) {
    await new Promise((r) => setTimeout(r, 700));
    return { batch_ref: 'POB-2026-9C1D', status: 'VALIDATED', total_rows: 8, valid_rows: 8, error_rows: 0, errors: [] };
  },
};

function Badge({ children, tone = 'gray' }) {
  const tones = { gray: 'bg-slate-100 text-slate-600', blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function StatCard({ icon: Icon, label, value, sub, tone }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600', green: 'bg-green-50 text-green-600' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${tones[tone]}`}><Icon size={18} /></div>
      <div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
        <div className="text-xl font-bold text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

// ── LOGIN ───────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Invalid email or password');
      onLogin(data.token, data.user);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
          <span className="font-bold text-lg text-slate-900">PackTrack Portal</span>
        </div>
        <p className="text-sm text-slate-500 mb-6">Indent & PO management</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button onClick={submit} disabled={loading} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── INDENT UPLOAD ───────────────────────────────────────────────────────────
function IndentUploadSection({ token }) {
  const [file, setFile] = useState(null);
  const [indentDate, setIndentDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleUpload() {
    setError('');
    if (!file) { setError('Please choose a file.'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('indent_date', indentDate);
      const res = await fetch(`${BASE_URL}/api/v1/indents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Upload failed');
      setResult(data);
    } catch (e) { setError(e.message || 'Upload failed. Please try again.'); } finally { setUploading(false); }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Upload Indent</h2>
        <p className="text-sm text-slate-500">Bulk upload facility-wise, SKU-wise demand for a given date.</p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-center justify-between gap-3">
        <div><strong>Expected columns:</strong> facility_code, sku_code, requested_qty, remarks (optional)</div>
        <button
          onClick={() => downloadCSV('indent_sample.csv', [
            ['facility_code', 'sku_code', 'requested_qty', 'remarks'],
            ['CC-BLR', 'LDPE-06', 500, 'Weekly stock'],
            ['CC-BLR', 'NTRLL-01', 40, ''],
            ['FC-BLR', 'WXRB-01', 20, 'Urgent'],
          ])}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium whitespace-nowrap hover:bg-blue-700 transition-colors"
        >
          <Download size={13} /> Sample CSV
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Indent Date <span className="text-red-500">*</span></label>
          <div className="relative">
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="date" value={indentDate} onChange={(e) => setIndentDate(e.target.value)} className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="text-xs text-slate-400 mt-1">This date applies to every row in the uploaded file.</div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">File (CSV or Excel) <span className="text-red-500">*</span></label>
          <label className="flex items-center gap-3 border-2 border-dashed border-slate-300 rounded-xl p-5 cursor-pointer hover:border-blue-400 transition-colors">
            <FileSpreadsheet size={28} className="text-slate-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">{file ? file.name : 'Click to choose a file'}</div>
              <div className="text-xs text-slate-400">.csv, .xlsx — max 10MB</div>
            </div>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        <button onClick={handleUpload} disabled={uploading} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
          <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload Indent'}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            {result.error_rows === 0 ? <CheckCircle2 size={18} className="text-green-500" /> : <AlertTriangle size={18} className="text-amber-500" />}
            <span className="font-semibold text-slate-900">{result.batch_ref}</span>
            <Badge tone={result.error_rows === 0 ? 'green' : 'amber'}>{result.status}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm mb-3">
            <div><div className="text-slate-400 text-xs">Total Rows</div><div className="font-bold text-slate-900">{result.total_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Valid</div><div className="font-bold text-green-600">{result.valid_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Errors</div><div className="font-bold text-red-600">{result.error_rows}</div></div>
          </div>
          {result.errors?.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-1">
              {result.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1.5">Row {e.row}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PO UPLOAD ────────────────────────────────────────────────────────────────
function POUploadSection({ token }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleUpload() {
    setError('');
    if (!file) { setError('Please choose a file.'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE_URL}/api/v1/purchase-orders/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Upload failed');
      setResult(data);
    } catch (e) { setError(e.message || 'Upload failed. Please try again.'); } finally { setUploading(false); }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Upload Purchase Orders</h2>
        <p className="text-sm text-slate-500">Bulk upload vendor POs for inward into the packaging material shop.</p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-center justify-between gap-3">
        <div><strong>Expected columns:</strong> po_no, vendor_name, sku_code, pm_store_code, po_qty, unit_price, po_date, expected_delivery (optional)</div>
        <button
          onClick={() => downloadCSV('purchase_orders_sample.csv', [
            ['po_no', 'vendor_name', 'sku_code', 'pm_store_code', 'po_qty', 'unit_price', 'po_date', 'expected_delivery'],
            ['PO-2026-0001', 'Shree Plastics Pvt Ltd', 'LDPE-06', 'CS-001', 2000, 2.50, '2026-07-01', '2026-07-10'],
            ['PO-2026-0002', 'Karnataka Packaging Co', 'NTRLL-01', 'CS-001', 150, 180.00, '2026-07-01', '2026-07-08'],
            ['PO-2026-0003', 'Tamil Nadu Ribbons Ltd', 'WXRB-01', 'CS-001', 50, 95.00, '2026-07-02', ''],
          ])}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium whitespace-nowrap hover:bg-blue-700 transition-colors"
        >
          <Download size={13} /> Sample CSV
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">File (CSV or Excel) <span className="text-red-500">*</span></label>
          <label className="flex items-center gap-3 border-2 border-dashed border-slate-300 rounded-xl p-5 cursor-pointer hover:border-blue-400 transition-colors">
            <FileSpreadsheet size={28} className="text-slate-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">{file ? file.name : 'Click to choose a file'}</div>
              <div className="text-xs text-slate-400">.csv, .xlsx — max 10MB</div>
            </div>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
          Vendor name is free text — it doesn't need to match a pre-existing vendor list.
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        <button onClick={handleUpload} disabled={uploading} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
          <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload POs'}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            {result.error_rows === 0 ? <CheckCircle2 size={18} className="text-green-500" /> : <AlertTriangle size={18} className="text-amber-500" />}
            <span className="font-semibold text-slate-900">{result.batch_ref}</span>
            <Badge tone={result.error_rows === 0 ? 'green' : 'amber'}>{result.status}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-slate-400 text-xs">Total Rows</div><div className="font-bold text-slate-900">{result.total_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Valid</div><div className="font-bold text-green-600">{result.valid_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Errors</div><div className="font-bold text-red-600">{result.error_rows}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PM STORE DASHBOARD ───────────────────────────────────────────────────────
function DashboardSection() {
  const [tab, setTab] = useState('indents');
  const totalPendingIndentQty = useMemo(() => MOCK_INDENT_TO_PROCESS.reduce((a, r) => a + r.pending_qty, 0), []);
  const totalPOIncoming = useMemo(() => MOCK_PO_SCHEDULE.reduce((a, r) => a + r.remaining_qty, 0), []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">PM Store Dashboard</h2>
        <p className="text-sm text-slate-500">Indents to process, scheduled POs, and low-stock alerts.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Box} label="Pending Indent Qty" value={totalPendingIndentQty} sub={`${MOCK_INDENT_TO_PROCESS.length} SKU lines`} tone="blue" />
        <StatCard icon={Truck} label="POs Scheduled" value={MOCK_PO_SCHEDULE.length} sub={`${totalPOIncoming} units incoming`} tone="green" />
        <StatCard icon={AlertTriangle} label="Low Stock Alerts" value={MOCK_LOW_STOCK.length} sub="below minimum" tone="red" />
        <StatCard icon={TrendingUp} label="Open SKUs Tracked" value="14" sub="active materials" tone="amber" />
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[{ id: 'indents', label: 'Indents to Process' }, { id: 'pos', label: 'PO Schedule' }, { id: 'lowstock', label: 'Low Stock' }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'indents' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr><th className="text-left px-4 py-2.5">Facility</th><th className="text-left px-4 py-2.5">SKU</th><th className="text-right px-4 py-2.5">Requested</th><th className="text-right px-4 py-2.5">Issued</th><th className="text-right px-4 py-2.5">Pending</th><th className="text-right px-4 py-2.5">Lines</th></tr>
            </thead>
            <tbody>
              {MOCK_INDENT_TO_PROCESS.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.warehouse_name}</td>
                  <td className="px-4 py-3 text-slate-600">{r.material_code} <span className="text-slate-400">— {r.material_name}</span></td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.total_requested} {r.unit}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.total_issued}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{r.pending_qty}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{r.line_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pos' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr><th className="text-left px-4 py-2.5">PO No</th><th className="text-left px-4 py-2.5">Vendor</th><th className="text-left px-4 py-2.5">SKU</th><th className="text-right px-4 py-2.5">PO Qty</th><th className="text-right px-4 py-2.5">Remaining</th><th className="text-left px-4 py-2.5">Expected</th><th className="text-left px-4 py-2.5">Status</th></tr>
            </thead>
            <tbody>
              {MOCK_PO_SCHEDULE.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.po_no}</td>
                  <td className="px-4 py-3 text-slate-600">{r.vendor_name}</td>
                  <td className="px-4 py-3 text-slate-600">{r.material_code}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.po_qty}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">{r.remaining_qty}</td>
                  <td className="px-4 py-3 text-slate-600">{r.expected_delivery}</td>
                  <td className="px-4 py-3"><Badge tone={r.status === 'OPEN' ? 'blue' : 'amber'}>{r.status.replace('_', ' ')}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'lowstock' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr><th className="text-left px-4 py-2.5">Facility</th><th className="text-left px-4 py-2.5">SKU</th><th className="text-right px-4 py-2.5">On Hand</th><th className="text-right px-4 py-2.5">Min Level</th><th className="text-right px-4 py-2.5">Deficit</th></tr>
            </thead>
            <tbody>
              {MOCK_LOW_STOCK.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.warehouse_name} <Badge tone="gray">{r.warehouse_type}</Badge></td>
                  <td className="px-4 py-3 text-slate-600">{r.material_code} — {r.material_name}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{r.on_hand_qty}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.min_qty}</td>
                  <td className="px-4 py-3 text-right text-red-500">-{r.min_qty - r.on_hand_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── ADMIN PANEL ──────────────────────────────────────────────────────────────
const TERMINAL_PO = ['CANCELLED', 'CLOSED', 'FORCE_COMPLETED'];
const TERMINAL_ISSUE = ['CANCELLED', 'RECEIVED', 'FORCE_COMPLETED'];

function AdminPanel({ token }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tab, setTab] = useState('pos');

  const [auditRows, setAuditRows] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const [reverseModal, setReverseModal] = useState(null); // { type, id, ref }
  const [reverseReason, setReverseReason] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const hdrs = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchOverview = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/overview`, { headers: hdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed to load overview');
      setOverview(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchAuditLog = useCallback(async (page) => {
    setAuditLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/audit-log?page=${page}&page_size=20`, { headers: hdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed');
      setAuditRows(data.data ?? []);
      setAuditHasMore((data.data ?? []).length === 20);
      setAuditPage(page);
    } catch { /* silently fail — table stays empty */ }
    finally { setAuditLoading(false); }
  }, [token]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { if (tab === 'audit') fetchAuditLog(1); }, [tab, fetchAuditLog]);

  async function submitReverse() {
    if (!reverseReason.trim()) { setReverseError('Reason is required.'); return; }
    setReverseSubmitting(true); setReverseError('');
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/${reverseModal.type}/${reverseModal.id}/cancel`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Cancel failed');
      setReverseModal(null); setReverseReason('');
      await fetchOverview();
    } catch (e) {
      setReverseError(e.message);
    } finally {
      setReverseSubmitting(false);
    }
  }

  function openCancel(type, id, ref) {
    setReverseModal({ type, id, ref });
    setReverseReason(''); setReverseError('');
  }

  const TABS = [
    { id: 'pos', label: 'Purchase Orders' },
    { id: 'issues', label: 'Stock Issues' },
    { id: 'stock', label: 'Current Stock' },
    { id: 'audit', label: 'Audit Log' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-slate-400 gap-2">
      <RefreshCw size={18} className="animate-spin" /> Loading overview…
    </div>
  );

  if (error) return (
    <div className="max-w-xl">
      <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-xl px-4 py-3">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <div className="flex-1">{error}</div>
        <button onClick={fetchOverview} className="text-red-600 font-medium hover:underline">Retry</button>
      </div>
    </div>
  );

  const pos = overview?.purchase_orders ?? [];
  const issues = overview?.stock_issues ?? [];
  const stock = overview?.current_stock ?? [];
  const lowStock = overview?.low_stock_alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Admin Panel</h2>
          <p className="text-sm text-slate-500">{pos.length} POs · {issues.length} issues · {lowStock.length} low-stock alerts</p>
        </div>
        <button onClick={fetchOverview} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pos' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">PO No</th>
                <th className="text-left px-4 py-2.5">Vendor</th>
                <th className="text-left px-4 py-2.5">SKU</th>
                <th className="text-right px-4 py-2.5">PO Qty</th>
                <th className="text-right px-4 py-2.5">Remaining</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {pos.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No purchase orders</td></tr>}
              {pos.map((po) => (
                <tr key={po.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{po.po_no}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{po.vendor_name}</td>
                  <td className="px-4 py-3 text-slate-600">{po.material_code}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{po.po_qty}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">{po.remaining_qty ?? (po.po_qty - po.received_qty_cache)}</td>
                  <td className="px-4 py-3"><Badge tone={po.status === 'OPEN' ? 'blue' : po.status === 'CANCELLED' ? 'red' : po.status === 'CLOSED' ? 'green' : 'gray'}>{po.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    {!TERMINAL_PO.includes(po.status) && (
                      <button onClick={() => openCancel('purchase-orders', po.id, po.po_no)}
                        className="text-xs px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'issues' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">Issue Ref</th>
                <th className="text-left px-4 py-2.5">SKU</th>
                <th className="text-left px-4 py-2.5">From → To</th>
                <th className="text-right px-4 py-2.5">Issued Qty</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No stock issues</td></tr>}
              {issues.map((si) => (
                <tr key={si.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{si.issue_ref}</td>
                  <td className="px-4 py-3 text-slate-600">{si.material_code}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{si.from_warehouse_name} → {si.to_warehouse_name}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">{si.issued_qty}</td>
                  <td className="px-4 py-3 text-slate-600">{si.issue_date}</td>
                  <td className="px-4 py-3"><Badge tone={si.status === 'DISPATCHED' ? 'blue' : si.status === 'RECEIVED' ? 'green' : si.status === 'CANCELLED' ? 'red' : 'amber'}>{si.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    {!TERMINAL_ISSUE.includes(si.status) && (
                      <button onClick={() => openCancel('stock-issues', si.id, si.issue_ref)}
                        className="text-xs px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'stock' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">Warehouse</th>
                <th className="text-left px-4 py-2.5">SKU</th>
                <th className="text-left px-4 py-2.5">Material</th>
                <th className="text-right px-4 py-2.5">On Hand</th>
                <th className="text-right px-4 py-2.5">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {stock.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No stock on record</td></tr>}
              {stock.map((s, i) => {
                const isLow = lowStock.some((l) => l.warehouse_id === s.warehouse_id && l.material_id === s.material_id);
                return (
                  <tr key={i} className={`border-t border-slate-100 ${isLow ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{s.warehouse_name}</td>
                    <td className="px-4 py-3 text-slate-600">{s.material_code}</td>
                    <td className="px-4 py-3 text-slate-500">{s.material_name}</td>
                    <td className={`px-4 py-3 text-right font-bold ${isLow ? 'text-red-600' : 'text-slate-800'}`}>{s.on_hand_qty}{isLow && ' ⚠'}</td>
                    <td className="px-4 py-3 text-right text-slate-500">₹{Number(s.weighted_avg_cost ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-4 py-2.5">Time</th>
                  <th className="text-left px-4 py-2.5">Action</th>
                  <th className="text-left px-4 py-2.5">Entity</th>
                  <th className="text-left px-4 py-2.5">Detail</th>
                  <th className="text-left px-4 py-2.5">Source</th>
                </tr>
              </thead>
              <tbody>
                {auditLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400"><RefreshCw size={14} className="animate-spin inline mr-1" />Loading…</td></tr>}
                {!auditLoading && auditRows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No audit entries</td></tr>}
                {auditRows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.action}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{r.entity_table} #{r.entity_id}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">{typeof r.detail === 'object' ? JSON.stringify(r.detail) : r.detail}</td>
                    <td className="px-4 py-2.5"><Badge tone={r.source === 'reversal' ? 'amber' : 'gray'}>{r.source}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={auditPage <= 1 || auditLoading} onClick={() => fetchAuditLog(auditPage - 1)}
              className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg disabled:opacity-40">← Prev</button>
            <span className="text-sm text-slate-500">Page {auditPage}</span>
            <button disabled={!auditHasMore || auditLoading} onClick={() => fetchAuditLog(auditPage + 1)}
              className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}

      {reverseModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900">Cancel {reverseModal.type === 'purchase-orders' ? 'PO' : 'Issue'}</div>
              <button onClick={() => setReverseModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="text-sm text-slate-500">
              You are about to cancel <span className="font-semibold text-slate-800">{reverseModal.ref}</span>. This action is logged and cannot be undone.
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Reason <span className="text-red-500">*</span></label>
              <textarea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Explain why this is being cancelled…"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
            </div>
            {reverseError && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{reverseError}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setReverseModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
                Back
              </button>
              <button onClick={submitReverse} disabled={reverseSubmitting}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {reverseSubmitting ? <><RefreshCw size={14} className="animate-spin" /> Cancelling…</> : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [section, setSection] = useState('dashboard');

  if (!user) return (
    <LoginScreen onLogin={(t, u) => {
      setToken(t); setUser(u);
      setSection(['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP'].includes(u.role) ? 'indent' : u.role === 'ADMIN' ? 'admin' : 'dashboard');
    }} />
  );

  const NAV = [
    { id: 'dashboard', label: 'PM Store Dashboard', icon: TrendingUp, roles: ['PM_STORE_EXEC', 'ADMIN'] },
    { id: 'indent', label: 'Upload Indent', icon: Box, roles: ['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP', 'ADMIN'] },
    { id: 'po', label: 'Upload Purchase Orders', icon: Truck, roles: ['PM_STORE_EXEC', 'ADMIN'] },
    { id: 'admin', label: 'Admin Panel', icon: Shield, roles: ['ADMIN'] },
  ].filter((n) => n.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <div className="w-60 bg-slate-900 flex flex-col flex-shrink-0">
        <div className="p-4 flex items-center gap-2 border-b border-slate-800">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
          <span className="font-bold text-white">PackTrack</span>
        </div>
        <div className="flex-1 p-2 space-y-1">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setSection(n.id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${section === n.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <n.icon size={16} /> {n.label}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{user.name.charAt(0)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{user.name}</div>
              <div className="text-xs text-slate-400">{user.role.replace('_', ' ')}</div>
            </div>
          </div>
          <button onClick={() => { setUser(null); setToken(null); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {section === 'dashboard' && <DashboardSection />}
        {section === 'indent' && <IndentUploadSection token={token} />}
        {section === 'po' && <POUploadSection token={token} />}
        {section === 'admin' && <AdminPanel token={token} />}
      </div>
    </div>
  );
}
