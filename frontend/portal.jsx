import { useState, useMemo, useEffect, useCallback } from 'react';
import { Upload, FileSpreadsheet, Package, AlertTriangle, CheckCircle2, Clock, TrendingUp, LogOut, ChevronRight, Truck, Box, Calendar, Download, Shield, RefreshCw, X, Zap, Users } from 'lucide-react';
import TourOverlay from './TourOverlay.jsx';

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
        <div><strong>Expected columns:</strong> facility_code, sku_code, requested_qty (non-roll), no_of_rolls (roll materials), remarks (optional)</div>
        <button
          onClick={() => downloadCSV('indent_sample.csv', [
            ['facility_code', 'sku_code', 'requested_qty', 'no_of_rolls', 'remarks'],
            ['CC-BLR', 'LDPE-06', 500, '', 'Weekly stock'],
            ['CC-BLR', 'NTRLL-01', '', 40, ''],
            ['FC-BLR', 'WXRB-01', '', 20, 'Urgent'],
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
        <div><strong>Expected columns:</strong> po_no, vendor_name, sku_code, pm_store_code, po_qty (non-roll), no_of_rolls + length_per_roll (roll materials), unit_price, po_date, expected_delivery (optional)</div>
        <button data-tour="po-sample-csv"
          onClick={() => downloadCSV('purchase_orders_sample.csv', [
            ['po_no', 'vendor_name', 'sku_code', 'pm_store_code', 'po_qty', 'no_of_rolls', 'length_per_roll', 'unit_price', 'po_date', 'expected_delivery'],
            ['PO-2026-0001', 'Shree Plastics Pvt Ltd', 'LDPE-06', 'CS-001', 2000, '', '', 2.50, '2026-07-01', '2026-07-10'],
            ['PO-2026-0002', 'Karnataka Packaging Co', 'NTRLL-01', 'CS-001', '', 10, 200, 180.00, '2026-07-01', '2026-07-08'],
            ['PO-2026-0003', 'Tamil Nadu Ribbons Ltd', 'WXRB-01', 'CS-001', '', 5, 150, 95.00, '2026-07-02', ''],
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

        <button data-tour="po-upload-btn" onClick={handleUpload} disabled={uploading} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
          <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload POs'}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            {result.error_rows === 0 ? <CheckCircle2 size={18} className="text-green-500" /> : <AlertTriangle size={18} className="text-amber-500" />}
            <span className="font-semibold text-slate-900">{result.batch_ref}</span>
            <Badge tone={result.error_rows === 0 ? 'green' : result.valid_rows === 0 ? 'red' : 'amber'}>{result.status}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-slate-400 text-xs">Total Rows</div><div className="font-bold text-slate-900">{result.total_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Valid</div><div className="font-bold text-green-600">{result.valid_rows}</div></div>
            <div><div className="text-slate-400 text-xs">Errors</div><div className="font-bold text-red-600">{result.error_rows}</div></div>
          </div>
          {result.errors?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1.5">Row errors</div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex gap-2 text-xs bg-red-50 rounded-lg px-3 py-1.5">
                    <span className="font-medium text-red-700 whitespace-nowrap">Row {e.row}</span>
                    <span className="text-red-600">{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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

function AdminPanel({ token, tabOverride }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tab, setTab] = useState('pos');
  const [poFilter, setPoFilter] = useState('active');

  useEffect(() => { if (tabOverride) setTab(tabOverride); }, [tabOverride]);

  const [auditRows, setAuditRows] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const [reverseModal, setReverseModal] = useState(null); // { type, id, ref }
  const [reverseReason, setReverseReason] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const [skuFile, setSkuFile] = useState(null);
  const [skuUploading, setSkuUploading] = useState(false);
  const [skuResult, setSkuResult] = useState(null);
  const [skuError, setSkuError] = useState('');

  const [consumptionRuns, setConsumptionRuns] = useState([]);
  const [consumptionLoading, setConsumptionLoading] = useState(false);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [facilityWarehouses, setFacilityWarehouses] = useState([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');

  const [mslWarehouses, setMslWarehouses] = useState([]);
  const [mslMaterials, setMslMaterials] = useState([]);
  const [mslLevels, setMslLevels] = useState({});
  const [mslEdits, setMslEdits] = useState({});
  const [mslLoading, setMslLoading] = useState(false);
  const [mslSaving, setMslSaving] = useState(false);
  const [mslSaved, setMslSaved] = useState(false);
  const [mslFilter, setMslFilter] = useState('ALL');
  const [mslError, setMslError] = useState('');

  const [usersList, setUsersList] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [resetModal, setResetModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState('');

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

  const fetchConsumptionRuns = useCallback(async () => {
    setConsumptionLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/consumption/runs`, { headers: hdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed');
      setConsumptionRuns(data.data ?? []);
    } catch { /* silent */ }
    finally { setConsumptionLoading(false); }
  }, [token]);

  async function uploadSkuMaster() {
    if (!skuFile) { setSkuError('Select a file first.'); return; }
    setSkuUploading(true); setSkuError(''); setSkuResult(null);
    try {
      const fd = new FormData();
      fd.append('file', skuFile);
      const res = await fetch(`${BASE_URL}/api/v1/sku-packaging-master/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Upload failed');
      setSkuResult(data);
    } catch (e) { setSkuError(e.message); }
    finally { setSkuUploading(false); }
  }

  async function fetchFacilityWarehouses() {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/warehouses`, { headers: hdrs });
      const data = await res.json();
      setFacilityWarehouses((data.warehouses ?? []).filter((w) => w.warehouse_type !== 'PM_STORE'));
    } catch { /* silent */ }
  }

  async function triggerRunNow() {
    if (!selectedFacilityId) return;
    setRunNowLoading(true);
    try {
      const body = selectedFacilityId === 'ALL' ? {} : { warehouseId: Number(selectedFacilityId) };
      await fetch(`${BASE_URL}/api/v1/admin/consumption/run-now`, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
      setTimeout(() => fetchConsumptionRuns(), 2000);
    } catch { /* silent */ }
    finally { setRunNowLoading(false); }
  }

  async function fetchMinStockLevels() {
    setMslLoading(true); setMslError('');
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/min-stock-levels`, { headers: hdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed');
      setMslWarehouses(data.warehouses ?? []);
      setMslMaterials(data.materials ?? []);
      setMslLevels(data.levels ?? {});
      setMslEdits({});
    } catch (e) { setMslError(e.message); }
    finally { setMslLoading(false); }
  }

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/users`, { headers: hdrs });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Failed');
      setUsersList(data.users ?? []);
    } catch { /* silent */ }
    finally { setUsersLoading(false); }
  }, [token]);

  async function submitResetPassword() {
    if (!resetPassword) { setResetError('New password is required.'); return; }
    if (resetPassword.length < 8) { setResetError('Password must be at least 8 characters.'); return; }
    if (resetPassword !== resetConfirm) { setResetError('Passwords do not match.'); return; }
    setResetSubmitting(true); setResetError('');
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/users/${resetModal.id}/reset-password`, {
        method: 'PUT', headers: hdrs,
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Reset failed');
      setResetModal(null); setResetPassword(''); setResetConfirm('');
    } catch (e) {
      setResetError(e.message);
    } finally {
      setResetSubmitting(false);
    }
  }

  async function saveMinStockLevels() {
    const updates = Object.entries(mslEdits).map(([key, min_qty]) => {
      const [warehouse_id, material_id] = key.split(':');
      return { warehouse_id: Number(warehouse_id), material_id: Number(material_id), min_qty: Number(min_qty) };
    });
    if (!updates.length) return;
    setMslSaving(true); setMslError(''); setMslSaved(false);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/min-stock-levels`, {
        method: 'PUT', headers: hdrs, body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Save failed');
      setMslLevels((prev) => { const next = { ...prev }; updates.forEach((u) => { next[`${u.warehouse_id}:${u.material_id}`] = u.min_qty; }); return next; });
      setMslEdits({});
      setMslSaved(true);
      setTimeout(() => setMslSaved(false), 3000);
    } catch (e) { setMslError(e.message); }
    finally { setMslSaving(false); }
  }

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { if (tab === 'audit') fetchAuditLog(1); }, [tab, fetchAuditLog]);
  useEffect(() => { if (tab === 'consumption') { fetchConsumptionRuns(); fetchFacilityWarehouses(); } }, [tab, fetchConsumptionRuns]);
  useEffect(() => { if (tab === 'msl') fetchMinStockLevels(); }, [tab]);
  useEffect(() => { if (tab === 'users') fetchUsers(); }, [tab, fetchUsers]);

  async function submitReverse() {
    if (!reverseReason.trim()) { setReverseError('Reason is required.'); return; }
    setReverseSubmitting(true); setReverseError('');
    try {
      const action = reverseModal.action || 'cancel';
      const res = await fetch(`${BASE_URL}/api/v1/admin/${reverseModal.type}/${reverseModal.id}/${action}`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Action failed');
      setReverseModal(null); setReverseReason('');
      await fetchOverview();
    } catch (e) {
      setReverseError(e.message);
    } finally {
      setReverseSubmitting(false);
    }
  }

  function openCancel(type, id, ref) {
    setReverseModal({ type, id, ref, action: 'cancel' });
    setReverseReason(''); setReverseError('');
  }

  function openReverseForceComplete(type, id, ref) {
    setReverseModal({ type, id, ref, action: 'reverse-force-complete' });
    setReverseReason(''); setReverseError('');
  }

  const TABS = [
    { id: 'pos', label: 'Purchase Orders' },
    { id: 'issues', label: 'Stock Issues' },
    { id: 'stock', label: 'Current Stock' },
    { id: 'audit', label: 'Audit Log' },
    { id: 'sku', label: 'SKU Master' },
    { id: 'consumption', label: 'Consumption Runs' },
    { id: 'msl', label: 'Min Stock Levels' },
    { id: 'users', label: 'Users' },
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

  const allPos = overview?.purchase_orders ?? [];
  const pos = poFilter === 'active' ? allPos.filter(p => !TERMINAL_PO.includes(p.status)) : allPos;
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
        <button data-tour="admin-refresh" onClick={fetchOverview} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div data-tour="admin-tabs" className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pos' && (
        <div className="space-y-3">
        <div data-tour="po-filter" className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {[['active', 'Active'], ['all', 'All']].map(([val, label]) => (
            <button key={val} onClick={() => setPoFilter(val)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${poFilter === val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}{val === 'active' ? ` (${allPos.filter(p => !TERMINAL_PO.includes(p.status)).length})` : ` (${allPos.length})`}
            </button>
          ))}
        </div>
        <div data-tour="po-table" className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
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
                  <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                    {!TERMINAL_PO.includes(po.status) && (
                      <button onClick={() => openCancel('purchase-orders', po.id, po.po_no)}
                        className="text-xs px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium">Cancel</button>
                    )}
                    {po.status === 'FORCE_COMPLETED' && (
                      <button onClick={() => openReverseForceComplete('purchase-orders', po.id, po.po_no)}
                        className="text-xs px-2 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium">Reverse Force Complete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {tab === 'issues' && (
        <div data-tour="issues-table" className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
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
          <div data-tour="audit-pagination" className="flex items-center gap-2">
            <button disabled={auditPage <= 1 || auditLoading} onClick={() => fetchAuditLog(auditPage - 1)}
              className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg disabled:opacity-40">← Prev</button>
            <span className="text-sm text-slate-500">Page {auditPage}</span>
            <button disabled={!auditHasMore || auditLoading} onClick={() => fetchAuditLog(auditPage + 1)}
              className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}

      {tab === 'sku' && (
        <div data-tour="sku-section" className="space-y-4 max-w-xl">
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">Upload SKU Packaging Master</h3>
            <p className="text-xs text-slate-500 mb-3">Use your existing master CSV — required columns: <code>FSN ID</code>, <code>SKU Name</code>, <code>Packing Material</code>. Optional: <code>Sec. packing (…)</code> columns for secondary/tertiary materials.</p>
            <div className="flex gap-2">
              <label className={`flex-1 flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer text-sm ${skuFile ? 'border-green-400 bg-green-50 text-green-700' : 'border-dashed border-slate-300 text-slate-500 hover:border-blue-400'}`}>
                <FileSpreadsheet size={15} />
                {skuFile ? skuFile.name : 'Choose CSV / Excel file'}
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { setSkuFile(e.target.files?.[0] ?? null); setSkuResult(null); setSkuError(''); }} />
              </label>
              <button data-tour="sku-upload-btn" onClick={uploadSkuMaster} disabled={skuUploading || !skuFile}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
                {skuUploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                {skuUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
            <button data-tour="sku-sample" onClick={() => downloadCSV('sku_master_sample.csv', [
              ['FSN ID','SKU Name','Packing Type','Packing Material','Sec. packing (Cling wrap)','Sec. packing (Foam Roll)','Sec. packing (Butter Paper)','Sec. packing (Foam Net)'],
              ['VEGFFHGDAHJVZQEN','Beans (cluster)','Bag','LDPE Cover 6 Kg','','','',''],
              ['VEGHZA5FHUVZRZ7C','Fresh Yam','Net','Net Roll','1','','',''],
            ])} className="mt-2 text-xs text-blue-600 hover:underline">↓ Download sample CSV</button>
          </div>
          {skuError && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{skuError}</div>}
          {skuResult && (
            <div className={`rounded-xl border p-4 space-y-2 ${skuResult.error_rows > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {skuResult.error_rows === 0 ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
                {skuResult.upserted} upserted · {skuResult.error_rows} errors
              </div>
              {skuResult.errors?.map((e, i) => (
                <div key={i} className="text-xs text-red-700">Row {e.row}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'consumption' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-800">Consumption Runs</h3>
            <div className="flex items-center gap-2">
              <select
                value={selectedFacilityId}
                onChange={(e) => setSelectedFacilityId(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select facility —</option>
                <option value="ALL">All Facilities</option>
                {['FC', 'CC'].map((type) => {
                  const whs = facilityWarehouses.filter((w) => w.warehouse_type === type);
                  if (!whs.length) return null;
                  return (
                    <optgroup key={type} label={type}>
                      {whs.map((w) => (
                        <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <button data-tour="run-now" onClick={triggerRunNow} disabled={runNowLoading || !selectedFacilityId}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                {runNowLoading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                Run Now
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left">Run Date</th>
                  <th className="px-4 py-2.5 text-left">Facility</th>
                  <th className="px-4 py-2.5 text-left">Scraped Range</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-right">Total Rows</th>
                  <th className="px-4 py-2.5 text-right">Deducted</th>
                  <th className="px-4 py-2.5 text-right">Skipped</th>
                  <th className="px-4 py-2.5 text-right">Errors</th>
                  <th className="px-4 py-2.5 text-left">Completed</th>
                </tr>
              </thead>
              <tbody>
                {consumptionLoading && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400"><RefreshCw size={14} className="animate-spin inline mr-1" />Loading…</td></tr>}
                {!consumptionLoading && consumptionRuns.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No runs yet</td></tr>}
                {consumptionRuns.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.run_date?.slice(0,10)}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs font-mono">{r.facility_filter ?? <span className="text-slate-400">All</span>}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{r.scraped_from?.slice(0,10)} → {r.scraped_to?.slice(0,10)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge tone={r.status === 'COMPLETED' ? 'green' : r.status === 'FAILED' ? 'red' : 'amber'}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{r.total_sku_facility_rows}</td>
                    <td className="px-4 py-2.5 text-right text-green-700 font-medium">{r.deducted_lines}</td>
                    <td className="px-4 py-2.5 text-right text-amber-600">{r.skipped_lines}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{r.error_lines}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'msl' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">Min Stock Levels</h3>
              <p className="text-xs text-slate-500 mt-0.5">Set per-facility low-stock thresholds for each packaging material.</p>
            </div>
            <div className="flex items-center gap-3">
              <select data-tour="msl-filter" value={mslFilter} onChange={(e) => setMslFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700">
                <option value="ALL">All Facility Types</option>
                <option value="PM_STORE">PM Store</option>
                <option value="FC">FC</option>
                <option value="CC">CC</option>
              </select>
              {Object.keys(mslEdits).length > 0 && (
                <button onClick={saveMinStockLevels} disabled={mslSaving}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {mslSaving ? 'Saving…' : `Save ${Object.keys(mslEdits).length} change${Object.keys(mslEdits).length > 1 ? 's' : ''}`}
                </button>
              )}
              {mslSaved && <span className="text-sm text-emerald-600 font-medium">Saved!</span>}
              <button onClick={fetchMinStockLevels} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          {mslError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{mslError}</div>}
          {mslLoading ? (
            <div className="py-12 text-center text-slate-400"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading…</div>
          ) : (
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left font-medium text-slate-500 sticky left-0 bg-slate-50 min-w-[200px]">Facility</th>
                    <th className="px-3 py-2.5 text-left font-medium text-slate-500 text-xs min-w-[80px]">Type</th>
                    {mslMaterials.map((m) => (
                      <th key={m.id} className="px-3 py-2.5 text-center font-medium text-slate-500 text-xs min-w-[90px]">
                        <div>{m.code}</div>
                        <div className="font-normal text-slate-400 truncate max-w-[80px]">{m.unit}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mslWarehouses
                    .filter((w) => mslFilter === 'ALL' || w.warehouse_type === mslFilter)
                    .map((w) => (
                      <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 sticky left-0 bg-white font-medium text-slate-700 text-xs">
                          <div>{w.name}</div>
                          <div className="text-slate-400">{w.city}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">{w.warehouse_type}</td>
                        {mslMaterials.map((m) => {
                          const key = `${w.id}:${m.id}`;
                          const saved = mslLevels[key] ?? '';
                          const edited = mslEdits[key];
                          const display = edited !== undefined ? edited : saved;
                          const isDirty = edited !== undefined;
                          return (
                            <td key={m.id} className="px-2 py-1.5 text-center">
                              <input
                                type="number" min="0"
                                value={display}
                                placeholder="—"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setMslEdits((prev) => {
                                    const next = { ...prev };
                                    if (val === '' || val === String(mslLevels[key] ?? '')) {
                                      delete next[key];
                                    } else {
                                      next[key] = val;
                                    }
                                    return next;
                                  });
                                }}
                                className={`w-16 text-center text-xs rounded-md border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400
                                  ${isDirty ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">User Accounts</h3>
              <p className="text-xs text-slate-500 mt-0.5">Reset passwords for any user account.</p>
            </div>
            <button onClick={fetchUsers} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <RefreshCw size={14} />
            </button>
          </div>
          {usersLoading ? (
            <div className="py-12 text-center text-slate-400"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading…</div>
          ) : (
            <div data-tour="users-table" className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-2.5">Email</th>
                    <th className="text-left px-4 py-2.5">Name</th>
                    <th className="text-left px-4 py-2.5">Role</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users</td></tr>}
                  {usersList.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800 font-medium">{u.email}</td>
                      <td className="px-4 py-3 text-slate-600">{u.name}</td>
                      <td className="px-4 py-3"><Badge tone="gray">{u.role.replace(/_/g, ' ')}</Badge></td>
                      <td className="px-4 py-3">
                        <Badge tone={u.is_active ? 'green' : 'red'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => { setResetModal(u); setResetPassword(''); setResetConfirm(''); setResetError(''); }}
                          className="text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium"
                        >
                          Reset Password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {resetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900">Reset Password</div>
              <button onClick={() => setResetModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="text-sm text-slate-500">
              Set a new password for <span className="font-semibold text-slate-800">{resetModal.email}</span>. Communicate the new password to the user directly.
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">New Password <span className="text-red-500">*</span></label>
                <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Confirm Password <span className="text-red-500">*</span></label>
                <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            {resetError && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{resetError}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setResetModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={submitResetPassword} disabled={resetSubmitting}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {resetSubmitting ? <><RefreshCw size={14} className="animate-spin" /> Resetting…</> : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reverseModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900">
                {reverseModal.action === 'reverse-force-complete' ? 'Reverse Force Complete' : `Cancel ${reverseModal.type === 'purchase-orders' ? 'PO' : 'Issue'}`}
              </div>
              <button onClick={() => setReverseModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="text-sm text-slate-500">
              {reverseModal.action === 'reverse-force-complete'
                ? <>You are about to undo the Force Complete on <span className="font-semibold text-slate-800">{reverseModal.ref}</span>, reopening it at its correct received-qty status. This action is logged.</>
                : <>You are about to cancel <span className="font-semibold text-slate-800">{reverseModal.ref}</span>. This action is logged and cannot be undone.</>}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Reason <span className="text-red-500">*</span></label>
              <textarea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
                placeholder={reverseModal.action === 'reverse-force-complete' ? 'Explain why the Force Complete is being reversed…' : 'Explain why this is being cancelled…'}
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
  const [showTour, setShowTour] = useState(false);
  const [adminTabForTour, setAdminTabForTour] = useState(null);

  function finishTour() {
    setShowTour(false);
    setAdminTabForTour(null);
    if (user) localStorage.setItem(`packtrack_tour_done_${user.role}`, '1');
  }

  if (!user) return (
    <LoginScreen onLogin={(t, u) => {
      setToken(t); setUser(u);
      setSection(['CC_EXEC', 'FC_EXEC', 'CC_DP', 'FC_DP'].includes(u.role) ? 'indent' : u.role === 'ADMIN' ? 'admin' : 'dashboard');
      if (!localStorage.getItem(`packtrack_tour_done_${u.role}`)) setShowTour(true);
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
        <div data-tour="admin-nav" className="flex-1 p-2 space-y-1">
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
        {section === 'admin' && <AdminPanel token={token} tabOverride={adminTabForTour} />}
      </div>

      <button
        data-tour="tour-btn-portal"
        onClick={() => setShowTour(true)}
        className="fixed bottom-6 right-6 w-11 h-11 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center text-lg font-bold hover:bg-blue-700 z-50"
        title="Open guided tour"
      >?</button>

      {showTour && (
        <TourOverlay
          onDone={finishTour}
          steps={[
            { target: null, title: 'Welcome to PackTrack Admin', body: 'This tour walks you through every section and button in the portal. Use Next/Prev to navigate or Skip to dismiss at any time.' },
            { target: 'admin-nav', title: 'Sidebar Navigation', body: 'Switch between sections using this sidebar. As admin you have access to PM Store Dashboard, Upload Indent, Upload Purchase Orders, and the Admin Panel.', onEnter: () => setSection('admin') },
            { target: 'po-sample-csv', title: 'Download Sample CSV', body: 'Always download the sample before uploading POs. Roll materials use no_of_rolls and length_per_roll; other materials use po_qty. Blank cells for unused columns are fine.', onEnter: () => { setSection('po'); setAdminTabForTour(null); } },
            { target: 'po-upload-btn', title: 'Upload Purchase Orders', body: 'After filling the CSV, upload it here. A single po_no can span multiple rows — one row per material under the same PO number.' },
            { target: 'admin-tabs', title: 'Admin Panel Tabs', body: 'The admin panel has 8 tabs: Purchase Orders, Stock Issues, Current Stock, Audit Log, SKU Master, Consumption Runs, Min Stock Levels, and Users.', onEnter: () => { setSection('admin'); setAdminTabForTour('pos'); } },
            { target: 'admin-refresh', title: 'Refresh', body: 'Re-fetches all data from the server without a full page reload. Use this after making changes in another session.' },
            { target: 'po-filter', title: 'Active / All Toggle', body: 'Active shows only open and partially received POs. Switch to All to include closed, cancelled, and force-completed POs too.', onEnter: () => setAdminTabForTour('pos') },
            { target: 'po-table', title: 'Purchase Orders Table', body: 'Each row is a PO line. The Cancel button withdraws an active PO; Reverse Force Complete (visible on force-completed POs) undoes an accidental close — both require a written reason.' },
            { target: 'issues-table', title: 'Stock Issues', body: 'Every dispatch from the PM Store to an FC or CC facility appears here. The Cancel button removes a pending dispatch before it is received at the destination.', onEnter: () => setAdminTabForTour('issues') },
            { target: 'audit-pagination', title: 'Audit Log', body: 'Every system action is recorded here — GRNs, force completes, password resets, cancellations. Use Prev and Next to page through 50 records at a time.', onEnter: () => setAdminTabForTour('audit') },
            { target: 'sku-section', title: 'SKU Packaging Master', body: 'Maps each FSN (Ninjacart product code) to its packaging materials. The daily consumption scraper uses this mapping to deduct PM stock when units are packed at FC/CC.', onEnter: () => setAdminTabForTour('sku') },
            { target: 'sku-sample', title: 'Download SKU Sample', body: 'Download the sample to see required columns: FSN ID, SKU Name, Packing Material, plus optional secondary/tertiary columns for multi-material SKUs.' },
            { target: 'sku-upload-btn', title: 'Upload SKU Master', body: 'Upload your filled SKU master CSV here. Existing FSN rows are updated; new ones are inserted. Re-upload whenever the packaging mapping changes.' },
            { target: 'run-now', title: 'Run Consumption Scraper', body: 'Triggers the daily scraper immediately without waiting for the 5am schedule. Use after uploading a new SKU master or if yesterday\'s run failed.', onEnter: () => setAdminTabForTour('consumption') },
            { target: 'msl-filter', title: 'Min Stock Levels — Filter', body: 'Narrows the threshold grid to PM Store, FC, or CC facilities so you can focus edits on one type at a time.', onEnter: () => setAdminTabForTour('msl') },
            { target: null, title: 'Min Stock Levels — Save', body: 'Edit any threshold cell inline — it highlights amber. A Save button appears top-right once edits exist. Hit it to commit all changes at once.' },
            { target: 'users-table', title: 'User Accounts', body: 'Lists every login account with role and status. Hit Reset Password on any row to set a new password — minimum 8 characters, confirmation required. The action is logged in the audit trail.', onEnter: () => setAdminTabForTour('users') },
            { target: 'tour-btn-portal', title: "You're all set!", body: 'Hit this ? button at the bottom-right any time to replay the tour.' },
          ]}
        />
      )}
    </div>
  );
}
