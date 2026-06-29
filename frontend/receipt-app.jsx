import { useState, useEffect, useMemo } from 'react';
import { Truck, Package, CheckCircle2, AlertTriangle, Camera, Clock, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// CC/FC Stock Receipt Confirmation Webapp
//
// This talks to:
//   GET  /api/v1/stock-issues?to_warehouse_id=...&status=DISPATCHED   (pending list)
//   POST /api/v1/stock-receipts                                       (confirm receipt)
//
// In this artifact, API calls are mocked with in-memory data (per the no-localStorage
// rule for artifacts) so you can see and click through the real flow. Swap MOCK_API
// for real fetch() calls to your Express server — the shapes match the API exactly.
// ═══════════════════════════════════════════════════════════════════════════

const SEED_ISSUES = [
  { id: 101, issue_ref: 'ISS-2026-A3F1', material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', from_warehouse_name: 'Central PM Store — Bangalore', to_warehouse_name: 'Bangalore CC', issued_qty: 500, pending_qty: 500, issue_date: '2026-06-24', vehicle_no: 'KA-01-AB-1234', indent_ref: 'IND-2026-0091', status: 'DISPATCHED' },
  { id: 102, issue_ref: 'ISS-2026-B7D2', material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', from_warehouse_name: 'Central PM Store — Bangalore', to_warehouse_name: 'Bangalore CC', issued_qty: 40, pending_qty: 40, issue_date: '2026-06-25', vehicle_no: 'KA-01-CD-5678', indent_ref: 'IND-2026-0092', status: 'DISPATCHED' },
  { id: 103, issue_ref: 'ISS-2026-C9E3', material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', from_warehouse_name: 'Central PM Store — Bangalore', to_warehouse_name: 'Bangalore CC', issued_qty: 15, pending_qty: 6, issue_date: '2026-06-23', vehicle_no: 'KA-01-EF-9012', indent_ref: 'IND-2026-0088', status: 'PARTIALLY_RECEIVED' },
];

const MOCK_API = {
  async listPendingIssues(toWarehouseId) {
    await new Promise((r) => setTimeout(r, 350));
    return SEED_ISSUES.filter((i) => i.pending_qty > 0);
  },
  async confirmReceipt(payload) {
    await new Promise((r) => setTimeout(r, 500));
    const issue = SEED_ISSUES.find((i) => i.id === payload.stock_issue_id);
    if (issue) {
      issue.pending_qty = Math.max(0, issue.pending_qty - (payload.received_qty + payload.shortage_qty + payload.damage_qty));
      issue.status = issue.pending_qty === 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    }
    return { receipt_id: Math.floor(Math.random() * 9000) + 1000, receipt_ref: `RCV-2026-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
  },
};

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
        <div className="font-bold text-slate-900">{issue.pending_qty}</div>
        <div className="text-xs text-slate-400">of {issue.issued_qty} {issue.unit}</div>
      </div>
      <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
    </button>
  );
}

function ReceiptForm({ issue, onBack, onSubmitted }) {
  const [receivedQty, setReceivedQty] = useState(String(issue.pending_qty));
  const [shortageQty, setShortageQty] = useState('0');
  const [damageQty, setDamageQty] = useState('0');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const rq = Number(receivedQty) || 0;
  const sq = Number(shortageQty) || 0;
  const dq = Number(damageQty) || 0;
  const total = rq + sq + dq;
  const overLimit = total > issue.pending_qty;
  const needsReason = sq > 0 || dq > 0;

  async function handleSubmit() {
    setError('');
    if (total <= 0) { setError('Enter at least one quantity (received, shortage, or damage).'); return; }
    if (overLimit) { setError(`Total (${total}) exceeds pending quantity (${issue.pending_qty}).`); return; }
    if (needsReason && !reason.trim()) { setError('A reason is required when reporting shortage or damage.'); return; }

    setSubmitting(true);
    try {
      const res = await MOCK_API.confirmReceipt({
        stock_issue_id: issue.id,
        received_qty: rq,
        shortage_qty: sq,
        damage_qty: dq,
        shortage_reason: needsReason ? reason.trim() : undefined,
        receipt_date: new Date().toISOString().slice(0, 10),
      });
      onSubmitted(res);
    } catch (e) {
      setError('Failed to submit receipt. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 font-medium">
        <ArrowLeft size={16} /> Back to pending list
      </button>

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
        <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-slate-100">
          <div><div className="text-slate-400 text-xs">From</div><div className="text-slate-700">{issue.from_warehouse_name}</div></div>
          <div><div className="text-slate-400 text-xs">Vehicle</div><div className="text-slate-700">{issue.vehicle_no || '—'}</div></div>
          <div><div className="text-slate-400 text-xs">Dispatched</div><div className="text-slate-700">{issue.issue_date}</div></div>
          <div><div className="text-slate-400 text-xs">Pending Qty</div><div className="text-slate-900 font-bold">{issue.pending_qty} {issue.unit}</div></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-700">Confirm quantities received</div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Received in good condition <span className="text-red-500">*</span></label>
          <input
            type="number" min="0" inputMode="decimal" value={receivedQty}
            onChange={(e) => setReceivedQty(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Shortage</label>
            <input
              type="number" min="0" inputMode="decimal" value={shortageQty}
              onChange={(e) => setShortageQty(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Damaged</label>
            <input
              type="number" min="0" inputMode="decimal" value={damageQty}
              onChange={(e) => setDamageQty(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {needsReason && (
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Reason for shortage/damage <span className="text-red-500">*</span></label>
            <textarea
              rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Torn packaging on 6 rolls, vehicle delay caused damage"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>
        )}

        <button className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 font-medium active:bg-slate-50">
          <Camera size={16} /> Attach photo (optional)
        </button>

        <div className={`flex items-center justify-between text-sm px-3 py-2 rounded-lg ${overLimit ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
          <span>Total accounted</span>
          <span className="font-semibold">{total} / {issue.pending_qty} {issue.unit}</span>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          {submitting ? 'Submitting...' : 'Confirm Receipt'}
        </button>
      </div>
    </div>
  );
}

function SuccessScreen({ receiptInfo, onDone }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
      <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
        <CheckCircle2 size={32} />
      </div>
      <div>
        <div className="font-bold text-lg text-slate-900">Receipt Confirmed</div>
        <div className="text-sm text-slate-500 mt-1">{receiptInfo.receipt_ref}</div>
      </div>
      <button onClick={onDone} className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium">
        Back to Pending List
      </button>
    </div>
  );
}

export default function ReceiptApp() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);

  async function refresh() {
    setLoading(true);
    const data = await MOCK_API.listPendingIssues();
    setIssues(data);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  const totalPending = useMemo(() => issues.reduce((a, i) => a + i.pending_qty, 0), [issues]);

  return (
    <div className="min-h-screen bg-slate-50 max-w-md mx-auto">
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">Receive Stock</div>
            <div className="text-xs text-slate-500">Bangalore CC</div>
          </div>
          <button onClick={refresh} className="p-2 text-slate-400 active:text-slate-600">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {successInfo ? (
          <SuccessScreen receiptInfo={successInfo} onDone={() => { setSuccessInfo(null); setSelected(null); refresh(); }} />
        ) : selected ? (
          <ReceiptForm
            issue={selected}
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
