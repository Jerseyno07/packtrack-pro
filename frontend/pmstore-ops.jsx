import { useState, useEffect, useCallback } from 'react';
import { Package, CheckCircle2, AlertTriangle, Truck, FileText, ChevronRight, ArrowLeft, RefreshCw, LogIn, LogOut, Zap } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

function makeApi(token) {
  async function req(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  }
  return {
    login: (email, password) => req('POST', '/api/v1/auth/login', { email, password }),
    listOpenPOs: () => req('GET', '/api/v1/purchase-orders?status=OPEN'),
    listPendingIndents: () => req('GET', '/api/v1/indent-lines?status=PENDING'),
    issueDefaults: (indentLineId) => req('GET', `/api/v1/indent-lines/${indentLineId}/issue-defaults`),
    postGRN: (payload) => req('POST', '/api/v1/goods-receipts', payload),
    postIssue: (payload) => req('POST', '/api/v1/stock-issues', payload),
    forcePO: (id, reason) => req('POST', `/api/v1/purchase-orders/${id}/force-complete`, { reason }),
    forceIndent: (id, reason) => req('POST', `/api/v1/indent-lines/${id}/force-complete`, { reason }),
  };
}

function Badge({ children, tone = 'gray' }) {
  const tones = { gray: 'bg-slate-100 text-slate-600', blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700' };
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
      const data = await makeApi(null).login(email.trim(), password);
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
          <div className="font-bold text-xl text-slate-900">PM Store Ops</div>
          <div className="text-sm text-slate-500 mt-1">PackTrack Pro</div>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ForceCompletePanel({ onForce, submitting, error }) {
  const [show, setShow] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4 space-y-3">
      <button onClick={() => setShow((v) => !v)} className="w-full flex items-center gap-2 text-sm font-semibold text-amber-700">
        <Zap size={16} /> Force Complete
        <span className="ml-auto text-xs font-normal text-slate-400">{show ? 'hide' : 'expand'}</span>
      </button>
      {show && (
        <>
          <p className="text-xs text-slate-500">Permanently closes this record with no further transactions allowed. Cannot be undone.</p>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for force completing…"
            className="w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}
            </div>
          )}
          <button onClick={() => onForce(reason)} disabled={submitting || !reason.trim()}
            className="w-full py-2.5 bg-amber-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
            {submitting ? 'Processing...' : 'Force Complete'}
          </button>
        </>
      )}
    </div>
  );
}

// ── GRN screen ───────────────────────────────────────────────────────────────
function GRNScreen({ api }) {
  const [openPOs, setOpenPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selectedPO, setSelectedPO] = useState(null);
  const [qty, setQty] = useState('');
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState('');
  const [hasInvoice, setHasInvoice] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [fcSubmitting, setFcSubmitting] = useState(false);
  const [fcError, setFcError] = useState('');

  const loadPOs = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const data = await api.listOpenPOs();
      setOpenPOs(Array.isArray(data) ? data : data.rows ?? []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load open POs');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadPOs(); }, [loadPOs]);

  async function submit() {
    setError('');
    const q = Number(qty);
    if (!selectedPO) return;
    if (!q || q <= 0) { setError('Enter a valid GRN quantity.'); return; }
    const remaining = Number(selectedPO.remaining_qty ?? selectedPO.po_qty);
    if (q > remaining) { setError(`GRN qty exceeds remaining PO qty (${remaining}).`); return; }
    if (!hasInvoice) { setError('Invoice copy attachment is mandatory.'); return; }
    setSubmitting(true);
    try {
      const res = await api.postGRN({ po_id: selectedPO.id, grn_qty: q, grn_date: grnDate, invoice_no: invoiceNo, has_invoice_attachment: hasInvoice });
      setSuccess(res);
    } catch (e) {
      setError(e.message || 'Failed to post GRN.');
    } finally { setSubmitting(false); }
  }

  async function handleForce(reason) {
    setFcError('');
    setFcSubmitting(true);
    try {
      await api.forcePO(selectedPO.id, reason);
      setSuccess({ grn_ref: 'FORCE_COMPLETED', forced: true });
    } catch (e) {
      setFcError(e.message || 'Force complete failed.');
    } finally { setFcSubmitting(false); }
  }

  if (success) {
    return (
      <div className="text-center py-16">
        {success.forced ? <Zap size={40} className="text-amber-500 mx-auto mb-3" /> : <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />}
        <div className="font-bold text-lg text-slate-900">{success.forced ? 'PO Force Completed' : 'GRN Posted'}</div>
        {!success.forced && <div className="text-sm text-slate-500 mt-1">{success.grn_ref}</div>}
        <button onClick={() => { setSuccess(null); setSelectedPO(null); setQty(''); setHasInvoice(false); setInvoiceNo(''); loadPOs(); }}
          className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          {success.forced ? 'Back to PO List' : 'Post Another GRN'}
        </button>
      </div>
    );
  }

  if (!selectedPO) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-slate-900">Post GRN</h2><p className="text-sm text-slate-500">Select an open PO to receive stock against.</p></div>
          <button onClick={loadPOs} className="p-2 text-slate-400"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {fetchError && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{fetchError}</div>}
        {loading ? <div className="text-center text-sm text-slate-400 py-8">Loading open POs…</div> : (
          <div className="space-y-2">
            {openPOs.length === 0 && <div className="text-center text-sm text-slate-500 py-8">No open POs found.</div>}
            {openPOs.map((po) => {
              const remaining = Number(po.remaining_qty ?? po.po_qty);
              return (
                <button key={po.id} onClick={() => { setSelectedPO(po); setQty(String(remaining)); }} className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-blue-300 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0"><Truck size={18} /></div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-slate-900">{po.po_no} <span className="text-slate-400">· {po.vendor_name}</span></div>
                    <div className="text-xs text-slate-500">{po.material_code} — {po.material_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900">{remaining}</div>
                    <div className="text-xs text-slate-400">remaining of {po.po_qty}</div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const remaining = Number(selectedPO.remaining_qty ?? selectedPO.po_qty);
  const actualQty = Number(qty) || 0;
  const variance = actualQty - remaining;

  return (
    <div className="space-y-4 max-w-xl">
      <button onClick={() => setSelectedPO(null)} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium"><ArrowLeft size={15} /> Back</button>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="font-semibold text-slate-900">{selectedPO.po_no} <Badge tone="blue">{selectedPO.vendor_name}</Badge></div>
          <div className="text-sm text-slate-500 mt-0.5">{selectedPO.material_code} — {selectedPO.material_name}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-lg p-3 text-sm">
          <div><div className="text-xs text-slate-400">Expected (remaining)</div><div className="font-bold text-slate-900">{remaining}</div></div>
          <div>
            <div className="text-xs text-slate-400">Variance</div>
            <div className={`font-bold ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {variance === 0 ? '0 (exact)' : variance > 0 ? `+${variance} over` : `${variance} short`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Actual GRN Qty <span className="text-red-500">*</span></label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">GRN Date</label>
            <input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Invoice Number</label>
          <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={hasInvoice} onChange={(e) => setHasInvoice(e.target.checked)} className="w-4 h-4" />
          Invoice copy attached <span className="text-red-500">*</span>
        </label>
        {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}</div>}
        <button onClick={submit} disabled={submitting} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
          {submitting ? 'Posting...' : 'Post GRN'}
        </button>
      </div>

      <ForceCompletePanel onForce={handleForce} submitting={fcSubmitting} error={fcError} />
    </div>
  );
}

// ── Issue screen ─────────────────────────────────────────────────────────────
function IssueScreen({ api }) {
  const [pendingIndents, setPendingIndents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selectedIndent, setSelectedIndent] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [qty, setQty] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [fcSubmitting, setFcSubmitting] = useState(false);
  const [fcError, setFcError] = useState('');

  const loadIndents = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const data = await api.listPendingIndents();
      setPendingIndents(Array.isArray(data) ? data : data.rows ?? []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load pending indents');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadIndents(); }, [loadIndents]);

  async function selectIndent(ind) {
    setSelectedIndent(ind);
    setDefaults(null);
    try {
      const d = await api.issueDefaults(ind.id);
      setDefaults(d);
      setQty(String(d.suggested_actual_qty ?? d.expected_qty ?? ind.pending_qty));
    } catch {
      setQty(String(ind.pending_qty ?? ind.requested_qty));
    }
  }

  async function submit() {
    setError('');
    const q = Number(qty);
    if (!selectedIndent) return;
    if (!q || q <= 0) { setError('Enter a valid issue quantity.'); return; }
    const pending = Number(selectedIndent.pending_qty ?? selectedIndent.requested_qty);
    if (q > pending) { setError(`Exceeds pending indent qty (${pending}).`); return; }
    if (defaults && q > Number(defaults.on_hand_qty)) {
      setError(`Insufficient PM Store stock (available ${defaults.on_hand_qty}).`); return;
    }
    setSubmitting(true);
    try {
      const res = await api.postIssue({
        indent_line_id: selectedIndent.id,
        issued_qty: q,
        issue_date: issueDate,
        vehicle_no: vehicleNo || undefined,
        expected_qty: defaults?.expected_qty,
      });
      setSuccess(res);
    } catch (e) {
      setError(e.message || 'Failed to dispatch stock.');
    } finally { setSubmitting(false); }
  }

  async function handleForce(reason) {
    setFcError('');
    setFcSubmitting(true);
    try {
      await api.forceIndent(selectedIndent.id, reason);
      setSuccess({ issue_ref: 'FORCE_COMPLETED', forced: true });
    } catch (e) {
      setFcError(e.message || 'Force complete failed.');
    } finally { setFcSubmitting(false); }
  }

  if (success) {
    return (
      <div className="text-center py-16">
        {success.forced ? <Zap size={40} className="text-amber-500 mx-auto mb-3" /> : <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />}
        <div className="font-bold text-lg text-slate-900">{success.forced ? 'Indent Line Force Completed' : 'Stock Issued'}</div>
        {!success.forced && <div className="text-sm text-slate-500 mt-1">{success.issue_ref}</div>}
        <button onClick={() => { setSuccess(null); setSelectedIndent(null); setDefaults(null); setQty(''); setVehicleNo(''); loadIndents(); }}
          className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          {success.forced ? 'Back to Indent List' : 'Issue Another'}
        </button>
      </div>
    );
  }

  if (!selectedIndent) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-slate-900">Issue Against Indent</h2><p className="text-sm text-slate-500">Select a pending indent line to dispatch stock.</p></div>
          <button onClick={loadIndents} className="p-2 text-slate-400"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {fetchError && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{fetchError}</div>}
        {loading ? <div className="text-center text-sm text-slate-400 py-8">Loading pending indents…</div> : (
          <div className="space-y-2">
            {pendingIndents.length === 0 && <div className="text-center text-sm text-slate-500 py-8">No pending indents found.</div>}
            {pendingIndents.map((ind) => (
              <button key={ind.id} onClick={() => selectIndent(ind)} className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-blue-300 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-slate-900">{ind.indent_ref} <span className="text-slate-400">· {ind.warehouse_name}</span></div>
                  <div className="text-xs text-slate-500">{ind.material_code} — {ind.material_name}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-amber-600">{ind.pending_qty ?? ind.requested_qty}</div>
                  <div className="text-xs text-slate-400">pending of {ind.requested_qty}</div>
                </div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const pending = Number(selectedIndent.pending_qty ?? selectedIndent.requested_qty);
  const actualQty = Number(qty) || 0;
  const expectedQty = defaults ? Number(defaults.expected_qty) : pending;
  const variance = actualQty - expectedQty;

  return (
    <div className="space-y-4 max-w-xl">
      <button onClick={() => setSelectedIndent(null)} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium"><ArrowLeft size={15} /> Back</button>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="font-semibold text-slate-900">{selectedIndent.indent_ref} <Badge tone="amber">{selectedIndent.warehouse_name}</Badge></div>
          <div className="text-sm text-slate-500 mt-0.5">{selectedIndent.material_code} — {selectedIndent.material_name}</div>
        </div>

        <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-lg p-3 text-sm">
          <div><div className="text-xs text-slate-400">Expected (pending)</div><div className="font-bold text-slate-900">{expectedQty}</div></div>
          <div>
            <div className="text-xs text-slate-400">On Hand (PM Store)</div>
            <div className={`font-bold ${defaults && Number(defaults.on_hand_qty) < expectedQty ? 'text-red-600' : 'text-slate-900'}`}>
              {defaults ? defaults.on_hand_qty : '…'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Variance</div>
            <div className={`font-bold ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {variance === 0 ? '0 (exact)' : variance > 0 ? `+${variance}` : `${variance}`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Actual Issue Qty <span className="text-red-500">*</span></label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Issue Date</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Vehicle No.</label>
          <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="Optional" className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}</div>}
        <button onClick={submit} disabled={submitting} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60">
          {submitting ? 'Dispatching...' : 'Confirm Issue'}
        </button>
      </div>

      <ForceCompletePanel onForce={handleForce} submitting={fcSubmitting} error={fcError} />
    </div>
  );
}

export default function PMStoreOps() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('grn');

  if (!token) {
    return <LoginScreen onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  }

  const client = makeApi(token);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
            <span className="font-bold text-slate-900">PM Store Ops</span>
            <span className="text-xs text-slate-400">· {user?.name || user?.email}</span>
          </div>
          <button onClick={() => { setToken(null); setUser(null); }} className="p-2 text-slate-400 hover:text-slate-600">
            <LogOut size={18} />
          </button>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-5">
          <button onClick={() => setTab('grn')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'grn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Post GRN</button>
          <button onClick={() => setTab('issue')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'issue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Issue Against Indent</button>
        </div>
        {tab === 'grn' ? <GRNScreen api={client} /> : <IssueScreen api={client} />}
      </div>
    </div>
  );
}
