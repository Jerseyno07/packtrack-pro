import { useState, useMemo } from 'react';
import { Upload, FileSpreadsheet, Package, AlertTriangle, CheckCircle2, Clock, TrendingUp, LogOut, ChevronRight, Truck, Box, Calendar, Download } from 'lucide-react';

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
  const [email, setEmail] = useState('pmstore@packtrack.local');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(''); setLoading(true);
    try {
      const res = await MOCK_API.login(email, password);
      onLogin(res.user);
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

        <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-400 space-y-1">
          <div className="font-medium text-slate-500">Demo logins:</div>
          <div>pmstore@packtrack.local · ccexec@packtrack.local · admin@packtrack.local</div>
          <div>password: demo1234</div>
        </div>
      </div>
    </div>
  );
}

// ── INDENT UPLOAD ───────────────────────────────────────────────────────────
function IndentUploadSection() {
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
      const res = await MOCK_API.uploadIndent(file, indentDate);
      setResult(res);
    } catch (e) { setError('Upload failed. Please try again.'); } finally { setUploading(false); }
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
            ['BLR-CC-01', 'LDPE-06', 500, 'Weekly stock'],
            ['BLR-CC-01', 'NTRLL-01', 40, ''],
            ['BLR-FC-01', 'WXRB-01', 20, 'Urgent'],
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
function POUploadSection() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleUpload() {
    setError('');
    if (!file) { setError('Please choose a file.'); return; }
    setUploading(true);
    try {
      const res = await MOCK_API.uploadPO(file);
      setResult(res);
    } catch (e) { setError('Upload failed. Please try again.'); } finally { setUploading(false); }
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
            ['PO-2026-0001', 'Shree Plastics Pvt Ltd', 'LDPE-06', 'BLR-PM-01', 2000, 2.50, '2026-07-01', '2026-07-10'],
            ['PO-2026-0002', 'Karnataka Packaging Co', 'NTRLL-01', 'BLR-PM-01', 150, 180.00, '2026-07-01', '2026-07-08'],
            ['PO-2026-0003', 'Tamil Nadu Ribbons Ltd', 'WXRB-01', 'BLR-PM-01', 50, 95.00, '2026-07-02', ''],
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

// ── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [section, setSection] = useState('dashboard');

  if (!user) return <LoginScreen onLogin={(u) => { setUser(u); setSection(u.role === 'CC_EXEC' || u.role === 'FC_EXEC' ? 'indent' : 'dashboard'); }} />;

  const NAV = [
    { id: 'dashboard', label: 'PM Store Dashboard', icon: TrendingUp, roles: ['PM_STORE_EXEC', 'ADMIN'] },
    { id: 'indent', label: 'Upload Indent', icon: Box, roles: ['CC_EXEC', 'FC_EXEC', 'ADMIN'] },
    { id: 'po', label: 'Upload Purchase Orders', icon: Truck, roles: ['PM_STORE_EXEC', 'ADMIN'] },
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
          <button onClick={() => setUser(null)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        {section === 'dashboard' && <DashboardSection />}
        {section === 'indent' && <IndentUploadSection />}
        {section === 'po' && <POUploadSection />}
      </div>
    </div>
  );
}
