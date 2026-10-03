import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProviders } from './store';
import { AuthProvider } from './lib/auth';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <StoreProviders>
        <App />
      </StoreProviders>
    </AuthProvider>
  </React.StrictMode>
);
