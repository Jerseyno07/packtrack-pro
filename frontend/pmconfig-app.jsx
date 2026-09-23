import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, LogOut, LogIn, RefreshCw, AlertTriangle, CheckCircle2, Camera, X, ImagePlus } from 'lucide-react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

const BASE_URL = import.meta.env.DEV ? '' : 'https://packtrack-pro-production.up.railway.app';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function makeApi(token) {
  async function req(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  }
  return {
    login: (email, password) => req('POST', '/api/v1/auth/login', { email, password }),
    googleLogin: (idToken) => req('POST', '/api/v1/auth/google', { id_token: idToken }),
    lookup: (ean) => req('GET', `/api/v1/pmconfig/lookup?ean=${encodeURIComponent(ean)}`),
    listMaterials: () => req('GET', '/api/v1/materials'),
    photoUrl: (scanId) => req('GET', `/api/v1/pmconfig/scans/${scanId}/photo`),
    validate: async (formData) => {
      const res = await fetch(`${BASE_URL}/api/v1/pmconfig/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Submit failed');
      return data;
    },
  };
}

function useGoogleSignIn(buttonRef, onCredential) {
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    function render() {
      if (!window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        hd: 'ninjacart.com',
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', width: 296 });
    }
    if (window.google?.accounts?.id) { render(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [buttonRef, onCredential]);
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const googleButtonRef = useRef(null);

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

  const handleGoogleCredential = useCallback(async (idToken) => {
    setError('');
    try {
      const data = await makeApi(null).googleLogin(idToken);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    }
  }, [onLogin]);

  useGoogleSignIn(googleButtonRef, handleGoogleCredential);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto mb-3">
            <Package size={28} />
          </div>
          <div className="font-bold text-xl text-slate-900">PM Config</div>
          <div className="text-sm text-slate-500 mt-1">PackTrack Pro</div>
        </div>
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}
        {GOOGLE_CLIENT_ID && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
            <div ref={googleButtonRef} className="flex justify-center" />
            <div className="flex items-center gap-2 mt-4">
              <div className="flex-1 h-px bg-slate-200" /><span className="text-xs text-slate-400">or</span><div className="flex-1 h-px bg-slate-200" />
            </div>
          </div>
        )}
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
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// Simple type-to-filter picker over a preloaded materials list — same
// interaction idea as the facility search in TransferSendScreen.jsx.
function MaterialPicker({ label, required, materials, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = materials.find((m) => m.code === value);
  const matches = query.trim()
    ? materials.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()) || m.code.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="relative">
      <label className="text-xs font-medium text-slate-500 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {selected ? (
        <div className="flex items-center justify-between px-3 py-2.5 border border-slate-300 rounded-lg bg-slate-50">
          <span className="text-sm text-slate-800">{selected.name} <span className="text-slate-400 text-xs">({selected.code})</span></span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {open && matches.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {matches.map((m) => (
                <button key={m.code} type="button"
                  onClick={() => { onChange(m.code); setQuery(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  {m.name} <span className="text-slate-400 text-xs">({m.code})</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ScanView({ token, user, onLogout }) {
  const api = makeApi(token);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [manualEan, setManualEan] = useState('');
  const [scanning, setScanning] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { sku, recent_scans }
  const [materials, setMaterials] = useState([]);
  const [sameAsBizfin, setSameAsBizfin] = useState(true);
  const [primaryCode, setPrimaryCode] = useState(null);
  const [secondaryCode, setSecondaryCode] = useState(null);
  const [tertiaryCode, setTertiaryCode] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => { api.listMaterials().then((d) => setMaterials(Array.isArray(d.data) ? d.data : [])).catch(() => {}); }, []);

  const doLookup = useCallback(async (ean) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.lookup(ean);
      setResult(data);
      setSameAsBizfin(true);
      setPrimaryCode(null);
      setSecondaryCode(null);
      setTertiaryCode(null);
      setPhotoFile(null);
      setScanning(false);
    } catch (e) {
      setError(e.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Camera scanning — only runs while in scanning mode (not while a result is shown).
  useEffect(() => {
    if (!scanning) return;
    setCameraError('');
    // The physical codes on packs here are QR (encoding the EAN as text),
    // not 1D barcodes — TRY_HARDER plus an explicit format list (QR_CODE
    // first, since that's what's actually scanned, common 1D formats kept
    // too so a real barcode still works if one's ever used) is the
    // documented fix for continuous-scan decode reliability. Found live:
    // camera feed worked fine, codes just never decoded, until this was
    // added.
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    let cancelled = false;
    reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current, (decoded, err, controls) => {
      controlsRef.current = controls;
      if (decoded && !cancelled) {
        cancelled = true;
        controls.stop();
        doLookup(decoded.getText());
      }
    }).catch((e) => setCameraError(e.message || 'Camera access failed — use manual entry below instead.'));

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [scanning, doLookup]);

  function handleManualLookup(e) {
    e.preventDefault();
    if (!manualEan.trim()) return;
    doLookup(manualEan.trim());
  }

  function backToScan() {
    setResult(null);
    setManualEan('');
    setSubmitError('');
    setScanning(true);
  }

  async function handleSubmit() {
    if (!result) return;
    if (!sameAsBizfin && !primaryCode) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const fd = new FormData();
      fd.append('sku_code', result.sku.sku_code);
      fd.append('ean', result.sku.ean || '');
      fd.append('same_as_bizfin', String(sameAsBizfin));
      if (!sameAsBizfin) {
        fd.append('primary_pm_code', primaryCode);
        if (secondaryCode) fd.append('secondary_pm_code', secondaryCode);
        if (tertiaryCode) fd.append('tertiary_pm_code', tertiaryCode);
        if (photoFile) fd.append('photo', photoFile);
      }
      await api.validate(fd);
      // Auto-return to the scan screen — no manual "scan next" step.
      backToScan();
    } catch (e) {
      setSubmitError(e.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = sameAsBizfin || !!primaryCode;

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
            <div>
              <div className="font-bold text-slate-900 text-sm">PM Config</div>
              <div className="text-xs text-slate-400">{user?.name || user?.email}</div>
            </div>
          </div>
          <button onClick={onLogout} className="p-2.5 text-slate-400 active:text-slate-600">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-10 space-y-4">
        {scanning ? (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-3">
                <Camera size={16} /> Scan QR Code
              </div>
              <video ref={videoRef} className="w-full rounded-lg bg-black aspect-video" muted playsInline />
              {cameraError && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{cameraError}</span>
                </div>
              )}
            </div>

            <form onSubmit={handleManualLookup} className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <label className="text-xs font-medium text-slate-500 block">Or enter EAN manually</label>
              <div className="flex gap-2">
                <input type="text" inputMode="numeric" value={manualEan} onChange={(e) => setManualEan(e.target.value)}
                  placeholder="e.g. 8904293703254"
                  className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="submit" disabled={loading || !manualEan.trim()}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : 'Look up'}
                </button>
              </div>
            </form>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={backToScan} className="text-sm text-blue-600 hover:underline">&larr; Back to scan</button>

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <div className="text-xs text-slate-400 font-mono">{result.sku.sku_code}</div>
              <div className="font-bold text-slate-900">{result.sku.sku_name || <span className="text-slate-400 italic">No name on file</span>}</div>
              <div className="grid grid-cols-2 gap-2 text-sm pt-2">
                <div><span className="text-slate-400 text-xs block">Primary Material</span>{result.sku.primary_pm_name || '—'}</div>
                <div><span className="text-slate-400 text-xs block">Secondary Material</span>{result.sku.secondary_pm_name || '—'}</div>
                <div><span className="text-slate-400 text-xs block">Tertiary Material</span>{result.sku.tertiary_pm_name || '—'}</div>
                <div><span className="text-slate-400 text-xs block">Packing Type</span>{result.sku.packing_type || '—'}</div>
              </div>
            </div>

            {result.recent_scans.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-500 mb-2">Scan history</div>
                <div className="space-y-1.5">
                  {result.recent_scans.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{s.scanned_by_name} {s.same_as_bizfin ? <span className="text-emerald-600">(confirmed)</span> : <span className="text-amber-600">(corrected)</span>}</span>
                      <span className="text-slate-400">{new Date(s.scanned_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sameAsBizfin} onChange={(e) => setSameAsBizfin(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm font-medium text-slate-800">Same as Bizfin</span>
              </label>

              {!sameAsBizfin && (
                <div className="space-y-3 pt-1">
                  <MaterialPicker label="Primary Packing Material" required materials={materials} value={primaryCode} onChange={setPrimaryCode} />
                  <MaterialPicker label="Secondary Packing Material" materials={materials} value={secondaryCode} onChange={setSecondaryCode} />
                  <MaterialPicker label="Tertiary Packing Material" materials={materials} value={tertiaryCode} onChange={setTertiaryCode} />
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Photo (optional)</label>
                    <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 cursor-pointer hover:border-blue-400">
                      <ImagePlus size={15} />
                      {photoFile ? photoFile.name : 'Attach a photo of the actual pack'}
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{submitError}</span>
                </div>
              )}

              <button onClick={handleSubmit} disabled={!canSubmit || submitting}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PMConfigApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  if (!token) {
    return <LoginScreen onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  }

  return <ScanView token={token} user={user} onLogout={() => { setToken(null); setUser(null); }} />;
}
