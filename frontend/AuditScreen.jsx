import { useState, useEffect } from 'react';
import { ClipboardList, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

const BASE_URL = 'https://packtrack-pro-production.up.railway.app';

const MOCK_PREFILL = [
  { material_id: 1, material_code: 'LDPE-06', material_name: 'LDPE Cover 6 Kg', unit: 'Pcs', system_qty: '1211.000' },
  { material_id: 2, material_code: 'NTRLL-01', material_name: 'Net Roll', unit: 'Roll', system_qty: '950.000' },
  { material_id: 3, material_code: 'WXRB-01', material_name: 'Wax Ribbon', unit: 'Roll', system_qty: '0.000' },
];

export default function AuditScreen({ token, warehouseId }) {
  const [materials, setMaterials] = useState([]);
  const [counts, setCounts] = useState({});
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

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

  async function handleSubmit() {
    if (!remarks.trim()) { setError('Remarks are mandatory.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const lines = materials.map((m) => ({
        material_id: m.material_id,
        physical_qty: Number(counts[m.material_id]) || 0,
      }));

      if (!token || !warehouseId) {
        // mock submission
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
    loadPrefill();
  }

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
            {adjusted.length} line{adjusted.length !== 1 ? 's' : ''} adjusted · Net delta: <span className={netDelta < 0 ? 'text-red-600 font-semibold' : netDelta > 0 ? 'text-green-600 font-semibold' : 'text-slate-600'}>{netDelta > 0 ? '+' : ''}{netDelta}</span>
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><ClipboardList size={18} /> Physical Audit</h2>
          <p className="text-xs text-slate-500 mt-0.5">Enter physical counts. Only items with a difference will create ledger adjustments.</p>
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
                  return (
                    <tr key={m.material_id} className={`border-t border-slate-100 ${hasDiff ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{m.material_name}</div>
                        <div className="text-xs text-slate-400">{m.material_code} · {m.unit}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 font-mono">{sysQty}</td>
                      <td className="px-4 py-2.5 text-right">
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
            <label className="text-xs font-medium text-slate-500 mb-1 block">Remarks <span className="text-red-500">*</span></label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. End of week physical count — all locations counted"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || !remarks.trim()}
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
