import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProviders } from './store';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProviders>
      <App />
    </StoreProviders>
  </React.StrictMode>
);
