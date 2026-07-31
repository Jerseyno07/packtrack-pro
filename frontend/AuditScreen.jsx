import { useState, useEffect } from 'react';
import { ClipboardList, CheckCircle2, AlertTriangle, RefreshCw, X } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

const MOCK_PREFILL = [
  { material_id: 1, material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', system_qty: '1211.000' },
  { material_id: 2, material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', system_qty: '950.000' },
  { material_id: 3, material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', system_qty: '0.000' },
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
        MOCK_PREFILL.forEach((m) => { init[m.material_id] = String(Number(m.system_qty)); });
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
      rows.forEach((m) => { init[m.material_id] = String(Number(m.system_qty)); });
      setCounts(init);
    } catch (e) {
      setError(e.message || 'Failed to load system quantities');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPrefill(); }, [token, warehouseId]);

  // Build the diff list for validation and confirmation modal
  function getDiffs() {
    return materials
      .map((m) => ({
        ...m,
        sysQty: Number(m.system_qty),
        physQty: Number(counts[m.material_id]) || 0,
        remark: (lineRemarks[m.material_id] || '').trim(),
      }))
      .filter((m) => m.physQty !== m.sysQty);
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
      const lines = materials.map((m) => ({
        material_id: m.material_id,
        physical_qty: Number(counts[m.material_id]) || 0,
        remark: (lineRemarks[m.material_id] || '').trim() || undefined,
      }));

      if (!token || !warehouseId) {
        const summary = lines.map((l) => {
          const mat = materials.find((m) => m.material_id === l.material_id);
          return { ...l, system_qty: Number(mat.system_qty), delta: l.physical_qty - Number(mat.system_qty), material_code: mat.material_code, material_name: mat.material_name };
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

      const enriched = (data.lines ?? []).map((l) => {
        const mat = materials.find((m) => String(m.material_id) === String(l.material_id));
        return { ...l, material_code: mat?.material_code, material_name: mat?.material_name };
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
    const netDelta = success.lines.reduce((s, l) => s + l.delta, 0);
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
          <CheckCircle2 size={36} className="text-green-500 mx-auto mb-2" />
          <div className="font-bold text-slate-900">Audit Submitted</div>
          <div className="text-sm text-slate-500 mt-0.5">{success.audit_ref}</div>
          <div className="text-sm text-slate-600 mt-2">
            {adjusted.length} line{adjusted.length !== 1 ? 's' : ''} adjusted · Net delta:{' '}
            <span className={netDelta < 0 ? 'text-red-600 font-semibold' : netDelta > 0 ? 'text-green-600 font-semibold' : 'text-slate-600'}>
              {netDelta > 0 ? '+' : ''}{netDelta}
            </span>
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
                {adjusted.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-800">{l.material_name ?? l.material_code}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{l.system_qty}</td>
                    <td className="px-4 py-2 text-right text-slate-700">{l.physical_qty}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${l.delta < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {l.delta > 0 ? '+' : ''}{l.delta}
                    </td>
                  </tr>
                ))}
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
                    {diffs.map((d, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">{d.material_name}</div>
                          {d.remark && <div className="text-xs text-slate-400 mt-0.5 italic">{d.remark}</div>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{d.sysQty}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{d.physQty}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${d.physQty - d.sysQty < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {d.physQty - d.sysQty > 0 ? '+' : ''}{d.physQty - d.sysQty}
                        </td>
                      </tr>
                    ))}
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
          <p className="text-xs text-slate-500 mt-0.5">Enter physical counts. Items with a difference require a remark.</p>
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
                  const sysQty = Number(m.system_qty);
                  const physQty = Number(counts[m.material_id]) || 0;
                  const hasDiff = physQty !== sysQty;
                  const remarkVal = lineRemarks[m.material_id] || '';
                  const remarkMissing = hasDiff && !remarkVal.trim();
                  return (
                    <tr key={m.material_id} className={`border-t border-slate-100 ${hasDiff ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{m.material_name}</div>
                        <div className="text-xs text-slate-400">{m.material_code} · {m.unit}</div>
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
                      <td className="px-4 py-2.5 text-right text-slate-500 font-mono align-top pt-3">{sysQty}</td>
                      <td className="px-4 py-2.5 text-right align-top pt-2.5">
                        <input
                          type="number"
                          min={0}
                          value={counts[m.material_id] ?? ''}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [m.material_id]: e.target.value }))}
                          className={`w-24 px-2 py-1.5 border rounded-lg text-right text-sm font-mono focus:outline-none focus:ring-2 ${hasDiff ? 'border-amber-400 bg-amber-50 focus:ring-amber-400' : 'border-slate-300 focus:ring-blue-500'}`}
                        />
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
