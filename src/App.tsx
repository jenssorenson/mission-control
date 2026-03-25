import { useState } from 'react';
import Dashboard from './components/Dashboard';
import PasskeyAuth from './components/PasskeyAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);

  function handleLogout() {
    // Clear browser localStorage
    localStorage.removeItem('mc_passphrase');
    localStorage.removeItem('mc_key_salt');
    localStorage.removeItem('mc_key_hash');
    localStorage.removeItem('mc_passkey_session_expiry');
    localStorage.removeItem('mc_passkey_credential_id');
    localStorage.removeItem('mc_passkey_registered');
    // Call server to wipe server-side auth state
    fetch('/__gateway/auth', { method: 'DELETE' }).finally(() => {
      setAuthenticated(false);
    });
  }

  if (!authenticated && !isLocalhost) {
    return <PasskeyAuth onAuth={() => setAuthenticated(true)} />;
  }

  return (
    <ErrorBoundary name="Dashboard">
      <ToastProvider>
        <Dashboard onLogout={handleLogout} />
      </ToastProvider>
    </ErrorBoundary>
  );
}
