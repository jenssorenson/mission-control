import { useState, useEffect, useRef } from 'react';
import type { Agent, SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Agent Capability Registry ─────────────────────────────────────────────────

interface AgentCapability {
  icon: string;
  label: string;
  description: string;
}

interface AgentProfile {
  id: string;
  name: string;
  runtime: 'dev' | 'pi' | 'gemini';
  role: string;
  tagline: string;
  capabilities: AgentCapability[];
  color: string;
  accentColor: string;
}

const AGENT_PROFILES: Record<string, AgentProfile> = {
  dev: {
    id: 'dev',
    name: 'Dev Agent',
    runtime: 'dev',
    role: 'Software Development',
    tagline: 'Coding, debugging, and building features',
    color: '#6ee7b7',
    accentColor: 'rgba(110,231,183,0.12)',
    capabilities: [
      { icon: '🔧', label: 'Code Writing', description: 'Write, refactor, and optimize code' },
      { icon: '🐛', label: 'Bug Fixing', description: 'Investigate and fix issues' },
      { icon: '🔍', label: 'Code Review', description: 'Review PRs and suggest improvements' },
      { icon: '📦', label: 'Package Mgmt', description: 'Install, update, manage dependencies' },
      { icon: '🧪', label: 'Testing', description: 'Write and run tests' },
      { icon: '🚀', label: 'Deployments', description: 'Ship and monitor releases' },
    ],
  },
  pi: {
    id: 'pi',
    name: 'Pi',
    runtime: 'pi',
    role: 'Personal Intelligence',
    tagline: 'Your always-on personal AI assistant',
    color: '#c4b5fd',
    accentColor: 'rgba(196,181,253,0.12)',
    capabilities: [
      { icon: '💬', label: 'Conversation', description: 'Natural, empathetic dialogue' },
      { icon: '📅', label: 'Scheduling', description: 'Calendar and time management' },
      { icon: '📝', label: 'Writing', description: 'Drafts, emails, documents' },
      { icon: '🔎', label: 'Research', description: 'Web search and synthesis' },
      { icon: '💡', label: 'Brainstorm', description: 'Ideas and creative exploration' },
      { icon: '🧠', label: 'Memory', description: 'Long-term context retention' },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    runtime: 'gemini',
    role: 'Research & Analysis',
    tagline: 'Deep research and multi-modal reasoning',
    color: '#fde68a',
    accentColor: 'rgba(253,230,138,0.12)',
    capabilities: [
      { icon: '🔬', label: 'Deep Research', description: 'Comprehensive web research' },
      { icon: '📊', label: 'Data Analysis', description: 'Interpret charts, tables, data' },
      { icon: '📸', label: 'Vision', description: 'Analyze images and screenshots' },
      { icon: '🌐', label: 'Translation', description: 'Cross-language understanding' },
      { icon: '📚', label: 'Summarize', description: 'Long documents → key insights' },
      { icon: '⚡', label: 'Fast Thinking', description: 'Rapid large-context reasoning' },
    ],
  },
};

function formatDuration(secs: number): string {
  if (!secs || secs < 0) return '—';
  if (secs < 60) return `${Math.floor(secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}k`;
  return String(tokens);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase() || 'idle';
  let color = 'var(--text-muted)';
  let label = 'Idle';
  let glow = false;
  if (s.includes('active') || s.includes('run')) {
    color = 'var(--green)'; label = 'Active'; glow = true;
  } else if (s.includes('think')) {
    color = 'var(--yellow)'; label = 'Thinking'; glow = true;
  } else if (s.includes('error') || s.includes('fail') || s.includes('dead')) {
    color = 'var(--red)'; label = 'Error';
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '10px', fontWeight: 600,
      color, background: `${color}14`,
      border: `1px solid ${color}44`,
      borderRadius: '10px', padding: '2px 8px',
      boxShadow: glow ? `0 0 6px ${color}44` : 'none',
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%',
        background: color, flexShrink: 0,
        boxShadow: glow ? `0 0 4px ${color}` : 'none',
      }} />
      {label}
    </span>
  );
}

function CapabilityChip({ cap }: { cap: AgentCapability }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '3px 7px',
        cursor: 'default',
        transition: 'all 0.15s',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <span style={{ fontSize: '9px' }}>{cap.icon}</span>
      <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'Space Grotesk', sans-serif" }}>
        {cap.label}
      </span>
      {expanded && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '6px 10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap', zIndex: 50,
          fontSize: '10px', color: 'var(--text-secondary)',
          fontFamily: "'Space Grotesk', sans-serif",
          pointerEvents: 'none',
        }}>
          {cap.description}
          <div style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: '0', height: '0',
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: `5px solid var(--border)`,
          }} />
        </div>
      )}
    </div>
  );
}

interface AgentStats {
  totalSessions: number;
  totalTokens: number;
  totalRuntimeSecs: number;
  completedTasks: number;
  errors: number;
}

function calcAgentStats(agentId: string, subAgents: SubAgent[]): AgentStats {
  const sessions = subAgents.filter(sa =>
    sa.sessionKey?.includes(agentId) ||
    sa.taskName?.includes(agentId) ||
    (agentId === 'dev' && sa.runtime === 'dev') ||
    (agentId === 'pi' && sa.runtime === 'pi') ||
    (agentId === 'gemini' && sa.runtime === 'gemini')
  );
  const now = Date.now();
  const totalRuntimeSecs = sessions.reduce((sum, sa) => {
    const elapsed = sa.startedAt ? (now - sa.startedAt) / 1000 : 0;
    return sum + elapsed;
  }, 0);
  return {
    totalSessions: sessions.length,
    totalTokens: sessions.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0),
    totalRuntimeSecs,
    completedTasks: 0,
    errors: 0,
  };
}

// Cost estimate for tokens
function fmtCost(tokens: number, runtime: string): string {
  const MODEL_PRICING: Record<string, [number, number]> = {
    dev: [0.50, 1.50], pi: [0.35, 1.05], gemini: [0.35, 1.05], default: [0.50, 1.50],
  };
  const [inp, out] = MODEL_PRICING[runtime] ?? MODEL_PRICING.default;
  const outputToks = Math.round(tokens * 0.30);
  const inputToks = tokens - outputToks;
  const cost = (inputToks / 1_000_000) * inp + (outputToks / 1_000_000) * out;
  if (cost < 0.001) return `${(cost * 1000).toFixed(1)}¢`;
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

function AgentCard({ agent, subAgents, expanded, onToggle }: {
  agent: Agent;
  subAgents: SubAgent[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const profile = AGENT_PROFILES[agent.id] ?? AGENT_PROFILES.dev;
  const stats = calcAgentStats(agent.id, subAgents);
  const activeSessions = subAgents.filter(sa =>
    (agent.id === 'dev' && sa.runtime === 'dev') ||
    (agent.id === 'pi' && sa.runtime === 'pi') ||
    (agent.id === 'gemini' && sa.runtime === 'gemini')
  );
  const currentTask = activeSessions.find(sa =>
    sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active')
  );
  const currentThinking = activeSessions.find(sa =>
    sa.status?.toLowerCase().includes('think')
  );
  const totalCost = activeSessions.reduce((sum, sa) => {
    const tokens = sa.tokenUsage || 0;
    return sum + (tokens > 0 ? parseFloat(fmtCost(tokens, sa.runtime || 'dev').replace(/[$]/g, '').replace(/¢/g, '').replace(/,/g, '') || '0') : 0);
  }, 0);

  return (
    <div
      style={{
        background: profile.accentColor,
        border: `1px solid ${profile.color}33`,
        borderRadius: '14px',
        overflow: 'hidden',
        transition: 'all 0.2s',
        boxShadow: agent.status !== 'idle' ? `0 0 12px ${profile.color}22` : 'none',
      }}
    >
      {/* Card Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px',
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        {/* Agent avatar */}
        <div style={{
          width: '38px', height: '38px', borderRadius: '10px',
          background: `linear-gradient(135deg, ${profile.color}33, ${profile.color}11)`,
          border: `1px solid ${profile.color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', flexShrink: 0,
          boxShadow: `0 0 10px ${profile.color}22`,
        }}>
          {agent.id === 'dev' ? '💻' : agent.id === 'pi' ? '🧠' : '✨'}
        </div>

        {/* Agent identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '13px', fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              {profile.name}
            </span>
            <span style={{
              fontSize: '9px', fontWeight: 600,
              color: profile.color,
              background: `${profile.color}14`,
              border: `1px solid ${profile.color}33`,
              borderRadius: '8px', padding: '1px 5px',
              textTransform: 'uppercase', letterSpacing: '0.4px',
            }}>
              {profile.role}
            </span>
            <StatusBadge status={agent.status} />
          </div>
          <div style={{
            fontSize: '10px', color: 'var(--text-muted)',
            fontFamily: "'Space Grotesk', sans-serif",
            marginTop: '2px',
          }}>
            {profile.tagline}
          </div>
        </div>

        {/* Session count */}
        {activeSessions.length > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '4px 8px', flexShrink: 0,
          }}>
            <span style={{
              fontSize: '16px', fontWeight: 800,
              color: profile.color,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1,
            }}>
              {activeSessions.length}
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              active
            </span>
          </div>
        )}

        {/* Expand chevron */}
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▼
        </span>
      </div>

      {/* Current task banner */}
      {currentTask && (
        <div style={{
          margin: '0 14px 8px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '6px 10px',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span style={{ fontSize: '9px', color: 'var(--green)', flexShrink: 0 }}>▶</span>
          <span style={{
            fontSize: '10px', color: 'var(--text-secondary)',
            fontFamily: "'Space Grotesk', sans-serif",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {currentTask.taskName || 'Running task…'}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
            {formatTokens(currentTask.tokenUsage)} tok
          </span>
        </div>
      )}
      {currentThinking && !currentTask && (
        <div style={{
          margin: '0 14px 8px',
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: '8px', padding: '6px 10px',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span style={{ fontSize: '9px', color: 'var(--yellow)', flexShrink: 0 }}>💭</span>
          <span style={{
            fontSize: '10px', color: 'var(--text-secondary)',
            fontFamily: "'Space Grotesk', sans-serif",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>
            {currentThinking.taskName || 'Thinking…'}
          </span>
        </div>
      )}

      {/* Compact stats row */}
      <div style={{
        display: 'flex', gap: '0',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        padding: '6px 14px',
      }}>
        {[
          { label: 'Sessions', value: String(activeSessions.length), color: 'var(--accent)' },
          { label: 'Tokens', value: formatTokens(stats.totalTokens), color: 'var(--green)' },
          { label: 'Runtime', value: formatDuration(stats.totalRuntimeSecs), color: 'var(--cyan)' },
          { label: 'Est. Cost', value: stats.totalTokens > 0 ? fmtCost(stats.totalTokens, agent.runtime) : '—', color: 'var(--yellow)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', padding: '3px 4px' }}>
            <div style={{
              fontSize: '11px', fontWeight: 700, color,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {value}
            </div>
            <div style={{
              fontSize: '8px', color: 'var(--text-muted)',
              fontFamily: "'Space Grotesk', sans-serif",
              textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: '1px',
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded: capabilities */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${profile.color}22`,
          padding: '12px 14px',
          background: 'rgba(0,0,0,0.1)',
        }}>
          <div style={{
            fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            marginBottom: '8px', fontFamily: "'Space Grotesk', sans-serif",
          }}>
            Capabilities
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
            {profile.capabilities.map(cap => (
              <CapabilityChip key={cap.label} cap={cap} />
            ))}
          </div>

          {/* Active sessions list */}
          {activeSessions.length > 0 && (
            <>
              <div style={{
                fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                marginBottom: '8px', marginTop: '4px',
                fontFamily: "'Space Grotesk', sans-serif",
              }}>
                Active Sessions ({activeSessions.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {activeSessions.map((sa) => {
                  const elapsed = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
                  const tokenRate = elapsed > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsed) * 60) : null;
                  return (
                    <div key={sa.sessionKey} style={{
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                      borderRadius: '7px', padding: '6px 9px',
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                      <span style={{
                        fontSize: '9px', fontFamily: "'JetBrains Mono', monospace",
                        color: profile.color, flexShrink: 0,
                        minWidth: '60px',
                      }}>
                        {sa.sessionKey.slice(0, 10)}…
                      </span>
                      <span style={{
                        fontSize: '10px', color: 'var(--text-secondary)',
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}>
                        {sa.taskName || '—'}
                      </span>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatDuration(elapsed)}
                      </span>
                      <span style={{ fontSize: '9px', color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatTokens(sa.tokenUsage)}
                      </span>
                      {tokenRate !== null && (
                        <span style={{
                          fontSize: '9px', fontFamily: "'JetBrains Mono', monospace",
                          color: tokenRate > 1000 ? 'var(--yellow)' : 'var(--text-muted)',
                        }}>
                          {tokenRate}/m
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {activeSessions.length === 0 && (
            <div style={{
              fontSize: '10px', color: 'var(--text-muted)',
              fontFamily: "'Space Grotesk', sans-serif",
              textAlign: 'center', padding: '8px 0',
            }}>
              No active sessions
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  agents: Agent[];
  subAgents: SubAgent[];
}

// ─── Fleet-wide stats ───────────────────────────────────────────────────────────

function FleetSummary({ agents, subAgents }: { agents: Agent[]; subAgents: SubAgent[] }) {
  const totalTokens = subAgents.reduce((sum, sa) => sum + (sa.tokenUsage || 0), 0);
  const totalRuntimeSecs = subAgents.reduce((sum, sa) => {
    return sum + (sa.startedAt ? (Date.now() - sa.startedAt) / 1000 : 0);
  }, 0);
  const activeCount = agents.filter(a => a.status === 'active' || a.status === 'thinking').length;
  const totalCost = subAgents.reduce((sum, sa) => {
    const tokens = sa.tokenUsage || 0;
    const [inp, out] = (MODEL_PRICING[sa.runtime] ?? MODEL_PRICING.default);
    const cost = ((tokens * 0.70) / 1_000_000) * inp + ((tokens * 0.30) / 1_000_000) * out;
    return sum + cost;
  }, 0);

  const MODEL_PRICING: Record<string, [number, number]> = {
    dev: [0.50, 1.50], pi: [0.35, 1.05], gemini: [0.35, 1.05], default: [0.50, 1.50],
  };

  const costColor = totalCost > 5 ? 'var(--red)' : totalCost > 1 ? 'var(--yellow)' : 'var(--green)';
  const fmtCost = (d: number) => d < 0.01 ? `$${d.toFixed(3)}` : d < 1 ? `$${d.toFixed(2)}` : `$${d.toFixed(2)}`;

  return (
    <div style={{
      display: 'flex', gap: '12px', alignItems: 'center',
      background: 'rgba(59,122,255,0.06)', border: '1px solid rgba(59,122,255,0.15)',
      borderRadius: '10px', padding: '8px 14px',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>Fleet</span>
        {activeCount > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>{activeCount}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>active</span>
          </span>
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>All idle</span>
        )}
      </div>
      <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
      <div style={{ display: 'flex', gap: '14px' }}>
        {[
          { label: 'Total sessions', value: String(subAgents.length), color: 'var(--accent)' },
          { label: 'Total tokens', value: formatTokens(totalTokens), color: 'var(--green)' },
          { label: 'Total runtime', value: formatDuration(totalRuntimeSecs), color: 'var(--cyan)' },
          { label: 'Est. cost', value: totalCost > 0 ? fmtCost(totalCost) : '—', color: costColor },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AgentRegistry({ agents, subAgents }: Props) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'compact'>('cards');

  function toggleAgent(id: string) {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ErrorBoundary name="AgentRegistry">
      <div className="agent-registry-panel">
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '12px', gap: '10px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{
              margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700, color: 'var(--text-primary)',
            }}>
              🤖 Agent Registry
            </h3>
            <span style={{
              fontSize: '9px', color: 'var(--text-muted)',
              fontFamily: "'Space Grotesk', sans-serif",
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '1px 6px',
            }}>
              {agents.length} agents
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '2px' }}>
              {(['cards', 'compact'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: viewMode === mode ? 'rgba(59,122,255,0.15)' : 'transparent',
                    border: 'none', borderRadius: '6px',
                    color: viewMode === mode ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                    padding: '3px 8px',
                    fontFamily: "'Space Grotesk', sans-serif",
                    transition: 'all 0.15s',
                  }}
                >
                  {mode === 'cards' ? '▦ Cards' : '≡ Compact'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Fleet summary */}
        <FleetSummary agents={agents} subAgents={subAgents} />

        {/* Agent cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: viewMode === 'cards' ? 'repeat(auto-fill, minmax(280px, 1fr))' : '1fr',
          gap: '10px',
          marginTop: '12px',
        }}>
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              subAgents={subAgents}
              expanded={expandedAgents.has(agent.id)}
              onToggle={() => toggleAgent(agent.id)}
            />
          ))}
        </div>

        {agents.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '24px', color: 'var(--text-muted)',
            fontSize: '12px', fontFamily: "'Space Grotesk', sans-serif",
          }}>
            No agents configured
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
