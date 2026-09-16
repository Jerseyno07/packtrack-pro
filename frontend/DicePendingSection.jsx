import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

const BASE_URL = import.meta.env.DEV ? '' : 'https://packtrack-pro-production.up.railway.app';

// DICE PO lines whose item_code isn't mapped to a PackTrack material yet —
// flagged instead of silently rejected. An admin/procurement user maps the
// material (Materials tab, admin-only) then hits Retry here, which re-runs
// the exact original line through the same validation the push endpoint
// uses. Shared between the Admin Portal ("DICE Pending" tab) and the
// Procurement view ("Flagged PO Items" tab) — same component, same data.
export default function DicePendingSection({ token, canMapMaterials = true }) {
  const hdrs = { Authorization: `Bearer ${token}` };
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);
  const [retryMsg, setRetryMsg] = useState({});

  function load() {
    setLoading(true);
    fetch(`${BASE_URL}/api/v1/dice-po-pending`, { headers: hdrs })
      .then((r) => r.json())
      .then((d) => setList(Array.isArray(d.items) ? d.items : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleRetry(row) {
    setRetryingId(row.id);
    setRetryMsg((m) => ({ ...m, [row.id]: null }));
    try {
      const r = await fetch(`${BASE_URL}/api/v1/dice-po-pending/${row.id}/retry`, { method: 'POST', headers: hdrs });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Retry failed');
      if (d.status === 'RESOLVED') {
        load();
      } else {
        setRetryMsg((m) => ({ ...m, [row.id]: d.reason || 'Still unresolved' }));
        load();
      }
    } catch (e) {
      setRetryMsg((m) => ({ ...m, [row.id]: e.message }));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">DICE Pending</h2>
          <p className="text-sm text-slate-500">PO lines from DICE whose item_code isn't mapped to a PackTrack material yet. {canMapMaterials ? 'Map the material (Materials tab), then hit Retry' : 'Once a PackTrack admin maps the material, hit Retry'} — nothing is lost, DICE doesn't need to resend anything.</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 py-16 text-center text-slate-400 text-sm">
          Nothing pending. Every DICE-pushed line has a mapped material.
        </div>
      ) : (
        <div data-tour="dice-pending-table" className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">PO No.</th>
                <th className="text-left px-4 py-2.5">Item Code</th>
                <th className="text-left px-4 py-2.5">Qty / UOM</th>
                <th className="text-left px-4 py-2.5">PM Store</th>
                <th className="text-left px-4 py-2.5">Flagged</th>
                <th className="text-right px-4 py-2.5">Retries</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.po_no}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.item_code}</td>
                  <td className="px-4 py-3 text-slate-600">{row.qty} {row.uom}</td>
                  <td className="px-4 py-3 text-slate-600">{row.pm_store_code}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{row.retry_count}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleRetry(row)} disabled={retryingId === row.id}
                      className="text-xs px-2.5 py-1.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium disabled:opacity-50">
                      {retryingId === row.id ? 'Retrying…' : 'Retry'}
                    </button>
                    {retryMsg[row.id] && <p className="text-xs text-amber-600 mt-1 max-w-[200px]">{retryMsg[row.id]}</p>}
                    {row.last_error && !retryMsg[row.id] && <p className="text-xs text-slate-400 mt-1 max-w-[200px]" title={row.last_error}>Last: {row.last_error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
