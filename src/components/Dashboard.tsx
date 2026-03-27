import { useState, useEffect, useRef, useCallback } from 'react';
import AgentMonitor from './AgentMonitor';
import AgentRegistry from './AgentRegistry';
import TodoList from './TodoList';
import Workshop from './Workshop';
import SessionTimeline from './SessionTimeline';
import CostHistory from './CostHistory';
import GitActivity from './GitActivity';
import ActivityFeed from './ActivityFeed';
import MemoryBrowser from './MemoryBrowser';
import CronJobs from './CronJobs';
import AlertsBanner from './AlertsBanner';
import { useToast } from './Toast';
import { NotificationCenter, NotificationBell, useNotifications } from './NotificationCenter';
import SessionEfficiencyMatrix from './SessionEfficiencyMatrix';
import ReasoningTrace from './ReasoningTrace';
import type { Agent, SubAgent, ActivityEvent, SystemEvent } from '../types';
import CommandPalette from './CommandPalette';

// Runtime distribution chips — shown in header for quick runtime breakdown
function RuntimeDistributionChips({ subAgents, agents }: { subAgents: SubAgent[], agents: Agent[] }) {
  const runtimes = [...new Set(subAgents.map(sa => sa.runtime).filter(Boolean))] as string[];
  const counts = runtimes.map(rt => ({
    rt,
    count: subAgents.filter(sa => sa.runtime === rt).length,
    tokens: subAgents.filter(sa => sa.runtime === rt).reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0),
  })).filter(c => c.count > 0);
  if (counts.length === 0) return null;
  const fmtTok = (t: number) => t >= 1000 ? `${(t / 1000).toFixed(0)}k` : String(t);
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      {counts.map(({ rt, count, tokens }) => {
        const color = rt === 'echo' ? 'var(--codex)' : rt === 'sparrow' ? 'var(--pi)' : rt === 'orion' ? 'var(--gemini)' : rt === 'nova' ? 'var(--accent)' : 'var(--text-muted)';
        const agent = agents.find(a => a.id === rt || a.runtime === rt);
        const label = agent?.name || rt.charAt(0).toUpperCase() + rt.slice(1);
        return (
          <div
            key={rt}
            title={`${label}: ${count} session${count !== 1 ? 's' : ''}, ${fmtTok(tokens)} tokens`}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: `${color}14`, border: `1px solid ${color}44`,
              borderRadius: '12px', padding: '2px 8px',
              fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
              color, fontWeight: 600, cursor: 'default',
              boxShadow: count > 0 ? `0 0 6px ${color}22` : 'none',
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0 }} />
            {label} {count}
          </div>
        );
      })}
      {/* Mini session-count bar — visual breakdown of session slots */}
      {subAgents.length > 0 && (
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }} title="Session slot usage by runtime">
          {(['dev', 'pi', 'gemini'] as const).map(rt => {
            const rtCount = subAgents.filter(sa => sa.runtime === rt).length;
            if (rtCount === 0) return null;
            const color = rt === 'dev' ? 'var(--dev)' : rt === 'pi' ? 'var(--pi)' : 'var(--gemini)';
            return Array.from({ length: Math.min(rtCount, 5) }, (_, i) => (
              <div
                key={`${rt}-${i}`}
                style={{
                  width: '4px', height: '8px', borderRadius: '2px',
                  background: color, opacity: 0.8 - i * 0.1,
                  boxShadow: `0 0 3px ${color}55`,
                }}
              />
            ));
          })}
        </div>
      )}
    </div>
  );
}

function KeyboardShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: '?', description: 'Show this help' },
    { key: 'R', description: 'Refresh status' },
    { key: 'P', description: 'Pause / resume polling' },
    { key: 'W', description: 'Focus 3D Workshop (hide panels)' },
    { key: '⌘↵', description: 'Spawn new session' },
    { key: 'Esc', description: 'Deselect / close overlay' },
  ];
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(10,14,26,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '16px', padding: '28px 32px', minWidth: '300px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,122,255,0.1)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>⌨ Keyboard Shortcuts</h3>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
            borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '12px', padding: '4px 10px', fontFamily: "'Space Grotesk', sans-serif",
          }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {shortcuts.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{s.description}</span>
              <kbd style={{
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '3px 10px', fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)',
                boxShadow: '0 2px 0 var(--border)',
              }}>{s.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemEventFeed({ events }: { events: SystemEvent[] }) {
  if (events.length === 0) return null;
  const ev = events[0];
  const iconMap: Record<string, string> = {
    spawn: '▶',
    kill: '■',
    gateway_connect: '◉',
    gateway_disconnect: '○',
  };
  const colorMap: Record<string, string> = {
    spawn: 'var(--green)',
    kill: 'var(--red)',
    gateway_connect: 'var(--green)',
    gateway_disconnect: 'var(--text-muted)',
  };
  return (
    <div
      className="system-event-feed"
      title={`Last: ${ev.detail}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '11px', fontFamily: "'Space Grotesk', sans-serif",
        color: colorMap[ev.type] || 'var(--text-secondary)',
        background: 'var(--bg-input)', border: '1px solid var(--border)',
        borderRadius: '6px', padding: '3px 8px', maxWidth: '180px',
        cursor: 'default',
      }}
    >
      <span style={{ fontSize: '10px', flexShrink: 0 }}>{iconMap[ev.type] || '•'}</span>
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, color: 'var(--text-secondary)',
      }}>
        {ev.detail}
      </span>
      {events.length > 1 && (
        <span style={{
          fontSize: '9px', fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-muted)', flexShrink: 0,
          background: 'rgba(59,122,255,0.1)', border: '1px solid rgba(59,122,255,0.2)',
          borderRadius: '10px', padding: '0 4px',
        }}>
          +{events.length - 1}
        </span>
      )}
    </div>
  );
}

// ─── Top Stats Banner ─────────────────────────────────────────────────────────
function TopStatsBanner({ agents, subAgents, memoryUsage, cpuUsage, gatewayUptime, tokenHistory = [], sessionHistory = [] }: {
  agents: Agent[]; subAgents: SubAgent[]; memoryUsage: number | null; cpuUsage: number | null; gatewayUptime: number | null; tokenHistory?: number[]; sessionHistory?: number[];
}) {
  const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
  const tokenDelta = tokenHistory.length >= 2 ? totalTokens - (tokenHistory[tokenHistory.length - 2] ?? totalTokens) : 0;
  const totalSessions = subAgents.length;
  const peakSessions = Math.max(...sessionHistory, totalSessions);
  const now = Date.now();
  const totalRuntime = subAgents.reduce((sum, sa) => sum + (sa.startedAt ? (now - sa.startedAt) / 1000 : 0), 0);
  const fmtRuntime = (secs: number) => {
    if (secs < 60) return `${Math.floor(secs)}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${(secs / 3600).toFixed(1)}h`;
  };
  const fmtTokens = (t: number) => t >= 1000000 ? `${(t / 1000000).toFixed(1)}M` : t >= 1000 ? `${(t / 1000).toFixed(0)}k` : String(t);

  // ── Token cost estimation ──────────────────────────────────────────────────
  // Pricing per million tokens (input / output). Using approximate common rates.
  const MODEL_PRICING: Record<string, [number, number]> = {
    // [inputCostPerM, outputCostPerM] — using $0.50/$1.50 for minimax-tier models
    dev:    [0.50,  1.50],
    pi:     [0.35,  1.05],
    gemini: [0.35,  1.05],
    default:[0.50,  1.50],
  };

  function estimateSessionCost(sa: SubAgent): number {
    const [inp, out] = MODEL_PRICING[sa.runtime] ?? MODEL_PRICING.default;
    // Assume ~30% of tokens are output (a reasonable mid-range estimate)
    const totalToks = sa.tokenUsage ?? 0;
    const outputToks = Math.round(totalToks * 0.30);
    const inputToks = totalToks - outputToks;
    return (inputToks / 1_000_000) * inp + (outputToks / 1_000_000) * out;
  }

  function fmtCost(dollars: number): string {
    if (dollars < 0.001) return `$${(dollars * 1000).toFixed(2)}¢`;
    if (dollars < 0.01) return `$${dollars.toFixed(3)}`;
    if (dollars < 1) return `$${dollars.toFixed(2)}`;
    return `$${dollars.toFixed(2)}`;
  }

  return (
    <div className="top-stats-banner">
      <div className="tsb-item">
        <span className="tsb-icon">🔗</span>
        <div className="tsb-content" title="Number of active sub-agent sessions">
          <span className="tsb-value">{totalSessions}</span>
          <span className="tsb-label">Sessions{totalSessions > 0 && peakSessions > totalSessions ? ` · peak ${peakSessions}` : ''}</span>
        </div>
        {/* Session capacity bar — shows load against the 5-slot limit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginLeft: '4px' }}>
          <div className="tsb-capacity-bar" title={`${totalSessions}/5 session slots in use`}>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                style={{
                  width: '6px',
                  height: '10px',
                  borderRadius: '2px',
                  background: i < totalSessions
                    ? (totalSessions >= 5 ? 'var(--red)' : totalSessions >= 3 ? 'var(--yellow)' : 'var(--green)')
                    : 'var(--border)',
                  boxShadow: i < totalSessions && totalSessions >= 3 ? `0 0 4px ${totalSessions >= 5 ? 'var(--red)' : 'var(--yellow)'}66` : 'none',
                  transition: 'background 0.3s, box-shadow 0.3s',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: totalSessions >= 5 ? 'var(--red)' : 'var(--text-muted)', textAlign: 'center' }}>
            {totalSessions}/5
          </span>
        </div>
        {sessionHistory.length > 1 && (
          <div className="tsb-session-sparkline" title={`Session count trend: last ${sessionHistory.length} polls`}>
            {sessionHistory.slice(-8).map((count, i) => {
              const maxC = Math.max(...sessionHistory.slice(-8), 1);
              const minC = Math.min(...sessionHistory.slice(-8));
              const range = maxC - minC || 1;
              const h = Math.round(((count - minC) / range) * 10) + 4;
              const color = count > (sessionHistory[sessionHistory.length - 2] ?? count) ? 'var(--green)' : count < (sessionHistory[sessionHistory.length - 2] ?? count) ? 'var(--red)' : 'var(--text-muted)';
              return <div key={i} className="tsb-session-spark-bar" style={{ height: `${h}px`, background: color }} />;
            })}
          </div>
        )}
      </div>
      <div className="tsb-divider" />
      <div className="tsb-item">
        <span className="tsb-icon">⚡</span>
        <div className="tsb-content" title="Cumulative token usage across all sessions">
          <span className="tsb-value">{fmtTokens(totalTokens)}</span>
          <span className="tsb-label">Tokens Used{tokenDelta > 0 ? ` (+${fmtTokens(tokenDelta)})` : ''}</span>
        </div>
        {tokenHistory.length > 1 && (
          <div className="tsb-sparkline" title={`Token trend: last ${tokenHistory.length} readings`}>
            {tokenHistory.slice(-8).map((t, i) => {
              const maxT = Math.max(...tokenHistory.slice(-8), 1);
              const minT = Math.min(...tokenHistory.slice(-8));
              const range = maxT - minT || 1;
              const h = Math.round(((t - minT) / range) * 10) + 4;
              return <div key={i} className="tsb-spark-bar" style={{ height: `${h}px`}} />;
            })}
          </div>
        )}
      </div>
      {totalTokens > 0 && (() => {
        const totalCost = subAgents.reduce((sum, sa) => sum + estimateSessionCost(sa), 0);
        // Project final cost: if session has been running for X secs and used Y tokens,
        // estimate cost if it runs for a full 60min (SESSION_MAX_AGE_MS).
        const now = Date.now();
        let projectedCost = totalCost;
        let canProject = false;
        subAgents.forEach(sa => {
          if (sa.startedAt && sa.tokenUsage) {
            const elapsed = (now - sa.startedAt) / 1000;
            if (elapsed > 30) { // only project if running >30s
              const agePct = elapsed * 1000 / 60 / 60 / 1000; // fraction of 60min
              const proj = estimateSessionCost(sa) / agePct;
              projectedCost += proj - estimateSessionCost(sa);
              canProject = true;
            }
          }
        });
        const costColor = totalCost > 5 ? 'var(--red)' : totalCost > 1 ? 'var(--yellow)' : 'var(--green)';
        return (
          <>
            <div className="tsb-divider" />
            <div className="tsb-item">
              <span className="tsb-icon">💰</span>
              <div className="tsb-content" title="Estimated session cost (30/70 input/output split, $0.50/$1.50 per 1M tokens)">
                <span className="tsb-value" style={{ color: costColor }}>{fmtCost(totalCost)}</span>
                <span className="tsb-label">Est. Cost</span>
              </div>
              {canProject && projectedCost > totalCost && (
                <div style={{ marginLeft: '6px', fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--yellow)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px', padding: '1px 6px' }} title="Projected cost if sessions run to 60min timeout">
                  →{fmtCost(projectedCost)} max
                </div>
              )}
            </div>
          </>
        );
      })()}
      <div className="tsb-divider" />
      <div className="tsb-item">
        <span className="tsb-icon">⏱</span>
        <div className="tsb-content" title="Total CPU time consumed by all sessions">
          <span className="tsb-value">{fmtRuntime(totalRuntime)}</span>
          <span className="tsb-label">Session Time</span>
        </div>
      </div>
      {totalSessions > 0 && (() => {
        const now = Date.now();
        const totalRate = subAgents.reduce((sum, sa) => {
          const ageSecs = sa.startedAt ? (now - sa.startedAt) / 1000 : 0;
          const rate = ageSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / ageSecs) * 60) : 0;
          return sum + rate;
        }, 0);
        const avgRate = totalSessions > 0 ? Math.round(totalRate / totalSessions) : 0;
        const rateColor = avgRate > 1000 ? 'var(--red)' : avgRate > 500 ? 'var(--yellow)' : 'var(--green)';
        return (
          <>
            <div className="tsb-divider" />
            <div className="tsb-item">
              <span className="tsb-icon">📈</span>
              <div className="tsb-content" title="Average token consumption rate across all sessions">
                <span className="tsb-value" style={{ color: rateColor }}>{avgRate}</span>
                <span className="tsb-label">tok/min avg</span>
              </div>
            </div>
          </>
        );
      })()}
      {memoryUsage !== null && (
        <>
          <div className="tsb-divider" />
          <div className="tsb-item">
            <span className="tsb-icon">🧠</span>
            <div className="tsb-content" title="Gateway process heap memory usage">
              <span className="tsb-value">{memoryUsage < 1024 ? `${memoryUsage}MB` : `${(memoryUsage / 1024).toFixed(1)}GB`}</span>
              <span className="tsb-label">Heap</span>
            </div>
          </div>
        </>
      )}
      {cpuUsage !== null && (
        <>
          <div className="tsb-divider" />
          <div className="tsb-item">
            <span className="tsb-icon">📊</span>
            <div className="tsb-content" title="Gateway process CPU utilization">
              <span className="tsb-value" style={{ color: cpuUsage > 80 ? 'var(--red)' : cpuUsage > 50 ? 'var(--yellow)' : 'var(--green)' }}>{cpuUsage}%</span>
              <span className="tsb-label">CPU</span>
            </div>
          </div>
        </>
      )}
      {gatewayUptime !== null && (
        <>
          <div className="tsb-divider" />
          <div className="tsb-item">
            <span className="tsb-icon">▲</span>
            <div className="tsb-content" title="Gateway process uptime">
              <span className="tsb-value">{gatewayUptime >= 86400 ? `${Math.floor(gatewayUptime / 86400)}d ${Math.floor((gatewayUptime % 86400) / 3600)}h` : gatewayUptime < 3600 ? `${Math.floor(gatewayUptime / 60)}m` : `${(gatewayUptime / 3600).toFixed(1)}h`}</span>
              <span className="tsb-label">Uptime</span>
            </div>
          </div>
        </>
      )}
      {/* Session age breakdown — colored dots showing agent status distribution */}
      {agents.length > 0 && (
        <div className="tsb-divider" />
      )}
      {agents.length > 0 && (
        <div className="tsb-item" title="Agent status breakdown — active, thinking, idle">
          <span className="tsb-icon">◉</span>
          <div className="tsb-content" style={{ flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {agents.filter(a => a.status === 'active').length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>{agents.filter(a => a.status === 'active').length}</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", fontSize: '9px' }}>active</span>
                </span>
              )}
              {agents.filter(a => a.status === 'thinking').length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--yellow)', boxShadow: '0 0 5px var(--yellow)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--yellow)', fontFamily: "'JetBrains Mono', monospace" }}>{agents.filter(a => a.status === 'thinking').length}</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", fontSize: '9px' }}>thinking</span>
                </span>
              )}
              {agents.filter(a => a.status === 'idle').length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 5px var(--accent)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>{agents.filter(a => a.status === 'idle').length}</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", fontSize: '9px' }}>idle</span>
                </span>
              )}
            </div>
            <span className="tsb-label">Agent breakdown</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 100);
    return () => clearInterval(t);
  }, []);
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ms = String(time.getMilliseconds()).padStart(3, '0').slice(0, 2);
  return (
    <span className="live-clock">
      <span className="date-display">{dateStr}</span>
      <span className="clock-time">{timeStr}</span>
      <span className="clock-ms">.{ms}</span>
    </span>
  );
}

function PingSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const max = Math.max(...history);
  const min = Math.min(...history);
  const range = max - min || 1;
  return (
    <div className="ping-sparkline" title={`Ping: ${history[history.length - 1]}ms (min ${min}ms, max ${max}ms)`}>
      {history.map((p, i) => {
        const h = Math.round(((p - min) / range) * 12) + 3;
        const color = p < 50 ? 'var(--green)' : p < 150 ? 'var(--yellow)' : 'var(--red)';
        return <div key={i} className="ping-spark-bar" style={{ height: `${h}px`, background: color }} />;
      })}
    </div>
  );
}

function QuickActions({ connected, onShowShortcuts, onOpenPalette, onFocus3D }: { connected: boolean; onShowShortcuts: () => void; onOpenPalette: () => void; onFocus3D: () => void }) {
  const handleRefresh = () => {
    // Trigger a custom event that AgentMonitor can listen to
    window.dispatchEvent(new CustomEvent('mc:refresh'));
  };

  const handleCopyStatus = async () => {
    try {
      const res = await fetch('/__gateway/status', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      }
    } catch {
      // silent fail
    }
  };

  const handleOpenGateway = () => {
    window.open('http://localhost:18789', '_blank');
  };

  return (
    <div className="quick-actions-row" title="Quick actions">
      <button
        className="quick-action-btn command-palette-trigger"
        onClick={onOpenPalette}
        title="Command palette (⌘K)"
        style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '12px', gap: '4px' }}
      >
        ⌘K
      </button>
      <button
        className="quick-action-btn"
        onClick={handleRefresh}
        disabled={!connected}
        title="Refresh status"
      >
        ↻
      </button>
      <button
        className="quick-action-btn"
        onClick={handleCopyStatus}
        disabled={!connected}
        title="Copy gateway status as JSON"
      >
        📋
      </button>
      <button
        className="quick-action-btn"
        onClick={handleOpenGateway}
        title="Open gateway URL"
      >
        🌐
      </button>
      <button
        className="quick-action-btn"
        onClick={onShowShortcuts}
        title="Keyboard shortcuts (?)"
      >
        ⌨
      </button>
      <button
        className="quick-action-btn"
        onClick={onFocus3D}
        title="Focus 3D Workshop (W)"
      >
        🎮
      </button>
    </div>
  );
}

// ─── Command Palette ─────────────────────────────────────────────────────────
interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

function HeaderActivityTicker({ activities, hatFlash }: { activities: ActivityEvent[]; hatFlash?: boolean }) {
  if (activities.length === 0) return null;
  const ev1 = activities[0];
  const ev2 = activities[1];

  const icon = (event: ActivityEvent['event']) =>
    event === 'started' ? '▶' : event === 'thinking' ? '💭' : event === 'error' ? '✕' : event === 'system' ? '⚙' : '✓';

  const text = (ev: ActivityEvent) => ev.detail || `${ev.agentName} ${ev.event}`;

  return (
    <div className={`header-activity-ticker${hatFlash ? ' hat-flash' : ''}`} title={activities.length > 1 ? `${activities.length} recent events` : text(ev1)}>
      <div className="hat-event">
        <span className="hat-icon">{icon(ev1.event)}</span>
        <span className="hat-text">{text(ev1)}</span>
      </div>
      {ev2 && (
        <div className="hat-event">
          <span className="hat-icon">{icon(ev2.event)}</span>
          <span className="hat-text">{text(ev2)}</span>
        </div>
      )}
    </div>
  );
}

const MAX_ACTIVITIES = 50;

interface DashboardProps {
  onLogout?: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const { stats: statsToast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'echo', name: 'Echo', runtime: 'echo', status: 'idle' },
    { id: 'sparrow', name: 'Wren', runtime: 'sparrow', status: 'idle' },
    { id: 'orion', name: 'Ember', runtime: 'orion', status: 'idle' },
    { id: 'nova', name: 'Pixel', runtime: 'nova', status: 'idle' },
  ]);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [activeTab, setActiveTab] = useState<'monitor' | 'agents' | 'todos' | 'timeline' | 'activity' | 'memory' | 'cron' | 'efficiency' | 'reasoning'>('monitor');
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [pingHistory, setPingHistory] = useState<number[]>([]);
  const [pingJitter, setPingJitter] = useState<number | null>(null);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayUptime, setGatewayUptime] = useState<number | null>(null);
  const [memoryUsage, setMemoryUsage] = useState<number | null>(null);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState<number>(15);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const prevActivitiesLenRef = useRef<number>(activities.length);
  const [hatFlash, setHatFlash] = useState(false);
  const prevConnectedRef = useRef(false);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  // Token history for TopStatsBanner sparkline
  const [tokenHistory, setTokenHistory] = useState<number[]>([]);
  // Session count history for TopStatsBanner sparkline
  const [sessionHistory, setSessionHistory] = useState<number[]>([]);
  // Respawn data for pre-filling spawn form from SessionDetailModal
  const [respawnData, setRespawnData] = useState<{ taskName: string; runtime: string } | null>(null);
  // Session key selected for the Reasoning Trace tab
  const [reasoningSessionKey, setReasoningSessionKey] = useState<string | null>(null);

  // Notification center state
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    overdueCount,
    addNotification,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    recordSystemEvent,
    recordActivityEvent,
  } = useNotifications();

  // Record error activities as notifications
  useEffect(() => {
    const errorEvents = activities.filter(a => a.event === 'error');
    errorEvents.forEach(ev => {
      // Avoid duplicates by checking if we already notified about this exact event
      const key = `${ev.id}-${ev.agentName}`;
      if (!(window as any).__mc_notified_errors) {
        (window as any).__mc_notified_errors = new Set<string>();
      }
      if (!(window as any).__mc_notified_errors.has(key)) {
        (window as any).__mc_notified_errors.add(key);
        recordActivityEvent(ev.event, ev.agentName, ev.detail);
      }
    });
  }, [activities, recordActivityEvent]);

  // Update token and session history when subAgents change
  useEffect(() => {
    const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
    if (totalTokens > 0) {
      setTokenHistory(prev => [...prev.slice(-7), totalTokens]);
    }
    setSessionHistory(prev => [...prev.slice(-7), subAgents.length]);
  }, [subAgents]);

  // Clear respawnData after AgentMonitor processes it (short delay)
  useEffect(() => {
    if (respawnData) {
      const t = setTimeout(() => setRespawnData(null), 100);
      return () => clearTimeout(t);
    }
  }, [respawnData]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(v => !v);
        return;
      }
      if (e.key === '?') setShowShortcuts(v => !v);
      if (e.key === 'Escape') { setShowShortcuts(false); setShowPalette(false); }
      if ((e.key === 'a' || e.key === 'A') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        setActiveTab('agents');
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        setActiveTab('efficiency');
        return;
      }
      if (e.key === 'w' || e.key === 'W') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          setPanelsVisible(v => !v);
        }
      }
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        window.dispatchEvent(new CustomEvent('mc:refresh'));
      }
      if (e.key === 'p' || e.key === 'P') {
        window.dispatchEvent(new CustomEvent('mc:togglePolling'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Command Palette handlers ─────────────────────────────────────────────────
  const handlePaletteAction = useCallback((action: string) => {
    switch (action) {
      case 'toggle-polling':
        window.dispatchEvent(new CustomEvent('mc:togglePolling'));
        break;
      case 'refresh':
        window.dispatchEvent(new CustomEvent('mc:refresh'));
        break;
      case 'export-sessions':
        navigator.clipboard.writeText(JSON.stringify(subAgents, null, 2)).catch(() => {});
        break;
      case 'clear-activity':
        setActivities([]);
        break;
      case 'clear-todos':
        window.dispatchEvent(new CustomEvent('mc:clearTodos'));
        break;
      case 'kanban-view':
        window.dispatchEvent(new CustomEvent('mc:viewKanban'));
        break;
      case 'list-view':
        window.dispatchEvent(new CustomEvent('mc:viewList'));
        break;
      case 'open-gateway':
        window.open('http://localhost:18789', '_blank');
        break;
      case 'shortcuts':
        setShowShortcuts(true);
        break;
    }
  }, [subAgents]);

  const handleSwitchView = useCallback((view: string) => {
    if (view === 'workshop') {
      setPanelsVisible(v => !v);
      return;
    }
    if (view === 'convoys') {
      // Convoys is shown in a separate section — not a tab
      return;
    }
    if (view === 'cost') {
      // Cost history is in the header, not a tab
      return;
    }
    window.dispatchEvent(new CustomEvent('mc:switchTab', { detail: { tab: view } }));
  }, []);

  const handleSelectSession = useCallback((sessionKey: string) => {
    setActiveTab('monitor');
    window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
  }, []);

  // Listen for showShortcuts from CommandPalette
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('mc:showShortcuts', handler);
    return () => window.removeEventListener('mc:showShortcuts', handler);
  }, []);

  // Listen for switchTab from CommandPalette
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: string }>).detail.tab;
      if (tab === 'monitor' || tab === 'agents' || tab === 'todos' || tab === 'timeline' || tab === 'activity' || tab === 'memory' || tab === 'cron' || tab === 'efficiency' || tab === 'reasoning') setActiveTab(tab);
    };
    window.addEventListener('mc:switchTab', handler);
    return () => window.removeEventListener('mc:switchTab', handler);
  }, []);

  // Listen for focus3D — hide panels to focus on 3D workshop
  useEffect(() => {
    const handler = () => setPanelsVisible(false);
    window.addEventListener('mc:focus3D', handler);
    return () => window.removeEventListener('mc:focus3D', handler);
  }, []);

  // Listen for spawn from CommandPalette — switch to monitor and spawn
  useEffect(() => {
    const handler = (e: Event) => {
      setActiveTab('monitor');
      const { runtime } = (e as CustomEvent<{ runtime: string }>).detail;
      window.dispatchEvent(new CustomEvent('mc:spawnRuntime', { detail: { runtime } }));
    };
    window.addEventListener('mc:spawn', handler);
    return () => window.removeEventListener('mc:spawn', handler);
  }, []);

  // Listen for polling paused state from AgentMonitor
  const [pollingPaused, setPollingPaused] = useState(false);

  // Failed cron count — read from CronJobs via window
  const [failedCronCount, setFailedCronCount] = useState(0);
  // Today's cost — read from CostHistory via window
  const [todayCost, setTodayCost] = useState(0);

  // Poll window globals exposed by CostHistory and CronJobs
  useEffect(() => {
    const poll = () => {
      try {
        const fc = (window as any).__mc_failedCronCount;
        if (typeof fc === 'number') setFailedCronCount(fc);
        const tc = (window as any).__mc_getTodayCost?.();
        if (typeof tc === 'number') setTodayCost(tc);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, []);

  // Add data-polling-interval attribute to document.body
  useEffect(() => {
    document.body.setAttribute('data-polling-interval', pollingPaused ? 'paused' : '5s');
    return () => { try { document.body.removeAttribute('data-polling-interval'); } catch {} };
  }, [pollingPaused]);
  useEffect(() => {
    const handler = (e: Event) => {
      setPollingPaused((e as CustomEvent<{ paused: boolean }>).detail.paused);
    };
    window.addEventListener('mc:pollingPaused', handler);
    return () => window.removeEventListener('mc:pollingPaused', handler);
  }, []);
  // Listen for session selection from Workshop timeline clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const sessionKey = (e as CustomEvent<{ sessionKey: string }>).detail.sessionKey;
      setActiveTab('monitor');
      window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
    };
    window.addEventListener('mc:selectSession', handler);
    return () => window.removeEventListener('mc:selectSession', handler);
  }, []);

  // Keep reasoningSessionKey in sync with the most recently selected session
  useEffect(() => {
    const handler = (e: Event) => {
      const sessionKey = (e as CustomEvent<{ sessionKey: string }>).detail.sessionKey;
      setReasoningSessionKey(sessionKey);
    };
    window.addEventListener('mc:selectSessionInternal', handler);
    return () => window.removeEventListener('mc:selectSessionInternal', handler);
  }, []);
  useEffect(() => {
    if (activities.length > prevActivitiesLenRef.current) {
      setHatFlash(true);
      const t = setTimeout(() => setHatFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevActivitiesLenRef.current = activities.length;
  }, [activities]);

  // Trim activities to MAX_ACTIVITIES to prevent unbounded growth
  useEffect(() => {
    if (activities.length > MAX_ACTIVITIES) {
      setActivities(prev => prev.slice(-MAX_ACTIVITIES));
    }
  }, [activities.length, setActivities]);

  const activeCount = agents.filter(a => a.status === 'active').length;
  const thinkingCount = agents.filter(a => a.status === 'thinking').length;

  // Fire stats toast when gateway reconnects
  useEffect(() => {
    if (gatewayConnected && !prevConnectedRef.current) {
      const totalSessions = subAgents.length;
      const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
      statsToast('Gateway Reconnected', `${activeCount} active · ${totalSessions} sessions · ${(totalTokens / 1000).toFixed(0)}k tokens`);
    }
    prevConnectedRef.current = gatewayConnected;
  }, [gatewayConnected, activeCount, subAgents.length, statsToast]);

  // Ping the gateway for latency display
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const t0 = Date.now();
        const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
        if (res.ok && !cancelled) {
          setGatewayConnected(true);
          const ms = Date.now() - t0;
          setPingLatency(ms);
          setPingHistory(prev => {
            const next = [...prev.slice(-11), ms];
            if (next.length >= 3) {
              // Calculate jitter as variance of recent deltas
              const deltas = next.slice(1).map((v, i) => Math.abs(v - next[i]));
              const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
              setPingJitter(Math.round(avgDelta));
            }
            return next;
          });
          setNextRefreshIn(15); // reset countdown after successful ping
          const data = await res.json();
          if (typeof data.uptime === 'number') setGatewayUptime(data.uptime);
          if (typeof data.memoryUsage === 'number') setMemoryUsage(data.memoryUsage);
          if (typeof data.cpuUsage === 'number') setCpuUsage(data.cpuUsage);
        }
      } catch {
        if (!cancelled) {
          setGatewayConnected(false);
          setPingLatency(null);
        }
      }
    }
    ping();
    const interval = setInterval(ping, 15000);
    // Countdown to next refresh
    const countdown = setInterval(() => setNextRefreshIn(n => Math.max(0, n - 1)), 1000);
    return () => { cancelled = true; clearInterval(interval); clearInterval(countdown); };
  }, []);

  return (
    <div className="dashboard">
      {!gatewayConnected && (
        <div className="gateway-disconnected-banner">
          <span>⚠ Gateway unreachable — attempting to reconnect…</span>
          <span style={{ marginLeft: '8px', opacity: 0.7, fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>refreshing…</span>
        </div>
      )}
      <TopStatsBanner
        agents={agents}
        subAgents={subAgents}
        memoryUsage={memoryUsage}
        cpuUsage={cpuUsage}
        gatewayUptime={gatewayUptime}
        tokenHistory={tokenHistory}
        sessionHistory={sessionHistory}
      />
      <AlertsBanner
        subAgents={subAgents}
        agents={agents}
        gatewayConnected={gatewayConnected}
        pingLatency={pingLatency}
        cpuUsage={cpuUsage}
        failedCronCount={failedCronCount}
        todayCost={todayCost}
        onNavigateToTab={(tab) => setActiveTab(tab as any)}
        onOpenNotificationPanel={() => setNotifPanelOpen(true)}
      />
      <header className="dashboard-header">
        <div className="header-brand">
          {/* Session capacity ring around the MC logo */}
          <div className="session-capacity-ring" title={`${subAgents.length}/5 session slots in use`}>
            <svg width="42" height="42" viewBox="0 0 42 42" style={{ transform: 'translate(-50%,-50%) rotate(-90deg)' }}>
              {/* Background track */}
              <circle cx="21" cy="21" r="17" fill="none" stroke="var(--bg-input)" strokeWidth="3" />
              {/* Progress arc */}
              <circle
                cx="21" cy="21" r="17"
                fill="none"
                stroke={subAgents.length >= 5 ? 'var(--red)' : subAgents.length >= 3 ? 'var(--yellow)' : 'var(--green)'}
                strokeWidth="3"
                strokeDasharray={`${(subAgents.length / 5) * Math.PI * 34} ${Math.PI * 34}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s', filter: subAgents.length > 0 ? `drop-shadow(0 0 4px ${subAgents.length >= 5 ? 'var(--red)' : subAgents.length >= 3 ? 'var(--yellow)' : 'var(--green)'})` : 'none' }}
              />
            </svg>
            <span className="header-logo-mono ring-label">MC</span>
          </div>
          <span className="header-logo">🕹️</span>
          <h1>Mission Control</h1>
        </div>
        <div className="header-meta">
          {/* Prominent connection latency display */}
          {pingLatency !== null && gatewayConnected && (
            <div
              className="latency-pill"
              title={`Gateway ping: ${pingLatency}ms (jitter: ±${pingJitter ?? '?'}ms)`}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: pingLatency < 50
                  ? 'rgba(52,211,153,0.1)'
                  : pingLatency < 150
                  ? 'rgba(251,191,36,0.1)'
                  : 'rgba(248,113,113,0.1)',
                border: `1px solid ${
                  pingLatency < 50
                    ? 'rgba(52,211,153,0.3)'
                    : pingLatency < 150
                    ? 'rgba(251,191,36,0.3)'
                    : 'rgba(248,113,113,0.3)'
                }`,
                borderRadius: '8px',
                padding: '3px 9px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                fontWeight: 700,
                color: pingLatency < 50
                  ? 'var(--green)'
                  : pingLatency < 150
                  ? 'var(--yellow)'
                  : 'var(--red)',
                boxShadow: pingLatency < 50
                  ? '0 0 8px rgba(52,211,153,0.2)'
                  : pingLatency < 150
                  ? '0 0 8px rgba(251,191,36,0.2)'
                  : '0 0 8px rgba(248,113,113,0.2)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '7px', color: 'var(--text-muted)', fontWeight: 500 }}>PING</span>
              <span style={{ color: 'inherit' }}>{pingLatency}</span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>ms</span>
              <span style={{ fontSize: '9px' }}>
                {pingLatency < 50 ? '🟢' : pingLatency < 150 ? '🟡' : '🔴'}
              </span>
            </div>
          )}
          <LiveClock />
          <RuntimeDistributionChips subAgents={subAgents} agents={agents} />
          <QuickActions connected={gatewayConnected} onShowShortcuts={() => setShowShortcuts(true)} onOpenPalette={() => setShowPalette(true)} onFocus3D={() => setPanelsVisible(v => !v)} />
          <HeaderActivityTicker activities={activities} hatFlash={hatFlash} />
          <SystemEventFeed events={systemEvents} />
          {/* Notification bell — unread badge shows pending unread + overdue reminders */}
          <NotificationBell
            unreadCount={unreadCount + overdueCount}
            onClick={() => setNotifPanelOpen(v => !v)}
          />
          {/* At-risk sessions badge — shown when any session is > 15 min old */}
          {(() => {
            const atRisk = subAgents.filter(sa => sa.startedAt && (Date.now() - sa.startedAt) > 15 * 60 * 1000);
            if (atRisk.length === 0) return null;
            return (
              <div title={`${atRisk.length} long-running session${atRisk.length > 1 ? 's' : ''} — consider reviewing`} style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: '8px', padding: '2px 7px',
                fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                color: 'var(--yellow)', fontWeight: 600,
                boxShadow: '0 0 6px rgba(251,191,36,0.15)',
              }}>
                ⏱ {atRisk.length} long-running
              </div>
            );
          })()}
          <div className="header-agent-summary">
            {activeCount > 0 && (
              <span className="summary-chip summary-chip--active">
                {activeCount} active
              </span>
            )}
            {thinkingCount > 0 && (
              <span className="summary-chip summary-chip--thinking">
                {thinkingCount} thinking
              </span>
            )}
            {activeCount === 0 && thinkingCount === 0 && (
              <span className="summary-chip summary-chip--idle">
                All idle
              </span>
            )}
            {subAgents.length > 0 && (
              <span className="summary-chip" style={{ background: 'rgba(34,211,238,0.08)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.2)' }} title={`${subAgents.length} active sub-agent sessions`}>
                {subAgents.length} sess
              </span>
            )}
          </div>
          <div className={`header-status${gatewayConnected ? ' header-status--connected' : ''}`}>
            <span className={`status-indicator ${!gatewayConnected ? 'status-indicator--disconnected' : ''}`} />
            <span className="gateway-label">Gateway</span>
            {pingLatency !== null && (
              <>
                <span className="ping-latency" title="Gateway ping latency">{pingLatency}ms</span>
                {pingJitter !== null && (
                  <span className="ping-jitter" title="Latency jitter/variance">±{pingJitter}ms</span>
                )}
                <PingSparkline history={pingHistory} />
                <span className={`conn-quality-badge ${pingJitter !== null ? (pingJitter < 10 ? 'conn-quality--stable' : pingJitter < 30 ? 'conn-quality--variable' : 'conn-quality--unstable') : ''}`}>
                  {pingJitter !== null ? (pingJitter < 10 ? '🟢' : pingJitter < 30 ? '🟡' : '🔴') : ''}
                </span>
              </>
            )}
            {pingLatency === null && (
              <span className="ping-latency" style={{ color: 'var(--red)' }}>—</span>
            )}
            {gatewayUptime !== null && (
              <span className="gateway-uptime" title="Gateway uptime">
                ↑ {gatewayUptime >= 86400
                  ? `${Math.floor(gatewayUptime / 86400)}d ${Math.floor((gatewayUptime % 86400) / 3600)}h`
                  : gatewayUptime < 3600
                  ? `${Math.floor(gatewayUptime / 60)}m`
                  : `${(gatewayUptime / 3600).toFixed(1)}h`}
              </span>
            )}
            {pingLatency !== null && (
              <div className="refresh-countdown-wrap" title={`Next refresh in ~${nextRefreshIn}s`}>
                <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', minWidth: '18px' }}>
                  {nextRefreshIn}s
                </span>
                <div className="refresh-countdown-bar-wrap">
                  <div
                    className="refresh-countdown-bar"
                    style={{ width: `${(nextRefreshIn / 15) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {pollingPaused && (
              <span className="polling-paused-badge" title="Polling is paused — click ⏸ in the Monitor tab to resume">
                ⏸ Paused
              </span>
            )}
            {activities.filter(a => a.event === 'error').length > 0 && (
              <span className="error-notif-badge" title={`${activities.filter(a => a.event === 'error').length} error(s) in activity feed`}>
                ⚠ {activities.filter(a => a.event === 'error').length}
              </span>
            )}
            {cpuUsage !== null && (
              <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: cpuUsage > 80 ? 'var(--red)' : cpuUsage > 50 ? 'var(--yellow)' : 'var(--green)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`CPU: ${cpuUsage}%`}>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>CPU</span>
                <div style={{ width: '24px', height: '3px', background: 'var(--bg-deep)', borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: `${cpuUsage}%`, height: '100%', background: cpuUsage > 80 ? 'var(--red)' : cpuUsage > 50 ? 'var(--yellow)' : 'var(--green)', borderRadius: '2px', transition: 'width 0.5s ease' }} />
                </div>
                <span>{cpuUsage}%</span>
              </span>
            )}
            {memoryUsage !== null && (
              <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }} title={`Heap: ${memoryUsage < 1024 ? `${memoryUsage}MB` : `${(memoryUsage / 1024).toFixed(1)}GB`}`}>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>MEM</span>
                <span>{memoryUsage < 1024 ? `${memoryUsage}MB` : `${(memoryUsage / 1024).toFixed(1)}GB`}</span>
              </span>
            )}
            {(() => {
              const warning = subAgents.filter(sa => { const e = sa.startedAt ? (Date.now() - sa.startedAt) / 1000 : 0; return e > 1200 && e <= 2400; }).length;
              const critical = subAgents.filter(sa => { const e = sa.startedAt ? (Date.now() - sa.startedAt) / 1000 : 0; return e > 2400; }).length;
              if (critical > 0) return <span className="at-risk-badge" style={{ background: 'rgba(248,113,113,0.18)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.35)' }} title={`${critical} session(s) at critical timeout risk (>40 min)`}>⏱ {critical} critical</span>;
              if (warning > 0) return <span className="at-risk-badge" title={`${warning} session(s) approaching timeout (>20 min)`}>⏱ {warning} at risk</span>;
              return null;
            })()}
          </div>
          {/* Cost history analytics — 7d/30d sparkline + expandable breakdown */}
          <CostHistory subAgents={subAgents} />
          {/* Git Activity — shows recent commits across workspace repos */}
          <GitActivity />
          {onLogout && (
            <button
              className="logout-btn"
              onClick={onLogout}
              title="Logout and clear session"
            >
              Logout
            </button>
          )}
        </div>
      </header>

      <div className="dashboard-body">
        <div className="scene-section">
          <Workshop agents={agents} subAgents={subAgents} activities={activities} onSwitchToMonitor={(agentId) => {
            if (agentId) {
              setActiveTab('monitor');
            }
          }} />
        </div>

        <div className="controls-section" style={{ display: panelsVisible ? '' : 'none' }}>
          <div className="tab-bar">
            <button
              className={`tab-btn ${activeTab === 'agents' ? 'active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >
              🤖 Agents
            </button>
            <button
              className={`tab-btn ${activeTab === 'monitor' ? 'active' : ''}`}
              onClick={() => setActiveTab('monitor')}
            >
              📡 Monitor
            </button>
            <button
              className={`tab-btn ${activeTab === 'todos' ? 'active' : ''}`}
              onClick={() => setActiveTab('todos')}
            >
              ✅ Todos
            </button>
            <button
              className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              📊 Timeline
            </button>
            <button
              className={`tab-btn ${activeTab === 'activity' ? 'active' : ''}`}
              onClick={() => setActiveTab('activity')}
            >
              📡 Activity
            </button>
            <button
              className={`tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              🧠 Memory
            </button>
            <button
              className={`tab-btn ${activeTab === 'cron' ? 'active' : ''}`}
              onClick={() => setActiveTab('cron')}
            >
              ⏰ Cron
            </button>
            <button
              className={`tab-btn ${activeTab === 'efficiency' ? 'active' : ''}`}
              onClick={() => setActiveTab('efficiency')}
            >
              📊 Efficiency
            </button>
            <button
              className={`tab-btn ${activeTab === 'reasoning' ? 'active' : ''}`}
              onClick={() => setActiveTab('reasoning')}
            >
              💭 Reasoning
            </button>
          </div>
          <div className="kbd-hint">⏎ Monitor · 🤖 Agents · ⌘↵ Spawn · W Focus 3D · E Efficiency</div>

          <div className="tab-content">
            {activeTab === 'agents' && (
              <AgentRegistry agents={agents} subAgents={subAgents} />
            )}
            {activeTab === 'monitor' && (
              <>
                <AgentMonitor
                  onAgentsChange={setAgents}
                  onSubAgentsChange={setSubAgents}
                  activities={activities}
                  setActivities={setActivities}
                  onSystemEvent={(ev) => {
                    setSystemEvents(prev => [ev, ...prev].slice(0, 20));
                    recordSystemEvent(ev.type, ev.detail, ev.runtime);
                  }}
                  onRespawn={(taskName, runtime) => setRespawnData({ taskName, runtime })}
                  gatewayConnected={gatewayConnected}
                />
                <div className="kbd-shortcut-hint">
                  <span><kbd>R</kbd> refresh</span>
                  <span><kbd>⌘↵</kbd> spawn</span>
                  <span><kbd>Esc</kbd> deselect</span>
                  <span><kbd>A</kbd> agents</span>
                </div>
              </>
            )}
            {activeTab === 'todos' && <TodoList />}
            {activeTab === 'timeline' && (
              <SessionTimeline
                subAgents={subAgents}
                onSelectSession={(sessionKey) => {
                  setActiveTab('monitor');
                  window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
                }}
                selectedSessionKey={null}
              />
            )}
            {activeTab === 'activity' && (
              <ActivityFeed
                activities={activities}
                systemEvents={systemEvents}
                subAgents={subAgents}
                onSelectSession={(sessionKey) => {
                  setActiveTab('monitor');
                  window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
                }}
                onClearActivities={() => setActivities([])}
              />
            )}
            {activeTab === 'memory' && (
              <MemoryBrowser />
            )}
            {activeTab === 'cron' && (
              <CronJobs />
            )}
            {activeTab === 'efficiency' && (
              <SessionEfficiencyMatrix
                subAgents={subAgents}
                onSelectSession={(sessionKey) => {
                  setActiveTab('monitor');
                  window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
                }}
              />
            )}
            {activeTab === 'reasoning' && (
              reasoningSessionKey ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{
                    padding: '8px 14px', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--bg-card)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'Space Grotesk', sans-serif" }}>
                        Showing reasoning trace for:
                      </span>
                      <span style={{
                        fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
                        color: 'var(--accent)', background: 'rgba(59,122,255,0.1)',
                        border: '1px solid rgba(59,122,255,0.2)',
                        borderRadius: '8px', padding: '2px 8px',
                      }}>
                        {reasoningSessionKey.slice(0, 20)}…
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setActiveTab('monitor')}
                        style={{
                          background: 'rgba(59,122,255,0.08)', border: '1px solid rgba(59,122,255,0.2)',
                          borderRadius: '8px', padding: '3px 10px',
                          fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                          color: 'var(--accent)', cursor: 'pointer',
                        }}
                      >
                        ← Back to Monitor
                      </button>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <ReasoningTrace sessionKey={reasoningSessionKey} subAgents={subAgents} />
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  height: '100%', gap: '16px', padding: '32px',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}>
                  <div style={{ fontSize: '48px' }}>💭</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Reasoning Trace
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>
                    Click any session in the Monitor tab to view its reasoning trace — the chain of thoughts, tool calls, and decisions made by the agent.
                  </div>
                  <button
                    onClick={() => setActiveTab('monitor')}
                    style={{
                      background: 'rgba(59,122,255,0.1)', border: '1px solid rgba(59,122,255,0.3)',
                      borderRadius: '10px', padding: '8px 20px',
                      fontSize: '12px', fontFamily: "'Space Grotesk', sans-serif",
                      color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
                      boxShadow: '0 0 12px rgba(59,122,255,0.15)',
                    }}
                  >
                    Go to Monitor →
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
      {showShortcuts && <KeyboardShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {showPalette && (
        <CommandPalette
          isOpen={showPalette}
          onClose={() => setShowPalette(false)}
          subAgents={subAgents}
          agents={agents}
          onSelectSession={handleSelectSession}
          onAction={handlePaletteAction}
          onSwitchView={handleSwitchView}
          pollingPaused={pollingPaused}
        />
      )}
      <NotificationCenter
        isOpen={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
        notifications={notifications}
        onAddNotification={addNotification}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
        onDismiss={dismiss}
        onClearAll={clearAll}
        onSelectSession={(sessionKey) => {
          setActiveTab('monitor');
          window.dispatchEvent(new CustomEvent('mc:selectSessionInternal', { detail: { sessionKey } }));
          setNotifPanelOpen(false);
        }}
      />
      {/* Floating "Show panels" button when panels are hidden — lets user focus on 3D scene */}
      {!panelsVisible && (
        <button
          onClick={() => setPanelsVisible(true)}
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
            background: 'rgba(59,122,255,0.15)', border: '1px solid rgba(59,122,255,0.4)',
            borderRadius: '12px', color: 'var(--accent)',
            cursor: 'pointer', fontSize: '12px', fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700, padding: '8px 16px',
            display: 'flex', alignItems: 'center', gap: '6px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 12px rgba(59,122,255,0.15)',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
          title="Show panels again (W)"
        >
          📡 Show Panels
        </button>
      )}
    </div>
  );
}
