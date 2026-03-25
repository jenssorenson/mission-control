import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  task: string;
  runtime: 'dev' | 'pi' | 'gemini';
  schedule: string; // cron expression
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failed' | 'running';
  lastRunDurationMs?: number;
  runHistory: CronRunEntry[];
}

export interface CronRunEntry {
  id: string;
  startedAt: number;
  durationMs?: number;
  status: 'success' | 'failed' | 'running';
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every 5 min', expr: '*/5 * * * *' },
  { label: 'Every 15 min', expr: '*/15 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily at 9am', expr: '0 9 * * *' },
  { label: 'Weekly', expr: '0 9 * * 1' },
];

function humanizeCron(expr: string): string {
  const map: Record<string, string> = {
    '*/5 * * * *': 'Every 5 min',
    '*/10 * * * *': 'Every 10 min',
    '*/15 * * * *': 'Every 15 min',
    '*/30 * * * *': 'Every 30 min',
    '0 * * * *': 'Hourly',
    '0 */2 * * *': 'Every 2 hours',
    '0 9 * * *': 'Daily at 9am',
    '0 9 * * 1': 'Weekly (Mon 9am)',
    '0 0 * * *': 'Daily at midnight',
    '0 12 * * *': 'Daily at noon',
    '30 * * * *': 'Every hour at :30',
  };
  return map[expr] ?? expr;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  if (diff < 60000) return `in ${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`;
  return `in ${Math.floor(diff / 86400000)}d`;
}

function nextRunFromCron(expr: string): number | null {
  // Very naive: for preset expressions compute the next occurrence
  try {
    const now = new Date();
    const parts = expr.split(' ');
    if (parts.length !== 5) return null;

    const [min, hour, dom, mon, dow] = parts;

    if (min.startsWith('*/')) {
      const interval = parseInt(min.slice(2));
      const nextMin = Math.ceil(now.getMinutes() / interval) * interval;
      const next = new Date(now);
      next.setMinutes(nextMin, 0, 0);
      if (next.getMinutes() === now.getMinutes() && now.getSeconds() > 0) {
        next.setMinutes(next.getMinutes() + interval);
      }
      return next.getTime();
    }

    if (min === '0' && hour === '*') {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next.getTime();
    }

    if (min === '0' && hour === '9' && dom === '*' && mon === '*' && dow === '*') {
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      return next.getTime();
    }

    // Default: add 1 hour for unknown expressions
    return now.getTime() + 3600000;
  } catch {
    return null;
  }
}

function upcomingRuns(expr: string, count: number): number[] {
  const runs: number[] = [];
  let next = nextRunFromCron(expr);
  for (let i = 0; i < count; i++) {
    if (next === null) break;
    runs.push(next);
    // Approximate next occurrence
    if (expr.includes('*/5')) next += 5 * 60000;
    else if (expr.includes('*/15')) next += 15 * 60000;
    else if (expr.includes('*/30')) next += 30 * 60000;
    else if (expr === '0 * * * *') next += 3600000;
    else next += 3600000;
  }
  return runs;
}

function formatDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function runtimeColor(rt: string): string {
  return rt === 'dev' ? 'var(--dev)' : rt === 'pi' ? 'var(--pi)' : 'var(--gemini)';
}

function runtimeLabel(rt: string): string {
  return rt === 'dev' ? 'Dev' : rt === 'pi' ? 'Pi' : 'Gemini';
}

// ─── Schedule Timeline ─────────────────────────────────────────────────────────

function ScheduleTimeline({ expr }: { expr: string }) {
  const now = Date.now();
  const end = now + 24 * 3600000;
  const runs = upcomingRuns(expr, 24).filter(t => t <= end && t > now);
  if (runs.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      marginTop: '8px', padding: '6px 10px',
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '8px', overflow: 'hidden',
    }}>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>now</span>
      <div style={{ flex: 1, position: 'relative', height: '20px' }}>
        {/* Track */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '2px', background: 'var(--border)', transform: 'translateY(-50%)', borderRadius: '1px' }} />
        {/* Dots */}
        {runs.map((t, i) => {
          const pct = ((t - now) / (end - now)) * 100;
          const label = new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          return (
            <div
              key={i}
              title={`Next run: ${label}`}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 5px var(--accent)',
                cursor: 'default',
                zIndex: 1,
              }}
            />
          );
        })}
      </div>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>+24h</span>
    </div>
  );
}

// ─── Run History ───────────────────────────────────────────────────────────────

function RunHistory({ history }: { history: CronRunEntry[] }) {
  const items = [...history].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600 }}>
        Run History
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {items.map(entry => (
          <div key={entry.id} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '4px 8px', background: 'var(--bg-input)', borderRadius: '5px',
            fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{
              color: entry.status === 'success' ? 'var(--green)' : entry.status === 'failed' ? 'var(--red)' : 'var(--yellow)',
              fontWeight: 700,
            }}>
              {entry.status === 'success' ? '✓' : entry.status === 'failed' ? '✕' : '◐'}
            </span>
            <span style={{ color: 'var(--text-muted)', flex: 1 }}>{timeAgo(entry.startedAt)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatDuration(entry.durationMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, onToggle, onDelete, onTrigger }: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const nextRun = job.enabled ? nextRunFromCron(job.schedule) : null;

  return (
    <div style={{
      background: 'var(--bg-input)', border: `1px solid ${job.enabled ? 'var(--border)' : 'rgba(255,255,255,0.05)'}`,
      borderRadius: '10px', padding: '14px 16px',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      opacity: job.enabled ? 1 : 0.65,
      boxShadow: job.enabled ? 'none' : 'none',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{job.name}</span>
            {/* Runtime badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '20px',
              background: `${runtimeColor(job.runtime)}14`, border: `1px solid ${runtimeColor(job.runtime)}44`,
              color: runtimeColor(job.runtime), textTransform: 'uppercase', letterSpacing: '0.4px',
            }}>
              {runtimeLabel(job.runtime)}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px' }}>
            {humanizeCron(job.schedule)} · <span style={{ color: 'var(--text-secondary)' }}>{job.schedule}</span>
          </div>
          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Last run */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Last:</span>
              {job.lastRunAt ? (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>{timeAgo(job.lastRunAt)}</span>
                  <span style={{
                    color: job.lastRunStatus === 'success' ? 'var(--green)' : job.lastRunStatus === 'failed' ? 'var(--red)' : 'var(--yellow)',
                    fontWeight: 700,
                  }}>
                    {job.lastRunStatus === 'success' ? '✓' : job.lastRunStatus === 'failed' ? '✕' : '◐'}
                  </span>
                  {job.lastRunDurationMs && (
                    <span style={{ color: 'var(--text-muted)' }}>({formatDuration(job.lastRunDurationMs)})</span>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>— never</span>
              )}
            </div>
            {/* Next run */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Next:</span>
              {nextRun ? (
                <span style={{ color: nextRun - Date.now() < 300000 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                  {timeUntil(nextRun)}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </div>
          </div>
          {/* Timeline */}
          {expanded && <ScheduleTimeline expr={job.schedule} />}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Toggle */}
          <button
            onClick={() => onToggle(job.id, !job.enabled)}
            title={job.enabled ? 'Disable' : 'Enable'}
            style={{
              width: '28px', height: '28px', borderRadius: '6px',
              border: `1px solid ${job.enabled ? 'var(--green)' : 'var(--border)'}`,
              background: job.enabled ? 'rgba(52,211,153,0.1)' : 'transparent',
              color: job.enabled ? 'var(--green)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {job.enabled ? '⏸' : '▶'}
          </button>

          {/* Run Now */}
          <button
            onClick={() => onTrigger(job.id)}
            title="Run now"
            disabled={job.lastRunStatus === 'running'}
            style={{
              width: '28px', height: '28px', borderRadius: '6px',
              border: '1px solid var(--accent)',
              background: 'rgba(59,122,255,0.1)', color: 'var(--accent)',
              cursor: job.lastRunStatus === 'running' ? 'not-allowed' : 'pointer',
              fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: job.lastRunStatus === 'running' ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            ⚡
          </button>

          {/* Expand */}
          <button
            onClick={() => setExpanded(v => !v)}
            title="Expand"
            style={{
              width: '28px', height: '28px', borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {expanded ? '▲' : '▼'}
          </button>

          {/* Delete */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              style={{
                width: '28px', height: '28px', borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              🗑
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => { onDelete(job.id); setConfirmDelete(false); }}
                style={{
                  padding: '4px 10px', borderRadius: '6px',
                  border: '1px solid var(--red)',
                  background: 'rgba(248,113,113,0.15)', color: 'var(--red)',
                  cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  padding: '4px 8px', borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '10px',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Run history */}
      {expanded && <RunHistory history={job.runHistory} />}
    </div>
  );
}

// ─── New Job Form ──────────────────────────────────────────────────────────────

function NewJobForm({ onCreate, onCancel }: {
  onCreate: (job: Omit<CronJob, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunDurationMs' | 'runHistory'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [runtime, setRuntime] = useState<'dev' | 'pi' | 'gemini'>('dev');
  const [schedule, setSchedule] = useState('*/15 * * * *');
  const [customCron, setCustomCron] = useState('');

  const activeSchedule = customCron.trim() || schedule;

  const handleSubmit = () => {
    if (!name.trim() || !task.trim()) return;
    onCreate({
      name: name.trim(),
      task: task.trim(),
      runtime,
      schedule: activeSchedule,
      enabled: true,
    });
  };

  return (
    <div style={{
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '16px',
      marginBottom: '16px',
      animation: 'fadeSlideIn 0.2s ease',
    }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
        New Cron Job
      </div>

      {/* Name */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Job Name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Morning Health Check"
          style={{
            width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '8px 12px', color: 'var(--text-primary)',
            fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* Task */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Task Prompt
        </label>
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="What should this job do?"
          rows={3}
          style={{
            width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '8px 12px', color: 'var(--text-primary)',
            fontFamily: "'Space Grotesk', sans-serif", fontSize: '13px', outline: 'none',
            resize: 'vertical', boxSizing: 'border-box',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* Runtime */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Runtime
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['dev', 'pi', 'gemini'] as const).map(rt => (
            <button
              key={rt}
              onClick={() => setRuntime(rt)}
              style={{
                flex: 1, padding: '7px', borderRadius: '8px', border: `1px solid ${runtime === rt ? runtimeColor(rt) : 'var(--border)'}`,
                background: runtime === rt ? `${runtimeColor(rt)}14` : 'transparent',
                color: runtime === rt ? runtimeColor(rt) : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif",
                transition: 'all 0.15s',
              }}
            >
              {runtimeLabel(rt)}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule presets */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Schedule
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {CRON_PRESETS.map(preset => (
            <button
              key={preset.expr}
              onClick={() => { setSchedule(preset.expr); setCustomCron(''); }}
              style={{
                padding: '5px 10px', borderRadius: '20px', border: `1px solid ${schedule === preset.expr && !customCron ? 'var(--accent)' : 'var(--border)'}`,
                background: schedule === preset.expr && !customCron ? 'rgba(59,122,255,0.15)' : 'transparent',
                color: schedule === preset.expr && !customCron ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif",
                transition: 'all 0.15s',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {/* Custom cron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Custom:</span>
          <input
            type="text"
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="*/15 * * * *"
            style={{
              flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '6px 10px', color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', outline: 'none',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          {customCron && (
            <span style={{ fontSize: '10px', color: 'var(--accent)', fontFamily: "'Space Grotesk', sans-serif" }}>
              {humanizeCron(customCron)}
            </span>
          )}
        </div>
      </div>

      {/* Preview timeline */}
      <ScheduleTimeline expr={activeSchedule} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            fontFamily: "'Space Grotesk', sans-serif",
            transition: 'all 0.15s',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !task.trim()}
          style={{
            padding: '8px 16px', borderRadius: '8px', border: 'none',
            background: name.trim() && task.trim() ? 'var(--accent)' : 'var(--accent-dim)',
            color: '#fff', cursor: name.trim() && task.trim() ? 'pointer' : 'not-allowed',
            fontSize: '12px', fontWeight: 700,
            fontFamily: "'Space Grotesk', sans-serif",
            transition: 'all 0.15s',
            opacity: name.trim() && task.trim() ? 1 : 0.5,
          }}
        >
          Create Job
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CronJobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/__gateway/cron/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Expose failedCronCount for AlertsBanner
  useEffect(() => {
    const failedCount = jobs.filter(j => j.lastRunStatus === 'failed').length;
    (window as any).__mc_failedCronCount = failedCount;
    return () => { delete (window as any).__mc_failedCronCount; };
  }, [jobs]);

  const handleCreate = async (job: Omit<CronJob, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunDurationMs' | 'runHistory'>) => {
    try {
      const res = await fetch('/__gateway/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      if (res.ok) {
        setShowForm(false);
        loadJobs();
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/__gateway/cron/jobs/${id}`, { method: 'DELETE' });
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch {
      // ignore
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/__gateway/cron/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updated } : j));
      }
    } catch {
      // ignore
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      const res = await fetch(`/__gateway/cron/jobs/${id}/trigger`, { method: 'POST' });
      if (res.ok) {
        // Update status to running
        setJobs(prev => prev.map(j => j.id === id ? { ...j, lastRunStatus: 'running' as const } : j));
        loadJobs();
      }
    } catch {
      // ignore
    }
  };

  const enabledCount = jobs.filter(j => j.enabled).length;

  return (
    <div className="cron-panel" style={{ padding: '0 20px 20px' }}>
      {/* Panel header */}
      <div className="panel-header" style={{ marginBottom: '16px' }}>
        <div className="panel-header-left">
          <h3 style={{ fontSize: '15px', fontWeight: 600 }}>⏰ Cron Jobs</h3>
          <span style={{
            fontSize: '11px', fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--text-muted)', background: 'var(--bg-input)',
            border: '1px solid var(--border)', borderRadius: '10px', padding: '1px 8px',
          }}>
            {jobs.length} total · {enabledCount} active
          </span>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '7px 14px', borderRadius: '8px', border: 'none',
              background: 'var(--accent)', color: '#fff',
              cursor: 'pointer', fontSize: '12px', fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            + New Job
          </button>
        )}
      </div>

      {/* New job form */}
      {showForm && (
        <NewJobForm
          onCreate={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Job list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Loading...
        </div>
      ) : jobs.length === 0 && !showForm ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          background: 'var(--bg-input)', border: '1px dashed var(--border)',
          borderRadius: '12px', color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏰</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            No cron jobs yet
          </div>
          <div style={{ fontSize: '12px', marginBottom: '16px' }}>
            Create a job to automate recurring tasks.
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '9px 18px', borderRadius: '8px', border: 'none',
              background: 'var(--accent)', color: '#fff',
              cursor: 'pointer', fontSize: '13px', fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            + Create First Job
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
}
