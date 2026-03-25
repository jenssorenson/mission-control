import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'stats';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
}

interface ToastContextValue {
  toast: (msg: string, kind?: ToastKind, detail?: string) => void;
  success: (msg: string, detail?: string) => void;
  error: (msg: string, detail?: string) => void;
  info: (msg: string, detail?: string) => void;
  stats: (msg: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  stats: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const TOAST_ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
  stats: '📊',
};

const TOAST_COLORS: Record<ToastKind, string> = {
  success: 'var(--green)',
  error: 'var(--red)',
  info: 'var(--accent)',
  warning: 'var(--yellow)',
  stats: 'var(--cyan)',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const color = TOAST_COLORS[toast.kind];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '11px 14px',
        background: 'var(--bg-card)',
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: `0 4px 20px rgba(0,0,0,0.45), 0 0 16px ${color}22`,
        minWidth: '260px',
        maxWidth: '360px',
        fontFamily: "'Space Grotesk', sans-serif",
        transform: visible ? 'translateX(0) scale(1)' : 'translateX(40px) scale(0.95)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease',
      }}
    >
      <span style={{
        fontSize: '14px',
        color,
        flexShrink: 0,
        lineHeight: '1.4',
        width: '18px',
        textAlign: 'center',
      }}>
        {TOAST_ICONS[toast.kind]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.kind === 'stats' ? (
          <>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--cyan)', lineHeight: 1.4 }}>
              {toast.message}
            </div>
            {toast.detail && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>
                {toast.detail}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {toast.message}
            </div>
            {toast.detail && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>
                {toast.detail}
              </div>
            )}
          </>
        )}
      </div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 280); }}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '11px',
          padding: '2px 4px',
          flexShrink: 0,
          lineHeight: 1,
          borderRadius: '3px',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info', detail?: string) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, kind, message, detail }].slice(-4));
  }, []);

  const success = useCallback((msg: string, detail?: string) => toast(msg, 'success', detail), [toast]);
  const error = useCallback((msg: string, detail?: string) => toast(msg, 'error', detail), [toast]);
  const info = useCallback((msg: string, detail?: string) => toast(msg, 'info', detail), [toast]);
  const stats = useCallback((msg: string, detail?: string) => toast(msg, 'stats', detail), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, stats }}>
      {children}
      {/* Toast container */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
