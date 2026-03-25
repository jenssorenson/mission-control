import { useState, useEffect, useRef, useCallback } from 'react';
import type { Notification, NotificationKind, NotificationPriority, SystemEvent, ActivityEvent } from '../types';

const STORAGE_KEY = 'mc_notifications';
const MAX_NOTIFICATIONS = 100;

const NOTIF_CONFIG: Record<NotificationPriority, { icon: string; color: string; bg: string; border: string }> = {
  error:   { icon: '✕',  color: 'var(--red)',    bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.35)' },
  warning: { icon: '⚠',  color: 'var(--yellow)', bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.3)'  },
  success: { icon: '✓',  color: 'var(--green)',  bg: 'rgba(52,211,153,0.1)',   border: 'rgba(52,211,153,0.3)'  },
  info:    { icon: 'ℹ',  color: 'var(--accent)', bg: 'rgba(59,122,255,0.1)',   border: 'rgba(59,122,255,0.3)'  },
};

const KIND_LABELS: Record<NotificationKind, string> = {
  error:    'Error',
  milestone: 'Milestone',
  gateway:   'Gateway',
  reminder:  'Reminder',
  spawn:     'Spawn',
  kill:      'Killed',
};

function formatRelTime(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveNotifications(notifs: Notification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs));
  } catch {}
}

// ─── Bell button with unread badge ─────────────────────────────────────────────

interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  const hasUnread = unreadCount > 0;
  return (
    <button
      className="notif-bell-btn"
      onClick={onClick}
      title={`Notifications${hasUnread ? ` (${unreadCount} unread)` : ''}`}
      style={{
        position: 'relative',
        background: hasUnread ? 'rgba(59,122,255,0.15)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hasUnread ? 'rgba(59,122,255,0.4)' : 'var(--border)'}`,
        borderRadius: '8px',
        color: hasUnread ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '16px',
        padding: '5px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        boxShadow: hasUnread ? '0 0 10px rgba(59,122,255,0.2)' : 'none',
      }}
    >
      🔔
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            minWidth: '16px',
            height: '16px',
            borderRadius: '8px',
            background: 'var(--red)',
            color: 'white',
            fontSize: '9px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            boxShadow: '0 0 6px rgba(248,113,113,0.6)',
            animation: 'pulse-live 2s ease-in-out infinite',
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

// ─── Notification item row ──────────────────────────────────────────────────────

interface NotifItemProps {
  notif: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onSelectSession?: (sessionKey: string) => void;
}

function NotifItem({ notif, onMarkRead, onDismiss, onSelectSession }: NotifItemProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = NOTIF_CONFIG[notif.priority];
  const isRecent = Date.now() - notif.timestamp < 30000; // within 30s

  return (
    <div
      className={`notif-item${notif.read ? ' notif-item--read' : ''}${isRecent ? ' notif-item--recent' : ''}`}
      style={{
        borderLeft: `2px solid ${cfg.border}`,
        background: notif.read ? 'transparent' : cfg.bg,
        opacity: notif.read ? 0.6 : 1,
        transition: 'background 0.3s, opacity 0.3s',
      }}
      onClick={() => {
        if (!notif.read) onMarkRead(notif.id);
        setExpanded(v => !v);
      }}
    >
      <div className="notif-item-row">
        {/* Icon */}
        <span style={{ fontSize: '13px', flexShrink: 0, color: cfg.color }}>
          {cfg.icon}
        </span>

        {/* Content */}
        <div className="notif-content" style={{ flex: 1, minWidth: 0 }}>
          <div className="notif-title-row">
            <span
              className="notif-priority-badge"
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: cfg.color,
                background: `${cfg.color}14`,
                border: `1px solid ${cfg.color}33`,
                borderRadius: '8px',
                padding: '1px 5px',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                flexShrink: 0,
              }}
            >
              {KIND_LABELS[notif.kind]}
            </span>
            <span className="notif-title" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {notif.title}
            </span>
            {!notif.read && (
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--accent)', flexShrink: 0,
                boxShadow: '0 0 4px var(--accent)',
              }} />
            )}
          </div>
          {notif.detail && (
            <div className="notif-detail" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {notif.detail}
            </div>
          )}
          {/* Runtime/agent meta */}
          {(notif.runtime || notif.agentName) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
              {notif.runtime && (
                <span style={{
                  fontSize: '9px', fontWeight: 600,
                  color: notif.runtime === 'dev' ? 'var(--dev)' : notif.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px', padding: '1px 5px',
                }}>
                  {notif.runtime === 'pi' ? 'Pi' : notif.runtime.charAt(0).toUpperCase() + notif.runtime.slice(1)}
                </span>
              )}
              {notif.agentName && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {notif.agentName}
                </span>
              )}
            </div>
          )}
          {/* Reminder countdown */}
          {notif.kind === 'reminder' && notif.reminderAt && (
            <div style={{
              marginTop: '4px', fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
              color: notif.reminderAt < Date.now() ? 'var(--yellow)' : 'var(--text-muted)',
            }}>
              {notif.reminderAt < Date.now()
                ? `⏰ Due ${formatRelTime(notif.reminderAt)}`
                : `⏰ In ${formatRelTime(notif.reminderAt)}`}
            </div>
          )}
        </div>

        {/* Actions + timestamp */}
        <div className="notif-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
          <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
            title={new Date(notif.timestamp).toLocaleString()}>
            {formatRelTime(notif.timestamp)}
          </span>
          <div style={{ display: 'flex', gap: '3px' }}>
            {!notif.read && (
              <button
                className="notif-action-btn"
                onClick={(e) => { e.stopPropagation(); onMarkRead(notif.id); }}
                title="Mark as read"
                style={{ color: 'var(--text-muted)' }}
              >
                ✓
              </button>
            )}
            <button
              className="notif-action-btn"
              onClick={(e) => { e.stopPropagation(); onDismiss(notif.id); }}
              title="Dismiss"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>
          {notif.sessionKey && onSelectSession && (
            <button
              className="notif-action-btn"
              onClick={(e) => { e.stopPropagation(); onSelectSession(notif.sessionKey!); }}
              title="Go to session"
              style={{ color: 'var(--accent)', fontSize: '10px' }}
            >
              ↗
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="notif-expanded" style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '1px solid var(--border)',
          fontSize: '10px', color: 'var(--text-muted)',
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: 1.6,
        }}>
          <div>Created: {new Date(notif.timestamp).toLocaleString()}</div>
          {notif.sessionKey && <div>Session: {notif.sessionKey}</div>}
          {notif.detail && <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>{notif.detail}</div>}
          {notif.kind === 'reminder' && notif.reminderAt && (
            <div style={{ marginTop: '4px' }}>
              Reminder: {new Date(notif.reminderAt).toLocaleString()}
              {notif.reminderAt < Date.now() && (
                <span style={{ color: 'var(--yellow)', marginLeft: '6px' }}>⏰ OVERDUE</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Reminder quick-add ─────────────────────────────────────────────────────────

interface ReminderFormProps {
  onAdd: (notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
}

function ReminderForm({ onAdd }: ReminderFormProps) {
  const [text, setText] = useState('');
  const [inMinutes, setInMinutes] = useState(15);
  const [priority, setPriority] = useState<NotificationPriority>('info');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const reminderAt = Date.now() + inMinutes * 60 * 1000;
    onAdd({
      kind: 'reminder',
      priority,
      title: text.trim(),
      reminderAt,
      recurring: false,
    });
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} style={{
      display: 'flex', gap: '6px', alignItems: 'center',
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '6px 10px',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '12px' }}>⏰</span>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Quick reminder..."
        maxLength={120}
        style={{
          flex: 1, minWidth: '120px',
          background: 'transparent', border: 'none', outline: 'none',
          fontSize: '12px', color: 'var(--text-primary)',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      />
      <select
        value={inMinutes}
        onChange={e => setInMinutes(Number(e.target.value))}
        style={{
          background: 'var(--bg-deep)', border: '1px solid var(--border)',
          borderRadius: '6px', color: 'var(--text-secondary)',
          fontSize: '11px', padding: '2px 6px', cursor: 'pointer',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <option value={5}>in 5m</option>
        <option value={15}>in 15m</option>
        <option value={30}>in 30m</option>
        <option value={60}>in 1h</option>
        <option value={120}>in 2h</option>
        <option value={480}>in 8h</option>
      </select>
      <select
        value={priority}
        onChange={e => setPriority(e.target.value as NotificationPriority)}
        style={{
          background: 'var(--bg-deep)', border: '1px solid var(--border)',
          borderRadius: '6px', color: NOTIF_CONFIG[priority].color,
          fontSize: '11px', padding: '2px 6px', cursor: 'pointer',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <option value="info">ℹ Info</option>
        <option value="warning">⚠ Warn</option>
        <option value="error">✕ Alert</option>
        <option value="success">✓ Success</option>
      </select>
      <button
        type="submit"
        disabled={!text.trim()}
        style={{
          background: 'rgba(59,122,255,0.15)', border: '1px solid rgba(59,122,255,0.3)',
          borderRadius: '6px', color: 'var(--accent)',
          fontSize: '11px', fontWeight: 600, cursor: text.trim() ? 'pointer' : 'not-allowed',
          padding: '3px 10px', opacity: text.trim() ? 1 : 0.5,
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        Set
      </button>
    </form>
  );
}

// ─── Main NotificationCenter ───────────────────────────────────────────────────

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onAddNotification: (notif: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onSelectSession?: (sessionKey: string) => void;
}

export function NotificationCenter({
  isOpen,
  onClose,
  notifications,
  onAddNotification,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onSelectSession,
}: NotificationCenterProps) {
  const [filterKind, setFilterKind] = useState<NotificationKind | 'all' | 'unread' | 'reminder'>('all');
  const [showReminderForm, setShowReminderForm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(notifications.length);

  // Auto-scroll to top when new notification arrives
  useEffect(() => {
    if (notifications.length > prevLenRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
    prevLenRef.current = notifications.length;
  }, [notifications.length]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const overdueReminders = notifications.filter(n =>
    n.kind === 'reminder' && n.reminderAt && n.reminderAt < Date.now() && !n.read
  );

  const filtered = notifications.filter(n => {
    if (filterKind === 'unread') return !n.read;
    if (filterKind === 'reminder') return n.kind === 'reminder';
    if (filterKind === 'all') return true;
    return n.kind === filterKind;
  });

  const kindFilters: Array<{ key: NotificationKind | 'all' | 'unread' | 'reminder'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: `Unread (${unreadCount})` },
    { key: 'error', label: 'Errors' },
    { key: 'reminder', label: 'Reminders' },
    { key: 'gateway', label: 'Gateway' },
    { key: 'milestone', label: 'Milestones' },
    { key: 'spawn', label: 'Spawns' },
  ];

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'rgba(10,14,26,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        position: 'absolute', top: '60px', right: '24px',
        width: '420px', maxWidth: '90vw', maxHeight: '75vh',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,122,255,0.1)',
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              🔔 Notifications
            </h3>
            {unreadCount > 0 && (
              <span style={{
                background: 'var(--accent)', color: 'white',
                fontSize: '10px', fontWeight: 700,
                borderRadius: '10px', padding: '1px 7px',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {unreadCount} unread
              </span>
            )}
            {overdueReminders.length > 0 && (
              <span style={{
                background: 'rgba(251,191,36,0.2)', color: 'var(--yellow)',
                border: '1px solid rgba(251,191,36,0.4)',
                fontSize: '10px', fontWeight: 700,
                borderRadius: '10px', padding: '1px 7px',
              }}>
                ⏰ {overdueReminders.length} overdue
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                style={{
                  background: 'rgba(59,122,255,0.1)', border: '1px solid rgba(59,122,255,0.3)',
                  borderRadius: '6px', color: 'var(--accent)',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  padding: '3px 8px', fontFamily: "'Space Grotesk', sans-serif",
                }}
                title="Mark all as read"
              >
                ✓ All read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={onClearAll}
                style={{
                  background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                  borderRadius: '6px', color: 'var(--red)',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  padding: '3px 8px', fontFamily: "'Space Grotesk', sans-serif",
                }}
                title="Clear all notifications"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '12px', padding: '3px 8px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Quick reminder form toggle */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={() => setShowReminderForm(v => !v)}
            style={{
              width: '100%',
              background: showReminderForm ? 'rgba(59,122,255,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${showReminderForm ? 'rgba(59,122,255,0.4)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)', padding: '6px 10px',
              color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
              fontFamily: "'Space Grotesk', sans-serif",
              transition: 'all 0.2s',
            }}
          >
            ⏰ {showReminderForm ? 'Hide reminder form' : 'Set a quick reminder…'}
          </button>
          {showReminderForm && (
            <div style={{ marginTop: '6px' }}>
              <ReminderForm onAdd={onAddNotification} />
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex', gap: '4px', padding: '8px 12px',
          borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {kindFilters.map(f => {
            const isActive = filterKind === f.key;
            const color = f.key === 'error' ? 'var(--red)'
              : f.key === 'reminder' ? 'var(--yellow)'
              : f.key === 'gateway' ? 'var(--cyan)'
              : f.key === 'unread' ? 'var(--accent)'
              : 'var(--text-muted)';
            const count = f.key === 'all' ? filtered.length
              : f.key === 'unread' ? notifications.filter(n => !n.read).length
              : f.key === 'reminder' ? notifications.filter(n => n.kind === 'reminder').length
              : f.key === 'error' ? notifications.filter(n => n.kind === 'error').length
              : filtered.length;
            return (
              <button
                key={f.key}
                onClick={() => setFilterKind(f.key)}
                style={{
                  background: isActive ? `${color}18` : 'transparent',
                  border: `1px solid ${isActive ? `${color}55` : 'var(--border)'}`,
                  borderRadius: '12px', padding: '2px 8px',
                  fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                  color: isActive ? color : 'var(--text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  boxShadow: isActive ? `0 0 6px ${color}22` : 'none',
                }}
              >
                {f.label}{count > 0 && ` (${count})`}
              </button>
            );
          })}
        </div>

        {/* Notification list */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: '13px',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>🔔</div>
              <div>{filterKind === 'unread' ? 'No unread notifications' : filterKind === 'reminder' ? 'No reminders set' : 'No notifications yet'}</div>
              <div style={{ fontSize: '11px', marginTop: '4px' }}>
                {filterKind === 'all' ? 'Errors, milestones, and reminders will appear here' : 'Try a different filter'}
              </div>
              {filterKind !== 'all' && (
                <button
                  onClick={() => setFilterKind('all')}
                  style={{
                    marginTop: '10px', background: 'rgba(59,122,255,0.1)',
                    border: '1px solid rgba(59,122,255,0.3)', borderRadius: '8px',
                    color: 'var(--accent)', fontSize: '11px', cursor: 'pointer',
                    padding: '4px 12px', fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  View all notifications
                </button>
              )}
            </div>
          ) : (
            filtered.map(notif => (
              <NotifItem
                key={notif.id}
                notif={notif}
                onMarkRead={onMarkRead}
                onDismiss={onDismiss}
                onSelectSession={onSelectSession}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            {notifications.length} total · {MAX_NOTIFICATIONS} max
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Click to expand · Auto-clears after 7 days
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Hook: manage notifications lifecycle ─────────────────────────────────────

export function useNotifications(
  initialNotifications: Notification[] = [],
) {
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    const saved = loadNotifications();
    // Merge with any initial notifications (e.g., from current session events)
    const savedIds = new Set(saved.map(n => n.id));
    const newOnes = initialNotifications.filter(n => !savedIds.has(n.id));
    return [...newOnes, ...saved].slice(0, MAX_NOTIFICATIONS);
  });

  // Persist on change
  useEffect(() => {
    saveNotifications(notifications);
  }, [notifications]);

  // Auto-cleanup old notifications (older than 7 days)
  useEffect(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    setNotifications(prev => prev.filter(n => n.timestamp > cutoff));
  }, []);

  // Auto-dismiss overdue reminders periodically
  useEffect(() => {
    const interval = setInterval(() => {
      // Just trigger a re-render to update relative times
      setNotifications(prev => [...prev]);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const addNotification = useCallback((
    data: Omit<Notification, 'id' | 'timestamp' | 'read'>
  ) => {
    const notif: Notification = {
      ...data,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    };
    setNotifications(prev => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Auto-promote error system events to error notifications
  const recordSystemEvent = useCallback((
    type: SystemEvent['type'],
    detail: string,
    runtime?: string
  ) => {
    const kindMap: Record<SystemEvent['type'], NotificationKind> = {
      spawn: 'spawn',
      kill: 'kill',
      gateway_connect: 'gateway',
      gateway_disconnect: 'gateway',
    };
    const priorityMap: Record<SystemEvent['type'], NotificationPriority> = {
      spawn: 'success',
      kill: 'warning',
      gateway_connect: 'info',
      gateway_disconnect: 'warning',
    };
    addNotification({
      kind: kindMap[type],
      priority: priorityMap[type],
      title: type === 'gateway_disconnect' ? 'Gateway disconnected' : type === 'gateway_connect' ? 'Gateway connected' : `${type}: ${detail.slice(0, 40)}`,
      detail,
      runtime,
    });
  }, [addNotification]);

  const recordActivityEvent = useCallback((
    event: ActivityEvent['event'],
    agentName: string,
    detail?: string
  ) => {
    if (event === 'error') {
      addNotification({
        kind: 'error',
        priority: 'error',
        title: `Error: ${agentName}`,
        detail: detail || `${agentName} encountered an error`,
        agentName,
      });
    }
  }, [addNotification]);

  return {
    notifications,
    unreadCount: notifications.filter(n => !n.read).length,
    overdueCount: notifications.filter(n => n.kind === 'reminder' && n.reminderAt && n.reminderAt < Date.now() && !n.read).length,
    addNotification,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    recordSystemEvent,
    recordActivityEvent,
  };
}
