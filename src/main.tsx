import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── Global client-side error handler ────────────────────────────────────────
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

async function sendClientError(error: ErrorEvent | PromiseRejectionEvent | Error, source?: string) {
  const payload: any = {
    message: error instanceof Error ? error.message : (error as any).reason?.message || String(error),
    stack: error instanceof Error ? error.stack : (error as any).reason?.stack || '',
    url: window.location.href,
  };
  if (source) payload.source = source;

  try {
    // Try the proxied API endpoint first (works for both dev and prod)
    await fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Fallback: post directly to API server (for production static serving)
    try {
      await fetch(`${isLocalhost ? 'http://localhost:3001' : ''}/api/client-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Silently fail — don't loop
    }
  }
}

window.addEventListener('error', (e) => sendClientError(e, 'window.onerror'));
window.addEventListener('unhandledrejection', (e) => sendClientError(e, 'unhandledrejection'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
