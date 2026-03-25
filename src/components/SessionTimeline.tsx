import { useState, useEffect } from 'react';
import type { SubAgent } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Token rate color coding
function rateColor(rate: number | null): string {
  if (rate === null) return 'var(--text-muted)';
  if (rate > 1500) return 'var(--red)';
  if (rate > 800) return 'var(--yellow)';
  return 'var(--green)';
}

const SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_TOKEN_RATE = 2000;

const runtimeColors: Record<string, string> = {
  dev: 'var(--dev)',
  pi: 'var(--pi)',
  gemini: 'var(--gemini)',
};

// ─── Session swim lane ────────────────────────────────────────────────────────

interface SessionCardProps {
  sa: SubAgent;
  onSelect: (sessionKey: string) => void;
  selected: boolean;
}

function SessionCard({ sa, onSelect, selected }: SessionCardProps) {
  const [, setTick] = useState(0);
  const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
  const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
  const agePct = Math.min((elapsedSecs * 1000 / SESSION_MAX_AGE_MS) * 100, 100);
  const ageColor = agePct > 80 ? 'var(--red)' : agePct > 50 ? 'var(--yellow)' : 'var(--green)';
  const rtColor = runtimeColors[sa.runtime || 'dev'] || 'var(--text-muted)';

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      onClick={() => onSelect(sa.sessionKey)}
      className={`tl-session-card${selected ? ' tl-session-card--selected' : ''}${agePct > 80 ? ' tl-session-card--age-critical' : agePct > 50 ? ' tl-session-card--age-warning' : ''}`}
      style={{
        '--rt-color': rtColor,
      } as React.CSSProperties}
      title={`${sa.taskName || sa.sessionKey}\nElapsed: ${formatDuration(elapsedSecs)}\nTokens: ${sa.tokenUsage || 0}\nRate: ${tokenRate !== null ? `${tokenRate}/min` : '—'}`}
    >
      {/* Header */}
      <div className="tl-card-header">
        <span
          className="tl-runtime-dot"
          style={{ background: rtColor, boxShadow: `0 0 6px ${rtColor}` }}
        />
        <span className="tl-runtime-label" style={{ color: rtColor }}>
          {sa.runtime === 'pi' ? 'Pi' : sa.runtime?.charAt(0).toUpperCase() + sa.runtime?.slice(1) || '—'}
        </span>
        <span className="tl-card-elapsed" style={{ color: ageColor }}>
          {formatDuration(elapsedSecs)}
        </span>
      </div>

      {/* Task name */}
      <div className="tl-card-task">
        {sa.taskName
          ? sa.taskName.length > 28
            ? sa.taskName.slice(0, 28) + '…'
            : sa.taskName
          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No task</span>
        }
      </div>

      {/* Mini stats row */}
      <div className="tl-card-stats">
        <span className="tl-stat" title="Token usage" style={{ color: 'var(--green)' }}>
          ⚡{sa.tokenUsage ? sa.tokenUsage >= 1000 ? `${(sa.tokenUsage / 1000).toFixed(0)}k` : sa.tokenUsage : '0'}
        </span>
        <span className="tl-stat" title="Token rate" style={{ color: rateColor(tokenRate) }}>
          📈{tokenRate !== null ? `${tokenRate}` : '—'}
        </span>
        <span
          className="tl-stat"
          title="Session age vs 60min limit"
          style={{ color: ageColor }}
        >
          ⏱{Math.round(agePct)}%
        </span>
      </div>

      {/* Age progress bar */}
      <div className="tl-age-bar-wrap" title={`Session age: ${Math.round(agePct)}% of 60min limit`}>
        <div
          className="tl-age-bar-fill"
          style={{ width: `${agePct}%`, background: ageColor }}
        />
      </div>

      {/* Token rate mini bar */}
      {tokenRate !== null && (
        <div className="tl-rate-bar-wrap" title={`Token rate: ${tokenRate}/min`}>
          <div
            className="tl-rate-bar-fill"
            style={{
              width: `${Math.min((tokenRate / MAX_TOKEN_RATE) * 100, 100)}%`,
              background: rateColor(tokenRate),
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Timeline Component ──────────────────────────────────────────────────

interface SessionTimelineProps {
  subAgents: SubAgent[];
  onSelectSession: (sessionKey: string) => void;
  selectedSessionKey?: string | null;
}

export default function SessionTimeline({ subAgents, onSelectSession, selectedSessionKey }: SessionTimelineProps) {
  const sorted = [...subAgents].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const now = Date.now();

  // Time axis markers (last 60 min in 10-min increments)
  const timeMarkers = Array.from({ length: 7 }, (_, i) => {
    const minsAgo = (6 - i) * 10;
    const ts = now - minsAgo * 60 * 1000;
    return { label: minsAgo === 0 ? 'now' : `-${minsAgo}m`, ts };
  });

  // Group sessions by runtime
  const byRuntime: Record<string, SubAgent[]> = {};
  subAgents.forEach(sa => {
    const rt = sa.runtime || 'unknown';
    if (!byRuntime[rt]) byRuntime[rt] = [];
    byRuntime[rt].push(sa);
  });

  // Timeline stats
  const stats = {
    total: subAgents.length,
    oldest: sorted.length > 0 ? sorted[sorted.length - 1].startedAt : null,
    newest: sorted.length > 0 ? sorted[0].startedAt : null,
    avgAge: sorted.length > 0
      ? Math.floor(sorted.reduce((sum, sa) => sum + (sa.startedAt ? (now - sa.startedAt) / 1000 : 0), 0) / sorted.length)
      : 0,
    totalTokens: subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0),
  };

  if (subAgents.length === 0) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-icon">📊</div>
        <div className="tl-empty-text">No active sessions to visualize</div>
        <div className="tl-empty-sub">Start a session from the Monitor tab to see it here on the timeline</div>
      </div>
    );
  }

  return (
    <div className="session-timeline-panel">
      {/* Timeline header stats */}
      <div className="tl-header-stats">
        <div className="tl-stat-item">
          <span className="tl-stat-label">Sessions</span>
          <span className="tl-stat-value">{stats.total}</span>
        </div>
        <div className="tl-stat-item">
          <span className="tl-stat-label">Avg Age</span>
          <span className="tl-stat-value">{formatDuration(Math.floor(stats.avgAge))}</span>
        </div>
        <div className="tl-stat-item">
          <span className="tl-stat-label">Total Tokens</span>
          <span className="tl-stat-value" style={{ color: 'var(--green)' }}>
            {stats.totalTokens >= 1000 ? `${(stats.totalTokens / 1000).toFixed(0)}k` : stats.totalTokens}
          </span>
        </div>
        <div className="tl-stat-item">
          <span className="tl-stat-label">Oldest</span>
          <span className="tl-stat-value">
            {stats.oldest ? formatDuration(Math.floor((now - stats.oldest) / 1000)) : '—'}
          </span>
        </div>
        {stats.newest && stats.oldest && stats.newest !== stats.oldest && (
          <div className="tl-stat-item">
            <span className="tl-stat-label">Span</span>
            <span className="tl-stat-value">
              {formatDuration(Math.floor((stats.newest - stats.oldest) / 1000))}
            </span>
          </div>
        )}
      </div>

      {/* Runtime group lanes */}
      <div className="tl-lanes">
        {(['dev', 'pi', 'gemini'] as const).map(runtime => {
          const lanes = byRuntime[runtime] || [];
          if (lanes.length === 0) return null;
          const rtColor = runtimeColors[runtime] || 'var(--text-muted)';
          const label = runtime === 'pi' ? 'Pi' : runtime.charAt(0).toUpperCase() + runtime.slice(1);

          return (
            <div key={runtime} className="tl-lane">
              {/* Lane header */}
              <div className="tl-lane-header" style={{ borderLeft: `3px solid ${rtColor}` }}>
                <span
                  className="tl-lane-dot"
                  style={{ background: rtColor, boxShadow: `0 0 6px ${rtColor}` }}
                />
                <span className="tl-lane-label" style={{ color: rtColor }}>{label}</span>
                <span className="tl-lane-count">{lanes.length}</span>
                <span className="tl-lane-tokens" title="Total tokens">
                  ⚡{lanes.reduce((s, sa) => s + (sa.tokenUsage || 0), 0) >= 1000
                    ? `${(lanes.reduce((s, sa) => s + (sa.tokenUsage || 0), 0) / 1000).toFixed(0)}k`
                    : lanes.reduce((s, sa) => s + (sa.tokenUsage || 0), 0)}
                </span>
              </div>

              {/* Lane body: horizontal timeline */}
              <div className="tl-lane-body">
                {/* Time axis */}
                <div className="tl-time-axis">
                  {timeMarkers.map(m => (
                    <div
                      key={m.label}
                      className={`tl-time-mark${m.label === 'now' ? ' tl-time-mark--now' : ''}`}
                      style={{
                        // Position as fraction of 60 min window
                        left: `${Math.max(0, Math.min(100, (1 - (now - m.ts) / (60 * 60 * 1000)) * 100))}%`,
                      }}
                    >
                      <span className="tl-time-label">{m.label}</span>
                    </div>
                  ))}
                </div>

                {/* Session cards in this lane */}
                <div className="tl-lane-cards">
                  {lanes
                    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
                    .map(sa => {
                      const startPct = sa.startedAt
                        ? Math.max(0, Math.min(100, ((now - sa.startedAt) / (60 * 60 * 1000)) * 100))
                        : 50;
                      const isSelected = sa.sessionKey === selectedSessionKey;
                      const agePct = sa.startedAt
                        ? Math.min(100, ((Date.now() - sa.startedAt) / SESSION_MAX_AGE_MS) * 100)
                        : 0;
                      const ageColor = agePct > 80 ? 'var(--red)' : agePct > 50 ? 'var(--yellow)' : 'var(--green)';

                      return (
                        <div
                          key={sa.sessionKey}
                          className={`tl-lane-item${isSelected ? ' tl-lane-item--selected' : ''}`}
                          style={{ '--lane-color': runtimeColors[sa.runtime || 'dev'] || 'var(--text-muted)' } as React.CSSProperties}
                          onClick={() => onSelectSession(sa.sessionKey)}
                          title={`${sa.taskName || sa.sessionKey}\nStarted: ${sa.startedAt ? formatAbsoluteTime(sa.startedAt) : '—'}\nTokens: ${sa.tokenUsage || 0}`}
                        >
                          {/* Session bar: starts at session start, extends to "now" */}
                          <div className="tl-session-bar-wrap" style={{ left: `${startPct}%` }}>
                            <div
                              className="tl-session-bar"
                              style={{
                                width: `${Math.max(2, 100 - startPct)}%`,
                                background: `linear-gradient(90deg, ${ageColor}88, ${ageColor}33)`,
                                border: `1px solid ${ageColor}66`,
                                boxShadow: `0 0 8px ${ageColor}33`,
                              }}
                            />
                            {/* Token rate dot at current position */}
                            <div
                              className="tl-session-now-dot"
                              style={{
                                background: ageColor,
                                boxShadow: `0 0 6px ${ageColor}`,
                              }}
                            />
                          </div>

                          {/* Card overlaid on the bar */}
                          <div className="tl-card-overlay">
                            <SessionCard
                              sa={sa}
                              onSelect={onSelectSession}
                              selected={isSelected}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Now marker */}
      <div className="tl-now-line" title="Current time">
        <div className="tl-now-label">▼ now</div>
      </div>

      {/* Summary footer */}
      <div className="tl-footer">
        <span className="tl-footer-hint">
          Timeline shows session age relative to a 60-minute window · Click a session to view details
        </span>
        <span className="tl-footer-sessions">
          {subAgents.length} session{subAgents.length !== 1 ? 's' : ''} across {Object.keys(byRuntime).length} runtime{Object.keys(byRuntime).length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
