import { useState, useEffect } from 'react';

const CREDENTIAL_ID_KEY = 'mc_passkey_credential_id';
const REGISTERED_KEY = 'mc_passkey_registered';
const SESSION_EXPIRY_KEY = 'mc_passkey_session_expiry';
const PASSPHRASE_KEY = 'mc_passphrase';
const KEY_SALT_KEY = 'mc_key_salt';
const KEY_HASH_KEY = 'mc_key_hash';

interface Props {
  onAuth: () => void;
}

// ── Key derivation (must match server/api.ts PBKDF2 params) ──────────────────
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { name: 'PBKDF2', salt: salt as any, iterations: 120000, hash: 'SHA-256' },
    keyMaterial,
    256,
  ) as ArrayBuffer;
  const bytes = new Uint8Array(bits);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function saltToHex(salt: Uint8Array): string {
  return Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeAndStoreHash(): Promise<void> {
  const passphrase = localStorage.getItem(PASSPHRASE_KEY);
  const saltHex = localStorage.getItem(KEY_SALT_KEY);
  if (!passphrase || !saltHex) return;
  // saltHex is stored as a hex string; convert to Uint8Array for deriveKey
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const hash = await deriveKey(passphrase, salt);
  localStorage.setItem(KEY_HASH_KEY, hash);
}

export default function PasskeyAuth({ onAuth }: Props) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [supportsWebAuthn, setSupportsWebAuthn] = useState(true);

  useEffect(() => {
    // Check server-side registration state
    fetch('/__gateway/auth/status')
      .then(r => r.json())
      .then(data => {
        if (!data.registered) {
          // No passkey registered server-side — show registration screen
          setIsRegistered(false);
          setSupportsWebAuthn(typeof navigator !== 'undefined' && !!navigator.credentials);
          return;
        }
        // Passkey is registered server-side — must login with that passkey
        // Check localStorage for credential + valid session
        const storedCredId = localStorage.getItem(CREDENTIAL_ID_KEY);
        const sessionExpiry = localStorage.getItem(SESSION_EXPIRY_KEY);
        if (storedCredId && sessionExpiry && Date.now() < parseInt(sessionExpiry)) {
          onAuth();
          return;
        }
        setIsRegistered(true);
      })
      .catch(() => {
        // Server unreachable — fail closed (show login if we have a local credential)
        const storedCredId = localStorage.getItem(CREDENTIAL_ID_KEY);
        if (storedCredId) {
          const sessionExpiry = localStorage.getItem(SESSION_EXPIRY_KEY);
          if (sessionExpiry && Date.now() < parseInt(sessionExpiry)) {
            onAuth();
            return;
          }
        }
        setIsRegistered(true);
      });
  }, [onAuth]);

  // Generate a random challenge
  function generateChallenge(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  // Convert ArrayBuffer to base64url string
  function bufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // Convert base64url string to ArrayBuffer
  function base64UrlToBuffer(url: string): ArrayBuffer {
    const base64 = url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer as ArrayBuffer;
  }

  async function handleRegister() {
    setError('');
    setIsLoading(true);

    try {
      if (!supportsWebAuthn) {
        setError('WebAuthn is not supported in this browser.');
        return;
      }

      const challenge = generateChallenge();
      const rpId = window.location.hostname;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            id: rpId,
            name: 'OpenClaw Mission Control',
          },
          user: {
            id: new TextEncoder().encode('openclaw-user'),
            name: 'openclaw-user',
            displayName: 'OpenClaw User',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        } as any,
      }) as PublicKeyCredential;

      if (!credential) {
        setError('Passkey registration was cancelled.');
        return;
      }

      const rawId = bufferToBase64Url(credential.rawId);

      // Store credential ID locally and register with server
      localStorage.setItem(CREDENTIAL_ID_KEY, rawId);
      localStorage.setItem(REGISTERED_KEY, 'true');
      localStorage.setItem(SESSION_EXPIRY_KEY, (Date.now() + 168 * 60 * 60 * 1000).toString());

      // Register credential ID server-side (this is what controls access)
      const regRes = await fetch('/__gateway/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: rawId }),
      });
      if (!regRes.ok) {
        setError('Passkey registered locally but server registration failed.');
        return;
      }

      // Generate and store passphrase, salt, and derived hash for API auth
      const passphrase = randomHex(32);
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const saltHex = saltToHex(saltBytes);
      localStorage.setItem(PASSPHRASE_KEY, passphrase);
      localStorage.setItem(KEY_SALT_KEY, saltHex);
      const hash = await deriveKey(passphrase, saltBytes);
      localStorage.setItem(KEY_HASH_KEY, hash);

      setIsRegistered(true);
      onAuth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cancel') || msg.includes('cancelled')) {
        setError('Registration was cancelled.');
      } else {
        setError('Passkey registration failed: ' + msg);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogin() {
    setError('');
    setIsLoading(true);

    try {
      const credentialId = localStorage.getItem(CREDENTIAL_ID_KEY);
      if (!credentialId) {
        setError('No passkey found. Please reload and register first.');
        return;
      }

      const challenge = generateChallenge();
      const rpId = window.location.hostname;

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as any,
          rpId,
          allowCredentials: [
            {
              id: base64UrlToBuffer(credentialId) as any,
              type: 'public-key',
            },
          ] as any,
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!assertion) {
        setError('Authentication was cancelled.');
        return;
      }

      // If we got here, authentication succeeded
      localStorage.setItem(SESSION_EXPIRY_KEY, (Date.now() + 168 * 60 * 60 * 1000).toString());
      // Recompute and store the API auth hash (needed for every API call)
      await computeAndStoreHash();
      onAuth();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cancel') || msg.includes('cancelled') || msg.includes('NotAllowedError')) {
        setError('Authentication was cancelled or denied.');
      } else {
        setError('Authentication failed: ' + msg);
      }
    } finally {
      setIsLoading(false);
    }
  }

  if (!supportsWebAuthn) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-icon">⚠️</div>
          <h2>WebAuthn Not Supported</h2>
          <p className="auth-subtitle">
            This browser does not support WebAuthn passkeys.
            Please use a modern browser with biometric authentication enabled.
          </p>
        </div>
      </div>
    );
  }

  if (isRegistered) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-icon">🔐</div>
          <h2>Mission Control</h2>
          <p className="auth-subtitle">
            Sign in with your passkey to access the dashboard.
          </p>
          {error && <p className="auth-error">{error}</p>}
          <button
            className="auth-btn"
            onClick={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? 'Authenticating...' : 'Sign in with Passkey'}
          </button>
        </div>
      </div>
    );
  }

  // First ever visit — one-time registration
  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-icon">🛡️</div>
        <h2>Register Passkey</h2>
        <p className="auth-subtitle">
          Create a passkey to protect your Mission Control.
          <br />
          Your device&apos;s <strong>Face ID or Touch ID</strong> will be used.
          <br />
          <strong>This is one-time only — choose wisely.</strong>
        </p>
        {error && <p className="auth-error">{error}</p>}
        <button
          className="auth-btn primary"
          onClick={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? 'Preparing...' : 'Register Passkey'}
        </button>
        <p className="auth-warning">
          ⚠️ After registration, this app is permanently single-user.
        </p>
      </div>
    </div>
  );
}
