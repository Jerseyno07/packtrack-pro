import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, LogOut, LogIn, RefreshCw, AlertTriangle, X, FileImage, ExternalLink } from 'lucide-react';
import DicePendingSection from './DicePendingSection.jsx';

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
    listPurchaseOrders: () => req('GET', '/api/v1/procurement/purchase-orders'),
    invoiceImageUrl: (grnId) => req('GET', `/api/v1/goods-receipts/${grnId}/invoice-image`),
  };
}

// Same Google Identity Services pattern as pmstore-ops.jsx / portal.jsx.
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

function Badge({ children, tone = 'gray' }) {
  const tones = { gray: 'bg-slate-100 text-slate-600', blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
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
          <div className="font-bold text-xl text-slate-900">Procurement</div>
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

// Small modal that fetches a presigned invoice-image URL on demand and
// renders it inline — the "quick view" the procurement team asked for.
function InvoiceQuickView({ grn, api, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.invoiceImageUrl(grn.id)
      .then((d) => setUrl(d.url))
      .catch((e) => setError(e.message || 'Could not load invoice'))
      .finally(() => setLoading(false));
  }, [grn.id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <div className="font-bold text-slate-900 text-sm">{grn.grn_ref}</div>
            <div className="text-xs text-slate-500">{grn.invoice_no ? `Invoice ${grn.invoice_no}` : 'No invoice number recorded'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="py-16 text-center text-slate-400"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading…</div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-red-600 flex flex-col items-center gap-2">
              <AlertTriangle size={20} />
              {error}
              {error.includes('No invoice') && (
                <p className="text-xs text-slate-400 max-w-xs">This GRN was posted before invoice storage moved to durable storage — the original image no longer exists.</p>
              )}
            </div>
          ) : (
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="Invoice" className="w-full rounded-lg border border-slate-200" />
              <div className="flex items-center gap-1 text-xs text-blue-600 mt-2 justify-center"><ExternalLink size={12} /> Open full size</div>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function POUploadedSection({ token }) {
  const api = makeApi(token);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quickView, setQuickView] = useState(null);

  function load() {
    setLoading(true);
    setError('');
    api.listPurchaseOrders()
      .then((d) => setRows(Array.isArray(d.data) ? d.data : []))
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">PO Uploaded</h2>
          <p className="text-sm text-slate-500">Status of every purchase order line — GRN progress and invoice attachments per GRN.</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw size={16} className="animate-spin inline mr-2" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 py-16 text-center text-slate-400 text-sm">No purchase orders yet.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">PO No.</th>
                <th className="text-left px-4 py-2.5">Vendor</th>
                <th className="text-left px-4 py-2.5">Material</th>
                <th className="text-left px-4 py-2.5">PM Store</th>
                <th className="text-left px-4 py-2.5">Source</th>
                <th className="text-right px-4 py-2.5">GRN / Total Qty</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{po.po_no}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate" title={po.vendor_name}>{po.vendor_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{po.material_code}</td>
                  <td className="px-4 py-3 text-slate-600">{po.warehouse_name}</td>
                  <td className="px-4 py-3"><Badge tone={po.source === 'DICE_PUSH' ? 'blue' : 'gray'}>{po.source === 'DICE_PUSH' ? 'DICE' : 'CSV'}</Badge></td>
                  <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">{Number(po.received_qty_cache).toLocaleString()} / {Number(po.po_qty).toLocaleString()} {po.unit}</td>
                  <td className="px-4 py-3"><Badge tone={po.status === 'CLOSED' ? 'green' : po.status === 'CANCELLED' || po.status === 'FORCE_COMPLETED' ? 'red' : 'amber'}>{po.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3">
                    {po.grns.length === 0 ? (
                      <span className="text-xs text-slate-400">No GRN yet</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {po.grns.map((g) => (
                          <button key={g.id} onClick={() => setQuickView(g)} disabled={!g.has_invoice}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-not-allowed w-fit">
                            <FileImage size={12} /> {g.grn_ref} {!g.has_invoice && '(no image)'}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quickView && <InvoiceQuickView grn={quickView} api={api} onClose={() => setQuickView(null)} />}
    </div>
  );
}

export default function ProcApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('pos');

  if (!token) {
    return <LoginScreen onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Package size={16} className="text-white" /></div>
            <div>
              <div className="font-bold text-slate-900 text-sm">Procurement</div>
              <div className="text-xs text-slate-400">{user?.name || user?.email}</div>
            </div>
          </div>
          <button onClick={() => { setToken(null); setUser(null); }} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600">
            <LogOut size={16} /> Sign Out
          </button>
        </div>
        <div className="flex gap-1 mt-3">
          <button onClick={() => setTab('pos')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'pos' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>PO Uploaded</button>
          <button onClick={() => setTab('flagged')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'flagged' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>Flagged PO Items</button>
        </div>
      </div>

      <div className="p-6">
        {tab === 'pos' && <POUploadedSection token={token} />}
        {tab === 'flagged' && <DicePendingSection token={token} canMapMaterials={false} />}
      </div>
    </div>
  );
}
