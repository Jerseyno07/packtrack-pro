import { useState, useEffect, useMemo, useCallback } from 'react';
import { Truck, Package, CheckCircle2, AlertTriangle, Clock, ChevronRight, ArrowLeft, RefreshCw, LogIn, LogOut, Zap } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

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
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-60"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
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
        <div className="font-bold text-slate-900">{issue.pending_qty ?? issue.issued_qty}</div>
        <div className="text-xs text-slate-400">of {issue.issued_qty} {issue.unit}</div>
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
  const expectedQty = Number(defaults?.expected_qty ?? issue.pending_qty ?? issue.issued_qty);

  useEffect(() => {
    client.receiptDefaults(issue.id).then((d) => {
      setDefaults(d);
      setReceivedQty(String(d.suggested_received_qty ?? issue.pending_qty ?? issue.issued_qty));
    }).catch(() => {
      setReceivedQty(String(issue.pending_qty ?? issue.issued_qty));
    });
  }, [issue.id]);

  const qty = Number(receivedQty) || 0;
  const isExact = qty === expectedQty;
  const isUnder = qty > 0 && qty < expectedQty;
  const isOver = qty > expectedQty;

  const canConfirm = isExact && !submitting;
  const canForce = isUnder && fcReason.trim().length > 0 && !submitting;

  async function handleConfirm() {
    setError('');
    setSubmitting(true);
    try {
      const res = await client.confirmReceipt({
        stock_issue_id: issue.id,
        received_qty: qty,
        shortage_qty: 0,
        damage_qty: 0,
        receipt_date: receiptDate,
        expected_qty: expectedQty,
      });
      onSubmitted(res);
    } catch (e) {
      setError(e.message || 'Failed to submit receipt. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForceComplete() {
    setError('');
    setSubmitting(true);
    try {
      await client.forceComplete(issue.id, fcReason.trim());
      onSubmitted({ receipt_ref: 'FORCE_COMPLETED', forced: true });
    } catch (e) {
      setError(e.message || 'Force complete failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
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
            <div className="font-bold text-slate-900">{issue.issued_qty}</div>
          </div>
          <div className="bg-slate-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-slate-400 mb-0.5">From</div>
            <div className="font-bold text-slate-900 text-xs leading-tight">{issue.from_warehouse_name}</div>
          </div>
          <div className="bg-blue-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-blue-600 mb-0.5">Expected</div>
            <div className="font-bold text-blue-800">{expectedQty} {issue.unit}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">

        {/* Editable received qty */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">
            Actual Received Qty <span className="text-red-500">*</span>
          </label>
          <input
            type="number" min={1} max={expectedQty} inputMode="decimal"
            value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)}
            className={`w-full px-3 py-2.5 border rounded-lg text-base font-medium focus:outline-none focus:ring-2 ${
              isOver    ? 'border-red-400 bg-red-50 focus:ring-red-400 text-red-700'
              : isExact ? 'border-green-400 bg-green-50 focus:ring-green-400 text-green-700'
              : isUnder ? 'border-amber-400 bg-amber-50 focus:ring-amber-400 text-amber-700'
              : 'border-slate-300 focus:ring-blue-500'
            }`}
          />
          {isOver && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
              <AlertTriangle size={12} /> Cannot receive more than dispatched qty. Max: {expectedQty}
            </p>
          )}
          {isExact && <p className="text-xs text-green-700 mt-1">Qty matches — Confirm Receipt enabled.</p>}
          {isUnder && <p className="text-xs text-amber-700 mt-1">Qty is less than expected — only Force Complete is allowed.</p>}
        </div>

        {/* Receipt date */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Receipt Date</label>
          <input
            type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* FC reason — only when under */}
        {isUnder && (
          <div>
            <label className="text-xs font-medium text-amber-700 mb-1 block">
              Force Complete Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={2} value={fcReason} onChange={(e) => setFcReason(e.target.value)}
              placeholder="e.g. Material damaged in transit, balance waived off"
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

        {/* Side-by-side action buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="py-2.5 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:bg-blue-700"
          >
            {submitting && isExact ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Confirm Receipt
          </button>
          <button
            onClick={handleForceComplete}
            disabled={!canForce}
            className="py-2.5 bg-amber-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:bg-amber-700"
          >
            {submitting && isUnder ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
            Force Complete
          </button>
        </div>

        {isOver && <p className="text-xs text-red-500 text-center">Both actions disabled — qty exceeds dispatched.</p>}
        {!isOver && !isExact && !isUnder && <p className="text-xs text-slate-400 text-center">Enter a quantity to enable actions.</p>}
      </div>
    </div>
  );
}

function SuccessScreen({ receiptInfo, onDone }) {
  const forced = receiptInfo.forced;
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${forced ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
        {forced ? <Zap size={32} /> : <CheckCircle2 size={32} />}
      </div>
      <div>
        <div className="font-bold text-lg text-slate-900">{forced ? 'Issue Force Completed' : 'Receipt Confirmed'}</div>
        {!forced && <div className="text-sm text-slate-500 mt-1">{receiptInfo.receipt_ref}</div>}
      </div>
      <button onClick={onDone} className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium">
        Back to Pending List
      </button>
    </div>
  );
}

export default function ReceiptApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);
  const [fetchError, setFetchError] = useState('');

  function handleLogin(t, u) {
    setToken(t);
    setUser(u);
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
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="p-2 text-slate-400 active:text-slate-600">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => { setToken(null); setUser(null); setIssues([]); }} className="p-2 text-slate-400 active:text-slate-600">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {successInfo ? (
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
            <div className="bg-blue-600 rounded-xl p-4 text-white flex items-center justify-between">
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
              <div className="space-y-2">
                {issues.map((issue) => (
                  <IssueListItem key={issue.id} issue={issue} onSelect={setSelected} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
