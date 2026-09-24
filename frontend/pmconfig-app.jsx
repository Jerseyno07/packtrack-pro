import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, LogOut, LogIn, RefreshCw, AlertTriangle, CheckCircle2, Camera, X, ImagePlus, MonitorSmartphone } from 'lucide-react';
import jsQR from 'jsqr';

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
  const { canInstall, install, showInstructions, setShowInstructions } = useInstallPrompt();
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

// Simple type-to-filter picker over a preloaded materials list — same
// interaction idea as the facility search in TransferSendScreen.jsx.
// Sentinel for "the physical material isn't in this list at all" — kept in
// sync with the server's PM_OTHER_SENTINEL. Picking it reveals a mandatory
// free-text field in the parent, since PackTrack's materials list can't be
// assumed to cover what's actually on the shelf.
const PM_OTHER_CODE = '__OTHER__';

function MaterialPicker({ label, required, materials, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const isOther = value === PM_OTHER_CODE;
  const selected = !isOther ? materials.find((m) => m.code === value) : null;
  const matches = query.trim()
    ? materials.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()) || m.code.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="relative">
      <label className="text-xs font-medium text-slate-500 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {isOther ? (
        <div className="flex items-center justify-between px-3 py-2.5 border border-amber-300 rounded-lg bg-amber-50">
          <span className="text-sm text-amber-800">Others</span>
          <button type="button" onClick={() => onChange(null)} className="text-amber-500 hover:text-amber-700"><X size={14} /></button>
        </div>
      ) : selected ? (
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
          {open && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {matches.map((m) => (
                <button key={m.code} type="button"
                  onClick={() => { onChange(m.code); setQuery(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  {m.name} <span className="text-slate-400 text-xs">({m.code})</span>
                </button>
              ))}
              <button type="button"
                onClick={() => { onChange(PM_OTHER_CODE); setQuery(''); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                Others (not in this list)
              </button>
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
  const [primaryOtherText, setPrimaryOtherText] = useState('');
  const [secondaryOtherText, setSecondaryOtherText] = useState('');
  const [tertiaryOtherText, setTertiaryOtherText] = useState('');
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
      setPrimaryOtherText('');
      setSecondaryOtherText('');
      setTertiaryOtherText('');
      setPhotoFile(null);
      setScanning(false);
    } catch (e) {
      setError(e.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Camera scanning — only runs while in scanning mode (not while a result is
  // shown). Tries the native BarcodeDetector API first — hardware-accelerated,
  // decodes the full video frame directly with no per-frame JS/canvas cost,
  // and is what actually closes the speed gap with a native scanner app.
  // Falls back to a jsQR + canvas loop only on browsers without it. That
  // fallback deliberately isn't @zxing/browser's own video-handling layer,
  // which has open, unresolved iPhone-specific continuous-decode issues
  // (confirmed live: camera feed worked fine on iOS Safari, codes just never
  // decoded there).
  useEffect(() => {
    if (!scanning) return;
    setCameraError('');
    let stream = null;
    let rafId = null;
    let stopped = false;

    // jsQR fallback only — decoding a center-cropped, capped-resolution
    // square instead of the full frame keeps pure-JS decode cost down (its
    // cost scales with pixel count, unlike the native detector below).
    const DECODE_SIZE = 400;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function finish(text) {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      doLookup(text);
    }

    function tickJsQR() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;
        canvas.width = DECODE_SIZE;
        canvas.height = DECODE_SIZE;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, DECODE_SIZE, DECODE_SIZE);
        const imageData = ctx.getImageData(0, 0, DECODE_SIZE, DECODE_SIZE);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) { finish(code.data); return; }
      }
      rafId = requestAnimationFrame(tickJsQR);
    }

    function tickNative(detector) {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_ENOUGH_DATA || video.videoWidth === 0) {
        rafId = requestAnimationFrame(() => tickNative(detector));
        return;
      }
      detector.detect(video)
        .then((codes) => {
          if (stopped) return;
          if (codes.length > 0) { finish(codes[0].rawValue); return; }
          rafId = requestAnimationFrame(() => tickNative(detector));
        })
        .catch(() => {
          if (!stopped) rafId = requestAnimationFrame(() => tickNative(detector));
        });
    }

    async function getDetector() {
      if (!('BarcodeDetector' in window)) return null;
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (!formats.includes('qr_code')) return null;
        return new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        return null;
      }
    }

    (async () => {
      try {
        const detector = await getDetector();
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            // Native detection is hardware-accelerated with no per-frame JS
            // cost, so it can afford a sharper feed for better range; the
            // jsQR fallback stays lower-res since its cost scales with pixels.
            width: { ideal: detector ? 1280 : 640 },
            height: { ideal: detector ? 720 : 480 },
          },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        if (detector) tickNative(detector); else tickJsQR();
      } catch (e) {
        setCameraError(e.message || 'Camera access failed — use manual entry below instead.');
      }
    })();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
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
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const fd = new FormData();
      fd.append('sku_code', result.sku.sku_code);
      fd.append('ean', result.sku.ean || '');
      fd.append('same_as_bizfin', String(sameAsBizfin));
      if (!sameAsBizfin) {
        fd.append('primary_pm_code', primaryCode);
        if (primaryCode === PM_OTHER_CODE) fd.append('primary_pm_other', primaryOtherText.trim());
        if (secondaryCode) fd.append('secondary_pm_code', secondaryCode);
        if (secondaryCode === PM_OTHER_CODE) fd.append('secondary_pm_other', secondaryOtherText.trim());
        if (tertiaryCode) fd.append('tertiary_pm_code', tertiaryCode);
        if (tertiaryCode === PM_OTHER_CODE) fd.append('tertiary_pm_other', tertiaryOtherText.trim());
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

  const canSubmit = sameAsBizfin || (
    !!primaryCode
    && (primaryCode !== PM_OTHER_CODE || !!primaryOtherText.trim())
    && (secondaryCode !== PM_OTHER_CODE || !!secondaryOtherText.trim())
    && (tertiaryCode !== PM_OTHER_CODE || !!tertiaryOtherText.trim())
  );

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
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-lg bg-black aspect-[3/4] object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-[80%] aspect-square border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">Center the QR code in the box for a faster scan</p>
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
                  <div>
                    <MaterialPicker label="Primary Packing Material" required materials={materials} value={primaryCode} onChange={setPrimaryCode} />
                    {primaryCode === PM_OTHER_CODE && (
                      <input type="text" value={primaryOtherText} onChange={(e) => setPrimaryOtherText(e.target.value)}
                        placeholder="Describe the actual primary packing material"
                        className="mt-2 w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    )}
                  </div>
                  <div>
                    <MaterialPicker label="Secondary Packing Material" materials={materials} value={secondaryCode} onChange={setSecondaryCode} />
                    {secondaryCode === PM_OTHER_CODE && (
                      <input type="text" value={secondaryOtherText} onChange={(e) => setSecondaryOtherText(e.target.value)}
                        placeholder="Describe the actual secondary packing material"
                        className="mt-2 w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    )}
                  </div>
                  <div>
                    <MaterialPicker label="Tertiary Packing Material" materials={materials} value={tertiaryCode} onChange={setTertiaryCode} />
                    {tertiaryCode === PM_OTHER_CODE && (
                      <input type="text" value={tertiaryOtherText} onChange={(e) => setTertiaryOtherText(e.target.value)}
                        placeholder="Describe the actual tertiary packing material"
                        className="mt-2 w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    )}
                  </div>
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
