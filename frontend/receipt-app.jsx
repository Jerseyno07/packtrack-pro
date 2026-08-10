import { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, Package, CheckCircle2, AlertTriangle, Clock, ChevronRight, ArrowLeft, RefreshCw, LogIn, LogOut, Zap, MonitorSmartphone } from 'lucide-react';

function useInstallPrompt() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const [prompt, setPrompt] = useState(window.__pwaPrompt || null);
  const [showInstructions, setShowInstructions] = useState(false);
  useEffect(() => {
    const onReady = () => setPrompt(window.__pwaPrompt);
    const onInstalled = () => setPrompt(null);
    window.addEventListener('pwaready', onReady);
    window.addEventListener('pwainstalled', onInstalled);
    return () => { window.removeEventListener('pwaready', onReady); window.removeEventListener('pwainstalled', onInstalled); };
  }, []);
  const install = async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setPrompt(null);
    } else {
      setShowInstructions(true);
    }
  };
  return { canInstall: !isStandalone, install, showInstructions, setShowInstructions };
}
import AuditScreen from './AuditScreen.jsx';
import TourOverlay from './TourOverlay.jsx';

const BASE_URL = import.meta.env.DEV ? '' : 'https://packtrack-pro-production.up.railway.app';

function rcptDispFactor(issue) {
  if (issue.meters_per_unit) return Number(issue.meters_per_unit);
  if (issue.stickers_per_roll) return Number(issue.stickers_per_roll);
  if (issue.pieces_per_kg) return Number(issue.pieces_per_kg);
  return 1;
}
function rcptDispUnit(issue) {
  return issue.meters_per_unit ? 'rolls' : issue.stickers_per_roll ? 'units' : issue.pieces_per_kg ? 'Kg' : (issue.unit ?? '');
}
function rcptToDisp(issue, baseQty) {
  const factor = rcptDispFactor(issue);
  return factor > 1 ? parseFloat((Number(baseQty) / factor).toFixed(2)) : Number(baseQty);
}

function api(token) {
  const headers = (extra = {}) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });

  async function request(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  }

  return {
    login: (email, password) => request('POST', '/api/v1/auth/login', { email, password }),
    listPendingIssues: (warehouseId) =>
      request('GET', `/api/v1/stock-issues?to_warehouse_id=${warehouseId}&status=DISPATCHED,PARTIALLY_RECEIVED`),
    receiptDefaults: (issueId) =>
      request('GET', `/api/v1/stock-issues/${issueId}/receipt-defaults`),
    confirmReceipt: (payload) => request('POST', '/api/v1/stock-receipts', payload),
    forceComplete: (issueId, reason) =>
      request('POST', `/api/v1/stock-issues/${issueId}/force-complete`, { reason }),
  };
}

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { canInstall, install, showInstructions, setShowInstructions } = useInstallPrompt();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api(null).login(email.trim(), password);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto mb-3">
            <Package size={28} />
          </div>
          <div className="font-bold text-xl text-slate-900">PackTrack</div>
          <div className="text-sm text-slate-500 mt-1">Stock Receipt App</div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="username"
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password"
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-60"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        {canInstall && (
          <button onClick={install}
            className="mt-4 w-full py-3 border border-slate-200 bg-white text-slate-600 rounded-xl font-medium flex items-center justify-center gap-2 active:bg-slate-50">
            <MonitorSmartphone size={16} /> Add to Home Screen
          </button>
        )}
        {showInstructions && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 space-y-2">
            <div className="font-semibold text-slate-900 flex items-center justify-between">
              Add to Home Screen
              <button onClick={() => setShowInstructions(false)} className="text-slate-400 text-lg leading-none">×</button>
            </div>
            <p><span className="font-medium">Android:</span> Tap the three-dot menu (⋮) in Chrome → <em>Add to Home Screen</em></p>
            <p><span className="font-medium">iPhone:</span> Tap the Share button (⎙) in Safari → <em>Add to Home Screen</em></p>
          </div>
        )}
      </div>
    </div>
  );
}

function IssueListItem({ issue, onSelect }) {
  const isPartial = issue.status === 'PARTIALLY_RECEIVED';
  return (
    <button
      onClick={() => onSelect(issue)}
      className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left active:bg-slate-50 transition-colors"
    >
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${isPartial ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
        <Truck size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm text-slate-900 truncate">{issue.material_name}</span>
          {isPartial && <Badge tone="amber">Partial</Badge>}
        </div>
        <div className="text-xs text-slate-500">{issue.issue_ref} · from {issue.from_warehouse_name}</div>
        <div className="text-xs text-slate-400 mt-0.5">Indent {issue.indent_ref} · {issue.issue_date}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-bold text-slate-900">{rcptToDisp(issue, issue.pending_qty ?? issue.issued_qty)}</div>
        <div className="text-xs text-slate-400">of {rcptToDisp(issue, issue.issued_qty)} {rcptDispUnit(issue)}</div>
      </div>
      <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
    </button>
  );
}

function ReceiptForm({ issue, token, onBack, onSubmitted }) {
  const [defaults, setDefaults] = useState(null);
  const [receivedQty, setReceivedQty] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [fcReason, setFcReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const client = api(token);
  const dispFactor = rcptDispFactor(issue);
  const unit = rcptDispUnit(issue);
  const expectedQtyBase = Number(defaults?.expected_qty ?? issue.pending_qty ?? issue.issued_qty);
  const expectedQty = rcptToDisp(issue, expectedQtyBase);

  useEffect(() => {
    client.receiptDefaults(issue.id).then((d) => {
      setDefaults(d);
      setReceivedQty(String(rcptToDisp(issue, d.suggested_received_qty ?? issue.pending_qty ?? issue.issued_qty)));
    }).catch(() => {
      setReceivedQty(String(rcptToDisp(issue, issue.pending_qty ?? issue.issued_qty)));
    });
  }, [issue.id]);

  const qty = Number(receivedQty) || 0;
  const hasEntry = receivedQty !== '';
  const isZero = hasEntry && qty === 0;
  const isExact = hasEntry && !isZero && Math.abs(qty - expectedQty) < 0.001;
  const isUnder = hasEntry && qty > 0 && qty < expectedQty - 0.001;
  const isOver = hasEntry && qty > expectedQty + 0.001;
  const needsRemark = hasEntry && !isExact;
  const canSubmit = hasEntry && (isExact || fcReason.trim()) && !submitting;

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        stock_issue_id: issue.id,
        received_qty: Math.round(qty * dispFactor),
        shortage_qty: 0,
        damage_qty: 0,
        receipt_date: receiptDate,
        expected_qty: Math.round(expectedQty * dispFactor),
      };
      if (!isExact) payload.force_complete_reason = fcReason.trim();
      const res = await client.confirmReceipt(payload);
      onSubmitted({ ...res, closed: !isExact });
    } catch (e) {
      setError(e.message || 'Failed to submit receipt. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium">
        <ArrowLeft size={16} /> Back to pending list
      </button>

      {/* Shipment summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Package size={18} />
          </div>
          <div>
            <div className="font-semibold text-slate-900">{issue.material_name}</div>
            <div className="text-xs text-slate-500">{issue.material_code} · {issue.issue_ref}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100">
          <div className="bg-slate-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-slate-400 mb-0.5">Dispatched</div>
            <div className="font-bold text-slate-900">{rcptToDisp(issue, issue.issued_qty)} {unit}</div>
          </div>
          <div className="bg-slate-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-slate-400 mb-0.5">From</div>
            <div className="font-bold text-slate-900 text-xs leading-tight">{issue.from_warehouse_name}</div>
          </div>
          <div className="bg-blue-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-blue-600 mb-0.5">Expected</div>
            <div className="font-bold text-blue-800">{expectedQty} {unit}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">

        {/* Editable received qty */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">
            Actual Received Qty ({unit}) <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={0} inputMode="decimal" step="any"
            value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)}
            className={`w-full px-3 py-2.5 border rounded-lg text-base font-medium focus:outline-none focus:ring-2 ${
              isExact ? 'border-green-400 bg-green-50 focus:ring-green-400 text-green-700'
              : needsRemark ? 'border-amber-400 bg-amber-50 focus:ring-amber-400 text-amber-700'
              : 'border-slate-300 focus:ring-blue-500'
            }`}
          />
          {isExact && <p className="text-xs text-green-700 mt-1">Qty matches dispatched amount.</p>}
          {isZero && <p className="text-xs text-amber-700 mt-1">Zero received — add a remark below. Issue will be closed with no stock credited.</p>}
          {isOver && <p className="text-xs text-amber-700 mt-1">Qty exceeds dispatched — add a remark below. Issue will be closed at this qty.</p>}
          {isUnder && <p className="text-xs text-amber-700 mt-1">Qty is less than dispatched — add a remark below. Issue will be closed at this qty.</p>}
        </div>

        {/* Receipt date */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Receipt Date</label>
          <input
            type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {needsRemark && (
          <div>
            <label className="text-xs font-medium text-amber-700 mb-1 block">
              Remark <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(required — qty differs from dispatched)</span>
            </label>
            <textarea
              rows={2} value={fcReason} onChange={(e) => setFcReason(e.target.value)}
              placeholder="e.g. Material damaged in transit, excess received vs challan"
              className="w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!hasEntry && <p className="text-xs text-slate-400 text-center">Enter a quantity to confirm receipt.</p>}
        {needsRemark && !fcReason.trim() && <p className="text-xs text-amber-600 text-center">Add a remark to continue.</p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 p-4">
        <div className="max-w-md mx-auto">
          <button onClick={handleSubmit} disabled={!canSubmit}
            className={`w-full py-4 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-40 ${needsRemark ? 'bg-amber-600 active:bg-amber-700' : 'bg-blue-600 active:bg-blue-700'}`}>
            {submitting ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {isZero ? 'Confirm Zero Receipt & Close Issue' : needsRemark ? 'Confirm Receipt & Close Issue' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ receiptInfo, onDone }) {
  const closed = receiptInfo.closed;
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${closed ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
        <CheckCircle2 size={32} />
      </div>
      <div>
        <div className="font-bold text-lg text-slate-900">{closed ? 'Receipt Confirmed & Issue Closed' : 'Receipt Confirmed'}</div>
        {receiptInfo.receipt_ref && <div className="text-sm text-slate-500 mt-1">{receiptInfo.receipt_ref}</div>}
      </div>
      <button onClick={onDone} className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium">
        Back to Pending List
      </button>
    </div>
  );
}

function ConsumptionHistory({ token, warehouseIds }) {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(sevenDaysAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`${BASE_URL}/api/v1/consumption/history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Error ${res.status}`);
      setRows(data.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Group rows by date for display
  const byDate = rows.reduce((acc, r) => {
    const d = r.consumption_date?.slice(0, 10);
    if (!acc[d]) acc[d] = [];
    acc[d].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Date filter */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-slate-500 mb-1 block">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-slate-500 mb-1 block">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800" />
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? '…' : 'Go'}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {!loading && rows.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-10">No consumption data for this period.</div>
      )}

      {Object.entries(byDate).map(([date, dateRows]) => (
        <div key={date} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-slate-100">
                <th className="px-4 py-2 text-left text-xs text-slate-500 font-medium">Material</th>
                <th className="px-4 py-2 text-right text-xs text-slate-500 font-medium">Consumed</th>
              </tr>
            </thead>
            <tbody>
              {dateRows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{r.material_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{r.material_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                    {rcptToDisp(r, r.qty_consumed)}
                    <span className="text-xs font-normal text-slate-400 ml-1">{rcptDispUnit(r)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function StockView({ token, warehouseId }) {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true); setError('');
      try {
        if (!token || !warehouseId) {
          setStock([
            { material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', on_hand_qty: '1211.000', weighted_avg_cost: '2.50', is_low_stock: false },
            { material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', on_hand_qty: '950.000', weighted_avg_cost: '12.00', is_low_stock: false },
            { material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', on_hand_qty: '0.000', weighted_avg_cost: '0.00', is_low_stock: true },
          ]);
          return;
        }
        const res = await fetch(`${BASE_URL}/api/v1/stock/current?warehouse_id=${warehouseId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        setStock(data.data ?? []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }
    load();
  }, [token, warehouseId]);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">My Stock</h2>
      {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}</div>}
      {loading ? <div className="text-center text-sm text-slate-400 py-10">Loading…</div> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 text-left">Material</th>
                <th className="px-3 py-2.5 text-right">On Hand</th>
                <th className="px-3 py-2.5 text-left">UOM</th>
                <th className="px-3 py-2.5 text-right">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {stock.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">No stock records</td></tr>}
              {stock.map((s, i) => {
                const dispQty = rcptToDisp(s, s.on_hand_qty);
                const dispUnit = rcptDispUnit(s);
                return (
                  <tr key={i} className={`border-t border-slate-100 ${s.is_low_stock ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">{s.material_name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1">
                        {s.material_code}
                        {s.is_low_stock && <span className="text-red-500 font-semibold">⚠ Below minimum</span>}
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold ${s.is_low_stock ? 'text-red-600' : 'text-slate-900'}`}>{dispQty}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{dispUnit}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">₹{Number(s.weighted_avg_cost ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReceiptApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('receive');
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [showTour, setShowTour] = useState(false);

  function finishTour() {
    setShowTour(false);
    if (user) { try { localStorage.setItem(`packtrack_tour_done_${user.role}`, '1'); } catch (_) {} }
  }

  const tourSteps = [
    { target: 'receipt-tabs', title: 'Welcome to the Receipt App', body: 'Three tabs: Receive (acknowledge incoming shipments), My Stock (current on-hand quantities), and Audit (full movement history).' },
    { target: 'pending-banner', title: 'Pending Shipments', body: 'This counter shows how many PM Store dispatches are waiting for your acknowledgement. Tap any shipment card below to open the receipt form.', onEnter: () => setTab('receive') },
    { target: 'pending-list', title: 'Shipment Cards', body: 'Each card is a dispatch from the PM Store. It shows the material, dispatched quantity, and source warehouse. Tap a card to open the receipt form.' },
    { target: null, title: 'Going Back', body: 'After opening a shipment, use the back arrow at the top to return to the pending list without making any changes.' },
    { target: null, title: 'Received Quantity', body: 'Enter the actual quantity you received. If it matches the dispatched qty exactly, Confirm Receipt activates. If it\'s less, Force Complete appears instead.' },
    { target: null, title: 'Confirm Receipt', body: 'Active only when received qty matches dispatched qty exactly. Closes the shipment and credits your facility\'s on-hand stock.' },
    { target: null, title: 'Short-Received?', body: 'If you received less than dispatched (damaged goods, short delivery), enter the reason here. The Force Complete button then becomes available.' },
    { target: null, title: 'Force Complete', body: 'Closes the shipment with the qty you actually received. The shortfall is recorded in the audit log. Contact the PM Store to raise a discrepancy claim if needed.' },
    { target: 'receipt-refresh', title: 'Refresh', body: 'Pulls the latest pending shipments from the server. Tap this if you\'re expecting a new shipment that hasn\'t appeared yet.' },
    { target: 'tour-btn-receipt', title: "You're all set!", body: 'Hit the ? button at the bottom-right any time to replay this tour.' },
  ];

  function handleLogin(t, u) {
    setToken(t);
    setUser(u);
    let tourDone = false; try { tourDone = !!localStorage.getItem(`packtrack_tour_done_${u.role}`); } catch (_) {}
    if (!tourDone) setShowTour(true);
  }

  const refresh = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setFetchError('');
    try {
      const warehouseId = user.warehouse_ids?.[0];
      let url = '/api/v1/stock-issues?status=DISPATCHED';
      if (warehouseId) url += `&to_warehouse_id=${warehouseId}`;
      const res = await fetch(`${BASE_URL}${url}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const rows = Array.isArray(data) ? data : data.data ?? data.rows ?? [];
      setIssues(rows.filter((i) => ['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(i.status)));
    } catch (e) {
      setFetchError(e.message || 'Failed to load pending shipments');
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!token) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-slate-50 max-w-md mx-auto">
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">Receive Stock</div>
            <div className="text-xs text-slate-500">{user?.name || user?.email}</div>
          </div>
          <div className="flex items-center gap-1">
            <button data-tour="receipt-refresh" onClick={refresh} className="p-2 text-slate-400 active:text-slate-600">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => { setToken(null); setUser(null); setIssues([]); }} className="p-2 text-slate-400 active:text-slate-600">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div data-tour="receipt-tabs" className="flex gap-1 bg-slate-100 rounded-lg p-1 mx-4 mt-3">
        <button onClick={() => setTab('receive')} className={`flex-1 py-3 rounded-md text-sm font-medium ${tab === 'receive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Receive</button>
        <button onClick={() => setTab('stock')} className={`flex-1 py-3 rounded-md text-sm font-medium ${tab === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>My Stock</button>
        <button onClick={() => setTab('consumption')} className={`flex-1 py-3 rounded-md text-sm font-medium ${tab === 'consumption' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Consumption</button>
        <button onClick={() => setTab('audit')} className={`flex-1 py-3 rounded-md text-sm font-medium ${tab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Audit</button>
      </div>

      <div className="p-4 space-y-3">
        {tab === 'audit' ? (
          <AuditScreen token={token} warehouseId={user?.warehouse_ids?.[0]} />
        ) : tab === 'consumption' ? (
          <ConsumptionHistory token={token} warehouseIds={user?.warehouse_ids} />
        ) : tab === 'stock' ? (
          <StockView token={token} warehouseId={user?.warehouse_ids?.[0]} />
        ) : successInfo ? (
          <SuccessScreen receiptInfo={successInfo} onDone={() => { setSuccessInfo(null); setSelected(null); refresh(); }} />
        ) : selected ? (
          <ReceiptForm
            issue={selected}
            token={token}
            onBack={() => setSelected(null)}
            onSubmitted={(info) => setSuccessInfo(info)}
          />
        ) : (
          <>
            <div data-tour="pending-banner" className="bg-blue-600 rounded-xl p-4 text-white flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-100 mb-0.5">Pending receipt</div>
                <div className="text-2xl font-bold">{issues.length} shipment{issues.length === 1 ? '' : 's'}</div>
              </div>
              <Clock size={28} className="text-blue-200" />
            </div>

            {fetchError && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{fetchError}</span>
              </div>
            )}

            {loading ? (
              <div className="text-center text-sm text-slate-400 py-12">Loading pending shipments...</div>
            ) : issues.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 size={32} className="text-green-400 mx-auto mb-2" />
                <div className="text-sm text-slate-500">All caught up — nothing pending receipt.</div>
              </div>
            ) : (
              <div data-tour="pending-list" className="space-y-2">
                {issues.map((issue) => (
                  <IssueListItem key={issue.id} issue={issue} onSelect={setSelected} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button
        data-tour="tour-btn-receipt"
        onClick={() => setShowTour(true)}
        className="fixed bottom-28 right-4 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center text-lg font-bold hover:bg-blue-700 z-50"
        title="Open guided tour"
      >?</button>

      {showTour && <TourOverlay steps={tourSteps} onDone={finishTour} />}
    </div>
  );
}
