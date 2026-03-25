import { useState, useEffect, useRef } from 'react';
import type { SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Budget constants ──────────────────────────────────────────────────────────
const MAX_BUDGET_BY_RUNTIME: Record<string, number> = {
  dev: 128_000,
  pi: 32_000,
  gemini: 32_000,
};

const SOFT_LIMIT = 0.80; // 80% → warning
const HARD_LIMIT = 0.95; // 95% → critical

const FLEET_HISTORY_KEY = 'mc_fleet_budget_history';
const HISTORY_DAYS = 7;

interface FleetHistory {
  dailyTotals: number[];
  dates: string[];
}

function loadFleetHistory(): FleetHistory {
  try {
    const raw = localStorage.getItem(FLEET_HISTORY_KEY);
    if (!raw) return { dailyTotals: [], dates: [] };
    const parsed: FleetHistory = JSON.parse(raw);
    // Prune entries older than HISTORY_DAYS
    const cutoff = Date.now() - HISTORY_DAYS * 86400 * 1000;
    const validIndices = parsed.dates
      .map((d, i) => (new Date(d).getTime() > cutoff ? i : -1))
      .filter(i => i >= 0);
    return {
      dailyTotals: validIndices.map(i => parsed.dailyTotals[i]),
      dates: validIndices.map(i => parsed.dates[i]),
    };
  } catch {
    return { dailyTotals: [], dates: [] };
  }
}

function saveFleetHistory(history: FleetHistory) {
  try {
    localStorage.setItem(FLEET_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Per-session budget calculation ────────────────────────────────────────────
interface SessionBudget {
  sessionKey: string;
  taskName?: string;
  runtime: string;
  tokenUsage: number;
  maxBudget: number;
  elapsedSecs: number;
  burnRateTokPerMin: number | null; // null if elapsedSecs < 30
  budgetPct: number; // 0–100+
  minutesUntilBudget: number | null; // null if can't project
  projectedTotalAt60Min: number | null;
  status: 'warming' | 'healthy' | 'warning' | 'critical' | 'exhausted';
}

function calcSessionBudget(sa: SubAgent, now: number): SessionBudget {
  const maxBudget = MAX_BUDGET_BY_RUNTIME[sa.runtime || 'dev'] ?? 128_000;
  const tokenUsage = sa.tokenUsage ?? 0;
  const elapsedSecs = sa.startedAt ? Math.floor((now - sa.startedAt) / 1000) : 0;
  const elapsedMin = elapsedSecs / 60;

  let burnRateTokPerMin: number | null = null;
  let projectedTotalAt60Min: number | null = null;
  let minutesUntilBudget: number | null = null;

  if (elapsedSecs > 30 && tokenUsage > 0) {
    burnRateTokPerMin = (tokenUsage / elapsedSecs) * 60;
    projectedTotalAt60Min = burnRateTokPerMin * 60;
    if (burnRateTokPerMin > 0) {
      minutesUntilBudget = (maxBudget - tokenUsage) / burnRateTokPerMin;
    }
  }

  const budgetPct = maxBudget > 0 ? (tokenUsage / maxBudget) * 100 : 0;

  let status: SessionBudget['status'] = 'warming';
  if (elapsedSecs < 30) {
    status = 'warming';
  } else if (budgetPct >= 95) {
    status = 'exhausted';
  } else if (budgetPct >= 80) {
    status = 'critical';
  } else if (budgetPct >= 50) {
    status = 'warning';
  } else {
    status = 'healthy';
  }

  return {
    sessionKey: sa.sessionKey,
    taskName: sa.taskName,
    runtime: sa.runtime,
    tokenUsage,
    maxBudget,
    elapsedSecs,
    burnRateTokPerMin,
    budgetPct,
    minutesUntilBudget,
    projectedTotalAt60Min,
    status,
  };
}

// ─── Fleet overview ────────────────────────────────────────────────────────────
interface FleetOverview {
  avgBurnRate: number | null;
  totalTokens: number;
  sessionCount: number;
  warningCount: number;
  criticalCount: number;
  healthState: 'healthy' | 'elevated' | 'critical';
}

function calcFleetOverview(budgets: SessionBudget[]): FleetOverview {
  const activeBudgets = budgets.filter(b => b.status !== 'warming');
  const totalTokens = budgets.reduce((s, b) => s + b.tokenUsage, 0);
  const warningCount = budgets.filter(b => b.status === 'warning').length;
  const criticalCount = budgets.filter(b => b.status === 'critical' || b.status === 'exhausted').length;

  const rates = activeBudgets.map(b => b.burnRateTokPerMin).filter((r): r is number => r !== null);
  const avgBurnRate = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;

  let healthState: FleetOverview['healthState'] = 'healthy';
  if (criticalCount > 0 || budgets.some(b => b.budgetPct >= 95)) {
    healthState = 'critical';
  } else if (warningCount > 0 || budgets.some(b => b.budgetPct >= 80)) {
    healthState = 'elevated';
  }

  return { avgBurnRate, totalTokens, sessionCount: budgets.length, warningCount, criticalCount, healthState };
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
          No history yet — data accumulates over 7 days
        </span>
      </div>
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const W = 120;
  const H = 32;
  const stepX = W / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  });
  const polyline = points.join(' ');
  const fillPoints = [`0,${H}`, ...points, `${W},${H}`].join(' ');

  return (
    <div style={{ position: 'relative' }}>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#spark-fill)" />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
        />
        {/* Current value dot */}
        {data.length > 0 && (() => {
          const lastX = (data.length - 1) * stepX;
          const lastY = H - ((data[data.length - 1] - min) / range) * H;
          return (
            <circle cx={lastX} cy={lastY} r="2.5" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          );
        })()}
      </svg>
      {/* Y-axis labels */}
      <div style={{
        position: 'absolute', top: 0, right: '100%', bottom: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        paddingRight: '4px', textAlign: 'right',
      }}>
        <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)' }}>
          {max >= 1000 ? `${(max / 1000).toFixed(0)}k` : max}
        </span>
        <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)' }}>
          {min >= 1000 ? `${(min / 1000).toFixed(0)}k` : min}
        </span>
      </div>
    </div>
  );
}

// ─── Burn rate color ───────────────────────────────────────────────────────────
function burnRateColor(rate: number | null): string {
  if (rate === null) return 'var(--text-muted)';
  if (rate < 500) return 'var(--green)';
  if (rate < 1000) return 'var(--yellow)';
  return 'var(--red)';
}

function burnRateLabel(rate: number | null): string {
  if (rate === null) return '—';
  if (rate < 500) return 'healthy';
  if (rate < 1000) return 'elevated';
  return 'high';
}

// ─── Budget bar ───────────────────────────────────────────────────────────────
function BudgetBar({ pct }: { pct: number }) {
  const cappedPct = Math.min(pct, 100);
  let barColor: string;
  if (pct >= 95) barColor = 'var(--red)';
  else if (pct >= 80) barColor = 'var(--orange)';
  else if (pct >= 50) barColor = 'var(--yellow)';
  else barColor = 'var(--green)';

  const isPulsing = pct >= 95;

  return (
    <div style={{
      width: '100%', height: '8px',
      background: 'var(--bg-deep)',
      borderRadius: '4px',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        width: `${cappedPct}%`,
        height: '100%',
        background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
        borderRadius: '4px',
        transition: 'width 0.6s ease',
        boxShadow: `0 0 6px ${barColor}66`,
        animation: isPulsing ? 'budget-pulse 1.2s ease-in-out infinite' : 'none',
      }} />
    </div>
  );
}

// ─── Time remaining formatter ─────────────────────────────────────────────────
function formatTimeRemaining(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 0) return 'Exhausted';
  if (minutes < 1) return '<1m remaining';
  if (minutes < 60) return `~${Math.round(minutes)}m remaining`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `~${hrs}h ${mins}m remaining`;
}

// ─── Runtime badge colors ──────────────────────────────────────────────────────
const RUNTIME_COLORS: Record<string, string> = {
  dev: 'var(--dev)',
  pi: 'var(--pi)',
  gemini: 'var(--gemini)',
};

// ─── Session budget card ───────────────────────────────────────────────────────
function SessionBudgetCard({ budget }: { budget: SessionBudget }) {
  const rtColor = RUNTIME_COLORS[budget.runtime] || 'var(--text-muted)';
  const rtLabel = budget.runtime === 'pi' ? 'Pi' : budget.runtime.charAt(0).toUpperCase() + budget.runtime.slice(1);
  const rateColor = burnRateColor(budget.burnRateTokPerMin);
  const rateLabel = burnRateLabel(budget.burnRateTokPerMin);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${budget.status === 'exhausted' ? 'rgba(248,113,113,0.5)' : budget.status === 'critical' ? 'rgba(251,191,36,0.35)' : budget.status === 'warning' ? 'rgba(251,191,36,0.2)' : 'var(--border)'}`,
      borderRadius: '12px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      transition: 'border-color 0.3s',
      animation: budget.status === 'exhausted' ? 'card-critical-pulse 2s ease-in-out infinite' : 'none',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={budget.sessionKey}>
          {budget.sessionKey.slice(0, 8)}
        </span>
        <span style={{
          fontSize: '9px', fontWeight: 700, color: rtColor,
          background: `${rtColor}14`, border: `1px solid ${rtColor}44`,
          borderRadius: '8px', padding: '1px 6px', flexShrink: 0,
          letterSpacing: '0.2px',
        }}>
          {rtLabel}
        </span>
      </div>

      {/* Task name */}
      {budget.taskName && (
        <div style={{
          fontSize: '10px', color: 'var(--text-secondary)',
          fontFamily: "'Space Grotesk', sans-serif",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={budget.taskName}>
          {budget.taskName.length > 45 ? budget.taskName.slice(0, 45) + '…' : budget.taskName}
        </div>
      )}

      {/* Burn rate */}
      {budget.status === 'warming' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px' }}>⏳</span>
          <span style={{
            fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif",
          }}>
            Warming up…
          </span>
          <span style={{
            fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif",
          }}>
            ({Math.round(budget.elapsedSecs)}s elapsed)
          </span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px' }}>📈</span>
              <span style={{
                fontSize: '12px', fontFamily: "'JetBrains Mono', monospace",
                color: rateColor, fontWeight: 700,
              }}>
                {budget.burnRateTokPerMin !== null ? `${Math.round(budget.burnRateTokPerMin)}` : '—'}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                tok/min
              </span>
            </div>
            <span style={{
              fontSize: '9px', fontWeight: 600,
              color: rateColor,
              background: `${rateColor}14`,
              border: `1px solid ${rateColor}44`,
              borderRadius: '6px', padding: '1px 5px',
            }}>
              {rateLabel}
            </span>
          </div>

          {/* Budget bar */}
          <BudgetBar pct={budget.budgetPct} />

          {/* Budget stats row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
            <span style={{
              fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
              color: budget.budgetPct >= 95 ? 'var(--red)' : budget.budgetPct >= 80 ? 'var(--orange)' : budget.budgetPct >= 50 ? 'var(--yellow)' : 'var(--green)',
            }}>
              {budget.budgetPct.toFixed(1)}%
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
              of {(budget.maxBudget / 1000).toFixed(0)}k context
            </span>
          </div>

          {/* Time remaining */}
          <div style={{
            fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
            color: budget.minutesUntilBudget !== null && budget.minutesUntilBudget < 30
              ? (budget.minutesUntilBudget < 10 ? 'var(--red)' : 'var(--orange)')
              : 'var(--text-muted)',
          }}>
            {formatTimeRemaining(budget.minutesUntilBudget)}
          </div>

          {/* Warnings */}
          {budget.status === 'exhausted' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: '6px', padding: '4px 8px',
            }}>
              <span style={{ fontSize: '11px' }}>🔴</span>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--red)', fontFamily: "'Space Grotesk', sans-serif" }}>
                Exhausted
              </span>
            </div>
          )}
          {budget.status === 'critical' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: '6px', padding: '4px 8px',
            }}>
              <span style={{ fontSize: '11px' }}>⚠</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--yellow)', fontFamily: "'Space Grotesk', sans-serif" }}>
                Budget nearly exhausted
              </span>
            </div>
          )}
          {budget.status === 'warning' && (
            <div style={{
              fontSize: '10px', color: 'var(--yellow)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              ⚠ Past 50% of budget
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Fleet overview header ─────────────────────────────────────────────────────
function FleetOverviewBar({ overview, history }: { overview: FleetOverview; history: FleetHistory }) {
  const healthColor = overview.healthState === 'healthy'
    ? 'var(--green)'
    : overview.healthState === 'elevated'
    ? 'var(--yellow)'
    : 'var(--red)';

  const healthLabel = overview.healthState === 'healthy'
    ? 'Fleet healthy'
    : overview.healthState === 'elevated'
    ? 'Fleet needs attention'
    : 'Fleet critical';

  return (
    <div style={{
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
    }}>
      {/* Health indicator */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <div style={{
          width: '12px', height: '12px', borderRadius: '50%',
          background: healthColor,
          boxShadow: `0 0 8px ${healthColor}`,
          animation: overview.healthState === 'critical' ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif",
          color: healthColor, fontWeight: 600,
        }}>
          {overview.sessionCount > 0 ? healthLabel : 'No sessions'}
        </span>
      </div>

      <div style={{ width: '1px', height: '32px', background: 'var(--border)' }} />

      {/* Avg burn rate */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <span style={{ fontSize: '16px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: 'var(--cyan)', lineHeight: 1 }}>
          {overview.avgBurnRate !== null ? overview.avgBurnRate : '—'}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>avg tok/min</span>
      </div>

      <div style={{ width: '1px', height: '32px', background: 'var(--border)' }} />

      {/* Fleet total tokens */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <span style={{ fontSize: '16px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: 'var(--green)', lineHeight: 1 }}>
          {overview.totalTokens >= 1000
            ? `${(overview.totalTokens / 1000).toFixed(1)}k`
            : overview.totalTokens}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>total tokens</span>
      </div>

      <div style={{ width: '1px', height: '32px', background: 'var(--border)' }} />

      {/* Session counts */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {overview.warningCount > 0 && (
          <span style={{
            fontSize: '10px', fontWeight: 700, color: 'var(--yellow)',
            background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '8px', padding: '2px 7px',
          }}>
            ⚠ {overview.warningCount} warning
          </span>
        )}
        {overview.criticalCount > 0 && (
          <span style={{
            fontSize: '10px', fontWeight: 700, color: 'var(--red)',
            background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: '8px', padding: '2px 7px',
          }}>
            🔴 {overview.criticalCount} critical
          </span>
        )}
        {overview.warningCount === 0 && overview.criticalCount === 0 && overview.sessionCount > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 600 }}>
            ✓ All sessions healthy
          </span>
        )}
      </div>

      {/* Sparkline — history of daily token consumption */}
      {history.dailyTotals.length > 1 && (
        <>
          <div style={{ width: '1px', height: '32px', background: 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
              7-day token history
            </span>
            <Sparkline data={history.dailyTotals} color="var(--cyan)" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
              {history.dates[history.dates.length - 1]?.slice(5) || '—'}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
              {history.dates[0]?.slice(5) || '—'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface Props {
  subAgents: SubAgent[];
}

export default function TokenBudgetForecaster({ subAgents }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [fleetHistory, setFleetHistory] = useState<FleetHistory>(() => loadFleetHistory());

  // Tick every 5 seconds
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Update fleet history when subAgents change or date changes
  useEffect(() => {
    const today = todayStr();
    const history = loadFleetHistory();

    // Check if we need to add a new day entry
    if (history.dates.length === 0 || history.dates[history.dates.length - 1] !== today) {
      // Append new day entry with today's total
      const todayTotal = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
      const newHistory: FleetHistory = {
        dailyTotals: [...history.dailyTotals, todayTotal],
        dates: [...history.dates, today],
      };
      // Trim to HISTORY_DAYS
      if (newHistory.dates.length > HISTORY_DAYS) {
        newHistory.dates = newHistory.dates.slice(-HISTORY_DAYS);
        newHistory.dailyTotals = newHistory.dailyTotals.slice(-HISTORY_DAYS);
      }
      setFleetHistory(newHistory);
      saveFleetHistory(newHistory);
    } else {
      // Update today's total (last entry)
      const todayTotal = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
      const updatedTotals = [...history.dailyTotals];
      updatedTotals[updatedTotals.length - 1] = todayTotal;
      const updated: FleetHistory = { ...history, dailyTotals: updatedTotals };
      setFleetHistory(updated);
      saveFleetHistory(updated);
    }
  }, [subAgents, now]);

  // Only show sessions with startedAt and tokenUsage > 0
  const eligibleSessions = subAgents.filter(sa => sa.startedAt && (sa.tokenUsage ?? 0) > 0);
  const budgets = eligibleSessions.map(sa => calcSessionBudget(sa, now));
  const overview = calcFleetOverview(budgets);

  if (subAgents.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
          ⛽ Token Budget Forecaster
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: "'Space Grotesk', sans-serif" }}>
          No sessions to forecast — spawn sessions to see budget projections
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary name="TokenBudgetForecaster">
      <style>{`
        @keyframes budget-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px var(--red)66; }
          50% { opacity: 0.7; box-shadow: 0 0 14px var(--red)bb; }
        }
        @keyframes card-critical-pulse {
          0%, 100% { border-color: rgba(248,113,113,0.5); }
          50% { border-color: rgba(248,113,113,0.8); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '14px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>⛽</span>
          <h3 style={{ margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>
            Token Budget Forecaster
          </h3>
        </div>

        {/* Fleet Overview */}
        <FleetOverviewBar overview={overview} history={fleetHistory} />

        {/* Section label */}
        <div style={{
          fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)',
          fontFamily: "'Space Grotesk', sans-serif",
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          Per-Session Budget
        </div>

        {/* Responsive grid of session cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '10px',
        }}>
          {budgets.length === 0 ? (
            <div style={{
              gridColumn: '1 / -1',
              fontSize: '11px', color: 'var(--text-muted)',
              fontFamily: "'Space Grotesk', sans-serif",
              textAlign: 'center', padding: '12px',
            }}>
              No sessions with measurable token usage yet
            </div>
          ) : (
            budgets.map(budget => (
              <SessionBudgetCard key={budget.sessionKey} budget={budget} />
            ))
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
