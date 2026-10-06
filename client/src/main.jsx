import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './index.css';
import { App } from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import { Toaster } from './components/Toaster.jsx';

/**
 * Provider order matters:
 *   Theme   — no dependencies, outermost so everything can read it.
 *   Toast   — Auth and Wallet both raise toasts.
 *   Auth    — WalletButton reads the user to save a contractor's address.
 *   Wallet  — innermost; depends on both of the above.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <WalletProvider>
              <App />
              <Toaster />
            </WalletProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
);
