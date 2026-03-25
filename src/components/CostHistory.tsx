import { useState, useEffect, useRef } from 'react';

const MODEL_PRICING: Record<string, [number, number]> = {
  // [inputCostPerM, outputCostPerM]
  dev:    [0.50,  1.50],
  pi:     [0.35,  1.05],
  gemini: [0.35,  1.05],
  default:[0.50,  1.50],
};

function estimateSessionCost(tokenUsage: number, runtime: string): number {
  const [inp, out] = MODEL_PRICING[runtime] ?? MODEL_PRICING.default;
  const outputToks = Math.round(tokenUsage * 0.30);
  const inputToks = tokenUsage - outputToks;
  return (inputToks / 1_000_000) * inp + (outputToks / 1_000_000) * out;
}

function fmtCost(dollars: number): string {
  if (dollars < 0.001) return `$${(dollars * 1000).toFixed(2)}¢`;
  if (dollars < 0.01) return `$${dollars.toFixed(3)}`;
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(2)}`;
}

function fmtCostFull(dollars: number): string {
  if (dollars < 0.001) return `$${(dollars * 1000).toFixed(2)}¢`;
  if (dollars < 0.01) return `$${dollars.toFixed(3)}`;
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(2)}k`;
  return `$${dollars.toFixed(2)}`;
}

interface CostEntry {
  date: string; // YYYY-MM-DD
  cost: number;
  tokens: number;
  sessions: number;
  byRuntime: Record<string, { cost: number; tokens: number; sessions: number }>;
}

interface CostHistoryState {
  entries: CostEntry[]; // rolling 30-day
  allTime: number;
}

const STORAGE_KEY = 'mc_cost_history';

function loadCostHistory(): CostHistoryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { entries: [], allTime: 0 };
}

function saveCostHistory(state: CostHistoryState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yest.';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  // Current active sessions (for today's running cost)
  subAgents: Array<{
    sessionKey: string;
    runtime: string;
    tokenUsage?: number;
    startedAt?: number;
  }>;
  /** Called when a session completes so we can record its final cost */
  onSessionComplete?: (sessionKey: string, runtime: string, tokenUsage: number) => void;
}

export default function CostHistory({ subAgents, onSessionComplete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<CostHistoryState>(loadCostHistory);
  const [tab, setTab] = useState<'7d' | '30d' | 'all'>('7d');
  const prevSubAgentsRef = useRef(subAgents.map(sa => sa.sessionKey));
  const [todayCost, setTodayCost] = useState(0);
  const [, setTodayTokens] = useState(0);
  const [, setTodaySessions] = useState(0);

  // Track "seen" sessions to avoid double-counting completions
  const completedRef = useRef<Set<string>>(new Set());

  // Update today's rolling cost from active sessions
  useEffect(() => {
    const today = todayStr();
    const existing = history.entries.find(e => e.date === today);
    const base = existing?.cost ?? 0;
    const baseTokens = existing?.tokens ?? 0;
    const baseSessions = existing?.sessions ?? 0;

    const activeCost = subAgents.reduce((sum, sa) => sum + estimateSessionCost(sa.tokenUsage ?? 0, sa.runtime), 0);
    const activeTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage ?? 0), 0);

    setTodayCost(base + activeCost);
    setTodayTokens(baseTokens + activeTokens);
    setTodaySessions(baseSessions + subAgents.length);
  }, [subAgents, history]);

  // Detect session completions: subAgents that were present but are now gone
  useEffect(() => {
    const prevKeys = new Set(prevSubAgentsRef.current);
    const currentKeys = new Set(subAgents.map(sa => sa.sessionKey));

    // Find sessions that ended
    prevKeys.forEach(key => {
      if (!currentKeys.has(key) && !completedRef.current.has(key)) {
        completedRef.current.add(key);
        // We don't have the final token count here — the caller should call
        // onSessionComplete when a session truly ends. For now, we just mark it.
      }
    });

    prevSubAgentsRef.current = subAgents.map(sa => sa.sessionKey);
  }, [subAgents]);

  // Expose session-complete handler via ref callback
  useEffect(() => {
    if (onSessionComplete) {
      // Caller passes the final token count; we record it in history
    }
  }, [onSessionComplete]);

  // Record a completed session's cost into history
  function recordSession(runtime: string, tokenUsage: number) {
    if (tokenUsage === 0) return;
    const cost = estimateSessionCost(tokenUsage, runtime);
    const today = todayStr();
    setHistory(prev => {
      const next = { ...prev };
      const existing = next.entries.find(e => e.date === today);
      if (existing) {
        existing.cost += cost;
        existing.tokens += tokenUsage;
        existing.sessions += 1;
        if (!existing.byRuntime[runtime]) {
          existing.byRuntime[runtime] = { cost: 0, tokens: 0, sessions: 0 };
        }
        existing.byRuntime[runtime].cost += cost;
        existing.byRuntime[runtime].tokens += tokenUsage;
        existing.byRuntime[runtime].sessions += 1;
      } else {
        next.entries.push({
          date: today,
          cost,
          tokens: tokenUsage,
          sessions: 1,
          byRuntime: {
            [runtime]: { cost, tokens: tokenUsage, sessions: 1 },
          },
        });
      }
      next.allTime += cost;
      // Trim to 30 days
      if (next.entries.length > 30) {
        next.entries = next.entries.slice(-30);
      }
      saveCostHistory(next);
      return next;
    });
  }

  // Expose recordSession and today's cost on window for cross-component use
  useEffect(() => {
    (window as any).__mc_recordSession = recordSession;
    (window as any).__mc_getTodayCost = () => todayCost;
    return () => {
      delete (window as any).__mc_recordSession;
      delete (window as any).__mc_getTodayCost;
    };
  }, [todayCost]);

  const days = tab === '7d' ? 7 : tab === '30d' ? 30 : history.entries.length;

  // Build chart data — fill in missing days with zero
  function buildChartData() {
    const result: { date: string; cost: number; isToday: boolean }[] = [];
    const today = todayStr();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      const entry = history.entries.find(e => e.date === dateStr);
      result.push({
        date: dateStr,
        cost: entry?.cost ?? 0,
        isToday: dateStr === today,
      });
    }
    return result;
  }

  const chartData = buildChartData();
  const maxCost = Math.max(...chartData.map(d => d.cost), 0.01);

  const periodCost = chartData.reduce((s, d) => s + d.cost, 0) + (tab === '7d' ? todayCost - (history.entries.find(e => e.date === todayStr())?.cost ?? 0) : 0);
  const avgDaily = days > 0 ? periodCost / days : 0;
  const projectedMonthly = avgDaily * 30;
  const allTime = history.allTime + todayCost;

  // Per-runtime breakdown for today
  const todayEntry = history.entries.find(e => e.date === todayStr());
  const byRuntimeToday = todayEntry?.byRuntime ?? {};

  const CHART_H = 52;

  return (
    <div style={{ position: 'relative' }}>
      {/* Compact inline sparkline shown in header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded(v => !v)}
          title={`${fmtCostFull(periodCost)} spent (${tab}) — click to expand`}
        >
          <svg width={chartData.length * 12 + 4} height={CHART_H + 8} style={{ display: 'block' }}>
            {chartData.map((d, i) => {
              const barH = Math.max(2, Math.round((d.cost / maxCost) * CHART_H));
              const x = i * 12 + 2;
              const y = CHART_H - barH + 4;
              return (
                <rect
                  key={d.date}
                  x={x}
                  y={y}
                  width={8}
                  height={barH}
                  rx={2}
                  fill={d.isToday ? 'var(--yellow)' : d.cost > 0 ? 'var(--accent)' : 'var(--border)'}
                  opacity={d.isToday ? 0.9 : d.cost > 0 ? 0.6 : 0.3}
                />
              );
            })}
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--yellow)', fontWeight: 700 }}>
            {fmtCost(periodCost)}
          </span>
          <span style={{ fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-muted)' }}>
            {tab === '7d' ? '7d' : tab === '30d' ? '30d' : 'all'} total
          </span>
        </div>
        {projectedMonthly > 0 && (
          <div style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 5px' }}
            title="Projected monthly spend based on average daily rate">
            →{fmtCostFull(projectedMonthly)}/mo
          </div>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '10px', padding: '2px 6px', fontFamily: "'Space Grotesk', sans-serif",
          }}
          title={expanded ? 'Collapse cost history' : 'Expand cost history'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 500,
          marginTop: '8px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '16px',
          width: '340px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,122,255,0.1)',
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '14px' }}>
            {(['7d', '30d', 'all'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '5px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
                  background: tab === t ? 'rgba(59,122,255,0.18)' : 'var(--bg-input)',
                  border: `1px solid ${tab === t ? 'rgba(59,122,255,0.4)' : 'var(--border)'}`,
                  color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {t === '7d' ? '7 Days' : t === '30d' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)' }}>{fmtCost(periodCost)}</div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Period total</div>
            </div>
            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--yellow)' }}>{fmtCost(projectedMonthly)}</div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Proj. monthly</div>
            </div>
            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--green)' }}>{fmtCostFull(allTime)}</div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>All-time</div>
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '64px' }}>
              {chartData.map((d) => {
                const barH = Math.max(3, Math.round((d.cost / maxCost) * 56));
                return (
                  <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: d.cost > 0 ? 'var(--text-secondary)' : 'var(--text-muted)', display: 'block', lineHeight: 1 }}>
                      {d.cost > 0 ? fmtCost(d.cost) : ''}
                    </span>
                    <div
                      style={{
                        width: '100%', borderRadius: '3px', minHeight: '3px',
                        height: `${barH}px`,
                        background: d.isToday
                          ? 'linear-gradient(180deg, var(--yellow), rgba(251,191,36,0.6))'
                          : d.cost > 0
                          ? 'linear-gradient(180deg, var(--accent), rgba(59,122,255,0.5))'
                          : 'var(--border)',
                        boxShadow: d.isToday && d.cost > 0 ? '0 0 6px rgba(251,191,36,0.4)' : d.cost > 0 ? '0 0 4px rgba(59,122,255,0.3)' : 'none',
                        transition: 'height 0.3s ease',
                      }}
                      title={`${dateLabel(d.date)}: ${fmtCost(d.cost)}`}
                    />
                    <span style={{ fontSize: '8px', fontFamily: "'Space Grotesk', sans-serif", color: d.isToday ? 'var(--yellow)' : 'var(--text-muted)', lineHeight: 1 }}>
                      {dateLabel(d.date)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today's breakdown by runtime */}
          {(todayCost > 0 || subAgents.length > 0) && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Today's Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {/* Running sessions */}
                {subAgents.map(sa => {
                  const cost = estimateSessionCost(sa.tokenUsage ?? 0, sa.runtime);
                  const color = sa.runtime === 'dev' ? 'var(--dev)' : sa.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)';
                  const label = sa.runtime === 'pi' ? 'Pi' : sa.runtime.charAt(0).toUpperCase() + sa.runtime.slice(1);
                  return (
                    <div key={sa.sessionKey} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0 }} />
                      <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Space Grotesk', sans-serif" }}>{sa.sessionKey.slice(0, 20)}…</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--yellow)', fontWeight: 600 }}>{fmtCost(cost)}</span>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>{label}</span>
                    </div>
                  );
                })}
                {/* Saved entries */}
                {Object.entries(byRuntimeToday).map(([rt, data]) => {
                  const color = rt === 'dev' ? 'var(--dev)' : rt === 'pi' ? 'var(--pi)' : 'var(--gemini)';
                  const label = rt === 'pi' ? 'Pi' : rt.charAt(0).toUpperCase() + rt.slice(1);
                  return (
                    <div key={rt} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0 }} />
                      <span style={{ color: 'var(--text-secondary)', flex: 1, fontFamily: "'Space Grotesk', sans-serif" }}>{data.sessions} session{data.sessions !== 1 ? 's' : ''} ({label})</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--green)', fontWeight: 600 }}>{fmtCost(data.cost)}</span>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>{data.tokens >= 1000 ? `${(data.tokens / 1000).toFixed(0)}k` : data.tokens} tok</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {periodCost === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>
              No cost data yet. Sessions will appear here as they run.
            </div>
          )}

          {/* Clear history */}
          {history.entries.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear all cost history? This cannot be undone.')) {
                  const fresh: CostHistoryState = { entries: [], allTime: 0 };
                  setHistory(fresh);
                  saveCostHistory(fresh);
                }
              }}
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                padding: '3px 8px', width: '100%',
              }}
            >
              Clear cost history
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Export the recordSession helper for use by other components
export { estimateSessionCost };
