import { useEffect, useState, useCallback, useRef } from 'react';
import type { Agent, SubAgent, ActivityEvent, SystemEvent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { useToast } from './Toast';
import TokenBudgetForecaster from './TokenBudgetForecaster';

interface Props {
  onAgentsChange: (agents: Agent[]) => void;
  onSubAgentsChange?: (subAgents: SubAgent[]) => void;
  activities: ActivityEvent[];
  setActivities: React.Dispatch<React.SetStateAction<ActivityEvent[]>>;
  onSystemEvent?: (ev: SystemEvent) => void;
}

const runtimeColors: Record<string, string> = {
  dev: 'var(--codex)',
  codex: 'var(--codex)',
  pi: 'var(--pi)',
  gemini: 'var(--gemini)',
  minimax: 'var(--accent)',
};

const runtimeIcons: Record<string, string> = {
  dev: '🐦',
  codex: '🤖',
  pi: '🧠',
  gemini: '✨',
  minimax: '🔮',
};

// Session max age for timeout progress bar (60 min default)
const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

function formatElapsed(startedAt?: number): string {
  if (!startedAt) return '—';
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatRelative(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// Highlight matching substrings in text based on search query
function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="session-search-highlight">{text.slice(idx, idx + search.length)}</span>
      {text.slice(idx + search.length)}
    </>
  );
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function statusLabel(status?: string): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.includes('run') || s.includes('active') || s.includes('busy')) return 'active';
  if (s.includes('think')) return 'thinking';
  if (s.includes('error') || s.includes('offline') || s.includes('dead') || s.includes('fail')) return 'error';
  return 'idle';
}

function RuntimeBadge({ runtime, prominent }: { runtime: string; prominent?: boolean }) {
  const color = runtimeColors[runtime] || 'var(--text-muted)';
  const label = runtime === 'pi' ? 'Pi' : runtime.charAt(0).toUpperCase() + runtime.slice(1);
  return (
    <span className={`runtime-badge${prominent ? ' runtime-badge--prominent' : ''}`} style={{ '--rt-color': color } as React.CSSProperties}>
      {label}
    </span>
  );
}

// Live session timer: shows elapsed time that ticks every second
function LiveSessionTimer({ startedAt }: { startedAt?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return <span className="sa-elapsed">—</span>;
  const elapsedSecs = Math.floor((Date.now() - startedAt) / 1000);
  const agePct = Math.min((elapsedSecs * 1000 / SESSION_MAX_AGE_MS) * 100, 100);
  const color = agePct > 80 ? 'var(--red)' : agePct > 50 ? 'var(--yellow)' : 'var(--green)';
  return (
    <span className="sa-elapsed" style={{ color }} title={`Started: ${new Date(startedAt).toLocaleTimeString()}`}>
      {formatDuration(elapsedSecs)}
    </span>
  );
}

// Session timeout icon: shown for sessions approaching/exceeding timeout thresholds
function SessionTimeoutIcon({ startedAt }: { startedAt?: number }) {
  if (!startedAt) return null;
  const elapsedMin = Math.floor((Date.now() - startedAt) / 60000);
  if (elapsedMin < 20) return null;
  const isCritical = elapsedMin >= 40;
  const color = isCritical ? 'var(--red)' : 'var(--yellow)';
  return (
    <span className="sa-elapsed-warning" style={{ color }} title={`Session running ${elapsedMin}+ min${isCritical ? ' — near hard limit' : ''}`}>
      ⏱
    </span>
  );
}

// Format absolute time as HH:MM:SS
function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Runtime source dot: colored dot showing which main agent owns this sub-session
// Peek tooltip panel: shown after 600ms hover on a task name
function PeekPanel({ sessionKey, subAgents }: { sessionKey: string; subAgents: SubAgent[] }) {
  const sa = subAgents.find(s => s.sessionKey === sessionKey);
  if (!sa) return null;
  return (
    <div className="peek-panel">
      <div className="peek-panel-header">
        <span className="peek-panel-runtime">
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block', background: runtimeColors[sa.runtime] || 'var(--text-muted)', boxShadow: `0 0 4px ${runtimeColors[sa.runtime] || 'var(--text-muted)'}`, marginRight: '5px' }} />
          {sa.runtime || 'unknown'}
        </span>
        <span className="peek-panel-key" title={sa.sessionKey}>{sa.sessionKey?.slice(0, 12)}…</span>
      </div>
      <div className="peek-panel-task">{sa.taskName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No task description</span>}</div>
      {sa.startedAt && (
        <div className="peek-panel-meta">
          Running {formatElapsed(sa.startedAt)}
          {sa.tokenUsage && ` · ${formatTokens(sa.tokenUsage)} tokens`}
        </div>
      )}
    </div>
  );
}

function RuntimeSourceDot({ runtime }: { runtime?: string }) {
  const color = runtime ? (runtimeColors[runtime] || 'var(--text-muted)') : 'var(--text-muted)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 4px ${color}`,
        flexShrink: 0,
      }}
      title={`Source: ${runtime || 'unknown'} agent`}
    />
  );
}

// ParentAgentChip: shows which main agent a sub-session was spawned by, inferred from sessionKey
function ParentAgentChip({ sessionKey, agents }: { sessionKey?: string; agents: Agent[] }) {
  if (!sessionKey) return null;
  // Try to match sessionKey to a known agent id/name
  const parent = agents.find(a =>
    sessionKey.includes(a.id) || sessionKey.includes(a.name || '')
  );
  if (!parent) return null;
  const color = runtimeColors[parent.runtime] || 'var(--text-muted)';
  return (
    <span
      title={`Spawned by ${parent.name} (${parent.runtime})`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 600, color, background: `${color}14`,
        border: `1px solid ${color}44`, borderRadius: '8px',
        padding: '1px 5px', cursor: 'default', flexShrink: 0,
        letterSpacing: '0.2px',
      }}
    >
      ←{parent.name}
    </span>
  );
}

const MAX_SPAWN_CHARS = 500;

const SPAWN_PRESETS = [
  { label: '— Preset —', value: '', task: '' },
  { label: '🐛 Bug Fix', value: 'bugfix', task: 'Investigate and fix the following bug: ' },
  { label: '🔍 Code Review', value: 'review', task: 'Review this code for quality, bugs, and best practices: ' },
  { label: '✨ Feature', value: 'feature', task: 'Implement the following feature: ' },
  { label: '📝 Docs', value: 'docs', task: 'Write documentation for: ' },
  { label: '🔬 Research', value: 'research', task: 'Research and summarize: ' },
  { label: '🧪 Test', value: 'test', task: 'Write tests for: ' },
  { label: '♻️ Refactor', value: 'refactor', task: 'Refactor for clarity and performance: ' },
];

// Copy-to-clipboard helper
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

function SessionDetailModal({ sessionKey, subAgents, onClose }: { sessionKey: string; subAgents: SubAgent[]; onClose: () => void }) {
  const sa = subAgents.find(s => s.sessionKey === sessionKey);
  if (!sa) return null;
  const label = statusLabel(sa.status);
  // Live elapsed timer — ticks every second
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
  const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(10,14,26,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '16px', padding: '24px 28px', width: '420px', maxWidth: '90vw',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '22px' }}>
              {runtimeIcons[sa.runtime] || '✨'}
            </span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Session Details
              </div>
              <div style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', marginTop: '2px' }}>
                {sa.sessionKey}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
            borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '12px', padding: '4px 10px',
          }}>✕</button>
        </div>

        {/* Task */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Task</div>
          <div style={{
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '10px 12px', fontSize: '12px',
            color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.6, maxHeight: '100px', overflowY: 'auto',
            wordBreak: 'break-word',
          }}>
            {sa.taskName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No task description</span>}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          {[
            { label: 'Status', value: label, color: label === 'active' ? 'var(--green)' : label === 'thinking' ? 'var(--yellow)' : label === 'error' ? 'var(--red)' : 'var(--text-muted)' },
            { label: 'Runtime', value: sa.runtime || '—', color: 'var(--text-secondary)' },
            { label: 'Tokens', value: formatTokens(sa.tokenUsage), color: 'var(--green)' },
            { label: 'Elapsed', value: formatDuration(elapsedSecs), color: elapsedSecs > 3600 ? 'var(--red)' : elapsedSecs > 1800 ? 'var(--yellow)' : 'var(--text-secondary)' },
            { label: 'Tok/min', value: tokenRate !== null ? `${tokenRate}` : '—', color: 'var(--cyan)' },
            { label: 'Full Status', value: sa.status || 'unknown', color: 'var(--text-muted)', fontSize: '9px' },
          ].map(({ label: l, value, color }) => (
            <div key={l} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px' }}>
              <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>{l}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Started at */}
        {sa.startedAt && (
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '16px' }}>
            Started: {new Date(sa.startedAt).toLocaleString()}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="spawn-btn"
            style={{ flex: 1 }}
            onClick={() => { copyToClipboard(sa.taskName || sa.sessionKey || ''); }}
          >
            📋 Copy Task
          </button>
          <button
            className="spawn-btn"
            style={{ flex: 1, background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--red)' }}
            onClick={async () => {
              try {
                await fetch(`/__gateway/sessions/${encodeURIComponent(sa.sessionKey)}`, { method: 'DELETE', signal: AbortSignal.timeout(3000) });
                onClose();
              } catch { /* silent */ }
            }}
          >
            ■ Kill Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Runtime filter chips for session search ───────────────────────────────────
function RuntimeFilterChips({ subAgents, activeFilter, onFilterChange, runtimes }: { subAgents: SubAgent[]; activeFilter: string; onFilterChange: (f: string) => void; runtimes: string[] }) {
  const counts: Record<string, number> = { all: subAgents.length };
  runtimes.slice(1).forEach(rt => { counts[rt] = subAgents.filter(sa => sa.runtime === rt).length; });
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {runtimes.map(rt => {
        const isActive = activeFilter === rt;
        const color = rt === 'all' ? 'var(--accent)' : rt === 'dev' ? 'var(--codex)' : rt === 'pi' ? 'var(--pi)' : rt === 'gemini' ? 'var(--gemini)' : rt === 'minimax' ? 'var(--accent)' : 'var(--accent)';
        const label = rt === 'all' ? `All` : rt === 'pi' ? `Pi` : rt === 'dev' ? `Dev` : rt === 'gemini' ? `Gemini` : rt === 'minimax' ? `Minimax` : rt.charAt(0).toUpperCase() + rt.slice(1);
        const count = counts[rt] || 0;
        return (
          <button
            key={rt}
            onClick={() => onFilterChange(rt)}
            title={`Filter by ${label} (${count} session${count !== 1 ? 's' : ''})`}
            style={{
              background: isActive ? `${color}18` : 'transparent',
              border: `1px solid ${isActive ? `${color}55` : 'var(--border)'}`,
              borderRadius: '12px', padding: '2px 8px',
              fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
              color: isActive ? color : 'var(--text-muted)',
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: isActive ? `0 0 6px ${color}22` : 'none',
            }}
          >
            {label} {count > 0 && `(${count})`}
          </button>
        );
      })}
    </div>
  );
}

// ─── Spawn duration presets — help users estimate task complexity ───────────────
const DURATION_PRESETS = [
  { label: '⚡ Quick', secs: 120, color: 'var(--green)', description: '<2 min' },
  { label: '📝 Simple', secs: 600, color: 'var(--cyan)', description: '<10 min' },
  { label: '🔧 Medium', secs: 1800, color: 'var(--yellow)', description: '<30 min' },
  { label: '🧩 Complex', secs: 3600, color: 'var(--red)', description: '>30 min' },
];

function DurationPresetSelector({ selected, onChange }: { selected: number | null; onChange: (secs: number | null) => void }) {
  return (
    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
      {DURATION_PRESETS.map(p => {
        const isActive = selected === p.secs;
        return (
          <button
            key={p.secs}
            onClick={() => onChange(isActive ? null : p.secs)}
            title={`Est. duration: ${p.description}`}
            style={{
              background: isActive ? `${p.color}18` : 'transparent',
              border: `1px solid ${isActive ? `${p.color}55` : 'var(--border)'}`,
              borderRadius: '8px', padding: '3px 7px',
              fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
              color: isActive ? p.color : 'var(--text-muted)',
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: isActive ? `0 0 6px ${p.color}22` : 'none',
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Average session time calculator ───────────────────────────────────────────
function calcSessionStats(subAgents: SubAgent[]) {
  const withTime = subAgents.filter(sa => sa.startedAt);
  if (withTime.length === 0) return null;
  const now = Date.now();
  const elapsedSecs = withTime.map(sa => Math.floor((now - (sa.startedAt || 0)) / 1000));
  const avg = Math.floor(elapsedSecs.reduce((a, b) => a + b, 0) / elapsedSecs.length);
  const max = Math.max(...elapsedSecs);
  const min = Math.min(...elapsedSecs);
  return { avg, max, min, count: withTime.length };
}

export default function AgentMonitor({ onAgentsChange, onSubAgentsChange, activities, setActivities, onSystemEvent }: Props) {
  const { success, error: toastError } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connected, setConnected] = useState(true);
  const [memoryUsage, setMemoryUsage] = useState<number | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [uptime, setUptime] = useState<number | null>(null);
  const prevAgentsRef = useRef<Agent[]>(agents);
  const prevAgentStatusRef = useRef<Record<string, string>>({});
  const prevConnectedRef = useRef<boolean>(connected);
  const prevSessionCountRef = useRef<number>(0);
  const [subAgentFilter, setSubAgentFilter] = useState<'all' | 'active' | 'thinking' | 'error'>('all');
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [pinnedErrorsOnly, setPinnedErrorsOnly] = useState(false);
  const [activityGrouped, setActivityGrouped] = useState(false);
  const [groupByRuntime, setGroupByRuntime] = useState(false);
  const [activitySinceRefresh, setActivitySinceRefresh] = useState(0);
  const [killConfirmKey, setKillConfirmKey] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionRuntimeFilter, setSessionRuntimeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'sessionKey' | 'taskName' | 'runtime' | 'status' | 'age' | 'elapsed' | 'tokens' | 'rate' | 'parent'>('elapsed');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc'); // default: longest-running first
  const [pollingPaused, setPollingPaused] = useState(false);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [peekMode, setPeekMode] = useState(false);
  const [peekTarget, setPeekTarget] = useState<string | null>(null);
  const [peekedSessionKey, setPeekedSessionKey] = useState<string | null>(null);
  const { info: toastInfo, error: toastErrorStatus } = useToast();

  // Peek tooltip state — managed per-row via session key
  const peekTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handlePeekEnter = useCallback((sessionKey: string) => {
    peekTimerRef.current[sessionKey] = setTimeout(() => {
      setPeekTarget(sessionKey);
      setPeekMode(true);
    }, 600);
  }, []);
  const handlePeekLeave = useCallback((sessionKey: string) => {
    if (peekTimerRef.current[sessionKey]) {
      clearTimeout(peekTimerRef.current[sessionKey]);
      delete peekTimerRef.current[sessionKey];
    }
    setPeekTarget(null);
    setPeekMode(false);
  }, []);

  // Quick spawn form state
  const [spawnTask, setSpawnTask] = useState('');
  const [spawnRuntime, setSpawnRuntime] = useState('codex');
  const [isSpawning, setIsSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState('');
  const [spawnPreset, setSpawnPreset] = useState('');
  const [spawnDuration, setSpawnDuration] = useState<number | null>(null);
  // Selected session duration hint — user picks an estimate to help prioritize token budgets
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  // Spawn history: last 5 spawned tasks for quick re-spawn — persisted to localStorage
  const [spawnHistory, setSpawnHistory] = useState<{ task: string; runtime: string; ts: number }[]>(() => {
    try {
      const saved = localStorage.getItem('mc_spawn_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Persist spawnHistory to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem('mc_spawn_history', JSON.stringify(spawnHistory)); } catch {}
  }, [spawnHistory]);
  // Token rate history for sparkline
  const [tokenRateHistory, setTokenRateHistory] = useState<number[]>([]);
  // Track previous token count for delta display
  const prevTokenCountRef = useRef<number>(0);
  const [tokenDelta, setTokenDelta] = useState<number>(0);
  // Track sessions we've already warned about (5min, 15min, 30min milestones)
  const warnedMilestonesRef = useRef<Record<string, Set<number>>>({});
  // Session table keyboard navigation
  const [focusedRowIdx, setFocusedRowIdx] = useState<number>(-1);

  const fetchStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/__gateway/status', {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        // Record gateway reconnect as system event
        if (prevConnectedRef.current === false) {
          setActivities(prev => [{
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            agentName: 'Gateway',
            event: 'system' as ActivityEvent['event'],
            detail: 'Gateway reconnected',
          }, ...prev].slice(0, 20));
        }
        prevConnectedRef.current = true;
        setConnected(true);

        if (data.agents && Array.isArray(data.agents)) {
          // If no agents yet, use the API data directly; otherwise merge status updates
          const updated = agents.length === 0
            ? data.agents
            : agents.map(a => {
                const remote = data.agents.find((r: any) =>
                  r.id === a.id || r.name?.toLowerCase() === a.id
                );
                return remote ? { ...a, status: remote.status || a.status } : a;
              });

          // Detect status changes → record activity
          const newActivities: ActivityEvent[] = [];
          updated.forEach((agent: Agent, i: number) => {
            const prevAgent = prevAgentsRef.current[i];
            if (prevAgent && prevAgent.status !== agent.status) {
              const newAgentWithActivity = { ...agent, lastActivity: Date.now() };
              updated[i] = newAgentWithActivity;
              prevAgentStatusRef.current[agent.id] = prevAgent.status || 'idle';
              const label = statusLabel(agent.status);
              let eventType: ActivityEvent['event'] = 'completed';
              if (label === 'active') eventType = 'started';
              else if (label === 'thinking') eventType = 'thinking';
              else if (label === 'error') eventType = 'error';
              newActivities.push({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                agentName: agent.name,
                event: eventType,
                detail: `${agent.name} is now ${label}`,
              });
            }
          });
          if (newActivities.length > 0) {
            setActivities(prev => [...newActivities, ...prev].slice(0, 20));
            setActivitySinceRefresh(c => c + newActivities.length);
            // Dispatch window event for 3D scene activity ticker
            window.dispatchEvent(new CustomEvent('mc:activity', { detail: newActivities[0] }));
            // Fire toast for significant status changes
            newActivities.forEach(na => {
              if (na.event === 'started') {
                toastInfo(`${na.agentName} is now active`, na.detail);
              } else if (na.event === 'error') {
                toastErrorStatus(`${na.agentName} error`, na.detail);
                // Auto-expand activity feed when a new error arrives so it's immediately visible
                setActivityExpanded(true);
              }
            });
          }

          setAgents(updated);
          onAgentsChange(updated);
          prevAgentsRef.current = updated;
        }

        if (data.sessions || data.subAgents) {
          const sa = (data.sessions || data.subAgents || []);
          setSubAgents(sa);
          onSubAgentsChange?.(sa);
        }

        if (typeof data.memoryUsage === 'number') {
          setMemoryUsage(data.memoryUsage);
          setMemoryHistory(prev => [...prev.slice(-4), data.memoryUsage]);
        }
        if (typeof data.uptime === 'number') setUptime(data.uptime);
        if (typeof data.cpuUsage === 'number') setCpuUsage(data.cpuUsage);

        // Track token rate for sparkline: sum tok/s across all subAgents
        const sa = data.sessions || data.subAgents || [];
        const now = Date.now();
        // Warn about sessions running > 5 min, 15 min, 30 min
        const MILESTONES = [
          { secs: 300,  label: '5m',  color: 'var(--yellow)', priority: 'timeSensitive' as const },
          { secs: 900,  label: '15m', color: 'var(--yellow)', priority: 'timeSensitive' as const },
          { secs: 1800, label: '30m', color: 'var(--red)',     priority: 'timeSensitive' as const },
        ];
        sa.forEach((s: any) => {
          if (s.sessionKey && s.startedAt) {
            const ageSecs = (now - s.startedAt) / 1000;
            if (!warnedMilestonesRef.current[s.sessionKey]) {
              warnedMilestonesRef.current[s.sessionKey] = new Set();
            }
            MILESTONES.forEach(({ secs, label }) => {
              if (ageSecs > secs && !warnedMilestonesRef.current[s.sessionKey].has(secs)) {
                warnedMilestonesRef.current[s.sessionKey].add(secs);
                const ageMin = Math.floor(ageSecs / 60);
                toastError(
                  `⏱ Session ${s.sessionKey?.slice(0, 8)} — ${ageMin}+ min`,
                  s.taskName?.slice(0, 55) || `Running for ${label}`,
                );
              }
            });
          }
        });
        const totalToks = sa.reduce((sum: number, s: any) => sum + (s.tokenUsage || 0), 0);
        const totalElapsed = sa.reduce((max: number, s: any) => {
          if (!s.startedAt) return max;
          const elapsed = (now - s.startedAt) / 1000;
          return elapsed > max ? elapsed : max;
        }, 0);
        // Token delta vs previous poll
        const delta = totalToks - prevTokenCountRef.current;
        if (delta > 0) setTokenDelta(delta);
        prevTokenCountRef.current = totalToks;
        if (totalElapsed > 0 && totalToks > 0) {
          const rate = Math.round((totalToks / totalElapsed) * 60); // tok/min
          setTokenRateHistory(prev => [...prev.slice(-14), rate]);
        }

        setLastUpdate(new Date());
      } else {
        setConnected(false);
      }
    } catch {
      if (prevConnectedRef.current !== false) {
        setActivities(prev => [{
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          agentName: 'Gateway',
          event: 'system' as ActivityEvent['event'],
          detail: 'Gateway unreachable',
        }, ...prev].slice(0, 20));
      }
      prevConnectedRef.current = false;
      setConnected(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [agents, onAgentsChange, onSubAgentsChange, setActivities, toastError]);

  useEffect(() => {
    if (pollingPaused) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, pollingPaused]);

  // Listen for quick refresh from Dashboard quick-actions
  useEffect(() => {
    const handler = () => fetchStatus();
    window.addEventListener('mc:refresh', handler);
    return () => window.removeEventListener('mc:refresh', handler);
  }, [fetchStatus]);

  // Listen for session selection from Workshop timeline
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionKey } = (e as CustomEvent<{ sessionKey: string }>).detail;
      setSelectedSessionKey(sessionKey);
    };
    window.addEventListener('mc:selectSessionInternal', handler);
    return () => window.removeEventListener('mc:selectSessionInternal', handler);
  }, []);

  // Listen for P key toggle polling from Dashboard
  useEffect(() => {
    const handler = () => {
      const next = !pollingPaused;
      setPollingPaused(next);
      window.dispatchEvent(new CustomEvent('mc:pollingPaused', { detail: { paused: next } }));
    };
    window.addEventListener('mc:togglePolling', handler);
    return () => window.removeEventListener('mc:togglePolling', handler);
  }, [pollingPaused]);

  // Tick the elapsed time display every second
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
  const activeSessionCount = agents.filter(a => a.status === 'active' || a.status === 'thinking').length;
  const prevSessionCount = prevSessionCountRef.current;
  const sessionTrend = subAgents.length > prevSessionCount ? 'up' : subAgents.length < prevSessionCount ? 'down' : 'same';
  // Update prev ref after render
  useEffect(() => {
    prevSessionCountRef.current = subAgents.length;
  });

  // Keyboard navigation for session table
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const filtered = subAgents.filter(sa => {
        const matchesSearch = sessionSearch === '' ||
          (sa.sessionKey || '').toLowerCase().includes(sessionSearch.toLowerCase()) ||
          (sa.taskName || '').toLowerCase().includes(sessionSearch.toLowerCase());
        const matchesFilter = subAgentFilter === 'all' || statusLabel(sa.status) === subAgentFilter;
        const matchesRuntime = sessionRuntimeFilter === 'all' || sa.runtime === sessionRuntimeFilter;
        return matchesSearch && matchesFilter && matchesRuntime;
      });
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIdx(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        setFocusedRowIdx(-1);
        setPeekedSessionKey(null);
      } else if (e.key === 'Enter') {
        if (focusedRowIdx >= 0 && focusedRowIdx < filtered.length) {
          const sa = filtered[focusedRowIdx];
          if (sa.sessionKey) setSelectedSessionKey(sa.sessionKey);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [subAgents, sessionSearch, subAgentFilter, sessionRuntimeFilter]);

  // Dismiss peek panel on click outside
  useEffect(() => {
    if (!peekedSessionKey) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.subagent-row') && !target.closest('.sa-task-wrap')) {
        setPeekedSessionKey(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [peekedSessionKey]);

  const killSession = useCallback(async (sessionKey: string, taskName?: string) => {
    try {
      await fetch(`/__gateway/sessions/${encodeURIComponent(sessionKey)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3000),
      });
      success('Session terminated', taskName || sessionKey.slice(0, 8));
      onSystemEvent?.({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'kill',
        detail: `Killed: ${taskName?.slice(0, 40) || sessionKey.slice(0, 8)}`,
      });
      fetchStatus();
    } catch {
      toastError('Failed to kill session', sessionKey.slice(0, 8));
    }
  }, [fetchStatus, success, toastError, onSystemEvent]);

  const handleSpawn = useCallback(async () => {
    const task = spawnTask.trim();
    if (!task) return;
    setIsSpawning(true);
    setSpawnError('');
    try {
      const res = await fetch('/__gateway/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, runtime: spawnRuntime }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        success('Session spawned', `${spawnRuntime}: "${task.slice(0, 50)}${task.length > 50 ? '…' : ''}"`);
        setSpawnTask('');
        // Record in spawn history for quick re-spawn
        setSpawnHistory(prev => [{ task, runtime: spawnRuntime, ts: Date.now() }, ...prev].slice(0, 5));
        onSystemEvent?.({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'spawn',
          runtime: spawnRuntime,
          detail: `Spawned [${spawnRuntime}]: ${task.slice(0, 45)}${task.length > 45 ? '…' : ''}`,
        });
        fetchStatus();
      } else {
        let msg = `Error ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && (errData.message || errData.error || errData.detail)) {
            msg = errData.message || errData.error || errData.detail;
          } else if (errData && typeof errData === 'string') {
            msg = errData.slice(0, 120);
          }
        } catch { /* use default msg */ }
        setSpawnError(msg);
        toastError('Spawn failed', msg);
      }
    } catch (err) {
      const msg = err instanceof Error && err.message.includes('abort') ? 'Request timed out' : 'Network error — check gateway connection';
      setSpawnError(msg);
      toastError('Spawn failed', msg);
    } finally {
      setIsSpawning(false);
    }
  }, [spawnTask, spawnRuntime, fetchStatus, success, toastError, onSystemEvent]);

  // Token rate bar: max reasonable rate for scaling (e.g. 2000 tokens/min as 100%)
  const MAX_TOKEN_RATE = 2000;

  return (
    <ErrorBoundary name="AgentMonitor">
    <div className="monitor-panel">
      {/* System stats row */}
      <div className="sys-stats-row">
        <div className={`sys-stat ${activeSessionCount > 0 ? 'sys-stat--active-emphasis' : ''}`}>
          <span className="sys-stat-label">Active</span>
          <span className="sys-stat-value sys-stat-value--highlight">{activeSessionCount}</span>
        </div>
        <div className="sys-stat">
          <span className="sys-stat-label">Sessions</span>
          <span className="sys-stat-value">
            {subAgents.length}
            <span className={`sa-trend sa-trend--${sessionTrend}`} title={`Sessions vs previous poll (${sessionTrend === 'up' ? '+' : ''}${subAgents.length - prevSessionCount})`}>
              {sessionTrend === 'up' ? `+${subAgents.length - prevSessionCount}` : sessionTrend === 'down' ? `${subAgents.length - prevSessionCount}` : '—'}
            </span>
          </span>
        </div>
        <div className="sys-stat">
          <span className="sys-stat-label">Tokens</span>
          <span className="sys-stat-value">{formatTokens(totalTokens)}</span>
          {tokenDelta > 0 && (
            <span className="sys-stat-delta" title={`+${formatTokens(tokenDelta)} since last poll`}>+{formatTokens(tokenDelta)}</span>
          )}
          {tokenRateHistory.length > 1 && (
            <>
              <div className="memory-sparkline" title={`Token rate: ${tokenRateHistory[tokenRateHistory.length - 1]} tok/min`}>
                {tokenRateHistory.map((r, i) => {
                  const maxR = Math.max(...tokenRateHistory, 1);
                  const minR = Math.min(...tokenRateHistory);
                  const range = maxR - minR || 1;
                  const h = Math.round(((r - minR) / range) * 14) + 3;
                  const color = r > MAX_TOKEN_RATE * 0.7 ? 'var(--yellow)' : r > MAX_TOKEN_RATE * 0.4 ? 'var(--green)' : 'var(--text-muted)';
                  return <div key={i} className="spark-bar" style={{ height: `${h}px`, background: color }} />;
                })}
              </div>
              <span style={{ fontSize: '9px', color: 'var(--cyan)', fontFamily: "'JetBrains Mono', monospace" }}>
                ↑{Math.max(...tokenRateHistory)} peak
              </span>
              {Math.max(...tokenRateHistory) > 1500 && (
                <span style={{ fontSize: '9px', color: 'var(--yellow)', fontFamily: "'JetBrains Mono', monospace", background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', padding: '1px 5px', fontWeight: 600 }} title="High token consumption — approaching rate limit">
                  ⚡ HIGH
                </span>
              )}
              {Math.max(...tokenRateHistory) > 1500 && (
                <span style={{ fontSize: '9px', color: 'var(--yellow)', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', padding: '1px 5px', marginLeft: '2px' }} title={`Peak token rate ${Math.max(...tokenRateHistory)} tok/min exceeds 1500 tok/min threshold`}>
                  ⚠ HIGH
                </span>
              )}
            </>
          )}
        </div>
        {memoryUsage !== null && (
          <div className="sys-stat">
            <span className="sys-stat-label">Heap</span>
            <span className="sys-stat-value">{memoryUsage < 1024 ? `${memoryUsage}MB` : `${(memoryUsage / 1024).toFixed(1)}GB`}</span>
            {memoryHistory.length > 1 && (
              <div className="memory-sparkline" title={`Memory trend: ${memoryHistory.length} readings`}>
                {memoryHistory.map((m, i) => {
                  const maxMem = Math.max(...memoryHistory);
                  const minMem = Math.min(...memoryHistory);
                  const range = maxMem - minMem || 1;
                  const h = Math.round(((m - minMem) / range) * 16) + 4;
                  return <div key={i} className="spark-bar" style={{ height: `${h}px`}} />;
                })}
              </div>
            )}
          </div>
        )}
        <div className="sys-stat">
          <span className="sys-stat-label">CPU</span>
          <span className="sys-stat-value sys-stat-value--muted">{cpuUsage !== null ? `${cpuUsage}%` : '—'}</span>
          {cpuUsage !== null && (
            <div className="memory-sparkline" title={`CPU: ${cpuUsage}%`}>
              <div style={{
                width: '48px', height: '4px', background: 'var(--bg-deep)',
                borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: `${cpuUsage}%`,
                  height: '100%',
                  background: cpuUsage > 80 ? 'var(--red)' : cpuUsage > 50 ? 'var(--yellow)' : 'var(--green)',
                  borderRadius: '2px',
                  transition: 'width 0.5s ease',
                  boxShadow: `0 0 4px ${cpuUsage > 80 ? 'var(--red)' : cpuUsage > 50 ? 'var(--yellow)' : 'var(--green)'}`,
                }} />
              </div>
            </div>
          )}
        </div>
        {uptime !== null && (
          <div className="sys-stat">
            <span className="sys-stat-label">Uptime</span>
            <span className="sys-stat-value">
              {uptime < 60 ? `${Math.floor(uptime)}s` : uptime < 3600 ? `${Math.floor(uptime / 60)}m` : `${(uptime / 3600).toFixed(1)}h`}
            </span>
          </div>
        )}
        <div className="sys-stat sys-stat--health">
          <span className="sys-stat-label">Health</span>
          <div className="agent-health-bar" title={`${activeSessionCount} active/thinking of ${agents.length} total`}>
            <div
              className="agent-health-fill"
              style={{ width: `${agents.length > 0 ? (activeSessionCount / agents.length) * 100 : 0}%` }}
            />
          </div>
          <span className="sys-stat-value" style={{ fontSize: '10px' }}>
            {activeSessionCount}/{agents.length}
          </span>
        </div>
        {activities.filter(a => a.event === 'error').length > 0 && (
          <div className="sys-stat">
            <span className="sys-stat-label">Errors</span>
            <span className="sys-stat-value" style={{ color: 'var(--red)' }}>
              {activities.filter(a => a.event === 'error').length}
            </span>
          </div>
        )}
        {/* Runtime token breakdown — only when sub-agents are running */}
        {subAgents.length > 0 && (() => {
          const runtimes = agents.map(a => a.runtime).filter((v, i, arr) => arr.indexOf(v) === i);
          const breakdown = runtimes.map(rt => ({
            rt,
            tokens: subAgents.filter(sa => sa.runtime === rt).reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0),
            count: subAgents.filter(sa => sa.runtime === rt).length,
          })).filter(b => b.count > 0);
          if (breakdown.length === 0) return null;
          return (
            <div className="sys-stat sys-stat--runtime-breakdown">
              <span className="sys-stat-label">By Runtime</span>
              <div className="runtime-breakdown-dots">
                {breakdown.map(({ rt, tokens, count }) => (
                  <span key={rt} className="runtime-breakdown-item" title={`${count} ${rt} session(s): ${formatTokens(tokens)} tokens`}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block', background: runtimeColors[rt] || 'var(--text-muted)', boxShadow: `0 0 4px ${runtimeColors[rt] || 'var(--text-muted)'}`, marginRight: '2px', flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>{formatTokens(tokens)}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="panel-header">
        <div className="panel-header-left">
          <h3>📡 Agent Monitor</h3>
          <div className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}>
            <span className="conn-dot" />
            {connected ? 'Live' : 'Offline'}
          </div>
        </div>
        <div className="panel-header-right">
          <span className="peek-kbd-hint" title="Hover over a task name for 600ms to peek full details">⌘K to peek task</span>
          <span className="last-update">{lastUpdate.toLocaleTimeString()}</span>
          <button
            className={`refresh-btn ${isRefreshing ? 'spinning' : ''}`}
            onClick={fetchStatus}
            disabled={isRefreshing}
            title="Refresh status"
          >
            ↻
          </button>
          <button
            className={`refresh-btn ${pollingPaused ? 'paused' : ''}`}
            onClick={() => {
              const next = !pollingPaused;
              setPollingPaused(next);
              window.dispatchEvent(new CustomEvent('mc:pollingPaused', { detail: { paused: next } }));
            }}
            title={pollingPaused ? 'Resume polling' : 'Pause polling'}
            style={pollingPaused ? { color: 'var(--yellow)', borderColor: 'var(--yellow)' } : {}}
          >
            {pollingPaused ? '▶' : '⏸'}
          </button>
        </div>
      </div>

      <div className="agents-grid">
        {agents.map(agent => {
          const label = statusLabel(agent.status);
          const lastActivity = agent.lastActivity ? formatRelative(agent.lastActivity) : null;
          const agentSubAgents = subAgents.filter(sa =>
            sa.sessionKey?.includes(agent.id) || sa.taskName?.includes(agent.name || '')
          );
          const currentTask = agentSubAgents.find(sa =>
            sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active')
          );
          const prevStatus = prevAgentStatusRef.current[agent.id];
          const statusJustChanged = !!prevStatus && prevStatus !== agent.status;
          const runtimeIcon = agent.runtime === 'dev' && label === 'active' ? '💻' : (runtimeIcons[agent.runtime] || '✨');
          return (
            <div key={agent.id} className={`agent-card ${label}${statusJustChanged ? ' agent-card--status-changed' : ''}`} data-status={label}>
              <div className="agent-card-icon">
                {runtimeIcon}
              </div>
              <div className="agent-card-info">
                <div className="agent-card-name-row">
                  <div className="agent-card-name">{agent.name}</div>
                  <RuntimeBadge runtime={agent.runtime} prominent />
                </div>
                <div className={`agent-card-status ${label}`}>
                  <span className="status-dot" />
                  {label}
                </div>
                {currentTask?.taskName && (
                  <div className="agent-card-task" title={`Current task: ${currentTask.taskName}`}>
                    → {currentTask.taskName.length > 32 ? currentTask.taskName.slice(0, 32) + '…' : currentTask.taskName}
                  </div>
                )}
              </div>
              {lastActivity && (
                <span className="agent-card-last-activity" title="Last status change">
                  {lastActivity}
                </span>
              )}
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('workshop:inspect-agent', { detail: { agentId: agent.id } }));
                }}
                title={`Inspect ${agent.name} in 3D workshop`}
                style={{
                  background: 'rgba(59,122,255,0.08)', border: '1px solid rgba(59,122,255,0.2)',
                  borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '10px', padding: '3px 6px', marginLeft: 'auto', flexShrink: 0,
                  transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '3px',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                ◈ 3D
              </button>
            </div>
          );
        })}
      </div>

      {/* Activity feed */}
      {activities.length === 0 && (
        <div className="activity-empty">
          <span className="activity-empty-icon">📡</span>
          <div>No recent agent events</div>
          <div className="activity-empty-sub">
            {agents.filter(a => a.status === 'active' || a.status === 'thinking').length > 0
              ? 'Agent is active — polling every 5s'
              : 'Waiting for agent activity…'}
          </div>
        </div>
      )}
      {activities.length > 0 && (
        <div className="activity-section">
          <div className="activity-section-header">
            <h4 className="section-label">
              Recent Activity
              <button
                className="activity-copy-log-btn"
                title="Copy all recent activity as text"
                onClick={() => {
                  const logText = activities.map(ev =>
                    `[${formatAbsoluteTime(ev.timestamp)}] ${ev.agentName}: ${ev.event} — ${ev.detail || ''}`
                  ).join('\n');
                  copyToClipboard(logText || 'No activity to copy');
                  success('Activity log copied', '');
                }}
              >
                📋 Copy log
              </button>
              {activities.length > 0 && (
                <span className="activity-count-badge">{activities.length}</span>
              )}
              {activitySinceRefresh > 0 && (
                <span className="activity-new-badge" title={`${activitySinceRefresh} new since last manual refresh`}>
                  {activitySinceRefresh}
                </span>
              )}
              <button
                className={`activity-group-toggle ${activityGrouped ? 'active' : ''}`}
                onClick={() => setActivityGrouped(v => !v)}
                title="Toggle grouping by agent"
              >
                {activityGrouped ? '👥 Grouped' : '📋 Group'}
              </button>
              {pinnedErrorsOnly && activities.filter(a => a.event === 'error' || a.event === 'system').length > 0 && (
                <span className="activity-pinned-badge">{activities.filter(a => a.event === 'error' || a.event === 'system').length}</span>
              )}
            </h4>
            <div className="activity-timeline-mini">
              {activities.slice(0, 15).map(ev => (
                <div
                  key={ev.id}
                  className={`atm-dot atm-dot--${ev.event}`}
                  title={`${ev.agentName}: ${ev.event}`}
                />
              ))}
            </div>
            {activities.length > 3 && (
              <button
                className="activity-clear-btn"
                onClick={() => setActivities([])}
                title="Clear all activity"
              >
                Clear all
              </button>
            )}
            {activities.length > 0 && (
              <button
                className="activity-clear-btn"
                onClick={() => setActivityExpanded(false)}
                title="Collapse all activity entries"
              >
                Collapse all
              </button>
            )}
            <button
              className={`activity-pin-errors-btn ${pinnedErrorsOnly ? 'active' : ''}`}
              onClick={() => setPinnedErrorsOnly(v => !v)}
              title="Pin error and system events"
            >
              {pinnedErrorsOnly ? '📌' : '📍'} Pin errors
              {activities.filter(a => a.event === 'error' || a.event === 'system').length > 0 && (
                <span className="activity-pinned-badge" style={{ marginLeft: '4px' }}>
                  {activities.filter(a => a.event === 'error' || a.event === 'system').length}
                </span>
              )}
            </button>
          </div>
          <div className="activity-list">
            {activityGrouped ? (
              // Grouped by agent view
              (() => {
                const groups: Record<string, typeof activities> = {};
                activities.forEach(ev => {
                  if (!groups[ev.agentName]) groups[ev.agentName] = [];
                  groups[ev.agentName].push(ev);
                });
                return Object.entries(groups).slice(0, activityExpanded ? undefined : 5).map(([agentName, evs]) => (
                  <div key={agentName} className="activity-group">
                    <div className="activity-group-header" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {agentName} ({evs.length})
                    </div>
                    {evs.slice(0, 3).map(ev => {
                      const isNew = ev.timestamp > lastUpdate.getTime();
                      return (
                        <div key={ev.id} className={`activity-row activity-row--${ev.event}${ev.event === 'error' ? ' pinned-error-row' : ''}`}>
                          <span className="activity-icon">
                            {ev.event === 'started' ? '▶' : ev.event === 'thinking' ? '💭' : ev.event === 'error' ? '✕' : ev.event === 'system' ? '⚙' : '✓'}
                          </span>
                          <span className="activity-text">{ev.detail || `${ev.agentName} ${ev.event}`}</span>
                          {isNew && <span className="activity-new-badge">NEW</span>}
                          <span className="activity-time">{formatElapsed(ev.timestamp)}</span>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()
            ) : (
              // Regular list view
              (activityExpanded ? activities : activities.slice(0, 8)).map(ev => {
                const isPinned = pinnedErrorsOnly && (ev.event === 'error' || ev.event === 'system');
                const isNew = ev.timestamp > lastUpdate.getTime();
                return (
                  <div key={ev.id} className={`activity-row activity-row--${ev.event}${isPinned ? ' pinned-error-row' : ''}`}>
                    <span className="activity-icon">
                      {ev.event === 'started' ? '▶' : ev.event === 'thinking' ? '💭' : ev.event === 'error' ? '✕' : ev.event === 'system' ? '⚙' : '✓'}
                    </span>
                    <span className="activity-text">{ev.detail || `${ev.agentName} ${ev.event}`}</span>
                    {isNew && ev.event !== 'system' && <span className="activity-new-badge">NEW</span>}
                    <span className="activity-time" title={`${new Date(ev.timestamp).toLocaleTimeString()} — ${new Date(ev.timestamp).toLocaleDateString()}`}>
                      <span className="activity-time-abs">{formatAbsoluteTime(ev.timestamp)}</span>
                      <span className="activity-time-rel"> · {formatElapsed(ev.timestamp)}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {activities.length > 8 && (
            <button
              className="activity-expand-btn"
              onClick={() => setActivityExpanded(e => !e)}
            >
              {activityExpanded ? `Show less` : `Show ${activities.length - 8} more`}
            </button>
          )}
        </div>
      )}

      {subAgents.length > 0 && (
        <>
          {/* Token Budget Forecaster — fleet-wide token budget health */}
          <TokenBudgetForecaster subAgents={subAgents} />

        <div className="subagents-section">
          {/* Session age distribution histogram */}
          <div className="session-age-histogram" title="Session age distribution — how long each session has been running">
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600, flexShrink: 0 }}>Age dist.</span>
            {(() => {
              const buckets = [
                { label: '<5m', maxMs: 5 * 60 * 1000, color: 'var(--green)' },
                { label: '5-15m', maxMs: 15 * 60 * 1000, color: 'var(--cyan)' },
                { label: '15-30m', maxMs: 30 * 60 * 1000, color: 'var(--yellow)' },
                { label: '>30m', maxMs: Infinity, color: 'var(--red)' },
              ];
              const counts = buckets.map(b => subAgents.filter(sa => {
                if (!sa.startedAt) return false;
                const age = Date.now() - sa.startedAt;
                const prevBucket = buckets[buckets.indexOf(b) - 1];
                const minMs = prevBucket ? prevBucket.maxMs : 0;
                return age >= minMs && age < b.maxMs;
              }).length);
              const maxCount = Math.max(...counts, 1);
              return (
                <>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', flex: 1 }}>
                    {buckets.map((b, i) => {
                      const count = counts[i];
                      const heightPct = Math.max((count / maxCount) * 100, count > 0 ? 20 : 0);
                      return (
                        <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flex: 1 }}>
                          <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: b.color }}>{count}</span>
                          <div style={{
                            width: '100%', height: `${heightPct}%`, minHeight: '3px',
                            background: count > 0 ? b.color : 'var(--border)',
                            borderRadius: '3px',
                            boxShadow: count > 0 ? `0 0 4px ${b.color}66` : 'none',
                            transition: 'height 0.4s ease',
                          }} />
                          <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>{b.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                    <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)' }}>
                      Total: <span style={{ color: 'var(--cyan)' }}>{subAgents.length}</span>
                    </span>
                    {(() => {
                      const oldest = [...subAgents].filter(sa => sa.startedAt).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
                      if (!oldest?.startedAt) return null;
                      const ageMin = Math.floor((Date.now() - oldest.startedAt) / 60000);
                      return (
                        <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: ageMin > 30 ? 'var(--red)' : ageMin > 15 ? 'var(--yellow)' : 'var(--green)' }}>
                          Oldest: <span style={{ color: 'inherit' }}>{ageMin}m</span>
                        </span>
                      );
                    })()}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Session summary panel */}
          <div className="session-summary-panel">
            <div className="session-summary-item">
              <span className="ss-label">Longest running</span>
              <span className="ss-value">
                {(() => {
                  const longest = [...subAgents].sort((a, b) => {
                    const ea = a.startedAt ? Date.now() - a.startedAt : 0;
                    const eb = b.startedAt ? Date.now() - b.startedAt : 0;
                    return eb - ea;
                  })[0];
                  if (!longest?.startedAt) return '—';
                  const secs = Math.floor((Date.now() - longest.startedAt) / 1000);
                  return (
                    <>
                      <span style={{ color: 'var(--yellow)', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                        {formatDuration(secs)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}> — {longest.taskName?.slice(0, 18) || longest.sessionKey?.slice(0, 8) || '—'}</span>
                    </>
                  );
                })()}
              </span>
            </div>
            <div className="ss-divider" />
            <div className="session-summary-item">
              <span className="ss-label">Highest consumer</span>
              <span className="ss-value">
                {(() => {
                  const highest = [...subAgents].sort((a, b) => (b.tokenUsage || 0) - (a.tokenUsage || 0))[0];
                  if (!highest?.tokenUsage) return '—';
                  return (
                    <>
                      <span style={{ color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                        {formatTokens(highest.tokenUsage)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}> — {highest.taskName?.slice(0, 18) || highest.sessionKey?.slice(0, 8) || '—'}</span>
                    </>
                  );
                })()}
              </span>
            </div>
            <div className="ss-divider" />
            <div className="session-summary-item">
              <span className="ss-label">Most recent spawn</span>
              <span className="ss-value">
                {(() => {
                  const recent = [...subAgents].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
                  if (!recent?.startedAt) return '—';
                  return (
                    <>
                      <span style={{ color: 'var(--cyan)', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                        {formatAbsoluteTime(recent.startedAt)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}> — {recent.taskName?.slice(0, 18) || recent.sessionKey?.slice(0, 8) || '—'}</span>
                    </>
                  );
                })()}
              </span>
            </div>
            {(() => {
              const stats = calcSessionStats(subAgents);
              if (!stats) return null;
              return (
                <>
                  <div className="ss-divider" />
                  <div className="session-summary-item">
                    <span className="ss-label">Avg runtime</span>
                    <span className="ss-value">
                      <span style={{ color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
                        {formatDuration(stats.avg)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}> ({stats.count} session{stats.count !== 1 ? 's' : ''})</span>
                    </span>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="session-search-row">
            <input
              type="text"
              className="session-search-input"
              placeholder="Search sessions..."
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
            />
            {sessionSearch && (
              <button
                className="session-search-clear"
                onClick={() => setSessionSearch('')}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="subagent-filter-row">
            {(['all', 'active', 'thinking', 'error'] as const).map(f => (
              <button
                key={f}
                className={`subagent-filter-btn ${subAgentFilter === f ? 'active' : ''}`}
                onClick={() => setSubAgentFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'all' ? '' : ` (${subAgents.filter(sa => statusLabel(sa.status) === f).length})`}
              </button>
            ))}
            <span className="session-kbd-hint" title="Use arrow keys ↑↓ to navigate sessions, Enter to select">
              ↑↓ navigate
            </span>
          </div>
          {/* Runtime filter chips */}
          <div style={{ marginBottom: '8px' }}>
            <RuntimeFilterChips
              subAgents={subAgents}
              activeFilter={sessionRuntimeFilter}
              onFilterChange={setSessionRuntimeFilter}
              runtimes={['all', ...agents.map(a => a.runtime).filter((v, i, arr) => arr.indexOf(v) === i)]}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
            <h4 className="section-label" style={{ margin: 0 }}>Running Sub-Agents</h4>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {subAgents.length > 0 && (
                <button
                  className={`activity-group-toggle ${groupByRuntime ? 'active' : ''}`}
                  onClick={() => setGroupByRuntime(v => !v)}
                  title="Group sessions by runtime"
                >
                  {groupByRuntime ? '🟢 By runtime' : '○ By runtime'}
                </button>
              )}
              <button
                className="sa-kill-all-btn"
                title="Kill all idle sessions"
                onClick={async () => {
                  const idleSessions = subAgents.filter(sa => {
                    const l = statusLabel(sa.status);
                    return l === 'idle' || l === 'unknown';
                  });
                  if (idleSessions.length === 0) return;
                  if (!confirm(`Kill ${idleSessions.length} idle session(s)?`)) return;
                  for (const sa of idleSessions) {
                    if (sa.sessionKey) {
                      try {
                        await fetch(`/__gateway/sessions/${encodeURIComponent(sa.sessionKey)}`, {
                          method: 'DELETE',
                          signal: AbortSignal.timeout(3000),
                        });
                      } catch { /* silent */ }
                    }
                  }
                  fetchStatus();
                }}
              >
                🗑 Kill idle ({subAgents.filter(sa => { const l = statusLabel(sa.status); return l === 'idle' || l === 'unknown'; }).length})
              </button>
              {subAgents.length > 0 && (
                <button
                  className="activity-copy-log-btn"
                  title="Copy all session keys (one per line)"
                  onClick={async () => {
                    const keys = subAgents.map(sa => sa.sessionKey).filter(Boolean).join('\n');
                    await copyToClipboard(keys || '');
                  }}
                >
                  📋 Copy all keys ({subAgents.length})
                </button>
              )}
            </div>
          </div>
          <div className="subagents-list">
            <div className="subagent-header">
              {([
                { key: 'sessionKey' as const, label: 'ID', title: 'Session ID — click to copy' },
                { key: 'taskName' as const, label: 'Task', title: 'Task description' },
                { key: 'runtime' as const, label: 'RT', title: 'Runtime' },
                { key: 'parent' as const, label: 'Agent', title: 'Parent agent that spawned this session' },
                { key: 'status' as const, label: 'Status', title: 'Session status' },
                { key: 'age' as const, label: 'Age', title: 'Session age' },
                { key: 'elapsed' as const, label: 'Elapsed', title: 'Time running' },
                { key: 'tokens' as const, label: 'Tokens', title: 'Token usage' },
                { key: 'rate' as const, label: 'tok/m', title: 'Token rate (tokens/min)' },
              ]).map(col => (
                <span
                  key={col.key}
                  className={`sortable-header${sortField === col.key ? ' active' : ''}${sortField === col.key ? ` sortable-header--sorted-${sortDir}` : ''}`}
                  title={col.title}
                  onClick={() => {
                    if (sortField === col.key) {
                      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortField(col.key);
                      setSortDir('desc');
                    }
                  }}
                >
                  {col.label}
                  {sortField === col.key && (
                    <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </span>
              ))}
              <span></span>
            </div>
            {(() => {
              const filtered = subAgents.filter(sa => {
                const matchesSearch = sessionSearch === '' ||
                  (sa.sessionKey || '').toLowerCase().includes(sessionSearch.toLowerCase()) ||
                  (sa.taskName || '').toLowerCase().includes(sessionSearch.toLowerCase());
                const matchesFilter = subAgentFilter === 'all' || statusLabel(sa.status) === subAgentFilter;
                const matchesRuntime = sessionRuntimeFilter === 'all' || sa.runtime === sessionRuntimeFilter;
                return matchesSearch && matchesFilter && matchesRuntime;
              });

              const sorted = [...filtered].sort((a, b) => {
                let cmp = 0;
                if (sortField === 'sessionKey') cmp = (a.sessionKey || '').localeCompare(b.sessionKey || '');
                else if (sortField === 'taskName') cmp = (a.taskName || '').localeCompare(b.taskName || '');
                else if (sortField === 'runtime') cmp = (a.runtime || '').localeCompare(b.runtime || '');
                else if (sortField === 'status') cmp = statusLabel(a.status).localeCompare(statusLabel(b.status));
                else if (sortField === 'age') {
                  const ea = a.startedAt ? Date.now() - a.startedAt : 0;
                  const eb = b.startedAt ? Date.now() - b.startedAt : 0;
                  cmp = ea - eb;
                } else if (sortField === 'elapsed') {
                  const ea = a.startedAt ? Date.now() - a.startedAt : 0;
                  const eb = b.startedAt ? Date.now() - b.startedAt : 0;
                  cmp = ea - eb;
                } else if (sortField === 'tokens') cmp = (a.tokenUsage || 0) - (b.tokenUsage || 0);
                else if (sortField === 'rate') {
                  const ea = a.startedAt ? Math.floor((Date.now() - a.startedAt) / 1000) : 0;
                  const eb = b.startedAt ? Math.floor((Date.now() - b.startedAt) / 1000) : 0;
                  const ra = ea > 0 && a.tokenUsage ? (a.tokenUsage / ea) * 60 : 0;
                  const rb = eb > 0 && b.tokenUsage ? (b.tokenUsage / eb) * 60 : 0;
                  cmp = ra - rb;
                } else if (sortField === 'parent') {
                  const parentA = agents.find(ag => a.sessionKey?.includes(ag.id) || a.sessionKey?.includes(ag.name || ''))?.name || '';
                  const parentB = agents.find(ag => b.sessionKey?.includes(ag.id) || b.sessionKey?.includes(ag.name || ''))?.name || '';
                  cmp = parentA.localeCompare(parentB);
                }
                return sortDir === 'asc' ? cmp : -cmp;
              });

              return (
                <div className="subagent-list-inner">
                  {sorted.length > 0 && (
                    <div className="subagent-count-summary" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: "'JetBrains Mono', monospace" }}>
                      Showing {sorted.length} of {subAgents.length} sessions{sessionSearch ? ` matching "${sessionSearch}"` : ''}
                    </div>
                  )}
                  {sorted.length === 0 && (
                    <div className="subagents-empty" style={{ marginTop: '8px' }}>
                      <div className="subagents-empty-icon">🔍</div>
                      <div className="subagents-empty-text">No sessions match</div>
                      <div className="subagents-empty-sub">Try a different search or filter</div>
                    </div>
                  )}
                  {groupByRuntime && sorted.length > 0 && (
                    <div style={{ marginBottom: '6px' }}>
                      {(['codex', 'pi', 'gemini'] as const).map(rt => {
                        const group = sorted.filter(sa => sa.runtime === rt);
                        if (group.length === 0) return null;
                        return (
                          <div key={rt} style={{ marginBottom: '6px' }}>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              padding: '4px 10px', background: 'rgba(59,122,255,0.04)',
                              borderRadius: '6px', marginBottom: '4px',
                              border: `1px solid ${runtimeColors[rt] || 'var(--border)'}`,
                            }}>
                              <span style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: runtimeColors[rt] || 'var(--text-muted)',
                                boxShadow: `0 0 6px ${runtimeColors[rt] || 'var(--text-muted)'}`,
                              }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, color: runtimeColors[rt] || 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {rt}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                                {group.length} session{group.length !== 1 ? 's' : ''}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace" }}>
                                {formatTokens(group.reduce((s, sa) => s + (sa.tokenUsage || 0), 0))} tokens
                              </span>
                            </div>
                            {group.map((sa) => {
                              const label = statusLabel(sa.status);
                              const fullStatus = sa.status || 'unknown';
                              const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
                              const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
                              const ratePct = tokenRate !== null ? Math.min((tokenRate / MAX_TOKEN_RATE) * 100, 100) : 0;
                              const rateClass = ratePct > 75 ? 'sa-rate-bar-fill--high' : ratePct > 40 ? 'sa-rate-bar-fill--med' : '';
                              const isNew = sa.startedAt && (Date.now() - sa.startedAt) < 60000;
                              const ageWarning = sa.startedAt && elapsedSecs > 1800;
                              const ageCritical = sa.startedAt && elapsedSecs > 3600;
                              const runtimeClass = sa.runtime ? `subagent-row--${sa.runtime}` : '';
                              const rowIdx = sorted.indexOf(sa);
                              const isFocused = rowIdx === focusedRowIdx;
                              return (
                                <div
                                  key={sa.sessionKey || rowIdx}
                                  tabIndex={0}
                                  title="Click to view session details"
                                  onClick={(e) => {
                                    if ((e.target as HTMLElement).closest('button')) return;
                                    setPeekedSessionKey(peekedSessionKey === sa.sessionKey ? null : sa.sessionKey);
                                  }}
                                  className={`subagent-row${runtimeClass ? ' ' + runtimeClass : ''}${ageWarning ? ' subagent-row--age-warning' : ''}${ageCritical ? ' subagent-row--age-critical' : ''}${isFocused ? ' subagent-row--focused' : ''}`}
                                  style={isFocused ? { boxShadow: '0 0 0 2px var(--accent), 0 4px 12px rgba(59,122,255,0.2)' } : {}}
                                >
                                  <span className="sa-key" title={sa.sessionKey || undefined}>
                                    <span className="sa-key-text" title="Click to copy">{sa.sessionKey ? highlightText(sa.sessionKey.slice(0, 8), sessionSearch) : '—'}</span>
                                    {isNew && <span className="new-session-badge">NEW</span>}
                                    <button className="sa-copy-btn" title="Copy full session ID" onClick={e => { e.stopPropagation(); copyToClipboard(sa.sessionKey || ''); }}>⎘</button>
                                    <button className="sa-copy-btn" title="Copy session as JSON" onClick={e => { e.stopPropagation(); copyToClipboard(JSON.stringify(sa, null, 2)); }} style={{ fontSize: '9px', marginLeft: '2px' }}>{}</button>
                                  </span>
                                  <span className="sa-task-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden' }}>
                                    <span className="sa-task" title={`Full task: ${sa.taskName || ''}`} onClick={() => sa.taskName && copyToClipboard(sa.taskName)} onMouseEnter={() => sa.sessionKey && handlePeekEnter(sa.sessionKey)} onMouseLeave={() => sa.sessionKey && handlePeekLeave(sa.sessionKey)} style={{ cursor: sa.taskName ? 'pointer' : 'default', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {sa.taskName ? highlightText(sa.taskName.length > 30 ? sa.taskName.slice(0, 30) + '…' : sa.taskName, sessionSearch) : '—'}
                                    </span>
                                    {sa.taskName && <button className="sa-task-copy-btn" title="Copy task name" onClick={e => { e.stopPropagation(); copyToClipboard(sa.taskName || ''); }}>⎘</button>}
                                    {peekTarget === sa.sessionKey && peekMode && <PeekPanel sessionKey={sa.sessionKey} subAgents={subAgents} />}
                                    {peekedSessionKey === sa.sessionKey && <PeekPanel sessionKey={sa.sessionKey} subAgents={subAgents} />}
                                  </span>
                                  <span className="sa-runtime"><RuntimeBadge runtime={sa.runtime || 'unknown'} /></span>
                                  <ParentAgentChip sessionKey={sa.sessionKey} agents={agents} />
                                  <span className={`sa-status-cell sa-status-cell--${label}`}><span className={`sa-status-dot sa-status-dot--${label}`} title={fullStatus} />{label}</span>
                                  <span className="sa-elapsed-cell">
                                    <RuntimeSourceDot runtime={sa.runtime} />
                                    <LiveSessionTimer startedAt={sa.startedAt} />
                                    <SessionTimeoutIcon startedAt={sa.startedAt} />
                                  </span>
                                  <span className="sa-age-cell">
                                    {sa.startedAt && (() => {
                                      const age = Date.now() - sa.startedAt;
                                      const pct = Math.min((age / SESSION_MAX_AGE_MS) * 100, 100);
                                      const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
                                      return (
                                        <div className="session-duration-mini-bar" title={`Session age: ${Math.round(pct)}% of 60min max`}>
                                          <div className="sdm-bar-fill" style={{ width: `${pct}%`, background: color }} />
                                        </div>
                                      );
                                    })()}
                                  </span>
                                  <span className="sa-tokens">{formatTokens(sa.tokenUsage)}</span>
                                  <span className="sa-rate-cell">
                                    {tokenRate !== null ? (
                                      <>
                                        <span className="sa-rate-value" title={`${tokenRate} tok/m`}>{tokenRate}<span style={{ fontSize: '8px', opacity: 0.7, marginLeft: '1px' }}>t/m</span></span>
                                        <div className="sa-rate-bar-wrap" title={`${tokenRate} tokens/min`}>
                                          <div className={`sa-rate-bar-fill ${rateClass}`} style={{ width: `${ratePct}%` }} />
                                        </div>
                                      </>
                                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                  </span>
                                  <button className="sa-kill-btn" title={`Kill session ${sa.sessionKey || ''}`}
                                    onClick={() => {
                                      if (killConfirmKey === sa.sessionKey) {
                                        sa.sessionKey && killSession(sa.sessionKey, sa.taskName);
                                        setKillConfirmKey(null);
                                      } else {
                                        setKillConfirmKey(sa.sessionKey || null);
                                        setTimeout(() => setKillConfirmKey(null), 3000);
                                      }
                                    }}>
                                    <span style={{ fontSize: '11px' }}>🗑</span>
                                    {killConfirmKey === sa.sessionKey && <span className="sa-kill-btn-confirm">Click again to confirm</span>}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!groupByRuntime && sorted.map((sa, i) => {
                    const label = statusLabel(sa.status);
                    const fullStatus = sa.status || 'unknown';
                    const elapsedSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
                    const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
                    const ratePct = tokenRate !== null ? Math.min((tokenRate / MAX_TOKEN_RATE) * 100, 100) : 0;
                    const rateClass = ratePct > 75 ? 'sa-rate-bar-fill--high' : ratePct > 40 ? 'sa-rate-bar-fill--med' : '';
                    const isNew = sa.startedAt && (Date.now() - sa.startedAt) < 60000;
                    const runtimeClass = sa.runtime ? `subagent-row--${sa.runtime}` : '';
                    const ageWarning = sa.startedAt && elapsedSecs > 1800; // >30 min
                    const ageCritical = sa.startedAt && elapsedSecs > 3600; // >60 min
                    const isFocused = i === focusedRowIdx;
                    return (
                      <div
                        key={sa.sessionKey || i}
                        tabIndex={0}
                        title="Click to view session details"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          setSelectedSessionKey(sa.sessionKey);
                        }}
                        className={`subagent-row${sortField === 'elapsed' ? ' subagent-row--sorted' : ''}${runtimeClass ? ' ' + runtimeClass : ''}${ageWarning ? ' subagent-row--age-warning' : ''}${ageCritical ? ' subagent-row--age-critical' : ''}${isFocused ? ' subagent-row--focused' : ''}`}
                        style={isFocused ? { boxShadow: '0 0 0 2px var(--accent), 0 4px 12px rgba(59,122,255,0.2)' } : {}}
                      >
                        <span className="sa-key" title={sa.sessionKey || undefined}>
                          <span className="sa-key-text" title="Click to copy">{sa.sessionKey ? highlightText(sa.sessionKey.slice(0, 8), sessionSearch) : '—'}</span>
                          {isNew && <span className="new-session-badge">NEW</span>}
                          <button
                            className="sa-copy-btn"
                            title="Copy full session ID"
                            onClick={e => { e.stopPropagation(); copyToClipboard(sa.sessionKey || ''); }}
                          >⎘</button>
                          <button
                            className="sa-copy-btn"
                            title="Copy session as JSON"
                            onClick={e => { e.stopPropagation(); copyToClipboard(JSON.stringify(sa, null, 2)); }}
                            style={{ fontSize: '9px', marginLeft: '2px' }}
                          >{}</button>
                        </span>
                        <span className="sa-task-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden' }}>
                          <span
                            className="sa-task"
                            title={`Full task: ${sa.taskName || ''}`}
                            onClick={() => sa.taskName && copyToClipboard(sa.taskName)}
                            onMouseEnter={() => sa.sessionKey && handlePeekEnter(sa.sessionKey)}
                            onMouseLeave={() => sa.sessionKey && handlePeekLeave(sa.sessionKey)}
                            style={{ cursor: sa.taskName ? 'pointer' : 'default', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {sa.taskName ? highlightText(sa.taskName.length > 30 ? sa.taskName.slice(0, 30) + '…' : sa.taskName, sessionSearch) : '—'}
                          </span>
                          {sa.taskName && (
                            <button
                              className="sa-task-copy-btn"
                              title="Copy task name"
                              onClick={e => { e.stopPropagation(); copyToClipboard(sa.taskName || ''); }}
                            >⎘</button>
                          )}
                          {/* Peek panel — anchored to the task cell */}
                          {peekTarget === sa.sessionKey && peekMode && (
                            <PeekPanel sessionKey={sa.sessionKey} subAgents={subAgents} />
                          )}
                          {peekedSessionKey === sa.sessionKey && (
                            <PeekPanel sessionKey={sa.sessionKey} subAgents={subAgents} />
                          )}
                        </span>
                        <span className="sa-runtime">
                          <RuntimeBadge runtime={sa.runtime || 'unknown'} />
                        </span>
                        <ParentAgentChip sessionKey={sa.sessionKey} agents={agents} />
                        <span className={`sa-status-cell sa-status-cell--${label}`}>
                          <span className={`sa-status-dot sa-status-dot--${label}`} title={fullStatus} />
                          {label}
                        </span>
                        <span className="sa-elapsed-cell">
                          <RuntimeSourceDot runtime={sa.runtime} />
                          <LiveSessionTimer startedAt={sa.startedAt} />
                          <SessionTimeoutIcon startedAt={sa.startedAt} />
                        </span>
                        <span className="sa-age-cell">
                          {sa.startedAt && (() => {
                            const age = Date.now() - sa.startedAt;
                            const pct = Math.min((age / SESSION_MAX_AGE_MS) * 100, 100);
                            const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
                            return (
                              <div className="session-duration-mini-bar" title={`Session age: ${Math.round(pct)}% of 60min max`}>
                                <div className="sdm-bar-fill" style={{ width: `${pct}%`, background: color }} />
                              </div>
                            );
                          })()}
                        </span>
                        <span className="sa-tokens">{formatTokens(sa.tokenUsage)}</span>
                        <span className="sa-rate-cell">
                          {tokenRate !== null ? (
                            <>
                              <span className="sa-rate-value" title={`${tokenRate} tok/m`}>{tokenRate}<span style={{ fontSize: '8px', opacity: 0.7, marginLeft: '1px' }}>t/m</span></span>
                              <div className="sa-rate-bar-wrap" title={`${tokenRate} tokens/min`}>
                                <div className={`sa-rate-bar-fill ${rateClass}`} style={{ width: `${ratePct}%` }} />
                              </div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </span>
                        <button className="sa-kill-btn" title={`Kill session ${sa.sessionKey || ''}`}
                          onClick={() => {
                            if (killConfirmKey === sa.sessionKey) {
                              sa.sessionKey && killSession(sa.sessionKey, sa.taskName);
                              setKillConfirmKey(null);
                            } else {
                              setKillConfirmKey(sa.sessionKey || null);
                              setTimeout(() => setKillConfirmKey(null), 3000);
                            }
                          }}>
                          <span style={{ fontSize: '11px' }}>🗑</span>
                          {killConfirmKey === sa.sessionKey && (
                            <span className="sa-kill-btn-confirm">Click again to confirm</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
        </>
      )}

      {subAgents.length === 0 && (
        <div className="subagents-empty">
          <div className="subagents-empty-icon">🧠</div>
          <div className="subagents-empty-text">No active sub-agent sessions</div>
          <div className="subagents-empty-sub">Sub-agents will appear here when tasks are running</div>
        </div>
      )}

      {/* Quick spawn form */}
      <div className="spawn-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 className="section-label" style={{ margin: 0 }}>Quick Spawn</h4>
          <span className={`spawn-quota-badge${subAgents.length >= 5 ? ' spawn-quota-badge--warn' : ''}`} title="Active sub-agent sessions">
            {subAgents.length}/5 sessions
          </span>
        </div>
        <div className="spawn-form">
          {/* Preset selector */}
          <div className="spawn-preset-row">
            <select
              className="spawn-preset-select"
              value={spawnPreset}
              onChange={e => {
                const preset = SPAWN_PRESETS.find(p => p.value === e.target.value);
                setSpawnPreset(e.target.value);
                if (preset && preset.task) {
                  setSpawnTask(prev => prev ? prev + preset.task : preset.task);
                }
              }}
              disabled={!connected || isSpawning}
            >
              {SPAWN_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {spawnTask.length > 0 && (
              <span className="spawn-est-cost" title="Rough token estimate">
                ~{Math.max(1, Math.round(spawnTask.length * 1.8))} tok est.
              </span>
            )}
          </div>
          {/* Duration presets */}
          <DurationPresetSelector selected={spawnDuration} onChange={setSpawnDuration} />
          <textarea
            className="spawn-textarea"
            placeholder="Describe the task for a new sub-agent..."
            rows={2}
            value={spawnTask}
            onChange={e => { setSpawnTask(e.target.value.slice(0, MAX_SPAWN_CHARS)); setSpawnPreset(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSpawn(); }}
            disabled={!connected || isSpawning}
          />
          <div className={`spawn-char-counter ${spawnTask.length > MAX_SPAWN_CHARS * 0.85 ? (spawnTask.length >= MAX_SPAWN_CHARS ? 'spawn-char-counter--over' : 'spawn-char-counter--near') : ''}`}>
            {spawnTask.length}/{MAX_SPAWN_CHARS}
          </div>
          {spawnTask.trim().length > 0 && (
            <div className="spawn-duration-hint">
              Est. session: ~{Math.max(2, Math.round(spawnTask.length / 60))}–{Math.max(4, Math.round(spawnTask.length / 30))} min
              {subAgents.length >= 5 && (
                <span className="max-sessions-warning"> ⚠ Near session limit ({subAgents.length}/5)</span>
              )}
            </div>
          )}
          {/* Session duration quick-select — click to set token-budget hint */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '0.3px' }}>Est. duration:</span>
            {([
              { label: '⚡ Quick', minutes: 5, color: 'var(--green)' },
              { label: '📋 Short', minutes: 15, color: 'var(--cyan)' },
              { label: '🔧 Standard', minutes: 30, color: 'var(--yellow)' },
              { label: '🚀 Complex', minutes: 60, color: 'var(--accent)' },
            ] as const).map(({ label, minutes, color }) => {
              const estLen = Math.round(spawnTask.length / 30);
              const isSuggested = estLen >= minutes * 0.7 && estLen <= minutes * 1.5;
              const isSelected = selectedDuration === minutes;
              const disabled = spawnTask.trim().length === 0;
              return (
                <button
                  key={minutes}
                  title={`Set estimated duration to ~${minutes} min — helps token budget allocation`}
                  onClick={() => setSelectedDuration(isSelected ? null : minutes)}
                  style={{
                    background: isSelected ? `${color}22` : 'var(--bg-input)',
                    border: `1px solid ${isSelected ? color : isSuggested ? color : 'var(--border)'}`,
                    borderRadius: '20px',
                    color: isSelected || isSuggested ? color : 'var(--text-muted)',
                    fontSize: '10px',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: isSelected || isSuggested ? 600 : 400,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    padding: '2px 8px',
                    transition: 'all 0.15s',
                    opacity: disabled ? 0.5 : 1,
                    boxShadow: isSelected ? `0 0 6px ${color}44` : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
            {selectedDuration && (
              <span style={{ fontSize: '10px', color: 'var(--cyan)', fontFamily: "'JetBrains Mono', monospace", background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: '10px', padding: '1px 6px' }}>
                ~{selectedDuration}min
              </span>
            )}
          </div>
          <div className="spawn-form-row">
            <select className="spawn-runtime-select" value={spawnRuntime}
              onChange={e => setSpawnRuntime(e.target.value)} disabled={!connected || isSpawning}>
              <option value="codex">Codex</option>
              <option value="pi">Pi</option>
              <option value="gemini">Gemini</option>
            </select>
            <button className="spawn-btn" disabled={!connected || isSpawning || !spawnTask.trim()}
              onClick={handleSpawn}>{isSpawning ? 'Spawning…' : 'Spawn Session'}</button>
          </div>
          {spawnError && <div className="spawn-feedback spawn-feedback--error">{spawnError}</div>}
          {!connected && <div className="spawn-offline-msg">Gateway offline — cannot spawn</div>}
          <div className="spawn-kbd-hint">⌘↵ to spawn</div>
        </div>

        {/* Spawn history: quick re-spawn */}
        {spawnHistory.length > 0 && (
          <div className="spawn-history">
            <div className="spawn-history-label">
              <span className="section-label" style={{ margin: 0 }}>Recent Spawns</span>
              <button
                className="spawn-history-clear"
                onClick={() => setSpawnHistory([])}
                title="Clear history"
              >
                ✕
              </button>
            </div>
            <div className="spawn-history-list">
              {spawnHistory.map((entry, i) => (
                <div key={i} className="spawn-history-item">
                  <button
                    className="spawn-history-fill-btn"
                    title={`Fill: ${entry.task}`}
                    onClick={() => {
                      setSpawnTask(entry.task);
                      setSpawnRuntime(entry.runtime);
                    }}
                  >
                    ✎
                  </button>
                  <RuntimeBadge runtime={entry.runtime} />
                  <span className="spawn-history-task">{entry.task.length > 40 ? entry.task.slice(0, 40) + '…' : entry.task}</span>
                  <button
                    className="spawn-history-spawn-btn"
                    title={`Re-spawn: ${entry.task}`}
                    disabled={!connected || isSpawning}
                    onClick={async () => {
                      try {
                        const res = await fetch('/__gateway/sessions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ task: entry.task, runtime: entry.runtime }),
                          signal: AbortSignal.timeout(8000),
                        });
                        if (res.ok) {
                          success('Session spawned', `${entry.runtime}: "${entry.task.slice(0, 40)}${entry.task.length > 40 ? '…' : ''}"`);
                          fetchStatus();
                        } else {
                          toastError('Spawn failed', `Error ${res.status}`);
                        }
                      } catch {
                        toastError('Spawn failed', 'Network error');
                      }
                    }}
                  >
                    ▶
                  </button>
                  <span className="spawn-history-age">{formatRelative(entry.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Keyboard shortcuts hint */}
      <div className="kbd-shortcut-hint">
        <span><kbd>↑↓</kbd> Navigate sessions</span>
        <span><kbd>Enter</kbd> View/Kill</span>
        <span><kbd>Esc</kbd> Clear</span>
        <span><kbd>Space</kbd> Pause polling</span>
        <span><kbd>R</kbd> Refresh</span>
      </div>
      {selectedSessionKey && (
        <SessionDetailModal
          sessionKey={selectedSessionKey}
          subAgents={subAgents}
          onClose={() => setSelectedSessionKey(null)}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}
