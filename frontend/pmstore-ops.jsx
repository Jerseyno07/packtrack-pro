import { useState, useEffect, useCallback } from 'react';
import { Package, CheckCircle2, AlertTriangle, Truck, FileText, ChevronRight, ArrowLeft, RefreshCw, LogIn, LogOut, Zap, ImagePlus, MonitorSmartphone } from 'lucide-react';

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

function poDispFactor(po) {
  if (po.meters_per_unit) return Number(po.meters_per_unit);
  if (po.stickers_per_roll) return Number(po.stickers_per_roll);
  return 1;
}
function poDispUnit(po) {
  return (po.meters_per_unit || po.stickers_per_roll) ? 'rolls' : (po.unit ?? '');
}
function poToDisp(po, baseQty) {
  const factor = poDispFactor(po);
  return factor > 1 ? parseFloat((Number(baseQty) / factor).toFixed(2)) : Number(baseQty);
}

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
    listOpenPOs: () => req('GET', '/api/v1/purchase-orders?status=OPEN,PARTIALLY_RECEIVED'),
    pendingByFacility: () => req('GET', '/api/v1/indents/pending-by-facility'),
    batchIssue: (payload) => req('POST', '/api/v1/stock-issues/batch', payload),
    postGRN: (payload) => req('POST', '/api/v1/goods-receipts', payload),
    postIssue: (payload) => req('POST', '/api/v1/stock-issues', payload),
    forcePO: (id, reason) => req('POST', `/api/v1/purchase-orders/${id}/force-complete`, { reason }),
    forceIndent: (id, reason) => req('POST', `/api/v1/indent-lines/${id}/force-complete`, { reason }),
    uploadGrnImage: async (grnId, imageFile) => {
      const fd = new FormData();
      fd.append('invoice_image', imageFile);
      const res = await fetch(`${BASE_URL}/api/v1/goods-receipts/${grnId}/invoice-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Image upload failed');
      return data;
    },
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
  const { canInstall, install, showInstructions, setShowInstructions } = useInstallPrompt();

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
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
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

function ForceCompletePanel({ onForce, submitting, error, hint }) {
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
          <p className="text-xs text-slate-500">{hint ?? 'Permanently closes this record with no further transactions allowed. Cannot be undone.'}</p>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for force completing…"
            className="w-full px-3 py-3 border border-amber-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}
            </div>
          )}
          <button onClick={() => onForce(reason)} disabled={submitting || !reason.trim()}
            className="w-full py-4 bg-amber-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
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
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState('');
  const [inwardQty, setInwardQty] = useState('');
  const [fcReason, setFcReason] = useState('');
  const [invoiceImage, setInvoiceImage] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  const loadPOs = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const data = await api.listOpenPOs();
      setOpenPOs(Array.isArray(data) ? data : data.data ?? data.rows ?? []);
    } catch (e) {
      setFetchError(e.message || 'Failed to load open POs');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadPOs(); }, [loadPOs]);

  function selectPO(po) {
    setSelectedPO(po);
    const remaining = Number(po.remaining_qty ?? po.po_qty);
    setInwardQty(String(poToDisp(po, remaining)));
    setFcReason('');
    setInvoiceImage(null);
    setInvoiceNo('');
    setError('');
  }

  function resetForm() {
    setSuccess(null);
    setSelectedPO(null);
    setInwardQty('');
    setFcReason('');
    setInvoiceImage(null);
    setInvoiceNo('');
    setError('');
    loadPOs();
  }

  async function submitGRN() {
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        po_id: selectedPO.id,
        grn_qty: Math.round(qty * poDispFactor(selectedPO)),
        grn_date: grnDate,
        invoice_no: invoiceNo,
        has_invoice_attachment: !!invoiceImage,
      };
      if (!isExact) payload.force_complete_reason = fcReason;
      const res = await api.postGRN(payload);
      if (invoiceImage && res.id) {
        try { await api.uploadGrnImage(res.id, invoiceImage); } catch (_) {}
      }
      setSuccess({ grn_ref: res.grn_ref ?? res.id, closed: !isExact });
    } catch (e) {
      setError(e.message || 'Failed to post GRN.');
    } finally { setSubmitting(false); }
  }

  if (success) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={40} className={`mx-auto mb-3 ${success.closed ? 'text-amber-500' : 'text-green-500'}`} />
        <div className="font-bold text-lg text-slate-900">{success.closed ? 'GRN Posted & PO Closed' : 'GRN Posted'}</div>
        <div className="text-sm text-slate-500 mt-1">{success.grn_ref}</div>
        <button onClick={resetForm} className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          Post Another GRN
        </button>
      </div>
    );
  }

  if (!selectedPO) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-slate-900">Post GRN</h2><p className="text-sm text-slate-500">Select a PO line to receive stock against. A PO with multiple materials appears as one card per material.</p></div>
          <button onClick={loadPOs} className="p-2 text-slate-400"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {fetchError && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{fetchError}</div>}
        {loading ? <div className="text-center text-sm text-slate-400 py-8">Loading open POs…</div> : (
          <div data-tour="grn-po-list" className="space-y-2">
            {openPOs.length === 0 && <div className="text-center text-sm text-slate-500 py-8">No open POs found.</div>}
            {openPOs.map((po) => {
              const remaining = poToDisp(po, Number(po.remaining_qty ?? po.po_qty));
              const unit = poDispUnit(po);
              const isPartial = po.status === 'PARTIALLY_RECEIVED';
              const cardCls = isPartial
                ? 'w-full bg-amber-50 rounded-xl border border-amber-200 p-4 flex items-center gap-3 text-left hover:border-amber-400 transition-colors'
                : 'w-full bg-green-50 rounded-xl border border-green-200 p-4 flex items-center gap-3 text-left hover:border-green-400 transition-colors';
              const iconCls = isPartial
                ? 'w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0'
                : 'w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0';
              return (
                <button key={po.id} onClick={() => selectPO(po)} className={cardCls}>
                  <div className={iconCls}><Truck size={18} /></div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-slate-900">{po.po_no} <span className="text-slate-400">· {po.vendor_name}</span></div>
                    <div className="text-xs text-slate-500">{po.material_code} — {po.material_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900">{remaining} {unit}</div>
                    <div className="text-xs text-slate-400">remaining of {poToDisp(po, po.po_qty)} {unit}</div>
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

  const remainingBase = Number(selectedPO.remaining_qty ?? selectedPO.po_qty);
  const remaining = poToDisp(selectedPO, remainingBase);
  const qty = Number(inwardQty) || 0;
  const isExact = Math.abs(qty - remaining) < 0.001;
  const isUnder = qty > 0 && qty < remaining - 0.001;
  const isOver = qty > remaining + 0.001;

  const needsRemark = qty > 0 && !isExact;
  const canGRN = qty > 0 && (isExact || fcReason.trim()) && !submitting;

  return (
    <div className="space-y-4 pb-32">
      <button onClick={() => setSelectedPO(null)} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium"><ArrowLeft size={15} /> Back</button>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="font-semibold text-slate-900">{selectedPO.po_no} <Badge tone="blue">{selectedPO.vendor_name}</Badge></div>
          <div className="text-sm text-slate-500 mt-0.5">{selectedPO.material_code} — {selectedPO.material_name}</div>
        </div>

        {/* PO quantity summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-slate-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-slate-400 mb-0.5">PO Qty</div>
            <div className="font-bold text-slate-900">{poToDisp(selectedPO, selectedPO.po_qty)} {poDispUnit(selectedPO)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-slate-400 mb-0.5">Already Received</div>
            <div className="font-bold text-slate-900">{poToDisp(selectedPO, selectedPO.received_qty_cache ?? 0)} {poDispUnit(selectedPO)}</div>
          </div>
          <div className="bg-blue-50 rounded-lg py-2.5 px-2">
            <div className="text-xs text-blue-600 mb-0.5">Remaining</div>
            <div className="font-bold text-blue-800">{remaining} {poDispUnit(selectedPO)}</div>
          </div>
        </div>

        {/* Editable inward qty */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">
            Actual Inward Qty ({poDispUnit(selectedPO)}) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={0.01}
            step="any"
            value={inwardQty}
            onChange={(e) => setInwardQty(e.target.value)}
            className={`w-full px-3 py-3 border rounded-lg text-base focus:outline-none focus:ring-2 font-medium ${
              isExact ? 'border-green-400 bg-green-50 focus:ring-green-400 text-green-700'
              : needsRemark ? 'border-amber-400 bg-amber-50 focus:ring-amber-400 text-amber-700'
              : 'border-slate-300 focus:ring-blue-500'
            }`}
          />
          {isExact && (
            <p className="text-xs text-green-700 mt-1">Inward qty matches remaining PO qty.</p>
          )}
          {isOver && (
            <p className="text-xs text-amber-700 mt-1">Qty exceeds PO — a remark is required. PO will be closed at this qty.</p>
          )}
          {isUnder && (
            <p className="text-xs text-amber-700 mt-1">Qty is less than PO remaining — add a remark below. PO will be closed at this qty.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">GRN Date</label>
            <input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Invoice Number</label>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Invoice image upload */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block flex items-center gap-1">
            <ImagePlus size={13} /> Invoice Image
          </label>
          <label className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer text-sm transition-colors ${invoiceImage ? 'border-green-400 bg-green-50 text-green-700' : 'border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600'}`}>
            <ImagePlus size={15} />
            {invoiceImage ? invoiceImage.name : 'Click to attach invoice image (JPG / PNG / PDF)'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setInvoiceImage(e.target.files?.[0] ?? null)} />
          </label>
          {invoiceImage && (
            <button onClick={() => setInvoiceImage(null)} className="text-xs text-slate-400 mt-1 hover:text-red-500">Remove</button>
          )}
        </div>

        {needsRemark && (
          <div>
            <label className="text-xs font-medium text-amber-700 mb-1 block">
              Remark <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(required — qty differs from PO)</span>
            </label>
            <textarea
              rows={2}
              value={fcReason}
              onChange={(e) => setFcReason(e.target.value)}
              placeholder="Reason for the difference…"
              className="w-full px-3 py-3 border border-amber-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}
          </div>
        )}

      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 p-4">
        <div className="max-w-lg mx-auto space-y-2">
          {qty === 0 && <p className="text-xs text-center text-slate-400">Enter a quantity to enable posting.</p>}
          {needsRemark && !fcReason.trim() && <p className="text-xs text-center text-amber-600">Add a remark to continue.</p>}
          <button onClick={submitGRN} disabled={!canGRN}
            className={`w-full py-4 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-40 ${needsRemark ? 'bg-amber-600 active:bg-amber-700' : 'bg-blue-600 active:bg-blue-700'}`}>
            {submitting ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {needsRemark ? 'Post GRN & Close PO' : 'Post GRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function dispUnit(l) { return (l.stickers_per_roll || l.meters_per_unit) ? 'rolls' : l.unit; }
function toDisp(l, base) {
  const n = Number(base);
  if (l.stickers_per_roll) return Math.round((n / Number(l.stickers_per_roll)) * 1000) / 1000;
  if (l.meters_per_unit) return parseFloat((n / Number(l.meters_per_unit)).toFixed(2));
  return n;
}
function toBase(l, disp) {
  const n = Number(disp) || 0;
  if (l.stickers_per_roll) return Math.round(n * Number(l.stickers_per_roll));
  if (l.meters_per_unit) return Math.round(n * Number(l.meters_per_unit));
  return n;
}

// ── Issue screen ─────────────────────────────────────────────────────────────
function IssueScreen({ api }) {
  const today = new Date().toISOString().slice(0, 10);
  const [allLines, setAllLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selectedFacilityId, setSelectedFacilityId] = useState(null);
  const [lineQtys, setLineQtys] = useState({});
  const [issueDate, setIssueDate] = useState(today);
  const [vehicleNo, setVehicleNo] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [dispatched, setDispatched] = useState(null);
  const [dispatchRemark, setDispatchRemark] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setFetchError('');
    try {
      const data = await api.pendingByFacility();
      const lines = Array.isArray(data) ? data : data.data ?? [];
      setAllLines(lines);
      const qtys = {};
      for (const l of lines) {
        const pendingDisp = toDisp(l, l.pending_qty);
        const pmStockDisp = toDisp(l, l.pm_on_hand_qty);
        qtys[l.id] = String(Math.min(pendingDisp, Math.max(0, pmStockDisp)));
      }
      setLineQtys(qtys);
    } catch (e) {
      setFetchError(e.message || 'Failed to load pending indents');
    } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Group lines by facility
  const facilities = [];
  const facMap = new Map();
  for (const line of allLines) {
    if (!facMap.has(line.warehouse_id)) {
      const fac = { warehouse_id: line.warehouse_id, warehouse_name: line.warehouse_name, warehouse_code: line.warehouse_code, lines: [] };
      facMap.set(line.warehouse_id, fac);
      facilities.push(fac);
    }
    facMap.get(line.warehouse_id).lines.push(line);
  }

  const selectedFacility = facMap.get(selectedFacilityId) ?? null;

  function setQty(lineId, val) {
    setLineQtys((prev) => ({ ...prev, [lineId]: val }));
  }

  async function dispatch() {
    const items = (selectedFacility?.lines ?? [])
      .map((l) => ({ indent_line_id: l.id, issued_qty: toBase(l, lineQtys[l.id] ?? 0) }))
      .filter((i) => i.issued_qty > 0);
    setSubmitting(true); setSubmitError('');
    try {
      const payload = { issue_date: issueDate, vehicle_no: vehicleNo || undefined, items };
      if (dispatchRemark.trim()) payload.force_complete_reason = dispatchRemark.trim();
      const result = await api.batchIssue(payload);
      setDispatched({ ...result, facility_name: selectedFacility.warehouse_name });
    } catch (e) {
      setSubmitError(e.message || 'Dispatch failed.');
    } finally { setSubmitting(false); }
  }

  function backToFacilities() {
    setSelectedFacilityId(null);
    setShowSummary(false);
    setSubmitError('');
    setVehicleNo('');
    setDispatchRemark('');
  }

  function reset() {
    setDispatched(null);
    setSelectedFacilityId(null);
    setShowSummary(false);
    setVehicleNo('');
    setDispatchRemark('');
    load();
  }

  // ── Success ──
  if (dispatched) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={44} className="text-green-500 mx-auto mb-3" />
        <div className="font-bold text-lg text-slate-900">Dispatched to {dispatched.facility_name}</div>
        <div className="text-sm text-slate-500 mt-1">{dispatched.count} item{dispatched.count !== 1 ? 's' : ''} issued</div>
        <div className="mt-3 space-y-1">
          {dispatched.issue_refs?.map((ref) => (
            <div key={ref} className="text-xs font-mono text-slate-400">{ref}</div>
          ))}
        </div>
        <button onClick={reset} className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold">
          Done — Back to Facilities
        </button>
      </div>
    );
  }

  // ── Facility list ──
  if (!selectedFacility) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Issue Against Indent</h2>
            <p className="text-sm text-slate-500">Select a facility to dispatch stock.</p>
          </div>
          <button onClick={load} className="p-2 text-slate-400"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {fetchError && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{fetchError}</div>}
        {loading && <div className="text-center text-sm text-slate-400 py-8">Loading pending indents…</div>}
        {!loading && facilities.length === 0 && <div className="text-center text-sm text-slate-500 py-8">No pending indents found.</div>}
        {!loading && (
          <div data-tour="indent-list" className="space-y-2">
            {facilities.map((fac) => {
              const hasShortage = fac.lines.some((l) => toDisp(l, l.pm_on_hand_qty) < toDisp(l, l.pending_qty));
              return (
                <button key={fac.warehouse_id} onClick={() => setSelectedFacilityId(fac.warehouse_id)}
                  className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-blue-300 active:bg-blue-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                    <Truck size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-900">{fac.warehouse_name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{fac.warehouse_code} · {fac.lines.length} item{fac.lines.length !== 1 ? 's' : ''} pending</div>
                  </div>
                  {hasShortage && <span className="text-xs text-red-500 font-medium flex-shrink-0">Low stock</span>}
                  <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Facility detail ──
  const lines = selectedFacility.lines;
  const summaryItems = lines
    .map((l) => ({ ...l, actualQty: Number(lineQtys[l.id] ?? 0) }))
    .filter((i) => i.actualQty > 0);
  const hasAnyQty = summaryItems.length > 0;
  const hasStockError = lines.some((l) => {
    const q = Number(lineQtys[l.id] ?? 0);
    return q > 0 && q > toDisp(l, l.pm_on_hand_qty);
  });
  const hasOverIndent = summaryItems.some((i) => i.actualQty > toDisp(i, i.pending_qty));
  const needsDispatchRemark = hasStockError || hasOverIndent;
  const canDispatch = hasAnyQty && (!needsDispatchRemark || dispatchRemark.trim()) && !submitting;

  return (
    <div className="space-y-4 pb-32">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <button onClick={backToFacilities} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium">
          <ArrowLeft size={15} /> Facilities
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800 truncate">{selectedFacility.warehouse_name}</span>
      </div>

      {/* Issue date (shared for all items) */}
      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">Issue Date</label>
        <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
          className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Item cards */}
      <div className="space-y-3">
        {lines.map((l) => {
          const qty = lineQtys[l.id] ?? '';
          const qtyNum = Number(qty);
          const unit = dispUnit(l);
          const pending = toDisp(l, l.pending_qty);
          const pmStock = toDisp(l, l.pm_on_hand_qty);
          const facStock = toDisp(l, l.facility_on_hand_qty);
          const overStock = qtyNum > 0 && qtyNum > pmStock;
          const overIndent = qtyNum > 0 && qtyNum > pending;
          return (
            <div key={l.id} className={`bg-white rounded-xl border p-4 space-y-3 ${overStock ? 'border-red-200' : overIndent ? 'border-amber-200' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-slate-900 leading-tight">{l.material_name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{l.material_code} · {l.indent_ref}</div>
                </div>
                <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-medium flex-shrink-0">{pending} {unit} due</span>
              </div>
              <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg p-2.5 text-xs">
                <div>
                  <div className="text-slate-400 mb-0.5">Indent Qty</div>
                  <div className="font-bold text-slate-900">{pending} <span className="font-normal text-slate-400">{unit}</span></div>
                </div>
                <div>
                  <div className="text-slate-400 mb-0.5">PM Stock</div>
                  <div className={`font-bold ${pmStock < pending ? 'text-red-600' : 'text-green-700'}`}>{pmStock} <span className="font-normal text-slate-400">{unit}</span></div>
                </div>
                <div>
                  <div className="text-slate-400 mb-0.5">At Facility</div>
                  <div className="font-bold text-slate-900">{facStock} <span className="font-normal text-slate-400">{unit}</span></div>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Dispatch Qty ({unit})</label>
                <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(l.id, e.target.value)}
                  className={`w-full px-3 py-3 border rounded-lg text-base focus:outline-none focus:ring-2 ${overStock ? 'border-red-300 focus:ring-red-400 bg-red-50' : overIndent ? 'border-amber-300 focus:ring-amber-400 bg-amber-50' : 'border-slate-300 focus:ring-blue-500'}`} />
                {overStock && <p className="text-xs text-red-600 mt-1">Exceeds PM Store stock ({pmStock} {unit} available) — add a remark in the dispatch summary</p>}
                {!overStock && overIndent && <p className="text-xs text-amber-600 mt-1">Exceeds indent qty — add a remark in the dispatch summary</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky dispatch bar */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 p-4">
        <div className="max-w-lg mx-auto">
          {needsDispatchRemark && <p className="text-xs text-amber-600 text-center mb-2">Qty mismatch detected — add a remark in the summary to continue.</p>}
          <button onClick={() => setShowSummary(true)} disabled={!hasAnyQty}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:bg-blue-700">
            <Truck size={18} /> Review & Dispatch ({summaryItems.length} item{summaryItems.length !== 1 ? 's' : ''})
          </button>
        </div>
      </div>

      {/* Summary / confirm modal */}
      {showSummary && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end">
          <div className="w-full max-w-lg mx-auto bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
              <div className="font-bold text-lg text-slate-900">Dispatch Summary</div>
              <div className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5"><Truck size={13} /> {selectedFacility.warehouse_name}</div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {summaryItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 leading-tight">{item.material_name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{item.indent_ref}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-slate-900">{item.actualQty} <span className="text-slate-400 font-normal text-xs">{dispUnit(item)}</span></div>
                    <div className="text-xs text-slate-400">of {toDisp(item, item.pending_qty)} pending</div>
                  </div>
                </div>
              ))}

              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Vehicle No.</label>
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="Optional"
                    className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Issue Date</label>
                  <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {needsDispatchRemark && (
                  <div>
                    <label className="text-xs font-medium text-amber-700 mb-1 block">
                      Remark <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(required — qty mismatch)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={dispatchRemark}
                      onChange={(e) => setDispatchRemark(e.target.value)}
                      placeholder="Reason for the quantity difference…"
                      className="w-full px-3 py-3 border border-amber-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                    />
                  </div>
                )}
              </div>

              {submitError && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{submitError}
                </div>
              )}
            </div>

            <div className="px-5 pb-6 pt-3 border-t border-slate-100 flex-shrink-0 grid grid-cols-2 gap-3">
              <button onClick={() => { setShowSummary(false); setSubmitError(''); }} disabled={submitting}
                className="py-4 bg-slate-100 text-slate-700 rounded-xl font-semibold text-sm">
                Cancel
              </button>
              <button onClick={dispatch} disabled={!canDispatch}
                className="py-4 bg-blue-600 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {submitting ? 'Dispatching…' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreStockView({ token, warehouseId }) {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (!token || !warehouseId) {
        setStock([
          { material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', on_hand_qty: '1211.000', weighted_avg_cost: '2.50', is_low_stock: false, min_qty: '500' },
          { material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', on_hand_qty: '950.000', weighted_avg_cost: '12.00', is_low_stock: false, min_qty: '200' },
          { material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', on_hand_qty: '0.000', weighted_avg_cost: '0.00', is_low_stock: true, min_qty: '50' },
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
  }, [token, warehouseId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Store Stock</h2>
        <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"><AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}</div>}
      {loading ? <div className="text-center text-sm text-slate-400 py-10">Loading…</div> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-left">Material</th>
                <th className="px-4 py-2.5 text-right">On Hand</th>
                <th className="px-4 py-2.5 text-right">Min Qty</th>
                <th className="px-4 py-2.5 text-right">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {stock.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No stock records</td></tr>}
              {stock.map((s, i) => {
                const unit = dispUnit(s);
                const onHand = toDisp(s, s.on_hand_qty);
                const minQty = s.min_qty != null ? Number(s.min_qty) : null;
                return (
                  <tr key={i} className={`border-t border-slate-100 ${s.is_low_stock ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{s.material_name}</div>
                      <div className="text-xs text-slate-400">{s.material_code} · {unit}</div>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-bold ${s.is_low_stock ? 'text-red-600' : 'text-slate-900'}`}>
                      {onHand} {unit}
                      {s.is_low_stock && <span className="ml-1.5 text-xs font-normal bg-red-100 text-red-600 px-1.5 py-0.5 rounded">⚠ Below minimum</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{minQty != null ? `${minQty} ${unit}` : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">₹{Number(s.weighted_avg_cost ?? 0).toFixed(2)}</td>
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

export default function PMStoreOps() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('grn');
  const [showTour, setShowTour] = useState(false);

  function finishTour() {
    setShowTour(false);
    if (user) localStorage.setItem(`packtrack_tour_done_${user.role}`, '1');
  }

  if (!token) {
    return <LoginScreen onLogin={(t, u) => {
      setToken(t); setUser(u);
      if (!localStorage.getItem(`packtrack_tour_done_${u.role}`)) setShowTour(true);
    }} />;
  }

  const client = makeApi(token);

  const tourSteps = [
    { target: 'pmstore-tabs', title: 'Welcome to PM Store Ops', body: 'Four sections: Post GRN (inward from vendors), Issue Against Indent (dispatch to FC/CC), Store Stock (current on-hand), and Audit (movement history).' },
    { target: 'grn-po-list', title: 'Post GRN — Open POs', body: 'Green cards are POs not yet inwarded; amber are partially inwarded with remaining qty shown on the right. Tap a card to start a GRN.', onEnter: () => setTab('grn') },
    { target: null, title: 'Entering Inward Quantity', body: 'After tapping a PO card, enter the quantity received in this shipment. Partial quantities are fine — the PO stays open for the next delivery.' },
    { target: null, title: 'Invoice Number', body: 'Enter the vendor\'s invoice number. Used for reconciliation and audit trail. Optional but recommended.' },
    { target: null, title: 'Attach Invoice Image', body: 'Attach the vendor\'s physical invoice as JPG, PNG, or PDF. Gives a paper trail for every delivery and is useful during audits.' },
    { target: null, title: 'Post GRN Button', body: 'Submits the inward entry. Updates the stock ledger and transitions the PO status to Partially Received or Closed depending on how much was received.' },
    { target: null, title: 'Force Complete Reason', body: 'Only needed if you want to close this PO short. Enter the reason — e.g. "Vendor confirmed no balance stock" — before the Force Complete button activates.' },
    { target: null, title: 'Force Complete', body: 'Closes the PO with whatever qty was received so far. No further GRNs are allowed. An admin can reverse this from the admin portal if done by mistake.' },
    { target: 'indent-list', title: 'Issue Against Indent — Pending Indents', body: 'Each card is an approved material request from an FC or CC facility waiting to be fulfilled. Shows facility, material, and pending qty.', onEnter: () => setTab('issue') },
    { target: null, title: 'Dispatch Details', body: 'Qty defaults to the indent\'s pending amount — adjust only for partial dispatches. Vehicle No is the transport vehicle carrying the goods (optional).' },
    { target: null, title: 'Confirm Issue', body: 'Records the dispatch, deducts from PM Store stock, and notifies the receiving FC/CC exec to acknowledge receipt in their app.' },
    { target: null, title: 'Store Stock', body: 'The Store Stock tab shows current on-hand quantities at this PM Store. Check here before issuing against an indent to confirm sufficient stock is available.', onEnter: () => setTab('stock') },
    { target: 'tour-btn-pmstore', title: "You're all set!", body: 'Hit the ? button at the bottom-right any time to replay this tour.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
            <div>
              <div className="font-bold text-slate-900 text-sm">PM Store Ops</div>
              <div className="text-xs text-slate-400">{user?.name || user?.email}</div>
            </div>
          </div>
          <button onClick={() => { setToken(null); setUser(null); }} className="p-2.5 text-slate-400 active:text-slate-600">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div data-tour="pmstore-tabs" className="flex gap-1 bg-slate-100 rounded-xl p-1 mx-4 mt-3">
        <button onClick={() => setTab('grn')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${tab === 'grn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>GRN</button>
        <button onClick={() => setTab('issue')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${tab === 'issue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Issue</button>
        <button onClick={() => setTab('stock')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${tab === 'stock' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Stock</button>
        <button onClick={() => setTab('audit')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium ${tab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Audit</button>
      </div>

      <div className="px-4 pt-3 pb-8">
        {tab === 'grn' && <GRNScreen api={client} />}
        {tab === 'issue' && <IssueScreen api={client} />}
        {tab === 'stock' && <StoreStockView token={token} warehouseId={user?.warehouse_ids?.[0]} />}
        {tab === 'audit' && <AuditScreen token={token} warehouseId={user?.warehouse_ids?.[0]} />}
      </div>

      <button
        data-tour="tour-btn-pmstore"
        onClick={() => setShowTour(true)}
        className="fixed bottom-24 right-4 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center text-lg font-bold hover:bg-blue-700 z-50"
        title="Open guided tour"
      >?</button>

      {showTour && <TourOverlay steps={tourSteps} onDone={finishTour} />}
    </div>
  );
}
