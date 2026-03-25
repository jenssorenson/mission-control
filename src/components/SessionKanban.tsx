import { useEffect, useState, useCallback } from 'react';
import type { Agent, SubAgent } from '../types';

interface Props {
  subAgents: SubAgent[];
  agents: Agent[];
  onSelectSession: (sessionKey: string) => void;
  onKillSession: (sessionKey: string) => void;
}

const SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const KANBAN_COMPLETIONS_KEY = 'mc_kanban_completions';
const MAX_DONE = 10;

interface DoneSession {
  sessionKey: string;
  taskName: string;
  runtime: string;
  endedAt: number;
  elapsedSecs: number;
  tokenUsage: number;
  terminationType: 'completed' | 'killed' | 'timeout' | 'error';
}

function loadDone(): DoneSession[] {
  try {
    const raw = localStorage.getItem(KANBAN_COMPLETIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveDone(done: DoneSession[]) {
  try {
    localStorage.setItem(KANBAN_COMPLETIONS_KEY, JSON.stringify(done));
  } catch {}
}

function inferStatus(status: string): 'active' | 'waiting' | 'needs-you' | 'done' {
  const s = status?.toLowerCase() || '';
  if (s.includes('error') || s.includes('fail') || s.includes('dead')) return 'needs-you';
  if (s.includes('think')) return 'waiting';
  return 'active';
}

function runtimeColor(runtime: string): string {
  return runtime === 'dev' ? 'var(--dev)' : runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)';
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function RuntimeBadge({ runtime }: { runtime: string }) {
  const color = runtimeColor(runtime);
  const label = runtime === 'pi' ? 'Pi' : runtime.charAt(0).toUpperCase() + runtime.slice(1);
  return (
    <span
      className="runtime-badge"
      style={{ '--rt-color': color } as React.CSSProperties}
    >
      {label}
    </span>
  );
}

function LiveTimer({ startedAt }: { startedAt?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return <span className="kanban-meta-mono">—</span>;
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  return (
    <span
      className="kanban-meta-mono"
      style={{
        color: secs > 3600 ? 'var(--red)' : secs > 1800 ? 'var(--yellow)' : 'var(--green)',
      }}
    >
      {formatDuration(secs)}
    </span>
  );
}

function TimeoutBar({ startedAt }: { startedAt?: number }) {
  if (!startedAt) return null;
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const pct = Math.min((secs * 1000 / SESSION_MAX_AGE_MS) * 100, 100);
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
  return (
    <div className="kanban-timeout-bar" title={`${Math.round(pct)}% of 60min limit`}>
      <div className="kanban-timeout-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

interface KanbanCardProps {
  sa: SubAgent;
  status: 'active' | 'waiting' | 'needs-you';
  onView: () => void;
  onKill: () => void;
}

function KanbanCard({ sa, status, onView, onKill }: KanbanCardProps) {
  const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
  const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;

  return (
    <div className={`kanban-card kanban-card--${status}`}>
      {/* Task name */}
      <div className="kanban-card-task" title={sa.taskName || 'No task'}>
        {sa.taskName
          ? sa.taskName.length > 40 ? sa.taskName.slice(0, 40) + '…' : sa.taskName
          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px' }}>No task</span>
        }
      </div>

      {/* Meta row */}
      <div className="kanban-card-meta">
        <RuntimeBadge runtime={sa.runtime || 'dev'} />
        <span className="kanban-meta-mono">
          <LiveTimer startedAt={sa.startedAt} />
        </span>
        {sa.tokenUsage !== undefined && (
          <span className="kanban-meta-mono" title="Token usage">
            ⚡{formatTokens(sa.tokenUsage)}
          </span>
        )}
        {tokenRate !== null && (
          <span
            className="kanban-meta-mono"
            title="Token rate"
            style={{ color: tokenRate > 1500 ? 'var(--yellow)' : 'var(--text-muted)' }}
          >
            📈{tokenRate}/m
          </span>
        )}
      </div>

      {/* Timeout progress bar */}
      {sa.startedAt && <TimeoutBar startedAt={sa.startedAt} />}

      {/* Actions */}
      <div className="kanban-card-actions">
        {status !== 'needs-you' && (
          <button
            className="kanban-action-btn kanban-action-btn--approve"
            title="Approve / Resume"
            onClick={(e) => { e.stopPropagation(); }}
          >
            ✓
          </button>
        )}
        <button
          className="kanban-action-btn kanban-action-btn--kill"
          title="Kill session"
          onClick={(e) => { e.stopPropagation(); onKill(); }}
        >
          ✕
        </button>
        <button
          className="kanban-action-btn kanban-action-btn--view"
          title="View in Monitor"
          onClick={(e) => { e.stopPropagation(); onView(); }}
        >
          ↗
        </button>
      </div>
    </div>
  );
}

interface DoneCardProps {
  item: DoneSession;
  onView: () => void;
}

function DoneCard({ item, onView }: DoneCardProps) {
  const terminationColor =
    item.terminationType === 'killed' ? 'var(--yellow)' :
    item.terminationType === 'timeout' ? 'var(--orange)' :
    item.terminationType === 'error' ? 'var(--red)' : 'var(--green)';

  return (
    <div className="kanban-card kanban-card--done">
      <div className="kanban-card-task" title={item.taskName || 'No task'}>
        {item.taskName
          ? item.taskName.length > 40 ? item.taskName.slice(0, 40) + '…' : item.taskName
          : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px' }}>No task</span>
        }
      </div>
      <div className="kanban-card-meta">
        <RuntimeBadge runtime={item.runtime || 'dev'} />
        <span className="kanban-meta-mono" style={{ color: terminationColor }} title={`Ended: ${item.terminationType}`}>
          {item.terminationType === 'killed' ? '■' : item.terminationType === 'timeout' ? '⏱' : item.terminationType === 'error' ? '✕' : '✓'}
        </span>
        <span className="kanban-meta-mono" title="Duration">
          {formatDuration(item.elapsedSecs)}
        </span>
        {item.tokenUsage > 0 && (
          <span className="kanban-meta-mono" title="Tokens">
            ⚡{formatTokens(item.tokenUsage)}
          </span>
        )}
      </div>
      <div className="kanban-card-actions">
        <button
          className="kanban-action-btn kanban-action-btn--view"
          title="View in Monitor"
          onClick={(e) => { e.stopPropagation(); onView(); }}
        >
          ↗
        </button>
      </div>
    </div>
  );
}

const COLUMN_CONFIG = {
  active:    { label: 'Active',     color: 'var(--green)',  emptyLabel: 'No active sessions' },
  waiting:   { label: 'Waiting',    color: 'var(--yellow)', emptyLabel: 'No waiting sessions' },
  'needs-you': { label: 'Needs You', color: 'var(--red)',    emptyLabel: 'No issues' },
  done:      { label: 'Done',        color: 'var(--text-muted)', emptyLabel: 'No completed sessions' },
};

export default function SessionKanban({ subAgents, agents, onSelectSession, onKillSession }: Props) {
  const [done, setDone] = useState<DoneSession[]>(() => loadDone());

  // Sync done sessions from subAgents that have disappeared
  useEffect(() => {
    // Done is managed independently; we just load/save here
    saveDone(done);
  }, [done]);

  const active    = subAgents.filter(sa => inferStatus(sa.status) === 'active');
  const waiting   = subAgents.filter(sa => inferStatus(sa.status) === 'waiting');
  const needsYou  = subAgents.filter(sa => inferStatus(sa.status) === 'needs-you');

  const handleKill = useCallback((sessionKey: string) => {
    onKillSession(sessionKey);
    // Record in done
    const sa = subAgents.find(s => s.sessionKey === sessionKey);
    if (sa) {
      const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
      const item: DoneSession = {
        sessionKey: sa.sessionKey,
        taskName: sa.taskName || '',
        runtime: sa.runtime || 'dev',
        endedAt: Date.now(),
        elapsedSecs,
        tokenUsage: sa.tokenUsage || 0,
        terminationType: 'killed',
      };
      setDone(prev => [item, ...prev].slice(0, MAX_DONE));
    }
  }, [subAgents, onKillSession]);

  const handleClearDone = useCallback(() => {
    setDone([]);
  }, []);

  const handleView = useCallback((sessionKey: string) => {
    onSelectSession(sessionKey);
  }, [onSelectSession]);

  const renderColumn = (
    key: 'active' | 'waiting' | 'needs-you' | 'done',
    items: SubAgent[] | DoneSession[],
    isDone = false
  ) => {
    const cfg = COLUMN_CONFIG[key];
    return (
      <div className="kanban-col">
        <div className="kanban-col-header" style={{ borderTopColor: cfg.color }}>
          <span className="kanban-col-title" style={{ color: cfg.color }}>{cfg.label}</span>
          <span className="kanban-col-count" style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}44` }}>
            {items.length}
          </span>
          {isDone && items.length > 0 && (
            <button className="kanban-clear-done" onClick={handleClearDone} title="Clear done">
              ✕
            </button>
          )}
        </div>

        <div className="kanban-col-body">
          {items.length === 0 ? (
            <div className="kanban-empty">{cfg.emptyLabel}</div>
          ) : (
            items.map((item) => {
              if (isDone) {
                const d = item as DoneSession;
                return (
                  <DoneCard
                    key={d.sessionKey}
                    item={d}
                    onView={() => handleView(d.sessionKey)}
                  />
                );
              }
              const sa = item as SubAgent;
              const status = key as 'active' | 'waiting' | 'needs-you';
              return (
                <KanbanCard
                  key={sa.sessionKey}
                  sa={sa}
                  status={status}
                  onView={() => handleView(sa.sessionKey)}
                  onKill={() => handleKill(sa.sessionKey)}
                />
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="kanban-board">
      {renderColumn('active', active)}
      {renderColumn('waiting', waiting)}
      {renderColumn('needs-you', needsYou)}
      {renderColumn('done', done, true)}
    </div>
  );
}
