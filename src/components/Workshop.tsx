import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { Agent, SubAgent, ActivityEvent } from '../types';
import AgentWorkshop3D from './AgentWorkshop3D';
import { useWebGLSupport } from '../hooks/useWebGLSupport';

interface Props {
  agents: Agent[];
  subAgents?: SubAgent[];
  activities?: ActivityEvent[];
  onSwitchToMonitor?: (agentId?: string) => void;
}

type AgentState = 'working' | 'idle' | 'thinking';

function getAgentState(agent: Agent): AgentState {
  if (agent.status === 'active') return 'working';
  if (agent.status === 'thinking') return 'thinking';
  return 'idle';
}

// Animated status indicator dot for the workshop header
// Activity heatmap dot: tiny colored dot that pulses based on activity level
function ActivityHeatmapDot({ state, subAgentCount }: { state: AgentState; subAgentCount: number }) {
  const colors: Record<AgentState, string> = {
    working: '#34d399',
    thinking: '#fbbf24',
    idle: '#4a5580',
  };
  const color = colors[state];
  const intensity = state === 'working' ? 1 : state === 'thinking' ? 0.7 : 0.3;
  const glowSize = state === 'working' ? 6 : state === 'thinking' ? 4 : 2;
  return (
    <div
      title={`Activity: ${state}${subAgentCount > 0 ? ` · ${subAgentCount} sessions` : ''}`}
      style={{
        width: `${8 + subAgentCount * 2}px`,
        height: '8px',
        borderRadius: '4px',
        background: `linear-gradient(90deg, ${color}${Math.round(intensity * 200).toString(16).padStart(2, '0')} 0%, ${color}${Math.round(intensity * 80).toString(16).padStart(2, '0')} 100%)`,
        border: `1px solid ${color}${Math.round(intensity * 180).toString(16).padStart(2, '0')}`,
        boxShadow: state !== 'idle' ? `0 0 ${glowSize}px ${color}55` : 'none',
        flexShrink: 0,
        transition: 'all 0.4s ease',
        cursor: 'default',
      }}
    />
  );
}

function StatusDot({ status }: { status: AgentState }) {
  const colors: Record<AgentState, string> = { working: 'var(--green)', thinking: 'var(--yellow)', idle: 'var(--text-muted)' };
  const label: Record<AgentState, string> = { working: 'active', thinking: 'thinking', idle: 'idle' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '10px', color: colors[status], fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500,
    }}>
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%', background: colors[status],
        boxShadow: status !== 'idle' ? `0 0 5px ${colors[status]}` : 'none',
        animation: status === 'thinking' ? 'pulse-yellow 1s infinite' : status === 'working' ? 'pulse-green 2s infinite' : 'none',
        flexShrink: 0,
      }} />
      {label[status]}
    </span>
  );
}

// LiveElapsedDisplay: shows elapsed time that ticks every 5 seconds for the selected agent drawer
function LiveElapsedDisplay({ startedAt }: { startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const elapsedSecs = Math.floor((Date.now() - startedAt) / 1000);
  const fmt = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  };
  const color = elapsedSecs > 3600 ? 'var(--red)' : elapsedSecs > 1800 ? 'var(--yellow)' : 'var(--cyan)';
  return (
    <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color }} title={`Started: ${new Date(startedAt).toLocaleTimeString()}`}>
      ⏱ {fmt(elapsedSecs)}
    </span>
  );
}

function WorkshopDesk({
  agent,
  position,
  subAgents = [],
}: {
  agent: Agent;
  position: 'left' | 'center' | 'right';
  subAgents?: SubAgent[];
}) {
  const state = getAgentState(agent);
  const colorMap = {
    dev: 'var(--dev)',
    pi: 'var(--pi)',
    gemini: 'var(--gemini)',
  };
  const accentColor = colorMap[agent.runtime];
  const isWorking = state === 'working';
  const isThinking = state === 'thinking';

  // Find active task for this agent to show elapsed time
  const activeTask = subAgents.find(sa =>
    (sa.sessionKey?.includes(agent.id) || sa.taskName?.includes(agent.name || '')) &&
    (sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active'))
  );

  return (
    <div
      className={`workshop-desk workshop-desk--${position}`}
      style={{ '--agent-accent': accentColor } as CSSProperties}
    >
      {/* Activity pulse ring for active agents */}
      {(isWorking || isThinking) && (
        <div className={`wd-pulse-ring ${state === 'working' ? 'wd-pulse-ring--work' : 'wd-pulse-ring--think'}`} />
      )}
      {/* Desk surface */}
      <div className="wd-surface">
        {/* Monitor */}
        <div className={`wd-monitor ${isWorking ? 'wd-monitor--working' : ''} ${isThinking ? 'wd-monitor--thinking' : ''}`}>
          <div className="wd-screen-content">
            {isWorking && <div className="wd-code-lines" />}
            {isThinking && <div className="wd-thought-bubble" />}
            {!isWorking && !isThinking && <div className="wd-idle-screen" />}
          </div>
        </div>

        {/* Keyboard */}
        <div className="wd-keyboard">
          {isWorking && (
            <>
              <div className="wd-key wd-key--active" style={{ animationDelay: '0ms' }} />
              <div className="wd-key wd-key--active" style={{ animationDelay: '80ms' }} />
              <div className="wd-key wd-key--active" style={{ animationDelay: '160ms' }} />
            </>
          )}
          {[...Array(6)].map((_, i) => (
            <div key={i} className="wd-key" style={{ animationDelay: `${i * 40}ms` }} />
          ))}
        </div>

        {/* Mug */}
        <div className="wd-mug" />
      </div>

      {/* Chair */}
      <div className={`wd-chair ${isWorking ? 'wd-chair--working' : ''}`}>
        <div className="wd-chair-back" />
        <div className="wd-chair-seat" />
        <div className="wd-chair-base" />
      </div>

      {/* Agent avatar at desk */}
      <div
        className={`workshop-agent workshop-agent--${state}`}
        data-runtime={agent.runtime}
      >
        {/* Head */}
        <div className="wa-head">
          <div className="wa-eye left" />
          <div className="wa-eye right" />
          <div className="wa-mouth" />
          {isThinking && <div className="wa-thought" />}
        </div>
        {/* Body */}
        <div className="wa-body">
          <div className="wa-arm left" />
          <div className="wa-arm right" />
          {isWorking && <div className="wa-laptop" />}
        </div>
        {/* Legs */}
        <div className="wa-leg left" />
        <div className="wa-leg right" />
      </div>

      {/* Name badge */}
      <div className="wa-label">
        <span className="wa-name">{agent.name}</span>
        <span className={`wa-state-badge wa-state-badge--${state}`}>{state}</span>
        {isWorking && activeTask?.startedAt && (
          <LiveAgentElapsed startedAt={activeTask.startedAt} />
        )}
      </div>
    </div>
  );
}

function LoungeArea() {
  return (
    <div className="workshop-lounge">
      {/* Couch */}
      <div className="wl-couch">
        <div className="wl-couch-back" />
        <div className="wl-couch-seat">
          <div className="wl-cushion" />
          <div className="wl-cushion" />
        </div>
        <div className="wl-couch-arm left" />
        <div className="wl-couch-arm right" />
      </div>
      {/* Coffee table */}
      <div className="wl-table">
        <div className="wl-table-top" />
        <div className="wl-table-leg left" />
        <div className="wl-table-leg right" />
      </div>
      {/* Plant */}
      <div className="wl-plant">
        <div className="wl-pot" />
        <div className="wl-leaves">
          <div className="wl-leaf wl-leaf--1" />
          <div className="wl-leaf wl-leaf--2" />
          <div className="wl-leaf wl-leaf--3" />
        </div>
      </div>
    </div>
  );
}

// Pre-computed deterministic book layout — avoids Math.random() in render (React anti-pattern)
const BOOKSHELF_BOOKS: { height: number; gradientIdx: number }[][] = [
  [{ height: 24, gradientIdx: 0 }, { height: 30, gradientIdx: 1 }, { height: 20, gradientIdx: 2 }, { height: 27, gradientIdx: 3 }, { height: 22, gradientIdx: 4 }],
  [{ height: 28, gradientIdx: 5 }, { height: 19, gradientIdx: 0 }, { height: 32, gradientIdx: 1 }, { height: 23, gradientIdx: 2 }, { height: 26, gradientIdx: 3 }],
  [{ height: 21, gradientIdx: 4 }, { height: 29, gradientIdx: 5 }, { height: 18, gradientIdx: 0 }, { height: 31, gradientIdx: 1 }, { height: 25, gradientIdx: 2 }],
];
const BOOK_GRADIENTS = [
  'linear-gradient(135deg, #7c3aed, #5b21b6)',
  'linear-gradient(135deg, #059669, #047857)',
  'linear-gradient(135deg, #dc2626, #b91c1c)',
  'linear-gradient(135deg, #d97706, #b45309)',
  'linear-gradient(135deg, #2563eb, #1d4ed8)',
  'linear-gradient(135deg, #db2777, #be185d)',
];

function Bookshelf() {
  return (
    <div className="workshop-shelf">
      {BOOKSHELF_BOOKS.map((shelf, shelfIdx) => (
        <div key={shelfIdx} className="ws-row">
          {shelf.map((book, bookIdx) => (
            <div
              key={bookIdx}
              className="ws-book"
              style={{
                height: `${book.height}px`,
                background: BOOK_GRADIENTS[book.gradientIdx],
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Window() {
  return (
    <div className="workshop-window">
      <div className="ww-frame">
        <div className="ww-pane" />
        <div className="ww-pane" />
        <div className="ww-pane" />
        <div className="ww-pane" />
      </div>
      <div className="ww-sill" />
      <div className="ww-light" />
    </div>
  );
}

// Live session bar: self-ticking elapsed time display for the session timeline
// Updates every second independently so the parent doesn't need to re-render constantly
function LiveSessionBar({ sa }: { sa: SubAgent }) {
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(sa.startedAt || null);
  useEffect(() => {
    if (!sa.startedAt) return;
    startedAtRef.current = sa.startedAt;
    const update = () => setElapsed(Math.floor((Date.now() - (startedAtRef.current || 0)) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [sa.startedAt]);

  const maxAge = 60 * 60;
  const pct = Math.min((elapsed / maxAge) * 100, 100);
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
  const rtColor = sa.runtime === 'dev' ? 'var(--dev)' : sa.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)';
  const label = elapsed < 60 ? `${elapsed}s` : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m` : `${(elapsed / 3600).toFixed(1)}h`;
  const startedAtLabel = sa.startedAt ? new Date(sa.startedAt).toLocaleTimeString() : null;
  const tooltip = `${sa.taskName || sa.sessionKey || 'session'} — ${label}${startedAtLabel ? ` · started ${startedAtLabel}` : ''}`;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '60px', cursor: 'pointer' }}
      title={tooltip}
      onClick={() => { if (sa.sessionKey) window.dispatchEvent(new CustomEvent('mc:selectSession', { detail: { sessionKey: sa.sessionKey } })); }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: rtColor, boxShadow: `0 0 4px ${rtColor}`, flexShrink: 0 }} />
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50px' }}>
          {sa.taskName ? (sa.taskName.length > 10 ? sa.taskName.slice(0, 10) + '…' : sa.taskName) : (sa.sessionKey?.slice(0, 6) || '—')}
        </span>
        <span style={{ fontSize: '8px', color, fontFamily: "'JetBrains Mono', monospace", marginLeft: 'auto', flexShrink: 0 }}>
          {label}
        </span>
      </div>
      <div style={{ height: '3px', background: 'var(--bg-deep)', borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 1s linear' }} />
        {pct > 50 && (
          <div style={{
            position: 'absolute', top: 0, right: 0,
            width: `${Math.min((pct - 50) * 2, 100)}%`, height: '100%',
            background: pct > 80 ? 'rgba(248,113,113,0.6)' : 'rgba(251,191,36,0.5)',
            borderRadius: '0 2px 2px 0',
            animation: pct > 80 ? 'pulse-red 1s infinite' : 'pulse-yellow 1.5s infinite',
          }} />
        )}
      </div>
    </div>
  );
}

// Live elapsed time for an agent's active task — ticks every second
function LiveAgentElapsed({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  const fmt = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  };
  return (
    <span
      title={`Task running for ${fmt(elapsed)}`}
      style={{
        fontSize: '9px',
        fontFamily: "'JetBrains Mono', monospace",
        color: elapsed > 1800 ? 'var(--yellow)' : 'var(--text-muted)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '1px 5px',
        flexShrink: 0,
        letterSpacing: '0.2px',
      }}
    >
      {fmt(elapsed)}
    </span>
  );
}

// Task progress arc: CSS conic-gradient that animates based on session elapsed time
function TaskProgressArc({ agentName, subAgents }: { agentName: string; subAgents: SubAgent[] }) {
  const [progress, setProgress] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const related = subAgents.filter(sa =>
      sa.sessionKey?.includes(agentName) || sa.taskName?.includes(agentName)
    );
    const activeTask = related.find(sa =>
      sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active')
    );
    if (!activeTask?.startedAt) {
      setProgress(0);
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = activeTask.startedAt;
    const update = () => {
      if (!startedAtRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      const maxAge = 30 * 60 * 1000;
      setProgress(Math.min((elapsed / maxAge) * 100, 100));
    };
    update();
    const t = setInterval(update, 3000);
    return () => clearInterval(t);
  }, [agentName, subAgents]);
  if (progress === 0) return null;
  const color = progress > 80 ? 'var(--red)' : progress > 50 ? 'var(--yellow)' : 'var(--green)';
  return (
    <div
      className="task-progress-arc"
      title={`Task progress: ${Math.round(progress)}%`}
      style={{
        width: '14px', height: '14px', borderRadius: '50%',
        background: `conic-gradient(${color} ${progress}%, rgba(255,255,255,0.08) 0%)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, boxShadow: `0 0 6px ${color}66`,
        animation: 'task-arc-spin 3s linear infinite',
      }}
    >
      <style>{`@keyframes task-arc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function Workshop({ agents, subAgents = [], activities = [], onSwitchToMonitor }: Props) {
  // Persist scene mode to localStorage so 2D view survives reload
  const [viewMode, setViewMode] = useState<'3d' | '2d'>(() => {
    try { return (localStorage.getItem('mc_scene_mode') as '3d' | '2d') || '3d'; } catch { return '3d'; }
  });
  const handleViewModeChange = (mode: '3d' | '2d') => {
    setViewMode(mode);
    try { localStorage.setItem('mc_scene_mode', mode); } catch {}
  };
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const webglSupported = useWebGLSupport();

  // Derive per-agent states + sub-agent counts for the header strip
  const agentStates = agents.map(a => ({
    id: a.id,
    name: a.name,
    state: getAgentState(a),
    runtime: a.runtime,
    subAgentCount: subAgents.filter(sa =>
      sa.sessionKey?.includes(a.id) || sa.taskName?.includes(a.name || '')
    ).length,
    currentTask: subAgents.find(sa =>
      (sa.sessionKey?.includes(a.id) || sa.taskName?.includes(a.name || '')) &&
      (sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active'))
    )?.taskName,
  }));

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;
  const selectedSubAgents = selectedAgent ? subAgents.filter(sa =>
    sa.sessionKey?.includes(selectedAgent.id) || sa.taskName?.includes(selectedAgent.name || '')
  ) : [];

  const handleAgentHover = (taskName?: string, mouseEvent?: React.MouseEvent) => {
    if (mouseEvent) {
      setHoverPos({ x: mouseEvent.clientX + 12, y: mouseEvent.clientY - 8 });
    }
    setHoveredTask(taskName || null);
  };

  const handleAgentLeave = () => {
    setHoveredTask(null);
    setHoverPos(null);
  };

  const handleInspect3D = () => {
    // Focus is already handled by selectedAgentId being set
    // The parent can also pass this to the 3D scene
    window.dispatchEvent(new CustomEvent('workshop:inspect-agent', { detail: { agentId: selectedAgentId } }));
  };

  const handleSendToMonitor = () => {
    onSwitchToMonitor?.(selectedAgentId || undefined);
  };

  return (
    <div className="workshop-wrapper">
      {/* Agent status strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        background: 'rgba(15,22,41,0.6)', flexWrap: 'wrap',
      }}>
        {agentStates.map(a => {
          const isSelected = selectedAgentId === agents.find(ag => ag.name === a.name)?.id;
          return (
            <div
              key={a.name}
              ref={stripRef}
              className={`workshop-strip-agent${isSelected ? ' workshop-strip-agent--selected' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 8px', borderRadius: '6px', transition: 'all 0.2s', position: 'relative' }}
              onClick={() => setSelectedAgentId(prev => prev === agents.find(ag => ag.name === a.name)?.id ? null : agents.find(ag => ag.name === a.name)?.id || null)}
              onMouseEnter={(e) => handleAgentHover(a.currentTask, e)}
              onMouseLeave={handleAgentLeave}
            >
              <span style={{ fontSize: '13px' }}>
                {a.runtime === 'dev' ? '🤖' : a.runtime === 'pi' ? '🧠' : '✨'}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'Space Grotesk', sans-serif" }}>
                {a.name}
              </span>
              {a.subAgentCount > 0 && (
                <span className="agent-subagent-count" title={`${a.subAgentCount} active session${a.subAgentCount > 1 ? 's' : ''}`}>
                  ×{a.subAgentCount}
                </span>
              )}
              <StatusDot status={a.state} />
              {/* Activity heatmap dot — intensity based on sub-agent count */}
              <ActivityHeatmapDot state={a.state} subAgentCount={a.subAgentCount} />
              {/* Thinking floating dots */}
              {a.state === 'thinking' && (
                <span className="thinking-dots">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </span>
              )}
              {/* Typing indicator for active agents */}
              {a.state === 'working' && (
                <span className="typing-indicator">
                  <span className="typing-bar" />
                  <span className="typing-bar" />
                  <span className="typing-bar" />
                </span>
              )}
              {/* Task progress arc — shown when agent has a currentTask */}
              {a.currentTask && a.state === 'working' && (
                <TaskProgressArc agentName={a.name} subAgents={subAgents} />
              )}
              {/* Elapsed time for the current task */}
              {a.currentTask && a.state === 'working' && (() => {
                const activeSa = subAgents.find(sa =>
                  (sa.sessionKey?.includes(a.name) || sa.taskName?.includes(a.name)) &&
                  (sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active'))
                );
                if (!activeSa?.startedAt) return null;
                return <LiveAgentElapsed startedAt={activeSa.startedAt} />;
              })()}
            </div>
          );
        })}
        {/* Task preview tooltip */}
        {hoverPos && hoveredTask && (
          <div
            className="workshop-strip-tooltip"
            style={{ left: hoverPos.x, top: hoverPos.y }}
          >
            <div>Task:</div>
            <div className="workshop-strip-tooltip-task">{hoveredTask}</div>
          </div>
        )}
        {!webglSupported && (
          <span style={{ fontSize: '10px', color: 'var(--yellow)', marginLeft: 'auto', fontFamily: "'Space Grotesk', sans-serif" }}>
            WebGL unavailable — using 2D view
          </span>
        )}
        {/* Live total sessions badge — always visible */}
        {subAgents.length > 0 && (
          <span
            title={`${subAgents.length} total session${subAgents.length !== 1 ? 's' : ''} running`}
            style={{
              fontSize: '10px', fontWeight: 600,
              color: 'var(--cyan)',
              background: 'rgba(34,211,238,0.08)',
              border: '1px solid rgba(34,211,238,0.22)',
              borderRadius: '8px', padding: '2px 7px',
              fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: '0 0 6px rgba(34,211,238,0.15)',
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: '4px',
              animation: 'badge-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <span style={{ fontSize: '11px', lineHeight: 1 }}>🔗</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{subAgents.length}</span>
            <span style={{ color: 'rgba(34,211,238,0.6)', fontSize: '9px' }}>session{subAgents.length !== 1 ? 's' : ''}</span>
          </span>
        )}
        {/* Max sessions warning — shown when 4+ sessions running */}
        {subAgents.length >= 4 && (
          <span
            title={`${subAgents.length} sessions running — approaching limit`}
            style={{
              fontSize: '10px', fontWeight: 700,
              color: subAgents.length >= 5 ? 'var(--red)' : 'var(--yellow)',
              background: subAgents.length >= 5 ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.12)',
              border: `1px solid ${subAgents.length >= 5 ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.35)'}`,
              borderRadius: '8px', padding: '2px 7px',
              fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: subAgents.length >= 5 ? '0 0 8px rgba(248,113,113,0.25)' : '0 0 6px rgba(251,191,36,0.2)',
              animation: subAgents.length >= 5 ? 'pulse-red 1.5s infinite' : 'none',
              flexShrink: 0,
            }}
          >
            ⚠ {subAgents.length}/5 sessions
          </span>
        )}
        {/* View mode toggle — always visible in the strip */}
        <div style={{ display: 'flex', gap: '3px', marginLeft: 'auto', background: 'var(--bg-input)', borderRadius: '7px', padding: '2px', border: '1px solid var(--border)' }}>
          {(['3d', '2d'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => handleViewModeChange(mode)}
              style={{
                background: viewMode === mode ? 'rgba(59,122,255,0.2)' : 'transparent',
                border: '1px solid ' + (viewMode === mode ? '#3b7aff' : 'transparent'),
                borderRadius: '5px', color: viewMode === mode ? '#3b7aff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600, padding: '3px 10px', letterSpacing: '0.3px',
                transition: 'all 0.2s',
              }}
            >
              {mode === '3d' ? '◈ 3D' : '⊞ 2D'}
            </button>
          ))}
        </div>
      </div>

      {/* Workshop live event strip — last 3 activity events */}
      {activities.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '4px 14px', borderBottom: '1px solid var(--border)',
          background: 'rgba(10,14,26,0.4)', overflowX: 'auto',
          height: '10px', minHeight: '10px',
        }}>
          {activities.slice(0, 3).map((ev) => {
            const icon = ev.event === 'started' ? '▶' : ev.event === 'thinking' ? '💭' : ev.event === 'error' ? '✕' : ev.event === 'system' ? '⚙' : '✓';
            const text = (ev.detail || `${ev.agentName} ${ev.event}`).slice(0, 20);
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                <span style={{ fontSize: '8px' }}>{icon}</span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {text}
                </span>
              </div>
            );
          })}
          {activities.length > 3 && (
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", flexShrink: 0 }}>
              +{activities.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* 3D / 2D Workshop Scene */}
      <div style={{ height: '380px', position: 'relative' }}>
        {/* Agent detail drawer */}
        <div className={`agent-detail-drawer ${selectedAgentId ? 'open' : ''}`}>
          {selectedAgent && (
            <>
              <div className="agent-detail-drawer-header">
                <div className="agent-detail-drawer-title">
                  <span style={{ fontSize: '18px' }}>
                    {selectedAgent.runtime === 'dev' ? '🤖' : selectedAgent.runtime === 'pi' ? '🧠' : '✨'}
                  </span>
                  <span>{selectedAgent.name}</span>
                </div>
                <button
                  className="agent-detail-drawer-close"
                  onClick={() => setSelectedAgentId(null)}
                >
                  ✕
                </button>
              </div>

              <div className="agent-detail-drawer-section">
                <div className="agent-detail-drawer-label">Runtime</div>
                <span className="runtime-badge" style={{ '--rt-color': selectedAgent.runtime === 'dev' ? 'var(--dev)' : selectedAgent.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)' } as React.CSSProperties}>
                  {selectedAgent.runtime === 'pi' ? 'Pi' : selectedAgent.runtime.charAt(0).toUpperCase() + selectedAgent.runtime.slice(1)}
                </span>
              </div>

              <div className="agent-detail-drawer-section">
                <div className="agent-detail-drawer-label">Status</div>
                <span className={`wa-state-badge wa-state-badge--${getAgentState(selectedAgent)}`}>
                  {getAgentState(selectedAgent)}
                </span>
              </div>

              {/* Live task + elapsed ticker — shown when agent is actively working/thinking */}
              {selectedSubAgents.length > 0 && (() => {
                const active = selectedSubAgents.find(sa =>
                  sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active') || sa.status?.toLowerCase().includes('think')
                );
                const mostRecent = [...selectedSubAgents].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
                const display = active || mostRecent;
                if (!display) return null;
                return (
                  <div className="agent-detail-drawer-section">
                    <div className="agent-detail-drawer-label">
                      {active ? 'Current Task' : 'Most Recent Session'}
                    </div>
                    <div style={{
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      borderRadius: '8px', padding: '8px 10px', marginTop: '4px',
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.5, marginBottom: '6px', wordBreak: 'break-word' }}>
                        {display.taskName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No task description</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: display.status?.toLowerCase().includes('think') ? 'var(--yellow)' : display.status?.toLowerCase().includes('error') ? 'var(--red)' : 'var(--green)' }}>
                          {display.status || 'idle'}
                        </span>
                        {display.startedAt && (
                          <LiveElapsedDisplay startedAt={display.startedAt} />
                        )}
                        {display.tokenUsage && (
                          <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--green)' }}>
                            ⚡ {display.tokenUsage >= 1000 ? `${(display.tokenUsage / 1000).toFixed(1)}k` : display.tokenUsage} tokens
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="agent-detail-drawer-section">
                <div className="agent-detail-drawer-label">
                  Sub-Agent Sessions ({selectedSubAgents.length})
                </div>
                {selectedSubAgents.length > 0 ? (
                  <div className="agent-detail-drawer-sessions">
                    {selectedSubAgents.map((sa, i) => (
                      <div key={sa.sessionKey || i} className="agent-detail-session-item">
                        <span className="agent-detail-session-name" title={sa.taskName}>
                          {sa.taskName ? (sa.taskName.length > 25 ? sa.taskName.slice(0, 25) + '…' : sa.taskName) : '—'}
                        </span>
                        <span className={`agent-detail-session-status agent-detail-session-status--${sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active') ? 'active' : sa.status?.toLowerCase().includes('think') ? 'thinking' : sa.status?.toLowerCase().includes('error') || sa.status?.toLowerCase().includes('fail') ? 'error' : 'idle'}`}>
                          {sa.status || 'idle'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                    No active sessions
                  </div>
                )}
              </div>

              <div className="agent-detail-actions">
                <button className="agent-detail-action-btn agent-detail-action-btn--primary" onClick={handleInspect3D}>
                  🔍 Inspect in 3D
                </button>
                <button className="agent-detail-action-btn agent-detail-action-btn--secondary" onClick={handleSendToMonitor}>
                  📡 Send to Monitor
                </button>
              </div>
            </>
          )}
        </div>
        {agents.length === 0 ? (
          <div className="workshop-skeleton">
            <span className="workshop-skeleton-icon">🕹️</span>
            <span className="workshop-skeleton-text">Loading workshop…</span>
          </div>
        ) : !webglSupported ? (
          <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '12px',
            background: 'radial-gradient(ellipse at 50% 0%, #0d1f3c 0%, #0a0e1a 55%, #080c14 100%)',
            color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif",
          }}>
            <span style={{ fontSize: '36px', opacity: 0.4 }}>🌐</span>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>WebGL not available</div>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>3D scene requires WebGL support</div>
          </div>
        ) : (
          <AgentWorkshop3D
            agents={agents}
            subAgents={subAgents}
            viewMode={webglSupported ? viewMode : '2d'}
            onViewModeChange={setViewMode}
            externalSelectedAgentId={selectedAgentId}
            onExternalSelectAgent={setSelectedAgentId}
          />
        )}
      </div>

      {/* Session age timeline — shows all sub-agents as colored bars relative to the 60-min session max */}
      {subAgents.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 14px', borderTop: '1px solid var(--border)',
          background: 'rgba(10,14,26,0.4)', overflowX: 'auto',
        }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap', flexShrink: 0 }}>
            SESSIONS
          </span>
          {/* Token + session summary at the left of the strip */}
          <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--green)', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '10px', padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            ⚡ {(() => {
              const total = subAgents.reduce((s, sa) => s + (sa.tokenUsage || 0), 0);
              return total >= 1000000 ? `${(total / 1000000).toFixed(1)}M` : total >= 1000 ? `${(total / 1000).toFixed(0)}k` : String(total);
            })()} tokens
          </span>
          <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--cyan)', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: '10px', padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {subAgents.length} sess{subAgents.length !== 1 ? 'ions' : 'ion'}
          </span>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flex: 1, overflowX: 'auto', paddingBottom: '1px' }}>
            {subAgents.map((sa, i) => (
              <LiveSessionBar key={sa.sessionKey || String(i)} sa={sa} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Export CSS-based scene components for potential reuse (kept as-is)
export { WorkshopDesk, LoungeArea, Bookshelf, Window };
