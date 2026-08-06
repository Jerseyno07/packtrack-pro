import { useState, useEffect } from 'react';
import { ClipboardList, CheckCircle2, AlertTriangle, RefreshCw, X } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

// ── Unit helpers ──────────────────────────────────────────────────────────────
// Roll materials: user sees/enters in rolls; DB stores in stickers or meters.
function dispUnit(m) {
  return m.stickers_per_roll || m.meters_per_unit ? 'rolls' : m.unit;
}
function toDisp(m, baseQty) {
  const n = Number(baseQty);
  if (m.stickers_per_roll) return Math.round((n / m.stickers_per_roll) * 1000) / 1000;
  if (m.meters_per_unit) return parseFloat((n / Number(m.meters_per_unit)).toFixed(2));
  return n;
}
function toBase(m, dispQty) {
  const n = Number(dispQty) || 0;
  if (m.stickers_per_roll) return Math.round(n * m.stickers_per_roll);
  if (m.meters_per_unit) return Math.round(n * Number(m.meters_per_unit));
  return n;
}
function fmtQty(n) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

const MOCK_PREFILL = [
  { material_id: 1, material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', stickers_per_roll: null, meters_per_unit: null, system_qty: '1211' },
  { material_id: 2, material_code: 'NTRLL-SFT', material_name: 'Soft Net Roll', unit: 'Roll', stickers_per_roll: null, meters_per_unit: '1000', system_qty: '197000' },
  { material_id: 3, material_code: 'BCRL-SML', material_name: 'Barcode Roll small', unit: 'Roll', stickers_per_roll: 1000, meters_per_unit: null, system_qty: '5000' },
];

export default function AuditScreen({ token, warehouseId }) {
  const [materials, setMaterials] = useState([]);
  const [counts, setCounts] = useState({});
  const [lineRemarks, setLineRemarks] = useState({});
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function loadPrefill() {
    setLoading(true);
    setError('');
    try {
      if (!token || !warehouseId) {
        setMaterials(MOCK_PREFILL);
        const init = {};
        MOCK_PREFILL.forEach((m) => { init[m.material_id] = String(toDisp(m, Number(m.system_qty))); });
        setCounts(init);
        return;
      }
      const res = await fetch(`${BASE_URL}/api/v1/audits/prefill?warehouse_id=${warehouseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const rows = data.data ?? [];
      setMaterials(rows);
      const init = {};
      // Initialise inputs in display units (rolls for roll materials)
      rows.forEach((m) => { init[m.material_id] = String(toDisp(m, Number(m.system_qty))); });
      setCounts(init);
    } catch (e) {
      setError(e.message || 'Failed to load system quantities');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPrefill(); }, [token, warehouseId]);

  // Diffs are computed in display units (rolls for roll materials)
  function getDiffs() {
    return materials
      .map((m) => ({
        ...m,
        sysQty: toDisp(m, Number(m.system_qty)),
        physQty: Number(counts[m.material_id]) || 0,
        remark: (lineRemarks[m.material_id] || '').trim(),
      }))
      .filter((d) => d.physQty !== d.sysQty);
  }

  function handleSubmitClick() {
    setError('');
    if (!remarks.trim()) { setError('Overall remarks are mandatory.'); return; }
    const diffs = getDiffs();
    const missing = diffs.filter((d) => !d.remark);
    if (missing.length > 0) {
      setError(`Remark required for: ${missing.map((d) => d.material_code).join(', ')}`);
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setSubmitting(true);
    setError('');
    try {
      // Convert display units → base units (stickers) before sending to server
      const lines = materials.map((m) => ({
        material_id: m.material_id,
        physical_qty: toBase(m, Number(counts[m.material_id]) || 0),
        remark: (lineRemarks[m.material_id] || '').trim() || undefined,
      }));

      if (!token || !warehouseId) {
        const summary = lines.map((l) => {
          const mat = materials.find((m) => m.material_id === l.material_id);
          return { ...l, system_qty: Number(mat.system_qty), delta: l.physical_qty - Number(mat.system_qty), ...mat };
        });
        setSuccess({ audit_ref: 'AUD-MOCK-001', lines: summary });
        return;
      }

      const res = await fetch(`${BASE_URL}/api/v1/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ warehouse_id: Number(warehouseId), remarks: remarks.trim(), lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

      // Enrich server response with material metadata for display-unit conversion in success screen
      const enriched = (data.lines ?? []).map((l) => {
        const mat = materials.find((m) => String(m.material_id) === String(l.material_id));
        return { ...l, material_code: mat?.material_code, material_name: mat?.material_name, stickers_per_roll: mat?.stickers_per_roll, meters_per_unit: mat?.meters_per_unit };
      });
      setSuccess({ audit_ref: data.audit_ref, lines: enriched });
    } catch (e) {
      setError(e.message || 'Failed to submit audit.');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSuccess(null);
    setRemarks('');
    setLineRemarks({});
    loadPrefill();
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    const adjusted = success.lines.filter((l) => l.delta !== 0);
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
          <CheckCircle2 size={36} className="text-green-500 mx-auto mb-2" />
          <div className="font-bold text-slate-900">Audit Submitted</div>
          <div className="text-sm text-slate-500 mt-0.5">{success.audit_ref}</div>
          <div className="text-sm text-slate-600 mt-2">
            {adjusted.length} line{adjusted.length !== 1 ? 's' : ''} adjusted
          </div>
        </div>

        {adjusted.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">Adjustments made</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Material</th>
                  <th className="px-4 py-2 text-right">System</th>
                  <th className="px-4 py-2 text-right">Physical</th>
                  <th className="px-4 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {adjusted.map((l, i) => {
                  const u = dispUnit(l);
                  const sysDisp = toDisp(l, l.system_qty);
                  const physDisp = toDisp(l, l.physical_qty);
                  const deltaDisp = toDisp(l, l.delta);
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-800">{l.material_name ?? l.material_code}</td>
                      <td className="px-4 py-2 text-right text-slate-500">{fmtQty(sysDisp)} {u}</td>
                      <td className="px-4 py-2 text-right text-slate-700">{fmtQty(physDisp)} {u}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${deltaDisp < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {deltaDisp > 0 ? '+' : ''}{fmtQty(deltaDisp)} {u}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <button onClick={reset} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm">
          Start New Audit
        </button>
      </div>
    );
  }

  const diffs = getDiffs();

  // ── Confirmation modal ──────────────────────────────────────────────────────
  const ConfirmModal = confirmOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="font-semibold text-slate-900">Confirm Audit Submission</div>
          <button onClick={() => setConfirmOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {diffs.length === 0 ? (
            <p className="text-sm text-slate-600">No differences found — all physical counts match system quantities.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-amber-600">{diffs.length} item{diffs.length !== 1 ? 's' : ''}</span> with a difference will be adjusted:
              </p>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Material</th>
                      <th className="px-3 py-2 text-right">System</th>
                      <th className="px-3 py-2 text-right">Physical</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d, i) => {
                      const u = dispUnit(d);
                      const delta = d.physQty - d.sysQty;
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{d.material_name}</div>
                            {d.remark && <div className="text-xs text-slate-400 mt-0.5 italic">{d.remark}</div>}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">{fmtQty(d.sysQty)} {u}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{fmtQty(d.physQty)} {u}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${delta < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {delta > 0 ? '+' : ''}{fmtQty(delta)} {u}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-xs text-slate-400">Items with no difference will be recorded but will not create ledger adjustments.</p>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-100">
          <button
            onClick={() => setConfirmOpen(false)}
            className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go Back
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={15} /> Confirm &amp; Submit
          </button>
        </div>
      </div>
    </div>
  );

  // ── Main audit form ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {ConfirmModal}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><ClipboardList size={18} /> Physical Audit</h2>
          <p className="text-xs text-slate-500 mt-0.5">Enter physical counts. Roll materials are counted in rolls. Items with a difference require a remark.</p>
        </div>
        <button onClick={loadPrefill} className="p-2 text-slate-400 hover:text-slate-600">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading system quantities…</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left">Material</th>
                  <th className="px-4 py-2.5 text-right">System Qty</th>
                  <th className="px-4 py-2.5 text-right">Physical Count</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const sysDisp = toDisp(m, Number(m.system_qty));
                  const physDisp = Number(counts[m.material_id]) || 0;
                  const hasDiff = physDisp !== sysDisp;
                  const unit = dispUnit(m);
                  const remarkVal = lineRemarks[m.material_id] || '';
                  const remarkMissing = hasDiff && !remarkVal.trim();
                  return (
                    <tr key={m.material_id} className={`border-t border-slate-100 ${hasDiff ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{m.material_name}</div>
                        <div className="text-xs text-slate-400">{m.material_code} · {unit}</div>
                        {hasDiff && (
                          <input
                            type="text"
                            value={remarkVal}
                            onChange={(e) => setLineRemarks((prev) => ({ ...prev, [m.material_id]: e.target.value }))}
                            placeholder="Remark required *"
                            className={`mt-1.5 w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${remarkMissing ? 'border-red-400 bg-red-50 placeholder-red-400 focus:ring-red-400' : 'border-amber-300 bg-white focus:ring-amber-400'}`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 font-mono align-top pt-3">
                        {fmtQty(sysDisp)} <span className="text-xs">{unit}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right align-top pt-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            step={m.stickers_per_roll || m.meters_per_unit ? 1 : 'any'}
                            value={counts[m.material_id] ?? ''}
                            onChange={(e) => setCounts((prev) => ({ ...prev, [m.material_id]: e.target.value }))}
                            className={`w-20 px-2 py-1.5 border rounded-lg text-right text-sm font-mono focus:outline-none focus:ring-2 ${hasDiff ? 'border-amber-400 bg-amber-50 focus:ring-amber-400' : 'border-slate-300 focus:ring-blue-500'}`}
                          />
                          <span className="text-xs text-slate-400">{unit}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Overall Remarks <span className="text-red-500">*</span></label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. End of week physical count — all locations counted"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <button
            onClick={handleSubmitClick}
            disabled={submitting}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {submitting ? 'Submitting…' : 'Submit Audit'}
          </button>
        </>
      )}
    </div>
  );
}
