import { useState, useEffect, useRef, useCallback } from 'react';
import type { ActivityEvent, SystemEvent, SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

interface ActivityFeedProps {
  activities: ActivityEvent[];
  systemEvents: SystemEvent[];
  subAgents: SubAgent[];
  onSelectSession: (sessionKey: string) => void;
  onClearActivities: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAbsTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelTime(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

type EventType = 'all' | 'started' | 'thinking' | 'completed' | 'error' | 'system' | 'spawn' | 'kill';

const EVENT_CONFIG: Record<string, { icon: string; color: string; borderColor: string; label: string }> = {
  started:  { icon: '▶',  color: 'var(--green)',  borderColor: 'var(--green)',  label: 'Started' },
  thinking: { icon: '💭', color: 'var(--yellow)', borderColor: 'var(--yellow)', label: 'Thinking' },
  completed:{ icon: '✓',  color: 'var(--cyan)',   borderColor: 'var(--cyan)',   label: 'Completed' },
  error:    { icon: '✕',  color: 'var(--red)',    borderColor: 'var(--red)',    label: 'Error' },
  system:   { icon: '⚙',  color: 'var(--accent)', borderColor: 'var(--accent)', label: 'System' },
  spawn:    { icon: '▶',  color: 'var(--green)',  borderColor: 'var(--green)',  label: 'Spawn' },
  kill:     { icon: '■',  color: 'var(--red)',    borderColor: 'var(--red)',    label: 'Killed' },
};

const RUNTIME_COLORS: Record<string, string> = {
  dev:    'var(--dev)',
  pi:     'var(--pi)',
  gemini: 'var(--gemini)',
};

const MAX_EVENTS = 200;

// ─── Unified event types ────────────────────────────────────────────────────────

type UnifiedEvent =
  | ({ kind: 'activity'; activity: ActivityEvent })
  | ({ kind: 'system'; system: SystemEvent });

function getEventTs(ev: UnifiedEvent): number {
  return ev.kind === 'activity' ? ev.activity.timestamp : ev.system.timestamp;
}

function getEventLabel(ev: UnifiedEvent): string {
  if (ev.kind === 'activity') {
    return ev.activity.event;
  }
  return ev.system.type;
}

// ─── Live dot ─────────────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '9px',
      fontFamily: "'Space Grotesk', sans-serif",
      color: 'var(--green)',
      fontWeight: 700,
      letterSpacing: '0.5px',
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: 'var(--green)',
        boxShadow: '0 0 6px var(--green)',
        animation: 'pulse-live 1.5s ease-in-out infinite',
        flexShrink: 0,
      }} />
      LIVE
    </span>
  );
}

// ─── Event entry ─────────────────────────────────────────────────────────────

interface EventEntryProps {
  ev: UnifiedEvent;
  isNew: boolean;
  subAgents: SubAgent[];
  onSelectSession: (sessionKey: string) => void;
}

function EventEntry({ ev, isNew, subAgents, onSelectSession }: EventEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const isActivity = ev.kind === 'activity';
  const act = isActivity ? ev.activity : null;
  const sys = !isActivity ? ev.system : null;
  const eventLabel = getEventLabel(ev);
  const cfg = EVENT_CONFIG[eventLabel] ?? EVENT_CONFIG.system;

  // Find matching session for activity events
  const matchingSession = act
    ? subAgents.find(sa => sa.taskName === act.agentName || sa.sessionKey.includes(act.agentName.replace(/\s+/g, '-')))
    : null;

  // Determine runtime from system event runtime field or fallback to dev
  const runtime = sys?.runtime ?? (matchingSession?.runtime ?? 'dev');
  const rtColor = RUNTIME_COLORS[runtime] || 'var(--text-muted)';

  const ts = getEventTs(ev);
  const detail = isActivity ? act!.detail || `${act!.agentName} ${act!.event}` : sys!.detail;
  const agentName = isActivity ? act!.agentName : sys!.agentName ?? 'System';

  return (
    <div
      className={`af-event${isNew ? ' af-event--new' : ''}`}
      style={{
        borderLeft: `2px solid ${cfg.borderColor}`,
        background: isNew ? 'rgba(52,211,153,0.05)' : 'transparent',
        transition: 'background 0.4s ease',
      }}
    >
      {/* Event row */}
      <div
        className="af-event-row"
        onClick={() => setExpanded(v => !v)}
        style={{ cursor: 'pointer' }}
      >
        {/* Icon */}
        <span className="af-event-icon" style={{ color: cfg.color }}>
          {cfg.icon}
        </span>

        {/* Agent + detail */}
        <div className="af-event-content">
          <div className="af-event-header-row">
            <span className="af-event-agent" style={{ color: rtColor }}>
              {agentName}
            </span>
            {matchingSession && (
              <button
                className="af-session-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSession(matchingSession.sessionKey);
                }}
                title={`Go to session: ${matchingSession.taskName || matchingSession.sessionKey}`}
              >
                ↗ session
              </button>
            )}
            <span
              className="af-event-type-badge"
              style={{ color: cfg.color, background: `${cfg.color}14`, border: `1px solid ${cfg.color}33` }}
            >
              {cfg.label}
            </span>
          </div>
          <div className="af-event-detail">
            {detail}
          </div>
        </div>

        {/* Timestamp + expand chevron */}
        <div className="af-event-meta">
          <span className="af-event-rel" title={new Date(ts).toLocaleString()}>
            {formatRelTime(ts)}
          </span>
          <span
            className="af-expand-chevron"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          >
            ▼
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="af-event-expanded">
          <div className="af-expanded-grid">
            <div className="af-expanded-item">
              <span className="af-expanded-label">Absolute time</span>
              <span className="af-expanded-value" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {formatAbsTime(ts)} · {new Date(ts).toLocaleDateString()}
              </span>
            </div>
            <div className="af-expanded-item">
              <span className="af-expanded-label">Event type</span>
              <span className="af-expanded-value" style={{ color: cfg.color }}>
                {eventLabel}
              </span>
            </div>
            {runtime && (
              <div className="af-expanded-item">
                <span className="af-expanded-label">Runtime</span>
                <span className="af-expanded-value" style={{ color: rtColor }}>
                  {runtime === 'pi' ? 'Pi' : runtime.charAt(0).toUpperCase() + runtime.slice(1)}
                </span>
              </div>
            )}
            {matchingSession && (
              <>
                <div className="af-expanded-item">
                  <span className="af-expanded-label">Session key</span>
                  <span className="af-expanded-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>
                    {matchingSession.sessionKey}
                  </span>
                </div>
                <div className="af-expanded-item">
                  <span className="af-expanded-label">Tokens used</span>
                  <span className="af-expanded-value" style={{ color: 'var(--green)' }}>
                    {matchingSession.tokenUsage?.toLocaleString() ?? '—'}
                  </span>
                </div>
              </>
            )}
            <div className="af-expanded-item" style={{ gridColumn: '1 / -1' }}>
              <span className="af-expanded-label">Detail</span>
              <span className="af-expanded-value">
                {detail}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ───────────────────────────────────────────────────────────────

function FeedStats({ events, newCount }: { events: UnifiedEvent[]; newCount: number }) {
  const counts: Record<string, number> = {};
  events.forEach(ev => {
    const label = getEventLabel(ev);
    counts[label] = (counts[label] ?? 0) + 1;
  });
  return (
    <div className="af-stats-bar">
      <LiveDot />
      {newCount > 0 && (
        <span className="af-new-badge" title={`${newCount} new event${newCount !== 1 ? 's' : ''} since you arrived`}>
          +{newCount} new
        </span>
      )}
      <div className="af-stats-pills">
        {Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => {
          const cfg = EVENT_CONFIG[label] ?? EVENT_CONFIG.system;
          return (
            <span
              key={label}
              className="af-stat-pill"
              style={{ color: cfg.color, background: `${cfg.color}12`, border: `1px solid ${cfg.color}30` }}
              title={`${count} ${label} event${count !== 1 ? 's' : ''}`}
            >
              {cfg.icon} {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActivityFeed({ activities, systemEvents, subAgents, onSelectSession, onClearActivities }: ActivityFeedProps) {
  const [filterType, setFilterType] = useState<EventType>('all');
  const [filterRuntime, setFilterRuntime] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [arrivedCount, setArrivedCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const isHoveredRef = useRef(false);
  const prevLenRef = useRef(activities.length + systemEvents.length);

  // Build unified events list
  const unifiedEvents: UnifiedEvent[] = [
    ...activities.map(a => ({ kind: 'activity' as const, activity: a })),
    ...systemEvents.map(s => ({ kind: 'system' as const, system: s })),
  ].sort((a, b) => getEventTs(b) - getEventTs(a)); // newest first

  // Filter
  const filtered = unifiedEvents.filter(ev => {
    const label = getEventLabel(ev);
    if (filterType !== 'all' && label !== filterType) return false;
    if (filterRuntime !== 'all') {
      const runtime = ev.kind === 'system'
        ? ev.system.runtime ?? 'dev'
        : subAgents.find(sa => sa.taskName === ev.activity.agentName)?.runtime ?? 'dev';
      if (runtime !== filterRuntime) return false;
    }
    return true;
  });

  // Track new arrivals while on this tab
  useEffect(() => {
    const totalNow = activities.length + systemEvents.length;
    if (totalNow > prevLenRef.current) {
      const diff = totalNow - prevLenRef.current;
      setNewCount(n => n + diff);
      setArrivedCount(prev => prev + diff);
    }
    prevLenRef.current = totalNow;
  }, [activities.length, systemEvents.length]);

  // Reset new count when filter changes
  useEffect(() => {
    setNewCount(0);
    setArrivedCount(0);
  }, [filterType, filterRuntime]);

  // Auto-scroll to top (newest = top)
  useEffect(() => {
    if (autoScroll && !isHoveredRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filtered.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    // If user scrolls down (away from top = newer), disable auto-scroll
    if (listRef.current.scrollTop > 60) {
      setAutoScroll(false);
    } else {
      setAutoScroll(true);
    }
  }, []);

  const handleMouseEnter = () => { isHoveredRef.current = true; };
  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    setAutoScroll(true);
  };

  // Tick relative timestamps
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const eventTypes: EventType[] = ['all', 'started', 'thinking', 'completed', 'error', 'system', 'spawn', 'kill'];
  const runtimes = ['all', 'dev', 'pi', 'gemini'];

  const filterBtns = eventTypes.map(type => {
    const cfg = type === 'all' ? { icon: '◉', color: 'var(--accent)', label: 'All' } : (EVENT_CONFIG[type] ?? EVENT_CONFIG.system);
    const count = type === 'all' ? filtered.length : filtered.filter(ev => getEventLabel(ev) === type).length;
    return (
      <button
        key={type}
        className={`af-filter-btn${filterType === type ? ' af-filter-btn--active' : ''}`}
        onClick={() => setFilterType(type)}
        style={filterType === type ? {
          color: cfg.color,
          background: `${cfg.color}15`,
          border: `1px solid ${cfg.color}44`,
        } : {}}
        title={`Filter by ${type === 'all' ? 'all events' : type}`}
      >
        {type !== 'all' && <span style={{ fontSize: '10px' }}>{cfg.icon}</span>}
        <span>{type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}</span>
        {count > 0 && <span className="af-filter-count">{count}</span>}
      </button>
    );
  });

  return (
    <ErrorBoundary name="ActivityFeed">
      <div className="activity-feed-panel">
        {/* Panel header */}
        <div className="panel-header">
          <div className="panel-header-left">
            <h3>📡 Activity Feed</h3>
            <FeedStats events={filtered} newCount={newCount} />
          </div>
          <div className="panel-header-right">
            {/* Runtime filter */}
            <select
              className="af-runtime-select"
              value={filterRuntime}
              onChange={e => setFilterRuntime(e.target.value)}
              title="Filter by runtime"
            >
              {runtimes.map(rt => (
                <option key={rt} value={rt}>
                  {rt === 'all' ? '🌐 All runtimes' : rt === 'pi' ? 'Pi' : rt.charAt(0).toUpperCase() + rt.slice(1)}
                </option>
              ))}
            </select>

            {/* Auto-scroll toggle */}
            <button
              className={`af-autoscroll-btn${autoScroll ? ' af-autoscroll-btn--active' : ''}`}
              onClick={() => setAutoScroll(v => !v)}
              title={autoScroll ? 'Auto-scroll is on — click to disable' : 'Auto-scroll is off — click to enable'}
            >
              {autoScroll ? '⬇ Live' : '⬇ Paused'}
            </button>

            {/* Clear feed */}
            {unifiedEvents.length > 0 && (
              <button
                className="af-clear-btn"
                onClick={onClearActivities}
                title="Clear all activity events"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="af-filter-bar">
          {filterBtns}
        </div>

        {/* Auto-scroll indicator */}
        {!autoScroll && (
          <div className="af-paused-notice">
            ⏸ Auto-scroll paused — scroll to top or click "Live" to resume
          </div>
        )}

        {/* Event list */}
        <div
          ref={listRef}
          className="af-event-list"
          onScroll={handleScroll}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {filtered.length === 0 ? (
            <div className="af-empty">
              <div className="af-empty-icon">📡</div>
              <div className="af-empty-text">
                {filterType !== 'all' || filterRuntime !== 'all'
                  ? `No ${filterType !== 'all' ? filterType : ''} events${filterRuntime !== 'all' ? ` for ${filterRuntime}` : ''}`
                  : 'No activity yet — events will appear here as agents work'
                }
              </div>
              {(filterType !== 'all' || filterRuntime !== 'all') && (
                <button
                  className="af-empty-reset"
                  onClick={() => { setFilterType('all'); setFilterRuntime('all'); }}
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            filtered.map((ev, i) => {
              const ts = getEventTs(ev);
              const isNew = i < arrivedCount && arrivedCount > 0;
              return (
                <EventEntry
                  key={`${ev.kind}-${ts}-${i}`}
                  ev={ev}
                  isNew={isNew}
                  subAgents={subAgents}
                  onSelectSession={onSelectSession}
                />
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="af-footer">
          <span className="af-footer-count">
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            {filterType !== 'all' || filterRuntime !== 'all' ? ' (filtered)' : ''}
          </span>
          <span className="af-footer-hint">
            Click any event to expand details
          </span>
        </div>
      </div>
    </ErrorBoundary>
  );
}
