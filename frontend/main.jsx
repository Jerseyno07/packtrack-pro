import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './portal.jsx';
import PMStoreOps from './pmstore-ops.jsx';
import ReceiptApp from './receipt-app.jsx';
import ProcApp from './proc-app.jsx';
import PMConfigApp from './pmconfig-app.jsx';
import MaintenanceScreen from './MaintenanceScreen.jsx';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: 'production',
});

// Flip to false to bring all 5 apps back once the Railway incident is resolved
// and credentials are rotated — see 05 - Change Log.md, October 22 2026.
const MAINTENANCE_MODE = false;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {MAINTENANCE_MODE ? <MaintenanceScreen /> : (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/ops" element={<PMStoreOps />} />
          <Route path="/receipt" element={<ReceiptApp />} />
          <Route path="/proc" element={<ProcApp />} />
          <Route path="/pmconfig" element={<PMConfigApp />} />
        </Routes>
      </BrowserRouter>
    )}
  </StrictMode>
);
