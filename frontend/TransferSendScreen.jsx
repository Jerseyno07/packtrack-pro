import { useState, useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';

// Shared between pmstore-ops.jsx (PM Store -> PM Store) and receipt-app.jsx
// (CC/FC -> CC/FC or CC/FC -> PM Store) — sends a direct Stock Transfer with
// no backing indent. Source facility is implicit (the caller's own facility,
// passed in as a prop, matching how AdhocIssueScreen hardcodes PM Store as
// its source); only the destination is picked here. The server enforces the
// actual direction rule (e.g. rejecting PM Store -> CC/FC) — this screen
// doesn't duplicate that logic, it just shows a clear error if the server
// rejects the pick.
function dispUnit(l) { return l.meters_per_unit ? 'rolls' : l.stickers_per_roll ? 'units' : l.pieces_per_kg ? 'Kg' : l.unit; }
function toBase(l, disp) {
  const n = Number(disp) || 0;
  if (l.stickers_per_roll) return Math.round(n * Number(l.stickers_per_roll));
  if (l.meters_per_unit) return Math.round(n * Number(l.meters_per_unit));
  if (l.pieces_per_kg) return Math.round(n * Number(l.pieces_per_kg));
  return n;
}

export default function TransferSendScreen({ api, sourceWarehouseId, sourceWarehouseName }) {
  const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [facilities, setFacilities] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [facilitySearch, setFacilitySearch] = useState('');
  const [showFacilityDd, setShowFacilityDd] = useState(false);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [items, setItems] = useState([]);
  const [issueDate, setIssueDate] = useState(todayIst);
  const [vehicleNo, setVehicleNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const matSearchRef = useRef(null);

  useEffect(() => {
    api.listWarehouses()
      .then(d => setFacilities((d.data || []).filter(w => String(w.id) !== String(sourceWarehouseId)).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
    api.listMaterials()
      .then(d => setMaterials(d.data || []))
      .catch(() => {});
  }, [sourceWarehouseId]);

  const selectedFacility = facilities.find(f => String(f.id) === String(toWarehouseId)) || null;
  const filteredFacilities = facilities.filter(f => {
    const q = facilitySearch.toLowerCase();
    return !q || f.name.toLowerCase().includes(q) || (f.code || '').toLowerCase().includes(q);
  });

  const filtered = materials.filter(m =>
    m.code.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase())
  );

  function selectFacility(f) {
    setToWarehouseId(String(f.id));
    setFacilitySearch('');
    setShowFacilityDd(false);
  }

  function clearFacility() {
    setToWarehouseId('');
    setFacilitySearch('');
  }

  function toggleItem(mat) {
    const isSelected = !!items.find(i => i.material_id === mat.id);
    if (isSelected) {
      setItems(prev => prev.filter(i => i.material_id !== mat.id));
    } else {
      setItems(prev => [...prev, { material_id: mat.id, material: mat, qty_disp: '' }]);
    }
    setTimeout(() => matSearchRef.current?.focus(), 0);
  }

  function removeItem(materialId) {
    setItems(prev => prev.filter(i => i.material_id !== materialId));
  }

  function setQty(materialId, val) {
    setItems(prev => prev.map(i => i.material_id === materialId ? { ...i, qty_disp: val } : i));
  }

  async function handleDispatch() {
    setError('');
    setLoading(true);
    try {
      const payload = {
        from_warehouse_id: Number(sourceWarehouseId),
        to_warehouse_id: Number(toWarehouseId),
        issue_date: issueDate,
        vehicle_no: vehicleNo || undefined,
        items: items.map(i => ({ material_id: i.material_id, issued_qty: toBase(i.material, i.qty_disp) })),
      };
      const data = await api.createTransfer(payload);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setToWarehouseId('');
    setFacilitySearch('');
    setItems([]);
    setIssueDate(todayIst);
    setVehicleNo('');
    setError('');
    setResult(null);
    setSearch('');
  }

  if (!sourceWarehouseId) {
    return <div className="text-sm text-slate-400 py-8 text-center">No facility mapped to your account — contact an admin.</div>;
  }

  if (result) {
    return (
      <div className="space-y-4 pt-2">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-green-700 font-semibold mb-2"><CheckCircle2 size={18} /> Transferred</div>
          <div className="text-sm text-green-700 space-y-1">
            {result.issue_refs.map(ref => <div key={ref} className="font-mono">{ref}</div>)}
          </div>
        </div>
        <button onClick={reset} className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm">Send Another</button>
      </div>
    );
  }

  const canSubmit = toWarehouseId && items.length > 0 && items.every(i => Number(i.qty_disp) > 0) && !loading;

  return (
    <div className="space-y-4 pt-2 pb-6">
      {sourceWarehouseName && (
        <div className="text-xs text-slate-500">From <span className="font-medium text-slate-700">{sourceWarehouseName}</span></div>
      )}

      {/* Destination facility search */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-500 mb-1">Send To</label>
        {selectedFacility ? (
          <div className="flex items-center gap-2 w-full border border-blue-300 bg-blue-50 rounded-xl px-3 py-3">
            <span className="flex-1 text-sm font-medium text-blue-800">{selectedFacility.name}
              {selectedFacility.code && <span className="ml-1.5 text-xs font-normal text-blue-500">({selectedFacility.code})</span>}
            </span>
            <button onClick={clearFacility} className="text-blue-400 hover:text-blue-700 text-lg leading-none">×</button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={facilitySearch}
              onChange={e => { setFacilitySearch(e.target.value); setShowFacilityDd(true); }}
              onFocus={() => setShowFacilityDd(true)}
              onBlur={() => setTimeout(() => setShowFacilityDd(false), 150)}
              placeholder="Search facility by name or code…"
              className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm"
            />
            {showFacilityDd && filteredFacilities.length > 0 && (
              <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-52 overflow-y-auto">
                {filteredFacilities.map(f => (
                  <button key={f.id} onMouseDown={() => selectFacility(f)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-800">{f.name}</span>
                    {f.code && <span className="ml-2 text-xs text-slate-400">{f.code}</span>}
                  </button>
                ))}
              </div>
            )}
            {showFacilityDd && facilitySearch.length > 0 && filteredFacilities.length === 0 && (
              <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 px-3 py-2.5 text-sm text-slate-400">No facilities found</div>
            )}
          </>
        )}
      </div>

      {/* Material multi-search */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-500 mb-1">
          Add Materials <span className="text-slate-300 font-normal">(search and select multiple)</span>
        </label>
        <input
          ref={matSearchRef}
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Search by code or name…"
          className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm"
        />
        {showDropdown && search.length > 0 && filtered.length > 0 && (
          <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-52 overflow-y-auto">
            {filtered.slice(0, 20).map(m => {
              const isSelected = !!items.find(i => i.material_id === m.id);
              return (
                <button key={m.id} onMouseDown={() => toggleItem(m)}
                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 border-b border-slate-100 last:border-0 ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center text-white text-[10px] font-bold ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                    {isSelected && '✓'}
                  </span>
                  <span className="font-mono font-medium text-blue-700">{m.code}</span>
                  <span className="text-slate-500 truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
        )}
        {showDropdown && search.length > 0 && filtered.length === 0 && (
          <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 px-3 py-2.5 text-sm text-slate-400">No materials found</div>
        )}
      </div>

      {/* Items list */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.material_id} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono font-medium text-blue-700">{item.material.code}</div>
                <div className="text-xs text-slate-500 truncate">{item.material.name}</div>
              </div>
              <input
                type="number"
                min="0"
                step={item.material.pieces_per_kg ? '0.001' : '1'}
                value={item.qty_disp}
                onChange={e => setQty(item.material_id, e.target.value)}
                placeholder="0"
                className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
              />
              <span className="text-xs text-slate-400 w-8">{dispUnit(item.material)}</span>
              <button onClick={() => removeItem(item.material_id)} className="text-slate-300 hover:text-red-400 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Date + Vehicle */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Transfer Date</label>
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm" />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Vehicle No <span className="text-slate-300">(optional)</span></label>
          <input type="text" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
            placeholder="KA01AB1234"
            className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm" />
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

      <button onClick={handleDispatch} disabled={!canSubmit}
        className={`w-full py-3.5 rounded-xl font-semibold text-sm ${canSubmit ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
        {loading ? 'Sending…' : `Send Transfer ${items.length > 0 ? `(${items.length} item${items.length > 1 ? 's' : ''})` : ''}`}
      </button>
    </div>
  );
}
