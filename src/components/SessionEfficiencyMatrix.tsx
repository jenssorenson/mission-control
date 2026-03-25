import { useState, useEffect, useCallback, useMemo } from 'react';
import type { SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Pricing ───────────────────────────────────────────────────────────────────
const MODEL_PRICING: Record<string, [number, number]> = {
  dev:    [0.50, 1.50],
  pi:     [0.35, 1.05],
  gemini: [0.35, 1.05],
  default:[0.50, 1.50],
};

function estimateCost(tokenUsage: number, runtime: string): number {
  const [inp, out] = MODEL_PRICING[runtime] ?? MODEL_PRICING.default;
  const outputToks = Math.round(tokenUsage * 0.30);
  const inputToks = tokenUsage - outputToks;
  return (inputToks / 1_000_000) * inp + (outputToks / 1_000_000) * out;
}

function fmtCost(d: number): string {
  if (d < 0.001) return `${(d * 1000).toFixed(1)}¢`;
  if (d < 0.01)  return `$${d.toFixed(3)}`;
  if (d < 1)     return `$${d.toFixed(2)}`;
  return `$${d.toFixed(2)}`;
}

function fmtTok(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000)     return `${(t / 1_000).toFixed(0)}k`;
  return String(t);
}

function fmtDuration(secs: number): string {
  if (!secs || secs < 0) return '—';
  if (secs < 60)   return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  return `${(secs / 3600).toFixed(1)}h`;
}

// ─── Efficiency tiers ─────────────────────────────────────────────────────────
type EfficiencyTier = 'blazing' | 'healthy' | 'elevated' | 'wasteful';

function burnRateTier(rate: number | null): EfficiencyTier {
  if (rate === null) return 'healthy';
  if (rate < 500)  return 'blazing';
  if (rate < 1000) return 'healthy';
  if (rate < 2000) return 'elevated';
  return 'wasteful';
}

const TIER_CONFIG: Record<EfficiencyTier, { icon: string; label: string; color: string; bg: string; border: string }> = {
  blazing:  { icon: '⚡', label: 'Blazing',  color: 'var(--green)',  bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.35)' },
  healthy:  { icon: '✓',  label: 'Healthy',  color: 'var(--yellow)', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)' },
  elevated: { icon: '📈', label: 'Elevated', color: 'var(--orange)', bg: 'rgba(251,146,60,0.10)',  border: 'rgba(251,146,60,0.30)' },
  wasteful: { icon: '🔥', label: 'Wasteful', color: 'var(--red)',    bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
};

const RUNTIME_COLORS: Record<string, string> = {
  dev:    'var(--dev)',
  pi:     'var(--pi)',
  gemini:  'var(--gemini)',
};

// ─── Sort state ────────────────────────────────────────────────────────────────
type SortKey = 'rate' | 'cost' | 'duration' | 'tokens' | 'projected';
type SortDir = 'asc' | 'desc';

interface RowData {
  sa: SubAgent;
  rate: number | null;       // tok/min
  cost: number;              // current estimated cost
  duration: number;          // secs elapsed
  projectedCost: number | null; // cost at current rate for full 60min
  tier: EfficiencyTier;
}

// ─── Burn rate bar ─────────────────────────────────────────────────────────────
function BurnRateBar({ rate, maxRate }: { rate: number | null; maxRate: number }) {
  const pct = rate !== null && maxRate > 0 ? Math.min((rate / maxRate) * 100, 100) : 0;
  const color = rate === null ? 'var(--border)'
    : rate < 500 ? 'var(--green)'
    : rate < 1000 ? 'var(--yellow)'
    : rate < 2000 ? 'var(--orange)'
    : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
      <div style={{ flex: 1, height: '5px', background: 'var(--bg-deep)', borderRadius: '3px', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.5s ease', boxShadow: `0 0 4px ${color}88` }} />
      </div>
      <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color, minWidth: '48px', textAlign: 'right' }}>
        {rate !== null ? `${Math.round(rate)}/m` : '—'}
      </span>
    </div>
  );
}

// ─── Sort header ───────────────────────────────────────────────────────────────
function SortHeader({ label, sortKey, current, dir, onClick }: { label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void }) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onClick(sortKey)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        padding: '2px 4px', borderRadius: '4px',
        display: 'flex', alignItems: 'center', gap: '3px',
        transition: 'color 0.15s',
      }}
    >
      {label}
      {active && (dir === 'desc' ? ' ↓' : ' ↑')}
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface Props {
  subAgents: SubAgent[];
  /** Called when user wants to go to a specific session in the monitor */
  onSelectSession?: (sessionKey: string) => void;
}

export default function SessionEfficiencyMatrix({ subAgents, onSelectSession }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [sortKey, setSortKey] = useState<SortKey>('rate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Tick every 3 seconds for live updates
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  // Build row data
  const rows: RowData[] = useMemo(() => {
    return subAgents
      .filter(sa => sa.startedAt && (sa.tokenUsage ?? 0) > 0)
      .map(sa => {
        const elapsedSecs = sa.startedAt ? (now - sa.startedAt) / 1000 : 0;
        const rate = elapsedSecs > 15 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
        const cost = estimateCost(sa.tokenUsage ?? 0, sa.runtime);
        const projectedCost = rate !== null ? estimateCost(rate * 60, sa.runtime) : null;
        return { sa, rate, cost, duration: elapsedSecs, projectedCost, tier: burnRateTier(rate) };
      });
  }, [subAgents, now]);

  // Sort
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'rate':      cmp = (a.rate ?? 0) - (b.rate ?? 0); break;
        case 'cost':      cmp = a.cost - b.cost; break;
        case 'duration':  cmp = a.duration - b.duration; break;
        case 'tokens':    cmp = (a.sa.tokenUsage ?? 0) - (b.sa.tokenUsage ?? 0); break;
        case 'projected': cmp = (a.projectedCost ?? 0) - (b.projectedCost ?? 0); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [rows, sortKey, sortDir]);

  const handleSort = useCallback((k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(k); setSortDir('desc'); }
  }, [sortKey]);

  const maxRate = useMemo(() => Math.max(...rows.map(r => r.rate ?? 0), 1), [rows]);

  // Fleet-wide stats
  const fleetStats = useMemo(() => {
    const active = rows.length;
    const avgRate = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.rate ?? 0), 0) / rows.filter(r => r.rate !== null).length) || 0 : 0;
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const maxProjected = rows.reduce((s, r) => s + (r.projectedCost ?? 0), 0);
    const wasteful = rows.filter(r => r.tier === 'wasteful').length;
    const elevated = rows.filter(r => r.tier === 'elevated').length;
    return { active, avgRate, totalCost, maxProjected, wasteful, elevated };
  }, [rows]);

  if (subAgents.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
          📊 Session Efficiency Matrix
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: "'Space Grotesk', sans-serif" }}>
          No active sessions — spawn sessions to see efficiency rankings
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary name="SessionEfficiencyMatrix">
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '14px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>📊</span>
            <h3 style={{ margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>
              Session Efficiency Matrix
            </h3>
            {/* Live pulse */}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--green)', fontWeight: 700 }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', animation: 'pulse-live 1.5s ease-in-out infinite', flexShrink: 0 }} />
              LIVE
            </span>
          </div>

          {/* Fleet summary chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--cyan)', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: '8px', padding: '2px 8px' }}>
              {fleetStats.active} active
            </span>
            <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--yellow)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px', padding: '2px 8px' }}>
              {fmtCost(fleetStats.totalCost)} cost
            </span>
            {fleetStats.avgRate > 0 && (
              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', background: 'rgba(59,122,255,0.08)', border: '1px solid rgba(59,122,255,0.2)', borderRadius: '8px', padding: '2px 8px' }}>
                ~{fleetStats.avgRate} tok/min avg
              </span>
            )}
            {fleetStats.maxProjected > 0 && (
              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '2px 8px' }}
                title="Projected total if all sessions run for 60 minutes">
                →{fmtCost(fleetStats.maxProjected)} max
              </span>
            )}
            {fleetStats.wasteful > 0 && (
              <span style={{ fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--red)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', padding: '2px 8px', fontWeight: 700 }}>
                🔥 {fleetStats.wasteful} wasteful
              </span>
            )}
            {fleetStats.elevated > 0 && (
              <span style={{ fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--orange)', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: '8px', padding: '2px 8px', fontWeight: 700 }}>
                📈 {fleetStats.elevated} elevated
              </span>
            )}
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 80px 1fr 80px 90px 90px',
          gap: '8px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', gridColumn: '1' }}>Session</span>
          <span style={{ fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', gridColumn: '2' }}>Runtime</span>
          <SortHeader label="Burn Rate" sortKey="rate" current={sortKey} dir={sortDir} onClick={handleSort} />
          <SortHeader label="Cost" sortKey="cost" current={sortKey} dir={sortDir} onClick={handleSort} />
          <SortHeader label="Duration" sortKey="duration" current={sortKey} dir={sortDir} onClick={handleSort} />
          <SortHeader label="Projected" sortKey="projected" current={sortKey} dir={sortDir} onClick={handleSort} />
        </div>

        {/* Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {sorted.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: "'Space Grotesk', sans-serif", padding: '12px' }}>
              Warming up — sessions with measurable token usage appear here
            </div>
          )}
          {sorted.map(({ sa, rate, cost, duration, projectedCost, tier }) => {
            const tc = TIER_CONFIG[tier];
            const rtColor = RUNTIME_COLORS[sa.runtime] || 'var(--text-muted)';
            const rtLabel = sa.runtime === 'pi' ? 'Pi' : sa.runtime.charAt(0).toUpperCase() + sa.runtime.slice(1);
            const isHovered = hoveredKey === sa.sessionKey;

            return (
              <div
                key={sa.sessionKey}
                onMouseEnter={() => setHoveredKey(sa.sessionKey)}
                onMouseLeave={() => setHoveredKey(null)}
                onClick={() => onSelectSession?.(sa.sessionKey)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 80px 1fr 80px 90px 90px',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: `1px solid ${isHovered ? 'rgba(59,122,255,0.3)' : 'transparent'}`,
                  background: isHovered ? 'rgba(59,122,255,0.05)' : tier === 'wasteful' ? 'rgba(248,113,113,0.05)' : tier === 'elevated' ? 'rgba(251,146,60,0.04)' : 'transparent',
                  cursor: onSelectSession ? 'pointer' : 'default',
                  transition: 'background 0.15s, border-color 0.15s',
                  alignItems: 'center',
                }}
              >
                {/* Session key + task */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sa.sessionKey}>
                    {sa.sessionKey.slice(0, 14)}
                  </span>
                  {sa.taskName && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sa.taskName}>
                      {sa.taskName.slice(0, 22)}
                    </span>
                  )}
                </div>

                {/* Runtime badge */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: rtColor, background: `${rtColor}14`, border: `1px solid ${rtColor}44`, borderRadius: '6px', padding: '1px 5px', textAlign: 'center', width: 'fit-content' }}>
                    {rtLabel}
                  </span>
                  {/* Efficiency tier badge */}
                  <span style={{ fontSize: '8px', fontWeight: 700, color: tc.color, background: tc.bg, border: `1px solid ${tc.border}`, borderRadius: '5px', padding: '1px 5px', textAlign: 'center', width: 'fit-content', letterSpacing: '0.2px' }}>
                    {tc.icon} {tc.label}
                  </span>
                </div>

                {/* Burn rate bar */}
                <BurnRateBar rate={rate} maxRate={maxRate} />

                {/* Current cost */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                  <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: cost > 0.5 ? 'var(--red)' : cost > 0.1 ? 'var(--yellow)' : 'var(--green)', fontWeight: 700 }}>
                    {fmtCost(cost)}
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                    {fmtTok(sa.tokenUsage ?? 0)} tok
                  </span>
                </div>

                {/* Duration */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                  <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: duration > 2400 ? 'var(--red)' : duration > 1200 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                    {fmtDuration(duration)}
                  </span>
                  <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                    elapsed
                  </span>
                </div>

                {/* Projected cost */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                  {projectedCost !== null ? (
                    <>
                      <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: projectedCost > 1 ? 'var(--orange)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        {fmtCost(projectedCost)}
                      </span>
                      <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                        at 60min
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hint */}
        {onSelectSession && (
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", textAlign: 'center', marginTop: '2px' }}>
            Click any row to jump to that session in the Monitor
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
