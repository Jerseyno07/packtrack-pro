import { useState, useMemo } from 'react';
import { Package, CheckCircle2, AlertTriangle, Truck, FileText, ChevronRight, ArrowLeft } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// PM Store Ops — two screens missing from the portal so far:
//   1. Post GRN against an open PO        -> POST /api/v1/goods-receipts
//   2. Issue stock against a pending indent -> POST /api/v1/stock-issues
// Mock data used here; swap MOCK_API for real fetch() calls — shapes match.
// ═══════════════════════════════════════════════════════════════════════════

const MOCK_OPEN_POS = [
  { id: 91, po_no: 'PO-2026-0091', vendor_name: 'Shree Plastics Pvt Ltd', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit_price: 2.5, po_qty: 2000, received_qty_cache: 0, remaining_qty: 2000 },
  { id: 92, po_no: 'PO-2026-0092', vendor_name: 'Karnataka Packaging Co', material_code: 'NTRLL-01', material_name: 'Net Roll', unit_price: 180, po_qty: 150, received_qty_cache: 50, remaining_qty: 100 },
];

const MOCK_PENDING_INDENTS = [
  { id: 451, indent_ref: 'IND-2026-0451', warehouse_name: 'Bangalore CC', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', requested_qty: 500, issued_qty: 0, pending_qty: 500, on_hand_at_pm_store: 1800 },
  { id: 452, indent_ref: 'IND-2026-0452', warehouse_name: 'Bangalore FC', material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', requested_qty: 20, issued_qty: 14, pending_qty: 6, on_hand_at_pm_store: 9 },
];

const MOCK_API = {
  async postGRN(payload) {
    await new Promise((r) => setTimeout(r, 600));
    return { grn_id: Math.floor(Math.random() * 9000), grn_ref: `GRN-2026-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
  },
  async postIssue(payload) {
    await new Promise((r) => setTimeout(r, 600));
    return { issue_id: Math.floor(Math.random() * 9000), issue_ref: `ISS-2026-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
  },
};

function Badge({ children, tone = 'gray' }) {
  const tones = { gray: 'bg-slate-100 text-slate-600', blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

// ── GRN screen ───────────────────────────────────────────────────────────────
function GRNScreen() {
  const [selectedPO, setSelectedPO] = useState(null);
  const [qty, setQty] = useState('');
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState('');
  const [hasInvoice, setHasInvoice] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  async function submit() {
    setError('');
    const q = Number(qty);
    if (!selectedPO) return;
    if (!q || q <= 0) { setError('Enter a valid GRN quantity.'); return; }
    if (q > selectedPO.remaining_qty) { setError(`GRN qty exceeds remaining PO qty (${selectedPO.remaining_qty}).`); return; }
    if (!hasInvoice) { setError('Invoice copy attachment is mandatory.'); return; }
    setSubmitting(true);
    try {
      const res = await MOCK_API.postGRN({ po_id: selectedPO.id, grn_qty: q, grn_date: grnDate, invoice_no: invoiceNo, has_invoice_attachment: hasInvoice });
      setSuccess(res);
    } finally { setSubmitting(false); }
  }

  if (success) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
        <div className="font-bold text-lg text-slate-900">GRN Posted</div>
        <div className="text-sm text-slate-500 mt-1">{success.grn_ref}</div>
        <button onClick={() => { setSuccess(null); setSelectedPO(null); setQty(''); setHasInvoice(false); setInvoiceNo(''); }} className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          Post Another GRN
        </button>
      </div>
    );
  }

  if (!selectedPO) {
    return (
      <div className="space-y-4">
        <div><h2 className="text-lg font-bold text-slate-900">Post GRN</h2><p className="text-sm text-slate-500">Select an open PO to receive stock against.</p></div>
        <div className="space-y-2">
          {MOCK_OPEN_POS.map((po) => (
            <button key={po.id} onClick={() => setSelectedPO(po)} className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-blue-300 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0"><Truck size={18} /></div>
              <div className="flex-1">
                <div className="font-semibold text-sm text-slate-900">{po.po_no} <span className="text-slate-400">· {po.vendor_name}</span></div>
                <div className="text-xs text-slate-500">{po.material_code} — {po.material_name}</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-slate-900">{po.remaining_qty}</div>
                <div className="text-xs text-slate-400">remaining of {po.po_qty}</div>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <button onClick={() => setSelectedPO(null)} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium"><ArrowLeft size={15} /> Back</button>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="font-semibold text-slate-900">{selectedPO.po_no} <Badge tone="blue">{selectedPO.vendor_name}</Badge></div>
          <div className="text-sm text-slate-500 mt-0.5">{selectedPO.material_code} — {selectedPO.material_name} · Remaining: <strong>{selectedPO.remaining_qty}</strong></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">GRN Quantity <span className="text-red-500">*</span></label>
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
    </div>
  );
}

// ── Issue screen ─────────────────────────────────────────────────────────────
function IssueScreen() {
  const [selectedIndent, setSelectedIndent] = useState(null);
  const [qty, setQty] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  async function submit() {
    setError('');
    const q = Number(qty);
    if (!selectedIndent) return;
    if (!q || q <= 0) { setError('Enter a valid issue quantity.'); return; }
    if (q > selectedIndent.pending_qty) { setError(`Exceeds pending indent qty (${selectedIndent.pending_qty}).`); return; }
    if (q > selectedIndent.on_hand_at_pm_store) { setError(`Insufficient PM Store stock (available ${selectedIndent.on_hand_at_pm_store}).`); return; }
    setSubmitting(true);
    try {
      const res = await MOCK_API.postIssue({ indent_line_id: selectedIndent.id, issued_qty: q, issue_date: issueDate, vehicle_no: vehicleNo });
      setSuccess(res);
    } finally { setSubmitting(false); }
  }

  if (success) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
        <div className="font-bold text-lg text-slate-900">Stock Issued</div>
        <div className="text-sm text-slate-500 mt-1">{success.issue_ref}</div>
        <button onClick={() => { setSuccess(null); setSelectedIndent(null); setQty(''); setVehicleNo(''); }} className="mt-5 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          Issue Another
        </button>
      </div>
    );
  }

  if (!selectedIndent) {
    return (
      <div className="space-y-4">
        <div><h2 className="text-lg font-bold text-slate-900">Issue Against Indent</h2><p className="text-sm text-slate-500">Select a pending indent line to dispatch stock.</p></div>
        <div className="space-y-2">
          {MOCK_PENDING_INDENTS.map((ind) => (
            <button key={ind.id} onClick={() => setSelectedIndent(ind)} className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-blue-300 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><FileText size={18} /></div>
              <div className="flex-1">
                <div className="font-semibold text-sm text-slate-900">{ind.indent_ref} <span className="text-slate-400">· {ind.warehouse_name}</span></div>
                <div className="text-xs text-slate-500">{ind.material_code} — {ind.material_name} · PM Store stock: {ind.on_hand_at_pm_store}</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-amber-600">{ind.pending_qty}</div>
                <div className="text-xs text-slate-400">pending of {ind.requested_qty}</div>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <button onClick={() => setSelectedIndent(null)} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium"><ArrowLeft size={15} /> Back</button>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="font-semibold text-slate-900">{selectedIndent.indent_ref} <Badge tone="amber">{selectedIndent.warehouse_name}</Badge></div>
          <div className="text-sm text-slate-500 mt-0.5">{selectedIndent.material_code} — {selectedIndent.material_name} · Pending: <strong>{selectedIndent.pending_qty}</strong> · PM Store stock: <strong>{selectedIndent.on_hand_at_pm_store}</strong></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Issue Quantity <span className="text-red-500">*</span></label>
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
    </div>
  );
}

export default function PMStoreOps() {
  const [tab, setTab] = useState('grn');
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
          <span className="font-bold text-slate-900">PM Store Ops</span>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-5">
          <button onClick={() => setTab('grn')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'grn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Post GRN</button>
          <button onClick={() => setTab('issue')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'issue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Issue Against Indent</button>
        </div>
        {tab === 'grn' ? <GRNScreen /> : <IssueScreen />}
      </div>
    </div>
  );
}
