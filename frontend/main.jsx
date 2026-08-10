import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './portal.jsx';
import PMStoreOps from './pmstore-ops.jsx';
import ReceiptApp from './receipt-app.jsx';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: 'production',
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/ops" element={<PMStoreOps />} />
        <Route path="/receipt" element={<ReceiptApp />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
