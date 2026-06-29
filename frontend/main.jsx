import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './portal.jsx';
import PMStoreOps from './pmstore-ops.jsx';
import ReceiptApp from './receipt-app.jsx';

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
