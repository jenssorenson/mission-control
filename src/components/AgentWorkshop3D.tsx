import React, { useRef, useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────
type AgentStatus = 'active' | 'idle' | 'thinking' | 'offline';

interface SceneAgent extends Agent {
  sceneStatus: AgentStatus;
  subAgentCount: number;
  taskName?: string;
  startedAt?: number; // oldest active session startedAt
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Steampunk palette — warm copper / brass / aged iron tones
const STATUS_COLORS: Record<AgentStatus, string> = {
  active:  '#f59e0b',  // amber forge-fire
  idle:    '#cd7c2f',  // warm copper
  thinking:'#e8c46a',  // polished brass
  offline: '#3d2e1e',  // dark iron / dormant
};

const RUNTIME_COLORS: Record<string, string> = {
  dev:     '#f59e0b',  // amber brass
  pi:      '#fb923c',  // copper orange
  gemini:  '#e8c46a',  // pale brass
};

const AGENT_POSITIONS: [number, number, number][] = [
  [-4.5, 0, 0],
  [0, 0, 0],
  [4.5, 0, 0],
];

const COMMAND_BOARD_POS: [number, number, number] = [0, 2.8, -3.5];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mapAgentStatus(status: string | undefined): AgentStatus {
  if (!status) return 'idle';
  const s = status.toLowerCase();
  if (s.includes('run') || s.includes('active') || s.includes('busy')) return 'active';
  if (s.includes('think')) return 'thinking';
  if (s.includes('offline') || s.includes('dead') || s.includes('error')) return 'offline';
  return 'idle';
}

// ─── 2D Fallback — Renaissance / Steampunk Workshop ──────────────────────────
export function Fallback2DWorkshop({
  agents,
  onAgentClick,
  selectedAgentId,
}: {
  agents: SceneAgent[];
  onAgentClick: (id: string) => void;
  selectedAgentId: string | null;
}) {
  const activeCount = agents.filter(a => a.sceneStatus === 'active').length;
  const thinkingCount = agents.filter(a => a.sceneStatus === 'thinking').length;
  const idleCount = agents.filter(a => a.sceneStatus === 'idle').length;
  const offlineCount = agents.filter(a => a.sceneStatus === 'offline').length;
  const totalSessions = agents.reduce((sum, a) => sum + a.subAgentCount, 0);
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px',
      padding: '14px',
      background: 'linear-gradient(180deg, #0d0804 0%, #1a0c06 50%, #0d0804 100%)',
      overflowY: 'auto',
      // Subtle steampunk dot pattern overlay
      backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(139,105,20,0.08) 1px, transparent 0)',
      backgroundSize: '24px 24px',
    }}>
      {/* Victorian workshop banner */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
        padding: '8px 16px',
        background: 'linear-gradient(135deg, rgba(26,12,6,0.95) 0%, rgba(15,8,4,0.9) 100%)',
        border: '1px solid rgba(139,105,20,0.4)',
        borderRadius: '8px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.4), inset 0 0 20px rgba(139,105,20,0.04)',
        marginBottom: '4px',
      }}>
        <span style={{ color: '#8b6914', fontSize: '12px' }}>❧</span>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '12px', fontWeight: 700, color: '#d4a856', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
          Agent Workshop — Industrial Division
        </span>
        <span style={{ color: '#8b6914', fontSize: '12px' }}>❧</span>
      </div>
      {agents.map(agent => {
        const color = STATUS_COLORS[agent.sceneStatus];
        const rColor = RUNTIME_COLORS[agent.runtime] || '#fff';
        const truncatedTask = agent.taskName && agent.taskName.length > 40
          ? agent.taskName.slice(0, 40) + '…'
          : agent.taskName;
        const isSelected = selectedAgentId === agent.id;
        return (
          <div
            key={agent.id}
            onClick={() => onAgentClick(agent.id)}
            style={{
              padding: '14px 16px',
              background: 'linear-gradient(135deg, rgba(20,10,04,0.98) 0%, rgba(15,8,4,0.96) 100%)',
              border: '1.5px solid ' + (isSelected ? rColor : 'rgba(139,105,20,0.5)'),
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              transition: 'all 0.2s',
              boxShadow: isSelected
                ? '0 0 22px ' + rColor + '55, 0 4px 16px rgba(0,0,0,0.45)'
                : '0 2px 10px rgba(0,0,0,0.35), inset 0 0 16px rgba(139,105,20,0.04)',
              transform: isSelected ? 'scale(1.01)' : 'scale(1)',
              position: 'relative',
              // Victorian left border accent
              borderLeft: isSelected ? '3px solid ' + rColor : '3px solid rgba(139,105,20,0.4)',
            }}
          >
            {/* Top decorative line */}
            <div style={{
              position: 'absolute', top: '0', left: '16px', right: '16px', height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(139,105,20,0.3), transparent)',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Avatar — brass locket style with animated border glow */}
              <div style={{
                width: '44px', height: '44px', borderRadius: '8px',
                background: 'radial-gradient(circle, ' + color + '22 0%, transparent 70%)',
                border: '1.5px solid ' + color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', flexShrink: 0,
                boxShadow: '0 0 14px ' + color + '55, inset 0 0 8px rgba(139,105,20,0.08)',
                animation: agent.sceneStatus === 'active' ? 'ws-agent-glow 2s ease-in-out infinite' : 'none',
              }}>
                {agent.runtime === 'dev' ? '🤖' : agent.runtime === 'pi' ? '🧠' : '✨'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>{agent.name}</span>
                  {/* Victorian brass runtime badge */}
                  <span style={{
                    fontSize: '9px', fontWeight: 700, padding: '2px 8px', borderRadius: '3px',
                    background: 'rgba(139,105,20,0.12)', border: '1px solid rgba(139,105,20,0.45)',
                    color: '#d4a856', letterSpacing: '0.8px', textTransform: 'uppercase',
                    boxShadow: 'inset 0 0 6px rgba(139,105,20,0.08)',
                  }}>
                    {agent.runtime.toUpperCase()}
                  </span>
                  {isSelected && (
                    <span style={{ fontSize: '9px', color: rColor, fontWeight: 600, letterSpacing: '0.5px' }}>◈ SELECTED</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* Breathing status dot for active/thinking */}
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: color,
                    boxShadow: '0 0 6px ' + color,
                    flexShrink: 0,
                    animation: agent.sceneStatus === 'active' ? 'status-breathe 2s ease-in-out infinite' :
                               agent.sceneStatus === 'thinking' ? 'status-breathe 3s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{agent.sceneStatus}</span>
                  {truncatedTask && (
                    <span style={{ fontSize: '10px', color: 'rgba(139,105,20,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      — {truncatedTask}
                    </span>
                  )}
                </div>
              </div>
              {/* Sessions badge — brass counter style */}
              {agent.subAgentCount > 0 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0,
                  background: 'rgba(139,105,20,0.08)', border: '1px solid rgba(139,105,20,0.3)',
                  borderRadius: '6px', padding: '4px 10px',
                }}>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b', fontFamily: "'JetBrains Mono', monospace" }}>
                    {agent.subAgentCount}
                  </span>
                  <span style={{ fontSize: '8px', color: '#8b6914', textTransform: 'uppercase', letterSpacing: '0.3px' }}>sess</span>
                </div>
              )}
            </div>
            {/* Status bar — steampunk brass gauge bars */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, display: 'flex', gap: '4px' }}>
                {(['active', 'thinking', 'idle'] as const).map((s) => {
                  const isActive = agent.sceneStatus === s;
                  const fill = isActive ? 100
                    : agent.sceneStatus === 'active' && s !== 'active' ? 15
                    : agent.sceneStatus === 'thinking' && s === 'thinking' ? 60
                    : agent.sceneStatus === 'thinking' && s === 'idle' ? 20
                    : 0;
                  const barColor = s === 'active' ? '#f59e0b' : s === 'thinking' ? '#e8c46a' : '#cd7c2f';
                  return (
                    <div key={s} style={{ flex: 1 }}>
                      <div style={{ height: '4px', background: 'rgba(26,12,6,0.8)', borderRadius: '2px', overflow: 'hidden', border: '1px solid rgba(139,105,20,0.2)' }}>
                        <div style={{
                          width: `${fill}%`, height: '100%',
                          background: barColor,
                          borderRadius: '2px',
                          transition: 'width 0.5s ease',
                          boxShadow: fill > 0 ? `0 0 4px ${barColor}66` : 'none',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <span style={{ fontSize: '10px', color: 'rgba(139,105,20,0.7)', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                {agent.sceneStatus === 'active' ? '\u25CF working' : agent.sceneStatus === 'thinking' ? '\u25D0 thinking' : '\u25CB idle'}
              </span>
            </div>
            {/* Live elapsed ticker — shown when agent has an active session */}
            {agent.startedAt && agent.sceneStatus !== 'idle' && (
              <LiveAgentElapsed2D startedAt={agent.startedAt} color={color} />
            )}
          </div>
        );
      })}
      {agents.length === 0 && (
        <div style={{ textAlign: 'center', color: 'rgba(139,105,20,0.5)', padding: '32px', fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif" }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚙</div>
          <div style={{ color: 'rgba(139,105,20,0.4)', fontSize: '12px', letterSpacing: '0.5px' }}>No agents connected — awaiting orders</div>
        </div>
      )}
      {/* Enhanced scene stats bar — Victorian brass instrument panel style */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '9px 14px',
        background: 'linear-gradient(135deg, rgba(26,12,6,0.9) 0%, rgba(15,8,4,0.85) 100%)',
        border: '1px solid rgba(139,105,20,0.35)',
        borderRadius: '6px',
        marginTop: 'auto',
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', monospace",
        flexWrap: 'wrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 0 12px rgba(139,105,20,0.04)',
      }}>
        <span style={{ color: 'rgba(139,105,20,0.5)' }}>Workshop instruments:</span>
        <span style={{ color: '#f59e0b' }}>&#9679; {activeCount} active</span>
        <span style={{ color: '#e8c46a' }}>&#9688; {thinkingCount} thinking</span>
        <span style={{ color: '#cd7c2f' }}>&#9675; {idleCount} idle</span>
        {offlineCount > 0 && <span style={{ color: 'var(--text-muted)' }}>&#8855; {offlineCount} offline</span>}
        <span style={{ color: '#f59e0b', marginLeft: 'auto' }}>&#9670; {totalSessions} total sessions</span>
        {agents.length > 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
            {agents.length} agent{agents.length !== 1 ? 's' : ''} connected
          </span>
        )}
      </div>
    </div>
  );
}

// Live elapsed ticker for 2D fallback — ticks every second
function LiveAgentElapsed2D({ startedAt, color }: { startedAt: number; color: string }) {
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
  const ageMin = Math.floor(elapsed / 60);
  const ageColor = ageMin > 30 ? '#cc3300' : ageMin > 15 ? '#e8c46a' : color;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
      color: ageColor,
      background: `${ageColor}11`,
      border: `1px solid ${ageColor}33`,
      borderRadius: '6px',
      padding: '3px 8px',
      width: 'fit-content',
    }}>
      <span style={{ fontSize: '9px' }}>⏱</span>
      <span>{fmt(elapsed)} elapsed</span>
    </div>
  );
}

// ─── 3D Components ────────────────────────────────────────────────────────────

function TaskBeam({ from, to, active }: { from: [number, number, number]; to: [number, number, number]; active: boolean }) {
  if (!active) return null;
  const fromVec = new THREE.Vector3(...from);
  const toVec = new THREE.Vector3(...to);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([fromVec, toVec]),
    new THREE.LineBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.45 })
  );
  return <primitive object={line} />;
}

function AgentWorkstation({
  agent, position, selected, hovered, onHover, onClick,
}: {
  agent: SceneAgent; position: [number, number, number];
  selected: boolean; hovered: boolean;
  onHover: (id: string | null) => void; onClick: (id: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Group>(null);
  const status = agent.sceneStatus;
  const statusColor = STATUS_COLORS[status];
  const rColor = RUNTIME_COLORS[agent.runtime] || '#ffffff';
  const emissiveMap: Record<AgentStatus, number> = { active: 0.5, thinking: 0.35, idle: 0.12, offline: 0.0 };

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    const speeds: Record<AgentStatus, number> = { active: 2.0, thinking: 1.2, idle: 0.7, offline: 0 };
    groupRef.current.position.y = position[1] + Math.sin(t * speeds[status]) * (status === 'offline' ? 0 : 0.06);
    const targetScale = selected || hovered ? 1.1 : 1.0;
    groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    if (haloRef.current) {
      const mat = haloRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = emissiveMap[status] * (0.6 + Math.sin(t * 1.5 + position[0]) * 0.4);
    }
    if (ringRef.current) {
      ringRef.current.rotation.y = t * 0.8;
      ringRef.current.rotation.x = Math.sin(t * 0.4) * 0.15;
    }
  });

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerEnter={() => onHover(agent.id)}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(agent.id); }}
    >
      {/* Platform */}
      <mesh position={[0, -0.55, 0]} receiveShadow>
        <cylinderGeometry args={[0.95, 1.15, 0.1, 32]} />
        <meshStandardMaterial color="#141d35" emissive={statusColor} emissiveIntensity={emissiveMap[status]} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* Desk surface */}
      <mesh position={[0, -0.3, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 1.0]} />
        <meshStandardMaterial color="#3d2910" roughness={0.75} metalness={0.1} />
      </mesh>
      {/* Desk legs */}
      {([[-0.65, -0.62, -0.38], [0.65, -0.62, -0.38], [-0.65, -0.62, 0.38], [0.65, -0.62, 0.38]] as [number,number,number][]).map((pos, i) => (
        <mesh key={i} position={pos} castShadow>
          <boxGeometry args={[0.055, 0.52, 0.055]} />
          <meshStandardMaterial color="#2a1e0c" roughness={0.8} />
        </mesh>
      ))}
      {/* Monitor */}
      <group position={[0, 0.12, -0.28]}>
        <mesh castShadow><boxGeometry args={[0.85, 0.52, 0.045]} /><meshStandardMaterial color="#0a0d14" roughness={0.3} metalness={0.5} /></mesh>
        <mesh position={[0, 0, 0.024]}>
          <planeGeometry args={[0.77, 0.44]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={status === 'active' ? 0.9 : status === 'thinking' ? 0.55 : 0.2} transparent opacity={0.88} />
        </mesh>
        <mesh position={[0, -0.32, 0]}>
          <boxGeometry args={[0.065, 0.1, 0.04]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.37, 0]}>
          <boxGeometry args={[0.32, 0.018, 0.22]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
      {/* Keyboard */}
      <mesh position={[0, -0.255, 0.18]}>
        <boxGeometry args={[0.52, 0.028, 0.16]} />
        <meshStandardMaterial color="#1a2030" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Agent body */}
      <group position={[0, 0.38, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.19, 0.26, 8, 16]} />
          <meshStandardMaterial color="#141d35" emissive={rColor} emissiveIntensity={0.1} roughness={0.4} metalness={0.6} />
        </mesh>
        {/* Head */}
        <group position={[0, 0.4, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.145, 16, 16]} />
            <meshStandardMaterial color="#1e2d4f" emissive={rColor} emissiveIntensity={0.25} roughness={0.3} metalness={0.5} />
          </mesh>
          {([-0.052, 0.052] as number[]).map((x, i) => (
            <mesh key={i} position={[x, 0, 0.135]}>
              <sphereGeometry args={[0.028, 8, 8]} />
              <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.2} />
            </mesh>
          ))}
        </group>
        {/* Antenna */}
        <mesh position={[0, 0.63, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.13, 8]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <sphereGeometry args={[0.026, 8, 8]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.5} />
        </mesh>
      </group>
      {/* Status halo */}
      {status !== 'offline' && (
        <mesh ref={haloRef} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.58, 0.014, 8, 64]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.9} transparent opacity={0.7} />
        </mesh>
      )}
      {/* Particle ring — only when active */}
      {status === 'active' && (
        <group ref={ringRef} position={[0, 0.1, 0]}>
          {/* Thin torus */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.68, 0.004, 6, 80]} />
            <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.2} transparent opacity={0.5} />
          </mesh>
          {/* Small orbiting spheres */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
            const angle = (i / 8) * Math.PI * 2;
            const x = Math.cos(angle) * 0.68;
            const z = Math.sin(angle) * 0.68;
            return (
              <mesh key={i} position={[x, 0, z]}>
                <sphereGeometry args={[0.018, 6, 6]} />
                <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={2.0} />
              </mesh>
            );
          })}
        </group>
      )}
      {/* Ambient floating particles — only when active */}
      {status === 'active' && (
        <AmbientParticles agentId={agent.id} statusColor={statusColor} position={position} />
      )}
      {/* Session count badge — shown when agent has active sessions */}
      {agent.subAgentCount > 0 && (
        <Html position={[0.7, 0.95, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{
            background: 'rgba(15,08,04,0.94)', border: '1px solid rgba(245,158,11,0.55)',
            borderRadius: '10px', padding: '2px 8px', whiteSpace: 'nowrap',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#f59e0b',
            fontWeight: 700, boxShadow: '0 0 10px rgba(245,158,11,0.35), inset 0 0 8px rgba(245,158,11,0.05)',
            display: 'flex', alignItems: 'center', gap: '3px',
          }}>
            <span style={{ fontSize: '10px' }}>◆</span>
            {agent.subAgentCount}
          </div>
        </Html>
      )}
      {/* Label — Victorian parchment style with brass corner ornaments */}
      <Html position={[0, 0.95, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(26,12,06,0.95) 0%, rgba(15,08,04,0.92) 100%)',
          border: '1px solid ' + (selected ? rColor : 'rgba(139,105,20,0.7)'),
          borderRadius: '4px', padding: '4px 12px', whiteSpace: 'nowrap',
          fontFamily: 'Space Grotesk, sans-serif', fontSize: '10px', color: '#e8edf8',
          fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
          boxShadow: selected
            ? '0 0 14px ' + rColor + '55, inset 0 0 12px rgba(139,105,20,0.08)'
            : '0 2px 8px rgba(0,0,0,0.5), inset 0 0 10px rgba(139,105,20,0.06)',
          position: 'relative',
        }}>
          {/* Top-left corner ornament */}
          <div style={{ position: 'absolute', top: '-3px', left: '3px', color: '#8b6914', fontSize: '8px', lineHeight: 1 }}>❧</div>
          {/* Top-right corner ornament */}
          <div style={{ position: 'absolute', top: '-3px', right: '3px', color: '#8b6914', fontSize: '8px', lineHeight: 1 }}>❧</div>
          <span style={{ color: rColor }}>{agent.name}</span>
          <span style={{ marginLeft: '6px', color: statusColor, fontSize: '8.5px', opacity: 0.9 }}>{status}</span>
        </div>
      </Html>
      {/* Hover tooltip */}
      {hovered && !selected && (
        <Html position={[0, 1.18, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{
            background: 'rgba(15,08,04,0.96)', border: '1px solid #5c2e1a', borderRadius: '8px',
            padding: '7px 11px', whiteSpace: 'nowrap', fontFamily: 'Space Grotesk, sans-serif',
            fontSize: '10px', color: '#e8edf8', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}>
            <div style={{ marginBottom: '3px', fontWeight: 700 }}>{agent.name}</div>
            <div style={{ color: '#8b5a2b', fontSize: '9px' }}>{agent.runtime.toUpperCase()} · {status.toUpperCase()}</div>
            {agent.taskName && <div style={{ color: '#5c2e1a', fontSize: '9px', marginTop: '2px' }}>Task: {agent.taskName}</div>}
            <div style={{ color: '#f59e0b', fontSize: '8px', marginTop: '3px' }}>Click to inspect →</div>
          </div>
        </Html>
      )}
      {/* Selection spotlight ring — ground glow when selected */}
      {selected && (
        <mesh position={[0, -0.49, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.0, 1.6, 64]} />
          <meshBasicMaterial color={rColor} transparent opacity={0.08} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Selection vertical beam — faint column of light above selected agent */}
      {selected && (
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.0, 0.45, 4.5, 32, 1, true]} />
          <meshBasicMaterial color={rColor} transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

// Ambient particles that orbit the CommandBoard
function CommandBoardOrbitParticles({ position }: { position: [number, number, number] }) {
  const PARTICLE_COUNT = 8;
  const groupRef = useRef<THREE.Group>(null);
  const particleParams = useMemo(() => Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    speed: 0.18 + (i % 4) * 0.06,
    radius: 1.8 + (i % 3) * 0.35,
    phase: (i / PARTICLE_COUNT) * Math.PI * 2,
    vertAmp: 0.4 + (i % 3) * 0.15,
    vertPhase: (i / PARTICLE_COUNT) * Math.PI,
  })), []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const { speed, radius, phase, vertAmp, vertPhase } = particleParams[i];
      const angle = t * speed + phase;
      child.position.x = Math.cos(angle) * radius;
      child.position.z = Math.sin(angle) * radius;
      child.position.y = 0.4 + Math.sin(t * speed * 0.5 + vertPhase) * vertAmp;
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.5 + Math.sin(t * speed * 1.8 + phase) * 0.35;
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {particleParams.map((p, i) => (
        <mesh key={'cb-orb-' + i} position={[Math.cos(p.phase) * p.radius, 0.4, Math.sin(p.phase) * p.radius]}>
          <sphereGeometry args={[0.028, 6, 6]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.7} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function CommandBoard({ position, agents }: { position: [number, number, number]; agents: SceneAgent[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const scanlineRef = useRef<THREE.Mesh>(null);
  const heartbeatRef = useRef<THREE.Mesh>(null);
  const [heartbeatPulse, setHeartbeatPulse] = useState(0);

  // Derive mission line from agents — updates on gateway poll, no wasteful interval
  const missionLine = (() => {
    const activeCount = agents.filter(a => a.sceneStatus === 'active').length;
    const thinkingCount = agents.filter(a => a.sceneStatus === 'thinking').length;
    const totalSubAgents = agents.reduce((sum, a) => sum + a.subAgentCount, 0);
    if (activeCount > 0 || thinkingCount > 0) {
      return `${activeCount} ACTIVE  ·  ${thinkingCount} THINKING  ·  ${totalSubAgents} SESSIONS`;
    }
    return 'STANDBY — AWAITING MISSION';
  })();

  // Heartbeat pulse synced with gateway polling (every 5s)
  useEffect(() => {
    const t = setInterval(() => {
      setHeartbeatPulse(1);
      setTimeout(() => setHeartbeatPulse(0), 600);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.rotation.y = Math.sin(t * 0.18) * 0.08;
    groupRef.current.position.y = position[1] + Math.sin(t * 0.5) * 0.055;
    // Scanline animation
    if (scanlineRef.current) {
      const mat = scanlineRef.current.material as THREE.MeshBasicMaterial;
      const scanY = ((t * 0.4) % 1.4) - 0.7;
      scanlineRef.current.position.y = scanY;
      mat.opacity = 0.18 * Math.sin(t * 0.8) * 0.5 + 0.12;
    }
    // Heartbeat glow on the board border — intensity scales with active session count
    if (heartbeatRef.current) {
      const mat = heartbeatRef.current.material as THREE.MeshStandardMaterial;
      const activeAgents = agents.filter(a => a.sceneStatus === 'active').length;
      const sessionIntensity = Math.min((activeAgents + agents.filter(a => a.sceneStatus === 'thinking').length * 0.5) * 0.15, 0.6);
      const decay = heartbeatPulse > 0 ? (1 - (t % 1) * 1.5) : 0;
      mat.emissiveIntensity = 0.25 + sessionIntensity + Math.max(0, decay) * 0.7 + Math.sin(t * 0.8) * 0.05;
    }
  });

  // Data stream positions (12 streams)
  const streamCount = 12;
  const streamPositions = Array.from({ length: streamCount }, (_, i) => -1.2 + (i / (streamCount - 1)) * 2.4);

  return (
    <group ref={groupRef} position={position}>
      {/* Brass/copper main panel frame */}
      <mesh castShadow>
        <boxGeometry args={[2.6, 1.55, 0.04]} />
        <meshStandardMaterial color="#3d2208" emissive="#8B4513" emissiveIntensity={0.15} transparent opacity={0.92} roughness={0.35} metalness={0.75} />
      </mesh>
      {/* Warm parchment/aged paper screen — backlit amber glow */}
      <mesh position={[0, 0, 0.023]}>
        <planeGeometry args={[2.48, 1.42]} />
        <meshBasicMaterial color="#1a0c04" transparent opacity={0.6} />
      </mesh>
      {/* Aged grid lines — brass/copper */}
      {Array.from({ length: 7 }).map((_, i) => (
        <mesh key={'h' + i} position={[0, 0.62 - i * 0.21, 0.024]}>
          <planeGeometry args={[2.3, 0.007]} />
          <meshBasicMaterial color="#8B5A2B" transparent opacity={0.45} />
        </mesh>
      ))}
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={'v' + i} position={[-1.24 + i * 0.31, 0, 0.024]}>
          <planeGeometry args={[0.005, 1.3]} />
          <meshBasicMaterial color="#8B5A2B" transparent opacity={0.35} />
        </mesh>
      ))}
      {/* Amber scanline sweep */}
      <mesh ref={scanlineRef} position={[0, -0.7, 0.026]}>
        <planeGeometry args={[2.4, 0.022]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.18} />
      </mesh>
      {/* Dynamic data streams — warm amber lines */}
      {streamPositions.map((x, i) => (
        <DataStream key={'ds' + i} xPos={x} startY={-0.62} height={1.2} index={i} />
      ))}
      {/* Per-agent mini status bars on CommandBoard */}
      {(() => {
        const barWidth = 0.7;
        const barHeight = 0.08;
        return agents.map((agent, i) => {
          const color = STATUS_COLORS[agent.sceneStatus];
          const rColor = RUNTIME_COLORS[agent.runtime] || '#ffffff';
          const fillPct = agent.sceneStatus === 'active' ? 1.0 : agent.sceneStatus === 'thinking' ? 0.6 : agent.sceneStatus === 'idle' ? 0.2 : 0.0;
          const elapsedStr = agent.subAgentCount > 0 && agent.sceneStatus !== 'idle'
            ? `${agent.subAgentCount}s`
            : null;
          return (
            <group key={agent.id} position={[-0.85 + i * 0.85, 0.45, 0.03]}>
              {/* Agent name label */}
              <Text position={[0, 0.14, 0]} fontSize={0.055} color={rColor} anchorX="center" anchorY="middle" letterSpacing={0.05}>
                {agent.name.toUpperCase()}
              </Text>
              {/* Status bar background */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[barWidth, barHeight, 0.005]} />
                <meshStandardMaterial color="#0d1f3c" emissive="#1e4080" emissiveIntensity={0.2} transparent opacity={0.8} />
              </mesh>
              {/* Status bar fill */}
              <mesh position={[-(barWidth / 2) + (barWidth * fillPct) / 2, 0, 0.003]}>
                <boxGeometry args={[barWidth * Math.max(fillPct, 0.02), barHeight * 0.7, 0.005]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.9} />
              </mesh>
              {/* Status dot */}
              <mesh position={[barWidth / 2 + 0.04, 0, 0]}>
                <sphereGeometry args={[0.025, 8, 8]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
              </mesh>
              {/* Elapsed / session count label */}
              {elapsedStr && (
                <Text position={[barWidth / 2 + 0.12, 0, 0]} fontSize={0.042} color="#f59e0b" anchorX="left" anchorY="middle">
                  {elapsedStr}
                </Text>
              )}
              {/* Live elapsed time ticker for active session */}
              <BoardAgentElapsedLabel startedAt={agent.startedAt} color="#22d3ee" />
            </group>
          );
        });
      })()}
      {/* Token usage bars */}
      {(() => {
        const MAX_SESSIONS = 5;
        const slotW = 0.1;
        const slotGap = 0.04;
        const rowWidth = MAX_SESSIONS * slotW + (MAX_SESSIONS - 1) * slotGap;
        return agents.map((agent, i) => {
          const count = agent.subAgentCount;
          const filledSlots = Math.min(count, MAX_SESSIONS);
          return (
            <group key={'tok-' + agent.id} position={[-0.85 + i * 0.85, -0.08, 0.03]}>
              {/* Per-slot budget indicators */}
              {Array.from({ length: MAX_SESSIONS }).map((_, slotIdx) => {
                const isFilled = slotIdx < filledSlots;
                const slotX = -(rowWidth / 2) + slotIdx * (slotW + slotGap) + slotW / 2;
                const color = isFilled ? '#f59e0b' : '#3d2208';
                const emissive = isFilled ? 0.9 : 0.05;
                return (
                  <group key={'slot-' + slotIdx} position={[slotX, 0, 0]}>
                    {/* Slot pip */}
                    <mesh>
                      <boxGeometry args={[slotW, 0.06, 0.005]} />
                      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive} transparent opacity={isFilled ? 0.9 : 0.3} />
                    </mesh>
                    {isFilled && (
                      <mesh position={[0, 0.055, 0]}>
                        <sphereGeometry args={[0.015, 6, 6]} />
                        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1.5} />
                      </mesh>
                    )}
                  </group>
                );
              })}
              {count > 0 && (
                <Text position={[rowWidth / 2 + 0.06, 0, 0]} fontSize={0.045} color="#f59e0b" anchorX="left" anchorY="middle">
                  {count}
                </Text>
              )}
            </group>
          );
        });
      })()}
      <mesh position={[0, -0.7, 0]}>
        <boxGeometry args={[2.6, 0.04, 0.065]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, -1.0, -0.1]}>
        <boxGeometry args={[0.09, 0.55, 0.09]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, -1.28, 0]}>
        <boxGeometry args={[0.9, 0.04, 0.35]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Heartbeat border glow */}
      <mesh ref={heartbeatRef} position={[0, 0, 0.021]}>
        <planeGeometry args={[2.58, 1.53]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.3} transparent opacity={0.1} />
      </mesh>
      <pointLight position={[0, 0, 0.35]} color="#f59e0b" intensity={1.125} distance={5} decay={2} />
      <Text position={[0, 0.6, 0.03]} fontSize={0.11} color="#f59e0b" anchorX="center" anchorY="middle" letterSpacing={0.1}>
        MISSION CONTROL
      </Text>
      <Text position={[0, -0.32, 0.03]} fontSize={0.07} color="#cd7c2f" anchorX="center" anchorY="middle" letterSpacing={0.05}>
        {missionLine}
      </Text>
      <Text position={[0, -0.52, 0.03]} fontSize={0.055} color="#f59e0b" anchorX="center" anchorY="middle" letterSpacing={0.04}>
        {agents.filter(a => a.runtime === 'dev').length > 0 ? '🤖 DEV ' : ''}
        {agents.filter(a => a.runtime === 'pi').length > 0 ? '🧠 PI ' : ''}
        {agents.filter(a => a.runtime === 'gemini').length > 0 ? '✨ GEMINI' : ''}
        · {agents.length} TOTAL
      </Text>
      {/* Live clock — ticks every second */}
      <BoardLiveClock />
    </group>
  );
}

// Animated data stream component
function DataStream({ xPos, startY, height, index }: { xPos: number; startY: number; height: number; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const speed = 0.6 + (index % 3) * 0.2;
  const offset = index * 0.37;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const progress = ((t * speed + offset) % 1.4) / 1.4;
    const y = startY + progress * (height + 0.3);
    meshRef.current.position.y = y;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    const fade = progress < 0.1 ? progress * 10 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
    mat.opacity = fade * 0.7;
  });

  return (
    <mesh ref={meshRef} position={[xPos, startY, 0.025]}>
      <planeGeometry args={[0.008, height * 0.35]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0} />
    </mesh>
  );
}

// Live clock: ticks every second, shown on CommandBoard
function BoardLiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <Html position={[0, -0.5, 0.03]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
        color: '#f59e0b', background: 'rgba(20,10,04,0.7)',
        borderRadius: '4px', padding: '1px 6px',
        border: '1px solid rgba(245,158,11,0.3)',
        whiteSpace: 'nowrap', letterSpacing: '0.5px',
      }}>
        {dateStr} {timeStr}
      </div>
    </Html>
  );
}

// Live ticking elapsed time label for CommandBoard — per agent
function BoardAgentElapsedLabel({ startedAt, color }: { startedAt?: number; color: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const fmt = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };
  return (
    <Html position={[0, -0.22, 0.03]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '9px',
        color,
        background: 'rgba(10,14,26,0.8)',
        borderRadius: '4px',
        padding: '1px 5px',
        border: '1px solid rgba(30,45,79,0.8)',
        whiteSpace: 'nowrap',
      }}>
        ⏱ {fmt(elapsed)}
      </div>
    </Html>
  );
}

// Floating live stats HUD rendered inside the 3D scene
function FloatingStatsHUD({ agents }: { agents: SceneAgent[] }) {
  const activeCount = agents.filter(a => a.sceneStatus === 'active').length;
  const thinkingCount = agents.filter(a => a.sceneStatus === 'thinking').length;
  const totalSessions = agents.reduce((sum, a) => sum + a.subAgentCount, 0);
  const [, tick] = useState(0);

  // Tick the HUD every 5s to keep stats fresh (synced with gateway poll)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Html position={[6.5, 3.2, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[50, 0]}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(26,12,6,0.96) 0%, rgba(15,8,4,0.94) 100%)',
        border: '1px solid rgba(139,105,20,0.5)',
        borderRadius: '8px',
        padding: '10px 13px',
        fontFamily: 'Space Grotesk, sans-serif',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6), inset 0 0 16px rgba(139,105,20,0.06)',
        minWidth: '130px',
      }}>
        {/* Victorian header with ornamental dividers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style={{ color: '#8b6914', fontSize: '8px' }}>❧</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(139,105,20,0.4), transparent)' }} />
          <span style={{ fontSize: '8px', fontWeight: 700, color: '#d4a856', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Workshop Gauge
          </span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(139,105,20,0.4))' }} />
          <span style={{ color: '#8b6914', fontSize: '8px' }}>❧</span>
        </div>
        {[
          { label: 'Active', count: activeCount, color: '#f59e0b', pulse: activeCount > 0 },
          { label: 'Thinking', count: thinkingCount, color: '#e8c46a', pulse: thinkingCount > 0 },
          { label: 'Sessions', count: totalSessions, color: '#fb923c', pulse: false },
        ].map(({ label, count, color, pulse }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%', background: color,
              boxShadow: pulse ? `0 0 6px ${color}` : 'none',
              animation: pulse ? 'pulse-green 2s infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '10px', color: '#8b6914', flex: 1 }}>{label}</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>
          </div>
        ))}
        {/* Victorian ornamental divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid rgba(139,105,20,0.25)' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(139,105,20,0.3))' }} />
          <span style={{ fontSize: '7px', color: '#5c3d1a', fontFamily: 'JetBrains Mono, monospace' }}>◆ WORKSHOP LIVE ◆</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(139,105,20,0.3), transparent)' }} />
        </div>
        {agents.filter(a => a.startedAt).length > 0 && (
          <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid rgba(139,105,20,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
              <span style={{ color: '#8b6914', fontSize: '7px' }}>❧</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(139,105,20,0.2)' }} />
              <span style={{ fontSize: '8px', fontWeight: 700, color: '#8b6914', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'Space Grotesk, sans-serif' }}>
                Agent Uptime
              </span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(139,105,20,0.2)' }} />
              <span style={{ color: '#8b6914', fontSize: '7px' }}>❧</span>
            </div>
            {agents.filter(a => a.startedAt).map(agent => {
              const elapsed = Math.floor((Date.now() - (agent.startedAt || 0)) / 1000);
              const h = Math.floor(elapsed / 3600);
              const m = Math.floor((elapsed % 3600) / 60);
              const s = elapsed % 60;
              const timeStr = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
              const rColor = RUNTIME_COLORS[agent.runtime] || '#ffffff';
              return (
                <div key={agent.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 600, color: rColor, fontFamily: 'Space Grotesk, sans-serif' }}>{agent.name}</span>
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: STATUS_COLORS[agent.sceneStatus] }} title={`Connected since ${new Date(agent.startedAt || 0).toLocaleTimeString()}`}>{timeStr}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Html>
  );
}

// Ambient floating particles that slowly orbit around active agents
function AmbientParticles({ agentId, statusColor, position }: { agentId: string; statusColor: string; position: [number, number, number] }) {
  const PARTICLE_COUNT = 6;
  const groupRef = useRef<THREE.Group>(null);
  // Pre-compute particle params using useMemo for stability
  const particleParams = useMemo(() => Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    speed: 0.25 + (i % 3) * 0.12,
    radius: 0.9 + (i % 3) * 0.18,
    phase: (i / PARTICLE_COUNT) * Math.PI * 2,
    vertPhase: (i / PARTICLE_COUNT) * Math.PI,
  })), []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    const children = groupRef.current.children;
    children.forEach((child, i) => {
      const { speed, radius, phase, vertPhase } = particleParams[i];
      const angle = t * speed + phase;
      const vertAngle = t * speed * 0.4 + vertPhase;
      child.position.x = Math.cos(angle) * radius;
      child.position.z = Math.sin(angle) * radius;
      child.position.y = 0.2 + Math.sin(vertAngle) * 0.35;
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.6 + Math.sin(t * speed * 2 + phase) * 0.4;
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {particleParams.map((p, i) => (
        <mesh key={agentId + '-amb-' + i}
          position={[Math.cos(p.phase) * p.radius, 0.2, Math.sin(p.phase) * p.radius]}
        >
          <sphereGeometry args={[0.022, 6, 6]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.8} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function AgentInspectionPanel({ agent, onClose }: { agent: SceneAgent; onClose: () => void }) {
  const color = STATUS_COLORS[agent.sceneStatus];
  const rColor = RUNTIME_COLORS[agent.runtime] || '#fff';
  return (
    <Html position={[0, 2.2, 0]} center style={{ pointerEvents: 'auto', userSelect: 'none' }} zIndexRange={[100, 0]}>
      <div style={{
        background: 'rgba(15,08,04,0.97)', border: '1.5px solid ' + rColor, borderRadius: '12px',
        padding: '14px', width: '210px', fontFamily: 'Space Grotesk, sans-serif',
        boxShadow: '0 0 24px ' + rColor + '44, 0 8px 32px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '8px',
              background: color + '22', border: '1.5px solid ' + color,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px',
            }}>
              {agent.runtime === 'dev' ? '🤖' : agent.runtime === 'pi' ? '🧠' : '✨'}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#e8edf8' }}>{agent.name}</div>
              <div style={{ fontSize: '8.5px', color: rColor, fontWeight: 700, letterSpacing: '0.5px' }}>{agent.runtime.toUpperCase()}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px', color: '#8b9ac8', cursor: 'pointer', fontSize: '11px', padding: '3px 7px',
          }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: '5px', marginBottom: '9px' }}>
          <div style={{ flex: 1, background: color + '18', border: '1px solid ' + color + '44', borderRadius: '6px', padding: '5px 7px', textAlign: 'center' }}>
            <div style={{ fontSize: '8px', color: '#4a5580', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</div>
            <div style={{ fontSize: '10px', fontWeight: 700, color, textTransform: 'uppercase' }}>{agent.sceneStatus}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', padding: '5px 7px', textAlign: 'center' }}>
            <div style={{ fontSize: '8px', color: '#5c2e1a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sessions</div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b' }}>{agent.subAgentCount}</div>
          </div>
        </div>
        {agent.taskName && (
          <div style={{ fontSize: '9.5px', color: '#8b9ac8', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '5px 7px', marginBottom: '7px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#4a5580' }}>Task: </span>{agent.taskName}
          </div>
        )}
        <div style={{ fontSize: '8.5px', color: '#f59e0b', textAlign: 'center', letterSpacing: '0.5px' }}>▲ SELECTED FOR INSPECTION</div>
      </div>
    </Html>
  );
}

function SceneSetup() {
  return (
    <>
      {/* Deep warm amber fog — Renaissance candlelit workshop atmosphere */}
      <fogExp2 attach="fog" args={['#1a0804', 0.048]} />
      {/* Ambient — dim warm candlelight with copper undertones */}
      <ambientLight intensity={0.35} color="#3d1c06" />
      {/* Main directional — warm lantern light from above-right */}
      <directionalLight position={[5, 8, 5]} intensity={0.6875} color="#d4852a" castShadow shadow-mapSize={[1024, 1024]} />
      {/* Central hanging lamp — warm amber */}
      <pointLight position={[0, 5, 0]} intensity={1.5} color="#f59e0b" distance={14} decay={2} />
      {/* Left lantern — orange copper */}
      <pointLight position={[-6, 2.5, 2]} intensity={0.625} color="#fb923c" distance={10} decay={2} />
      {/* Right lantern — brass glow */}
      <pointLight position={[6, 2.5, 2]} intensity={0.625} color="#e8c46a" distance={10} decay={2} />
      {/* Back fill — deep ember, iron and rust tones */}
      <pointLight position={[0, 1, -6]} intensity={0.375} color="#7c2d10" distance={12} decay={2} />
      {/* Forge corner — warm furnace orange glow (back-right) */}
      <pointLight position={[5.8, 0.8, -1.5]} intensity={1.25} color="#ff4500" distance={8} decay={2} />
      {/* Overhead lantern fill — warm amber from center-top */}
      <pointLight position={[0, 4.8, -2.5]} intensity={0.875} color="#f59e0b" distance={10} decay={2} />
      {/* Deep red accent from back wall */}
      <pointLight position={[-3.2, 2.4, -4.5]} intensity={0.390625} color="#cc3300" distance={6} decay={2} />
      {/* Warm fill near bookshelf — copper patina green accent */}
      <pointLight position={[-3.2, 3.5, -4.0]} intensity={0.375} color="#d4852a" distance={5} decay={2} />
      {/* Victorian wall sconce — oxidized copper green */}
      <pointLight position={[1.8, 3.2, -4.5]} intensity={0.390625} color="#e8c46a" distance={5} decay={2} />
      {/* Backdrop wall ambient — warm dark iron glow */}
      <pointLight position={[0, 2.2, -4.8]} intensity={0.1875} color="#5c2e1a" distance={6} decay={2} />
    </>
  );
}

function SceneFloor() {
  return (
    <>
      {/* Rich dark mahogany workshop floor with warm grain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.66, 0]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial color="#1a0c06" roughness={0.88} metalness={0.05} />
      </mesh>
      {/* Wood grain overlay — warm mid-tone walnut planks */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.655, 0]}>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial color="#2e1508" roughness={0.95} metalness={0.0} transparent opacity={0.45} />
      </mesh>
      {/* Warm grid — faint workshop tile lines in aged brass */}
      <gridHelper args={[24, 48, '#3d2010', '#1c0f06']} position={[0, -0.65, 0]} />
      {/* Central rug — worn oxblood leather under workstations */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.64, 0]}>
        <planeGeometry args={[5.5, 3.2]} />
        <meshStandardMaterial color="#4a1a0a" roughness={0.95} metalness={0.0} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.639, 0]}>
        <planeGeometry args={[5.4, 3.1]} />
        <meshStandardMaterial color="#6b3015" roughness={0.9} metalness={0.0} transparent opacity={0.25} />
      </mesh>
      {/* Brass border inlay around the central rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.638, 0]}>
        <planeGeometry args={[5.6, 3.3]} />
        <meshStandardMaterial color="#8b6914" roughness={0.6} metalness={0.35} transparent opacity={0.12} />
      </mesh>
    </>
  );
}

// Steampunk workshop — floating embers, soot, and dust motes in candlelight
function EmberParticles() {
  const COUNT = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  // Ember palette — warm oranges, ambers, deep reds, copper
  const emberColors = [
    [0.96, 0.62, 0.20],  // bright amber
    [0.98, 0.45, 0.10],  // orange ember
    [0.85, 0.30, 0.08],  // deep orange-red
    [0.78, 0.55, 0.20],  // copper
    [0.92, 0.72, 0.35],  // pale brass dust
    [0.60, 0.25, 0.08],  // dark soot ember
  ];
  for (let i = 0; i < COUNT; i++) {
    // Distribute throughout the scene volume
    positions[i * 3]     = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 9 + 0.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 13 - 1;
    const c = emberColors[Math.floor(Math.random() * emberColors.length)];
    colors[i * 3]     = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const pointsRef = useRef<THREE.Points>(null);
  // Slowly drift upward like embers rising from a forge
  useFrame(({ clock }) => {
    if (!pointsRef.current) return;
    const t = clock.getElapsedTime();
    pointsRef.current.rotation.y = t * 0.012;
    // Gentle vertical bob of individual particles handled by shader-like drift
    const posAttr = pointsRef.current.geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      const base = i * 3 + 1;
      const drift = Math.sin(t * 0.3 + i * 1.7) * 0.003;
      posAttr.array[base] += drift;
      // Wrap: if too high, reset low
      if (posAttr.array[base] > 9.5) posAttr.array[base] = 0.2;
    }
    posAttr.needsUpdate = true;
  });
  return (
    <points ref={pointsRef}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial size={0.05} vertexColors transparent opacity={0.75} sizeAttenuation />
    </points>
  );
}

function Scene({
  agents, selectedAgentId, hoveredAgentId, onHover, onSelectAgent, taskFlows, autoRotating, cameraTargetRef, canvas,
}: {
  agents: SceneAgent[]; selectedAgentId: string | null; hoveredAgentId: string | null;
  onHover: (id: string | null) => void; onSelectAgent: (id: string | null) => void;
  taskFlows: { id: string; fromId: string; toId: string; status: 'active' | 'pending' }[];
  autoRotating: boolean;
  cameraTargetRef: React.MutableRefObject<[number, number, number]>;
  canvas: HTMLCanvasElement | null;
}) {
  const orbitTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0.5, 0));
  const controlsRef = useRef<any>(null);
  // Two-finger horizontal-only pan state
  const isPanningRef = useRef(false);
  const panDeltaRef = useRef({ x: 0, y: 0 });
  const cameraTargetAtPanStartRef = useRef<[number, number, number]>([0, 0.5, 0]);

  // Attach two-finger touch listeners to the canvas for horizontal-only manual panning
  useEffect(() => {
    if (!canvas) return;

    let prevTwoFingerCenter: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        isPanningRef.current = true;
        panDeltaRef.current = { x: 0, y: 0 };
        // Store initial touch center so we can compute per-move deltas
        prevTwoFingerCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && isPanningRef.current) {
        e.preventDefault();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (prevTwoFingerCenter) {
          const dx = cx - prevTwoFingerCenter.x;
          const dy = cy - prevTwoFingerCenter.y;
          // Only use horizontal delta for horizontal-only panning
          panDeltaRef.current.x += dx;
          panDeltaRef.current.y += dy;
        }
        prevTwoFingerCenter = { x: cx, y: cy };
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPanningRef.current = false;
        panDeltaRef.current = { x: 0, y: 0 };
        prevTwoFingerCenter = null;
      }
    };

    // Non-passive so we can call preventDefault and block OrbitControls' two-finger handler
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [canvas]);

  // Smoothly pan OrbitControls target toward cameraTargetRef when agent is selected
  // Also apply two-finger horizontal-only pan delta when isPanningRef is active
  useFrame(() => {
    const target = orbitTargetRef.current;

    if (isPanningRef.current) {
      // Apply the accumulated horizontal pan delta directly
      // Scale by panSpeed for consistent feel with OrbitControls
      target.x += panDeltaRef.current.x * 0.7;
      panDeltaRef.current.x = 0; // Reset after applying

      // Keep cameraTargetRef in sync so smooth-follow doesn't snap back after pan ends
      cameraTargetRef.current = [target.x, cameraTargetRef.current[1], cameraTargetRef.current[2]];

      if (controlsRef.current) {
        controlsRef.current.target.copy(target);
        controlsRef.current.update();
      }
    } else {
      // Normal smooth follow for agent-selection camera pans
      const [tx, ty, tz] = cameraTargetRef.current;
      target.x += (tx - target.x) * 0.06;
      target.y += (ty - target.y) * 0.06;
      target.z += (tz - target.z) * 0.06;

      if (controlsRef.current) {
        controlsRef.current.target.copy(target);
        controlsRef.current.update();
      }
    }
  });

  return (
    <>
      <SceneSetup />
      <SceneFloor />
      <EmberParticles />
      <CommandBoard position={COMMAND_BOARD_POS} agents={agents} />
      <CommandBoardOrbitParticles position={COMMAND_BOARD_POS} />
      <FloatingStatsHUD agents={agents} />

      {/* ── Steampunk Workshop Enhancements ── */}
      {/* Backdrop riveted metal wall — factory/workshop wall behind CommandBoard */}
      <BackdropWall position={[0, 2.2, -5.2]} />

      {/* Overhead pipe network — brass/copper pipes running across ceiling */}
      <OverheadPipeNetwork />

      {/* Decorative gears on backdrop wall */}
      <DecorativeGear position={[-2.8, 2.2, -5.0]} radius={0.38} thickness={0.065} color="#D4852A" rotationSpeed={0.18} />
      <DecorativeGear position={[2.8, 1.8, -5.0]} radius={0.3} thickness={0.055} color="#B87333" rotationSpeed={-0.12} />
      <DecorativeGear position={[0.5, 3.4, -5.0]} radius={0.22} thickness={0.045} color="#CD7F32" rotationSpeed={0.25} />

      {/* Tool rack on backdrop wall */}
      <ToolRack position={[0, 1.8, -5.05]} />

      {/* Hanging brass lanterns */}
      <HangingLantern position={[-4.5, 4.2, 0]} scale={0.9} />
      <HangingLantern position={[4.5, 4.2, 0]} scale={0.9} />
      <HangingLantern position={[0, 4.5, -2.5]} scale={1.0} />

      {/* Anvil near left workstation */}
      <Anvil position={[-5.8, -0.5, 0.3]} />

      {/* Forge / Furnace — back-right corner with glowing embers */}
      <Forge position={[5.8, -0.28, -1.5]} />

      {/* Wooden bookshelf with leather-bound books — left side of backdrop wall */}
      <WoodenBookshelf position={[-3.2, 2.4, -5.05]} />

      {/* Water barrel — near forge area */}
      <WaterBarrel position={[4.5, -0.28, 1.2]} />

      {/* Wall sconces on backdrop wall */}
      <WallSconce position={[-1.8, 3.2, -5.15]} facingZ={0.5} />
      <WallSconce position={[1.8, 3.2, -5.15]} facingZ={0.5} />

      {/* Work stools near each workstation */}
      <WorkStool position={[-4.5, -0.28, 0.9]} />
      <WorkStool position={[0, -0.28, 0.9]} />
      <WorkStool position={[4.5, -0.28, 0.9]} />

      {/* Candelabras on each workstation desk */}
      <Candelabra position={[-4.5, -0.22, 0.3]} candleColor="#f59e0b" />
      <Candelabra position={[0, -0.22, 0.3]} candleColor="#fb923c" />
      <Candelabra position={[4.5, -0.22, 0.3]} candleColor="#e8c46a" />

      {/* Quill & Inkwell on each workstation — Renaissance artisan feel */}
      <QuillAndInkwell position={[-4.5, -0.52, 0.6]} />
      <QuillAndInkwell position={[0, -0.52, 0.6]} />
      <QuillAndInkwell position={[4.5, -0.52, 0.6]} />

      {/* Hourglass timepiece near CommandBoard — Renaissance / steampunk */}
      <Hourglass position={[2.8, 0.05, -3.8]} />

      {/* Hanging chains from ceiling — industrial atmosphere */}
      <HangingChain position={[-2.2, 4.8, -0.5]} length={2.5} />
      <HangingChain position={[2.2, 4.8, -0.5]} length={2.2} />
      <HangingChain position={[-5.5, 4.8, 1.0]} length={1.8} />
      <HangingChain position={[5.5, 4.8, 1.0]} length={1.8} />

      {/* Floor debris scattered near workstations */}
      <FloorDebris />

      {/* Atmospheric floor-level mist */}
      <AtmosphericMist />

      {/* ── Agent Workstations ── */}
      {agents.map((agent, i) => {
        const pos = AGENT_POSITIONS[i] || [i * 4.5, 0, 0];
        return (
          <AgentWorkstation
            key={agent.id}
            agent={agent}
            position={pos}
            selected={selectedAgentId === agent.id}
            hovered={hoveredAgentId === agent.id}
            onHover={onHover}
            onClick={onSelectAgent}
          />
        );
      })}
      {taskFlows.map(flow => {
        const fromIdx = agents.findIndex(a => a.id === flow.fromId);
        const toIdx = agents.findIndex(a => a.id === flow.toId);
        if (fromIdx < 0 || toIdx < 0) return null;
        return <TaskBeam key={flow.id} from={AGENT_POSITIONS[fromIdx]} to={AGENT_POSITIONS[toIdx]} active={flow.status === 'active'} />;
      })}
      {selectedAgentId && (() => {
        const agent = agents.find(a => a.id === selectedAgentId);
        if (!agent) return null;
        return <AgentInspectionPanel agent={agent} onClose={() => onSelectAgent(null)} />;
      })()}
      <OrbitControls
        ref={controlsRef}
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        enableDamping={true}
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={18}
        minPolarAngle={Math.PI * 0.08}
        maxPolarAngle={Math.PI * 0.52}
        target={orbitTargetRef.current}
        autoRotate={autoRotating}
        autoRotateSpeed={0.6}
        // screenSpacePanning: horizontal two-finger drag pans horizontally on screen
        screenSpacePanning={true}
        panSpeed={1.4}
        // one-finger → rotate, two-finger → handled by custom touch listeners (horizontal only)
        // Disable OrbitControls' native two-finger handling entirely so our custom
        // touch listener on the canvas has full control over two-finger gestures.
        // Value 99 doesn't match any TOUCH case in OrbitControls, so it falls through
        // without triggering any built-in two-finger behavior (no conflict with our handler).
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: 99 }}
      />
    </>
  );
}

// Scene activity ticker: listens to window events from Dashboard and shows last activity
function SceneActivityTicker() {
  const [lastEvent, setLastEvent] = useState<{ agentName: string; event: string; detail?: string } | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = (e as CustomEvent<{ agentName: string; event: string; detail?: string }>);
      setLastEvent(ev.detail as any);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    };
    window.addEventListener('mc:activity', handler);
    return () => window.removeEventListener('mc:activity', handler);
  }, []);

  if (!lastEvent) return null;

  const icon = lastEvent.event === 'started' ? '▶' : lastEvent.event === 'thinking' ? '💭' : lastEvent.event === 'error' ? '✕' : lastEvent.event === 'system' ? '⚙' : '✓';
  const text = lastEvent.detail || `${lastEvent.agentName} ${lastEvent.event}`;
  const truncated = text.length > 28 ? text.slice(0, 28) + '…' : text;

  return (
    <div
      className={`scene-activity-ticker${flash ? ' scene-activity-ticker--flash' : ''}`}
      style={{
        position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', alignItems: 'center', gap: '5px',
        background: 'rgba(15,08,04,0.88)', border: '1px solid #5c2e1a',
        borderRadius: '8px', padding: '4px 12px', maxWidth: '220px',
        fontFamily: "'Space Grotesk', sans-serif", fontSize: '10px',
        boxShadow: flash ? '0 0 12px rgba(245,158,11,0.3)' : 'none',
        transition: 'box-shadow 0.3s ease',
      }}
    >
      <span style={{ fontSize: '10px', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {truncated}
      </span>
    </div>
  );
}

// ─── Steampunk Workshop Enhancements ─────────────────────────────────────────

// Hanging Brass Lantern — ornate frame + glowing inner core
function HangingLantern({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {/* Chain links hanging from ceiling */}
      {[-0.06, 0.06].map((x, i) => (
        <mesh key={'chain-' + i} position={[x, 0.35, 0]} rotation={[0, 0, 0.3 * (i === 0 ? 1 : -1)]}>
          <torusGeometry args={[0.035, 0.012, 6, 12]} />
          <meshStandardMaterial color="#8B5A2B" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}
      {/* Top cap — polished brass */}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.06, 8]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Top ring */}
      <mesh position={[0, 0.6, 0]}>
        <torusGeometry args={[0.08, 0.015, 6, 16]} />
        <meshStandardMaterial color="#B87333" metalness={0.85} roughness={0.25} />
      </mesh>
      {/* Main lantern body — frame bars (vertical) */}
      {[-0.1, 0.1].map((x, i) => (
        <mesh key={'vbar-' + i} position={[x, 0.1, 0]}>
          <boxGeometry args={[0.018, 0.55, 0.018]} />
          <meshStandardMaterial color="#8B5A2B" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {[0, 0.1, -0.1].map((x, i) => (
        <mesh key={'hbar-' + i} position={[0, 0.1 + (i - 1) * 0.14, x === 0 ? 0 : x]}>
          <boxGeometry args={[0.22, 0.015, x === 0 ? 0.22 : 0.015]} />
          <meshStandardMaterial color="#B87333" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {/* Glowing inner core */}
      <mesh position={[0, 0.1, 0]}>
        <sphereGeometry args={[0.065, 10, 10]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={2.5} transparent opacity={0.95} />
      </mesh>
      {/* Warm point light from lantern */}
      <pointLight position={[0, 0.1, 0]} color="#f59e0b" intensity={1.0} distance={6} decay={2} />
    </group>
  );
}

// Background riveted metal wall behind CommandBoard — Victorian industrial factory panel
function BackdropWall({ position }: { position: [number, number, number] }) {
  const PANEL_W = 8;
  const PANEL_H = 4.5;
  const PANEL_D = 0.08;
  const RIVET_POSITIONS: [number, number][] = [];
  for (let x = -PANEL_W / 2 + 0.3; x <= PANEL_W / 2 - 0.1; x += 0.5) {
    RIVET_POSITIONS.push([x, PANEL_H / 2 - 0.2]);
    RIVET_POSITIONS.push([x, -PANEL_H / 2 + 0.2]);
  }
  for (let y = -PANEL_H / 2 + 0.5; y <= PANEL_H / 2 - 0.3; y += 0.6) {
    RIVET_POSITIONS.push([-PANEL_W / 2 + 0.2, y]);
    RIVET_POSITIONS.push([PANEL_W / 2 - 0.2, y]);
  }
  // Victorian decorative corner bracket positions
  const CORNER_BRACKETS: [number, number][] = [
    [-PANEL_W / 2 + 0.25, PANEL_H / 2 - 0.25],
    [PANEL_W / 2 - 0.25, PANEL_H / 2 - 0.25],
    [-PANEL_W / 2 + 0.25, -PANEL_H / 2 + 0.25],
    [PANEL_W / 2 - 0.25, -PANEL_H / 2 + 0.25],
  ];
  return (
    <group position={position}>
      {/* Outer brass border frame */}
      <mesh position={[0, 0, -0.01]}>
        <boxGeometry args={[PANEL_W + 0.12, PANEL_H + 0.12, 0.04]} />
        <meshStandardMaterial color="#8b6914" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Inner dark frame recess */}
      <mesh position={[0, 0, -0.005]}>
        <boxGeometry args={[PANEL_W + 0.06, PANEL_H + 0.06, 0.04]} />
        <meshStandardMaterial color="#1a0c04" metalness={0.4} roughness={0.7} />
      </mesh>
      {/* Main wall panel */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[PANEL_W, PANEL_H, PANEL_D]} />
        <meshStandardMaterial color="#1a1208" metalness={0.75} roughness={0.55} />
      </mesh>
      {/* Horizontal seam lines */}
      {[-1.5, -0.5, 0.5, 1.5].map((y, i) => (
        <mesh key={'hseam-' + i} position={[0, y, PANEL_D / 2 + 0.001]}>
          <boxGeometry args={[PANEL_W - 0.1, 0.012, 0.005]} />
          <meshStandardMaterial color="#3d2a1a" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* Rivets */}
      {RIVET_POSITIONS.map((rp, i) => (
        <mesh key={'rivet-' + i} position={[rp[0], rp[1], PANEL_D / 2 + 0.005]}>
          <sphereGeometry args={[0.04, 6, 6]} />
          <meshStandardMaterial color="#B87333" metalness={0.9} roughness={0.2} />
        </mesh>
      ))}
      {/* Victorian decorative corner brackets — ornate L-shaped iron pieces */}
      {CORNER_BRACKETS.map(([cx, cy], i) => (
        <group key={'bracket-' + i} position={[cx, cy, PANEL_D / 2 + 0.005]}>
          {/* Horizontal arm */}
          <mesh position={[i % 2 === 0 ? 0.18 : -0.18, 0, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.28, 0.03, 0.03]} />
            <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
          </mesh>
          {/* Vertical arm */}
          <mesh position={[0, i >= 2 ? -0.18 : 0.18, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.03, 0.28, 0.03]} />
            <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
          </mesh>
          {/* Corner rosette / rivet ornament */}
          <mesh>
            <sphereGeometry args={[0.045, 8, 8]} />
            <meshStandardMaterial color="#D4852A" metalness={0.92} roughness={0.18} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Decorative brass gear
function DecorativeGear({ position, radius = 0.5, thickness = 0.08, color = '#B87333', rotationSpeed = 0 }: {
  position: [number, number, number]; radius?: number; thickness?: number; color?: string; rotationSpeed?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const TEETH = 12;
  useFrame(({ clock }) => {
    if (rotationSpeed !== 0 && groupRef.current) {
      groupRef.current.rotation.z = clock.getElapsedTime() * rotationSpeed;
    }
  });
  return (
    <group ref={groupRef} position={position}>
      {/* Main ring */}
      <mesh>
        <torusGeometry args={[radius, thickness, 8, 32]} />
        <meshStandardMaterial color={color} metalness={0.88} roughness={0.22} />
      </mesh>
      {/* Inner ring */}
      <mesh>
        <torusGeometry args={[radius * 0.55, thickness * 0.8, 8, 24]} />
        <meshStandardMaterial color={color} metalness={0.88} roughness={0.22} />
      </mesh>
      {/* Hub center */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.18, radius * 0.18, thickness * 2.5, 12]} />
        <meshStandardMaterial color={color} metalness={0.9} roughness={0.15} />
      </mesh>
      {/* Spokes */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={'spoke-' + i} rotation={[0, 0, (i / 4) * Math.PI * 2]}>
          <boxGeometry args={[radius * 1.7, thickness * 1.2, thickness * 0.9]} />
          <meshStandardMaterial color={color} metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {/* Gear teeth */}
      {Array.from({ length: TEETH }).map((_, i) => {
        const angle = (i / TEETH) * Math.PI * 2;
        const tx = Math.cos(angle) * (radius + thickness);
        const ty = Math.sin(angle) * (radius + thickness);
        return (
          <mesh key={'tooth-' + i} position={[tx, ty, 0]} rotation={[0, 0, angle]}>
            <boxGeometry args={[thickness * 1.4, thickness * 2.2, thickness * 0.9]} />
            <meshStandardMaterial color={color} metalness={0.85} roughness={0.25} />
          </mesh>
        );
      })}
    </group>
  );
}

// Overhead pipe network
function OverheadPipeNetwork() {
  const PIPE_R = 0.055;
  const BRASS_MAT = { color: '#B87333', metalness: 0.88, roughness: 0.22 };
  const COPPER_MAT = { color: '#CD7F32', metalness: 0.85, roughness: 0.28 };
  const IRON_MAT = { color: '#2a2f3a', metalness: 0.75, roughness: 0.5 };
  return (
    <group position={[0, 4.6, 0]}>
      {/* Main horizontal trunk pipe */}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, 0]}>
        <cylinderGeometry args={[PIPE_R, PIPE_R, 14, 10]} />
        <meshStandardMaterial {...COPPER_MAT} />
      </mesh>
      {/* Vertical drops from main pipe */}
      {[-4, -2, 0, 2, 4].map((x, i) => (
        <mesh key={'vdrop-' + i} position={[x, -0.6, 0]}>
          <cylinderGeometry args={[PIPE_R * 0.85, PIPE_R * 0.85, 1.2, 8]} />
          <meshStandardMaterial {...IRON_MAT} />
        </mesh>
      ))}
      {/* Angled connector pipes — left side */}
      <mesh position={[-5, 0.4, 0]} rotation={[0, 0, Math.PI * 0.35]}>
        <cylinderGeometry args={[PIPE_R * 0.75, PIPE_R * 0.75, 2.2, 8]} />
        <meshStandardMaterial {...BRASS_MAT} />
      </mesh>
      <mesh position={[-4.5, 0.9, 0.4]} rotation={[Math.PI * 0.15, 0, Math.PI * 0.5]}>
        <cylinderGeometry args={[PIPE_R * 0.65, PIPE_R * 0.65, 1.8, 8]} />
        <meshStandardMaterial {...BRASS_MAT} />
      </mesh>
      {/* Right side connectors */}
      <mesh position={[5, 0.4, 0]} rotation={[0, 0, -Math.PI * 0.35]}>
        <cylinderGeometry args={[PIPE_R * 0.75, PIPE_R * 0.75, 2.2, 8]} />
        <meshStandardMaterial {...COPPER_MAT} />
      </mesh>
      <mesh position={[4.5, 0.9, 0.4]} rotation={[Math.PI * 0.15, 0, -Math.PI * 0.5]}>
        <cylinderGeometry args={[PIPE_R * 0.65, PIPE_R * 0.65, 1.8, 8]} />
        <meshStandardMaterial {...COPPER_MAT} />
      </mesh>
      {/* Pipe joint nodes */}
      {[-4, 0, 4].map((x, i) => (
        <mesh key={'node-' + i} position={[x, 0, 0]}>
          <sphereGeometry args={[PIPE_R * 1.8, 8, 8]} />
          <meshStandardMaterial color="#D4852A" metalness={0.92} roughness={0.15} />
        </mesh>
      ))}
      {/* Back-wall pipe runs */}
      <mesh position={[0, 0, -4.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[PIPE_R * 0.7, PIPE_R * 0.7, 12, 8]} />
        <meshStandardMaterial {...IRON_MAT} />
      </mesh>
      {/* Vertical drops to CommandBoard area */}
      {[-2.5, 2.5].map((x, i) => (
        <mesh key={'cb-drop-' + i} position={[x, -1.2, -4.2]}>
          <cylinderGeometry args={[PIPE_R * 0.7, PIPE_R * 0.7, 2.4, 8]} />
          <meshStandardMaterial {...BRASS_MAT} />
        </mesh>
      ))}
    </group>
  );
}

// Small anvil for blacksmith/rennissance workshop feel
function Anvil({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main anvil body */}
      <mesh castShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[0.5, 0.16, 0.25]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.9} roughness={0.4} />
      </mesh>
      {/* Anvil horn — tapered working end */}
      <mesh castShadow position={[0.38, 0.05, 0]} rotation={[0, 0, -0.15]}>
        <boxGeometry args={[0.3, 0.1, 0.18]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.9} roughness={0.4} />
      </mesh>
      {/* Anvil heel — back end */}
      <mesh castShadow position={[-0.32, 0.04, 0]}>
        <boxGeometry args={[0.12, 0.08, 0.2]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.9} roughness={0.45} />
      </mesh>
      {/* Anvil base/stump */}
      <mesh castShadow position={[0, -0.18, 0]}>
        <cylinderGeometry args={[0.12, 0.15, 0.36, 8]} />
        <meshStandardMaterial color="#1a0f06" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Base platform */}
      <mesh receiveShadow position={[0, -0.38, 0]}>
        <boxGeometry args={[0.45, 0.08, 0.35]} />
        <meshStandardMaterial color="#1c0f06" roughness={0.88} metalness={0.05} />
      </mesh>
    </group>
  );
}

// Tool rack on backdrop wall
function ToolRack({ position }: { position: [number, number, number] }) {
  const TOOLS: { pos: [number, number, number]; rot?: number }[] = [
    { pos: [-1.2, 0.3, 0], rot: 0.4 },
    { pos: [-0.6, 0.1, 0], rot: -0.2 },
    { pos: [0.0, 0.2, 0], rot: 0.1 },
    { pos: [0.6, 0.0, 0], rot: 0.35 },
    { pos: [1.2, 0.3, 0], rot: -0.35 },
  ];
  return (
    <group position={position}>
      {/* Rack board */}
      <mesh position={[0, 0, -0.04]}>
        <boxGeometry args={[3.2, 0.12, 0.06]} />
        <meshStandardMaterial color="#2a1e0c" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* Tool hook pegs */}
      {TOOLS.map((t, i) => (
        <mesh key={'peg-' + i} position={[t.pos[0], t.pos[1] - 0.1, 0.02]}>
          <cylinderGeometry args={[0.025, 0.025, 0.12, 6]} />
          <meshStandardMaterial color="#B87333" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {/* Hammer 1 */}
      <group position={[TOOLS[0].pos[0], TOOLS[0].pos[1], TOOLS[0].pos[2]]} rotation={[0, 0, TOOLS[0].rot || 0]}>
        <mesh position={[0, -0.15, 0]}>
          <boxGeometry args={[0.055, 0.3, 0.055]} />
          <meshStandardMaterial color="#8B4513" roughness={0.85} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.18, 0.1, 0.07]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.88} roughness={0.3} />
        </mesh>
      </group>
      {/* Wrench 1 */}
      <group position={[TOOLS[1].pos[0], TOOLS[1].pos[1], TOOLS[1].pos[2]]} rotation={[0, 0, TOOLS[1].rot || 0]}>
        <mesh position={[0, -0.14, 0]}>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color="#B87333" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <torusGeometry args={[0.07, 0.02, 6, 12, Math.PI]} />
          <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
        </mesh>
      </group>
      {/* Pliers */}
      <group position={[TOOLS[2].pos[0], TOOLS[2].pos[1], TOOLS[2].pos[2]]} rotation={[0, 0, TOOLS[2].rot || 0]}>
        <mesh position={[-0.04, -0.12, 0]}>
          <boxGeometry args={[0.03, 0.22, 0.03]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.88} roughness={0.3} />
        </mesh>
        <mesh position={[0.04, -0.12, 0]}>
          <boxGeometry args={[0.03, 0.22, 0.03]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.88} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[0.1, 0.06, 0.04]} />
          <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
        </mesh>
      </group>
      {/* Wrench 2 */}
      <group position={[TOOLS[3].pos[0], TOOLS[3].pos[1], TOOLS[3].pos[2]]} rotation={[0, 0, TOOLS[3].rot || 0]}>
        <mesh position={[0, -0.14, 0]}>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color="#CD7F32" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <torusGeometry args={[0.07, 0.02, 6, 12, Math.PI]} />
          <meshStandardMaterial color="#CD7F32" metalness={0.88} roughness={0.25} />
        </mesh>
      </group>
      {/* Hammer 2 */}
      <group position={[TOOLS[4].pos[0], TOOLS[4].pos[1], TOOLS[4].pos[2]]} rotation={[0, 0, TOOLS[4].rot || 0]}>
        <mesh position={[0, -0.15, 0]}>
          <boxGeometry args={[0.055, 0.3, 0.055]} />
          <meshStandardMaterial color="#8B4513" roughness={0.85} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.18, 0.1, 0.07]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.88} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

// Floor debris — scattered metal scraps near workstations
function FloorDebris() {
  const DEBRIS_PIECES: { pos: [number, number, number]; type: 'box' | 'cylinder' | 'gear'; size: number[]; color: string; rot?: number }[] = [
    { pos: [-5.2, -0.6, 0.5], type: 'box', size: [0.18, 0.06, 0.12], color: '#2a2f3a' },
    { pos: [-5.0, -0.62, 0.8], type: 'cylinder', size: [0.05, 0.05, 0.04, 8], color: '#B87333' },
    { pos: [-4.8, -0.61, 0.3], type: 'box', size: [0.1, 0.05, 0.15], color: '#1a1a2e' },
    { pos: [-5.4, -0.6, -0.2], type: 'gear', size: [0.12, 0.03, 8], color: '#CD7F32' },
    { pos: [-4.6, -0.62, -0.5], type: 'cylinder', size: [0.04, 0.04, 0.08, 6], color: '#2a2f3a' },
    { pos: [0.3, -0.61, 0.6], type: 'box', size: [0.15, 0.05, 0.1], color: '#1a1a2e' },
    { pos: [-0.3, -0.6, 0.4], type: 'gear', size: [0.1, 0.025, 10], color: '#D4852A' },
    { pos: [0.6, -0.62, -0.3], type: 'cylinder', size: [0.06, 0.06, 0.05, 8], color: '#B87333' },
    { pos: [-0.1, -0.61, -0.6], type: 'box', size: [0.08, 0.04, 0.2], color: '#2a2f3a' },
    { pos: [4.9, -0.6, 0.4], type: 'box', size: [0.14, 0.05, 0.18], color: '#2a2f3a' },
    { pos: [5.2, -0.62, -0.1], type: 'gear', size: [0.11, 0.028, 8], color: '#B87333' },
    { pos: [4.6, -0.61, -0.5], type: 'cylinder', size: [0.05, 0.05, 0.06, 6], color: '#CD7F32' },
    { pos: [5.4, -0.6, 0.6], type: 'box', size: [0.1, 0.04, 0.1], color: '#1a1a2e' },
    { pos: [2.0, -0.61, 1.0], type: 'gear', size: [0.09, 0.022, 6], color: '#D4852A' },
    { pos: [-2.0, -0.62, 0.9], type: 'cylinder', size: [0.04, 0.04, 0.07, 8], color: '#2a2f3a' },
  ];
  return (
    <group>
      {DEBRIS_PIECES.map((d, i) => {
        if (d.type === 'box') {
          return (
            <mesh key={'deb-' + i} position={d.pos as [number, number, number]} castShadow receiveShadow>
              <boxGeometry args={d.size as [number, number, number]} />
              <meshStandardMaterial color={d.color} metalness={0.75} roughness={0.5} />
            </mesh>
          );
        }
        if (d.type === 'cylinder') {
          return (
            <mesh key={'deb-' + i} position={d.pos as [number, number, number]} castShadow receiveShadow>
              <cylinderGeometry args={d.size as [number, number, number, number]} />
              <meshStandardMaterial color={d.color} metalness={0.8} roughness={0.4} />
            </mesh>
          );
        }
        if (d.type === 'gear') {
          return (
            <mesh key={'deb-' + i} position={d.pos as [number, number, number]} rotation={[Math.PI / 2, 0, d.rot || 0]} castShadow>
              <cylinderGeometry args={d.size as [number, number, number, number]} />
              <meshStandardMaterial color={d.color} metalness={0.88} roughness={0.22} />
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
}

// Atmospheric steam/mist near floor level
function AtmosphericMist() {
  const mistRef = useRef<THREE.Group>(null);
  const MIST_LAYERS = 3;
  const mistParams = useMemo(() => Array.from({ length: MIST_LAYERS }, (_, i) => ({
    y: -0.58 + i * 0.04,
    opacity: 0.06 + i * 0.03,
    scale: 1 + i * 0.4,
    speed: 0.08 + i * 0.04,
    offset: i * 1.2,
  })), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (mistRef.current) {
      mistRef.current.children.forEach((child, i) => {
        const mp = mistParams[i];
        const drift = Math.sin(t * mp.speed + mp.offset) * 0.3;
        child.position.x = drift;
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = mp.opacity * (0.7 + Math.sin(t * 0.3 + mp.offset) * 0.3);
      });
    }
  });

  return (
    <group ref={mistRef}>
      {mistParams.map((mp, i) => (
        <mesh key={'mist-' + i} position={[0, mp.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[22 * mp.scale, 14 * mp.scale]} />
          <meshStandardMaterial
            color="#8B4513"
            transparent
            opacity={mp.opacity}
            roughness={1}
            metalness={0}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// Quill & Inkwell — placed on artisan workstations for Renaissance feel
function QuillAndInkwell({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Inkwell — dark glass with brass collar */}
      <mesh position={[0.08, 0.04, 0]}>
        <cylinderGeometry args={[0.05, 0.045, 0.08, 10]} />
        <meshStandardMaterial color="#1a0a04" roughness={0.3} metalness={0.1} transparent opacity={0.85} />
      </mesh>
      {/* Brass collar / ring around inkwell */}
      <mesh position={[0.08, 0.09, 0]}>
        <torusGeometry args={[0.052, 0.008, 6, 16]} />
        <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
      </mesh>
      {/* Ink surface — dark liquid */}
      <mesh position={[0.08, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.042, 12]} />
        <meshStandardMaterial color="#0a0508" roughness={0.1} metalness={0.0} />
      </mesh>
      {/* Quill feather shaft */}
      <group position={[-0.06, 0.12, 0.04]} rotation={[0.2, 0.3, -0.4]}>
        {/* Feather vane — main feather body */}
        <mesh>
          <boxGeometry args={[0.008, 0.32, 0.018]} />
          <meshStandardMaterial color="#d4c4a0" roughness={0.85} />
        </mesh>
        {/* Feather barbs — left side */}
        <mesh position={[-0.012, 0.02, 0]} rotation={[0, 0, 0.15]}>
          <boxGeometry args={[0.025, 0.18, 0.004]} />
          <meshStandardMaterial color="#c8b890" roughness={0.88} />
        </mesh>
        <mesh position={[-0.012, 0.08, 0]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[0.022, 0.14, 0.004]} />
          <meshStandardMaterial color="#c8b890" roughness={0.88} />
        </mesh>
        {/* Feather barbs — right side */}
        <mesh position={[0.012, 0.02, 0]} rotation={[0, 0, -0.15]}>
          <boxGeometry args={[0.025, 0.18, 0.004]} />
          <meshStandardMaterial color="#c8b890" roughness={0.88} />
        </mesh>
        <mesh position={[0.012, 0.08, 0]} rotation={[0, 0, -0.12]}>
          <boxGeometry args={[0.022, 0.14, 0.004]} />
          <meshStandardMaterial color="#c8b890" roughness={0.88} />
        </mesh>
        {/* Quill tip / nib */}
        <mesh position={[0, -0.16, 0]}>
          <boxGeometry args={[0.004, 0.04, 0.008]} />
          <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.15} />
        </mesh>
      </group>
    </group>
  );
}

// Hourglass — placed near CommandBoard for Renaissance / steampunk timepiece feel
function Hourglass({ position }: { position: [number, number, number] }) {
  const sandRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (sandRef.current) {
      sandRef.current.rotation.y = t * 0.3;
    }
  });
  return (
    <group position={position} scale={0.7}>
      {/* Top bulb — aged glass */}
      <mesh position={[0, 0.22, 0]}>
        <sphereGeometry args={[0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color="#c8b890" roughness={0.15} metalness={0.05} transparent opacity={0.6} />
      </mesh>
      {/* Bottom bulb */}
      <mesh position={[0, -0.22, 0]} rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color="#c8b890" roughness={0.15} metalness={0.05} transparent opacity={0.6} />
      </mesh>
      {/* Brass frame pillars */}
      {[[-0.09, 0, 0], [0.09, 0, 0], [0, 0, -0.09], [0, 0, 0.09]].map(([x, y, z], i) => (
        <mesh key={'hbar-' + i} position={[x, y, z]}>
          <cylinderGeometry args={[0.008, 0.008, 0.44, 6]} />
          <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
        </mesh>
      ))}
      {/* Brass end caps */}
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.025, 12]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.18} />
      </mesh>
      <mesh position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.025, 12]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.18} />
      </mesh>
      {/* Sand in bottom bulb */}
      <mesh position={[0, -0.32, 0]}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial color="#c8b060" roughness={0.9} />
      </mesh>
      {/* Sand trickling through */}
      <group ref={sandRef} position={[0, 0, 0]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 0.35, 6]} />
          <meshStandardMaterial color="#c8b060" roughness={0.9} transparent opacity={0.85} />
        </mesh>
      </group>
      {/* Warm point light — candle-like glow from hourglass */}
      <pointLight position={[0, 0, 0]} color="#f59e0b" intensity={0.390625} distance={2.5} decay={2} />
    </group>
  );
}

// Hanging Chains — ceiling-mounted industrial chains for steampunk atmosphere
function HangingChain({ position, length = 6 }: { position: [number, number, number]; length?: number }) {
  const LINK_COUNT = Math.floor(length / 0.12);
  return (
    <group position={position}>
      {Array.from({ length: LINK_COUNT }, (_, i) => {
        const y = i * 0.12;
        const rot = i % 2 === 0 ? [0, 0, 0] : [Math.PI / 2, 0, Math.PI / 2];
        return (
          <mesh key={'link-' + i} position={[0, -y, 0]} rotation={rot as [number, number, number]}>
            <torusGeometry args={[0.025, 0.008, 6, 10]} />
            <meshStandardMaterial color="#4a3010" metalness={0.8} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Renaissance / Industrial Workshop New Elements ─────────────────────────

// Forge / Furnace — brick and copper forge with glowing embers and chimney
function Forge({ position }: { position: [number, number, number] }) {
  const emberRef = useRef<THREE.Group>(null);
  const furnaceRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // Flicker the ember glow
    if (emberRef.current) {
      emberRef.current.children.forEach((child, i) => {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.5 + Math.sin(t * 4 + i * 1.3) * 0.8 + Math.sin(t * 7 + i * 2.1) * 0.4;
      });
    }
    // Furnace door glow pulse
    if (furnaceRef.current) {
      const mat = furnaceRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.4 + Math.sin(t * 3.5) * 0.15 + Math.sin(t * 6.2) * 0.08;
    }
  });

  const EMBER_COLORS = ['#ff6b00', '#ff4500', '#ff8c00', '#cc3300', '#ffd700'];
  return (
    <group position={position}>
      {/* Furnace body — brick base */}
      <mesh castShadow receiveShadow position={[0, 0.35, 0]}>
        <boxGeometry args={[0.9, 0.7, 0.6]} />
        <meshStandardMaterial color="#5c2e1a" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* Furnace brick lines */}
      {[-0.28, 0, 0.28].map((y, i) => (
        <mesh key={'fbrick-' + i} position={[0, 0.35 + y, 0.305]}>
          <boxGeometry args={[0.88, 0.012, 0.005]} />
          <meshStandardMaterial color="#3d1e0e" roughness={0.95} />
        </mesh>
      ))}
      {/* Furnace arch opening */}
      <mesh position={[0, 0.52, 0.3]}>
        <boxGeometry args={[0.5, 0.36, 0.05]} />
        <meshStandardMaterial color="#1a0a02" roughness={0.95} />
      </mesh>
      {/* Glowing furnace core (through the opening) */}
      <mesh ref={furnaceRef} position={[0, 0.52, 0.33]}>
        <boxGeometry args={[0.42, 0.28, 0.02]} />
        <meshStandardMaterial color="#ff4500" emissive="#ff4500" emissiveIntensity={0.5} transparent opacity={0.9} />
      </mesh>
      {/* Furnace stone feet */}
      {[[-0.35, 0.04, -0.22], [0.35, 0.04, -0.22], [-0.35, 0.04, 0.22], [0.35, 0.04, 0.22]].map((p, i) => (
        <mesh key={'ffoot-' + i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.08, 0.08, 0.08]} />
          <meshStandardMaterial color="#3d2a1a" roughness={0.88} />
        </mesh>
      ))}
      {/* Copper chimney pipe */}
      <mesh position={[0.5, 1.5, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 2.3, 10]} />
        <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
      </mesh>
      {/* Chimney collar */}
      <mesh position={[0.5, 0.46, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.08, 10]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.18} />
      </mesh>
      {/* Chimney top rim */}
      <mesh position={[0.5, 2.67, 0]}>
        <cylinderGeometry args={[0.14, 0.1, 0.1, 10]} />
        <meshStandardMaterial color="#8B5A2B" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Chimney smoke wisps */}
      <ForgeSmoke position={[0.5, 2.75, 0]} />
      {/* Glowing embers inside furnace */}
      <group ref={emberRef} position={[0, 0.38, 0.33]}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
          const r = 0.06 + Math.random() * 0.1;
          return (
            <mesh key={'ember-' + i} position={[Math.cos(angle) * r * 0.8, (Math.random() - 0.5) * 0.1, Math.sin(angle) * r * 0.5]}>
              <sphereGeometry args={[0.025 + Math.random() * 0.02, 6, 6]} />
              <meshStandardMaterial
                color={EMBER_COLORS[i % EMBER_COLORS.length]}
                emissive={EMBER_COLORS[i % EMBER_COLORS.length]}
                emissiveIntensity={2.0}
                transparent
                opacity={0.9}
              />
            </mesh>
          );
        })}
      </group>
      {/* Forge bellows spout */}
      <mesh position={[-0.45, 0.42, 0]} rotation={[0, 0, -0.3]}>
        <cylinderGeometry args={[0.06, 0.08, 0.25, 8]} />
        <meshStandardMaterial color="#5c2e1a" roughness={0.85} />
      </mesh>
      {/* Forge bellows spout nozzle */}
      <mesh position={[-0.58, 0.35, 0]} rotation={[0, 0, -0.3]}>
        <cylinderGeometry args={[0.04, 0.06, 0.12, 8]} />
        <meshStandardMaterial color="#8B5A2B" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* Iron grate bars */}
      {[-0.14, 0, 0.14].map((x, i) => (
        <mesh key={'grate-' + i} position={[x, 0.28, 0.33]}>
          <boxGeometry args={[0.02, 0.04, 0.38]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.88} roughness={0.35} />
        </mesh>
      ))}
      {/* Warm orange point light from forge */}
      <pointLight position={[0, 0.5, 0.5]} color="#ff4500" intensity={1.75} distance={7} decay={2} />
      <pointLight position={[0.5, 2.5, 0]} color="#ff6b00" intensity={0.5} distance={4} decay={2} />
    </group>
  );
}

// Animated smoke from forge chimney
function ForgeSmoke({ position }: { position: [number, number, number] }) {
  const smokeRef = useRef<THREE.Group>(null);
  const PARTICLE_COUNT = 5;
  const smokeParams = useMemo(() => Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    speed: 0.25 + i * 0.08,
    phase: (i / PARTICLE_COUNT) * Math.PI * 2,
    radius: 0.06 + i * 0.04,
    yOff: i * 0.4,
  })), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!smokeRef.current) return;
    smokeRef.current.children.forEach((child, i) => {
      const sp = smokeParams[i];
      const angle = t * sp.speed * 0.5 + sp.phase;
      child.position.x = Math.cos(angle) * sp.radius;
      child.position.y = sp.yOff + (t * sp.speed) % 1.8;
      child.position.z = Math.sin(angle) * sp.radius * 0.5;
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 0.35 - (t * sp.speed) % 1.0 * 0.35) * 0.7;
    });
  });

  return (
    <group ref={smokeRef} position={position}>
      {smokeParams.map((sp, i) => (
        <mesh key={'smoke-' + i} position={[0, sp.yOff, 0]}>
          <sphereGeometry args={[0.07 + i * 0.025, 6, 6]} />
          <meshStandardMaterial color="#4a3520" transparent opacity={0.3} roughness={1} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// Candelabra — three-armed brass candelabra placed on workstation desks
function Candelabra({ position, candleColor = '#f59e0b' }: { position: [number, number, number]; candleColor?: string }) {
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    flameRefs.current.forEach((flame, i) => {
      if (flame) {
        const mat = flame.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.8 + Math.sin(t * 6 + i * 1.7) * 0.7 + Math.sin(t * 11 + i * 2.3) * 0.3;
        flame.scale.y = 0.9 + Math.sin(t * 8 + i * 2.1) * 0.15;
      }
    });
  });

  const CANDLE_POSITIONS: [number, number, number][] = [
    [0, 0.22, 0],
    [-0.18, 0.15, 0],
    [0.18, 0.15, 0],
  ];

  return (
    <group position={position}>
      {/* Main center stem */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 0.22, 8]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Base saucer */}
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.02, 12]} />
        <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
      </mesh>
      {/* Base plate */}
      <mesh position={[0, -0.005, 0]}>
        <cylinderGeometry args={[0.12, 0.14, 0.02, 12]} />
        <meshStandardMaterial color="#8B5A2B" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Arms and candles */}
      {CANDLE_POSITIONS.map((cp, i) => (
        <group key={'candle-' + i} position={cp}>
          {/* Arm */}
          <mesh position={[0, -0.05, 0]} rotation={[0, 0, i === 0 ? 0 : i === 1 ? 0.6 : -0.6]}>
            <cylinderGeometry args={[0.012, 0.012, i === 0 ? 0.08 : 0.18, 6]} />
            <meshStandardMaterial color="#CD7F32" metalness={0.88} roughness={0.22} />
          </mesh>
          {/* Candle cup */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.032, 0.02, 8]} />
            <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
          </mesh>
          {/* Wax candle */}
          <mesh position={[0, 0.07, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.14, 8]} />
            <meshStandardMaterial color="#e8d5b0" roughness={0.9} metalness={0.0} />
          </mesh>
          {/* Flame */}
          <mesh ref={el => { flameRefs.current[i] = el; }} position={[0, 0.16, 0]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color={candleColor} emissive={candleColor} emissiveIntensity={2.0} transparent opacity={0.92} />
          </mesh>
        </group>
      ))}
      {/* Small warm point light from central flame */}
      <pointLight position={[0, 0.2, 0]} color={candleColor} intensity={0.4375} distance={3.5} decay={2} />
    </group>
  );
}

// Wooden bookshelf with leather-bound books — on the backdrop wall
function WoodenBookshelf({ position }: { position: [number, number, number] }) {
  // Renaissance leather-bound tome palette — rich aged leather, burgundy, forest green, midnight blue, warm ochre
  const BOOK_COLORS = [
    '#6b1a1a', // deep burgundy
    '#1a3d1a', // forest green
    '#1a2460', // midnight blue
    '#3d2810', // warm raw sienna
    '#4a1a30', // dark plum
    '#2a3a1a', // dark olive
    '#0f2a3a', // deep teal
    '#3a2010', // burnt umber
    '#5a1a1a', // oxblood
    '#1a3020', // dark forest
    '#2a1a40', // deep violet
    '#4a3010', // aged ochre
  ];
  const books = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    x: -0.54 + i * 0.075 + (i > 7 ? 0.006 : 0),
    shelf: i > 7 ? 1 : 0,
    height: 0.23 + (i % 3) * 0.04,
    width: 0.052 + (i % 4) * 0.006,
    color: BOOK_COLORS[i % BOOK_COLORS.length],
    tilt: (i % 5 === 0 ? 0.04 : i % 7 === 0 ? -0.04 : 0),
  })), []);

  const shelfY = [-0.15, 0.3];

  return (
    <group position={position}>
      {/* Shelf back panel */}
      <mesh position={[0, 0.08, -0.06]}>
        <boxGeometry args={[1.32, 0.72, 0.06]} />
        <meshStandardMaterial color="#2a1e0c" roughness={0.85} metalness={0.03} />
      </mesh>
      {/* Left side panel */}
      <mesh position={[-0.66, 0.08, 0]}>
        <boxGeometry args={[0.06, 0.72, 0.28]} />
        <meshStandardMaterial color="#3d2910" roughness={0.82} metalness={0.03} />
      </mesh>
      {/* Right side panel */}
      <mesh position={[0.66, 0.08, 0]}>
        <boxGeometry args={[0.06, 0.72, 0.28]} />
        <meshStandardMaterial color="#3d2910" roughness={0.82} metalness={0.03} />
      </mesh>
      {/* Top board */}
      <mesh position={[0, 0.44, 0]}>
        <boxGeometry args={[1.38, 0.05, 0.28]} />
        <meshStandardMaterial color="#3d2910" roughness={0.8} metalness={0.04} />
      </mesh>
      {/* Shelf boards */}
      {shelfY.map((sy, si) => (
        <mesh key={'shelf-' + si} position={[0, sy - 0.15, 0]}>
          <boxGeometry args={[1.32, 0.04, 0.26]} />
          <meshStandardMaterial color="#3d2910" roughness={0.82} metalness={0.03} />
        </mesh>
      ))}
      {/* Bottom board */}
      <mesh position={[0, -0.31, 0]}>
        <boxGeometry args={[1.38, 0.05, 0.28]} />
        <meshStandardMaterial color="#3d2910" roughness={0.8} metalness={0.04} />
      </mesh>
      {/* Leather-bound books */}
      {books.map((book, i) => (
        <group key={'book-' + i} position={[book.x, shelfY[book.shelf] - 0.15 + book.height / 2 + 0.02, 0.04]} rotation={[0, book.tilt, 0]}>
          {/* Book body */}
          <mesh castShadow>
            <boxGeometry args={[book.width, book.height, 0.18]} />
            <meshStandardMaterial color={book.color} roughness={0.88} metalness={0.02} />
          </mesh>
          {/* Spine highlight */}
          <mesh position={[book.width / 2 - 0.004, 0, 0]}>
            <boxGeometry args={[0.006, book.height * 0.92, 0.165]} />
            <meshStandardMaterial color="#d4a855" roughness={0.85} metalness={0.05} />
          </mesh>
          {/* Gold title band */}
          {i % 3 === 0 && (
            <mesh position={[book.width / 2 - 0.003, 0, 0]}>
              <boxGeometry args={[0.004, book.height * 0.3, 0.15]} />
              <meshStandardMaterial color="#d4a017" emissive="#d4a017" emissiveIntensity={0.15} roughness={0.7} metalness={0.3} />
            </mesh>
          )}
        </group>
      ))}
      {/* Brass corner brackets */}
      {[[-0.62, 0.4], [0.62, 0.4], [-0.62, -0.28], [0.62, -0.28]].map(([x, y], i) => (
        <mesh key={'bracket-' + i} position={[x, y, 0.12]}>
          <boxGeometry args={[0.05, 0.05, 0.03]} />
          <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
        </mesh>
      ))}
    </group>
  );
}

// Leather-topped work stool — artisan's seat near each workstation
function WorkStool({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Leather seat top */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.22, 0.2, 0.05, 12]} />
        <meshStandardMaterial color="#3d1a0a" roughness={0.88} metalness={0.02} />
      </mesh>
      {/* Seat rim / tack strip */}
      <mesh position={[0, 0.025, 0]}>
        <torusGeometry args={[0.21, 0.012, 6, 20]} />
        <meshStandardMaterial color="#5c2e1a" roughness={0.85} />
      </mesh>
      {/* Seat brass tacks */}
      {[0, 1, 2, 3, 4, 5].map(i => {
        const angle = (i / 6) * Math.PI * 2;
        return (
          <mesh key={'tack-' + i} position={[Math.cos(angle) * 0.19, 0.028, Math.sin(angle) * 0.19]}>
            <sphereGeometry args={[0.015, 6, 6]} />
            <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.2} />
          </mesh>
        );
      })}
      {/* Stool leg — center pole */}
      <mesh position={[0, -0.28, 0]}>
        <cylinderGeometry args={[0.03, 0.035, 0.56, 8]} />
        <meshStandardMaterial color="#2a1e0c" roughness={0.8} metalness={0.05} />
      </mesh>
      {/* Three legs spread outward */}
      {[0, 1, 2].map(i => {
        const angle = (i / 3) * Math.PI * 2;
        return (
          <mesh key={'leg-' + i} position={[Math.cos(angle) * 0.18, -0.52, Math.sin(angle) * 0.18]} rotation={[Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35]}>
            <cylinderGeometry args={[0.02, 0.025, 0.3, 6]} />
            <meshStandardMaterial color="#2a1e0c" roughness={0.82} metalness={0.05} />
          </mesh>
        );
      })}
      {/* Iron leg brace ring */}
      <mesh position={[0, -0.38, 0]}>
        <torusGeometry args={[0.14, 0.015, 6, 16]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.85} roughness={0.35} />
      </mesh>
    </group>
  );
}

// Wall-mounted sconce — brass wall bracket with candle
function WallSconce({ position, facingZ = 0.5 }: { position: [number, number, number]; facingZ?: number }) {
  const flameRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (flameRef.current) {
      const mat = flameRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.6 + Math.sin(t * 7.3) * 0.6 + Math.sin(t * 12.1) * 0.3;
    }
  });
  return (
    <group position={position} rotation={[0, 0, 0]}>
      {/* Wall backplate */}
      <mesh>
        <boxGeometry args={[0.12, 0.18, 0.03]} />
        <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.25} />
      </mesh>
      {/* Curved arm bracket */}
      <mesh position={[0, -0.06, facingZ * 0.5]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.025, 0.14, 0.025]} />
        <meshStandardMaterial color="#D4852A" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Drip cup */}
      <mesh position={[0, -0.14, facingZ * 0.7]}>
        <cylinderGeometry args={[0.045, 0.035, 0.03, 8]} />
        <meshStandardMaterial color="#8B5A2B" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Candle */}
      <mesh position={[0, -0.06, facingZ * 0.7]}>
        <cylinderGeometry args={[0.022, 0.022, 0.12, 8]} />
        <meshStandardMaterial color="#e8d5b0" roughness={0.9} />
      </mesh>
      {/* Flame */}
      <mesh ref={flameRef} position={[0, 0.04, facingZ * 0.7]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={2.0} transparent opacity={0.9} />
      </mesh>
      {/* Warm glow */}
      <pointLight position={[0, 0.04, facingZ * 0.7]} color="#f59e0b" intensity={0.5} distance={3} decay={2} />
    </group>
  );
}

// Wooden water barrel with copper bands
function WaterBarrel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Barrel body */}
      <mesh castShadow>
        <cylinderGeometry args={[0.28, 0.24, 0.55, 14]} />
        <meshStandardMaterial color="#3d2910" roughness={0.85} metalness={0.03} />
      </mesh>
      {/* Barrel lid */}
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.29, 0.29, 0.03, 14]} />
        <meshStandardMaterial color="#2a1e0c" roughness={0.88} />
      </mesh>
      {/* Copper bands */}
      {[-0.15, 0, 0.15].map((y, i) => (
        <mesh key={'band-' + i} position={[0, y, 0]}>
          <torusGeometry args={[0.285, 0.015, 6, 24]} />
          <meshStandardMaterial color="#B87333" metalness={0.88} roughness={0.22} />
        </mesh>
      ))}
      {/* Wooden stave lines */}
      {[0, 1, 2, 3, 4, 5].map(i => {
        const angle = (i / 6) * Math.PI * 2;
        return (
          <mesh key={'stave-' + i} position={[Math.cos(angle) * 0.26, 0, Math.sin(angle) * 0.26]} rotation={[0, angle, 0]}>
            <boxGeometry args={[0.012, 0.54, 0.02]} />
            <meshStandardMaterial color="#5c3d1a" roughness={0.88} />
          </mesh>
        );
      })}
      {/* Brass tap/faucet */}
      <mesh position={[0.28, -0.08, 0]} rotation={[0, 0, -0.8]}>
        <cylinderGeometry args={[0.02, 0.02, 0.12, 6]} />
        <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.18} />
      </mesh>
      <mesh position={[0.35, -0.12, 0]}>
        <sphereGeometry args={[0.022, 6, 6]} />
        <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.18} />
      </mesh>
    </group>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function AgentWorkshop3D({
  agents, subAgents, viewMode, onViewModeChange,
  externalSelectedAgentId,
  onExternalSelectAgent,
}: {
  agents: Agent[]; subAgents: { sessionKey: string; taskName?: string; status?: string; startedAt?: number }[];
  viewMode: '3d' | '2d'; onViewModeChange: (mode: '3d' | '2d') => void;
  externalSelectedAgentId?: string | null;
  onExternalSelectAgent?: (id: string | null) => void;
}) {
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [autoRotating, setAutoRotating] = useState(false);
  const lastInteractionRef = useRef<number>(Date.now());
  // Target position for camera to smoothly pan to when agent is selected
  const cameraTargetRef = useRef<[number, number, number]>([0, 0.5, 0]);
  const prevSelectedIdRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync with external selected agent if provided
  const effectiveSelectedId = externalSelectedAgentId !== undefined ? externalSelectedAgentId : selectedAgentId;
  const handleSelect = useCallback((id: string | null) => {
    setSelectedAgentId(prev => {
      const next = prev === id ? null : id;
      onExternalSelectAgent?.(next);
      return next;
    });
  }, [onExternalSelectAgent]);

  // Auto-rotate camera after 10s of no interaction
  useEffect(() => {
    const checkInteraction = () => {
      if (Date.now() - lastInteractionRef.current > 10000) {
        setAutoRotating(true);
      }
    };
    const interval = setInterval(checkInteraction, 2000);
    return () => clearInterval(interval);
  }, []);

  // Reset auto-rotate on any pointer interaction
  const handlePointerInteract = useCallback(() => {
    lastInteractionRef.current = Date.now();
    setAutoRotating(false);
  }, []);

  // Camera presets: [cameraTarget x, y, z]
  const CAMERA_PRESETS: { label: string; target: [number, number, number]; title: string }[] = [
    { label: '⟐', title: 'Front view', target: [0, 0.5, 0] },
    { label: '↑', title: 'Top view', target: [0, 2, 0] },
    { label: '→', title: 'Side view', target: [4.5, 0.5, 0] },
  ];
  const [activePreset, setActivePreset] = useState<string>('⟐');

  // Reset camera to default centered view
  const handleCameraReset = useCallback(() => {
    cameraTargetRef.current = [0, 0.5, 0];
    setAutoRotating(false);
    setActivePreset('⟐');
    lastInteractionRef.current = Date.now();
  }, []);

  // Sync external selected agent into internal state
  useEffect(() => {
    if (externalSelectedAgentId !== undefined) {
      setSelectedAgentId(externalSelectedAgentId);
    }
  }, [externalSelectedAgentId]);

  const sceneAgents: SceneAgent[] = agents.map(agent => {
    const related = subAgents.filter(sa => sa.sessionKey?.includes(agent.id) || sa.taskName?.includes(agent.name || ''));
    const activeTask = related.find(sa => sa.status?.toLowerCase().includes('run') || sa.status?.toLowerCase().includes('active'));
    return {
      ...agent,
      sceneStatus: mapAgentStatus(agent.status),
      subAgentCount: related.length,
      taskName: activeTask?.taskName,
      startedAt: activeTask?.startedAt,
    };
  });

  // When sceneAgents or effectiveSelectedId changes, update camera target for smooth pan
  useEffect(() => {
    if (effectiveSelectedId !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = effectiveSelectedId;
      if (effectiveSelectedId) {
        const idx = sceneAgents.findIndex(a => a.id === effectiveSelectedId);
        if (idx >= 0) {
          const [ax, ay] = AGENT_POSITIONS[idx];
          cameraTargetRef.current = [ax, ay + 0.5, 0];
        }
      } else {
        cameraTargetRef.current = [0, 0.5, 0];
      }
    }
  }, [effectiveSelectedId, sceneAgents]);

  const taskFlows = sceneAgents.flatMap(fromAgent =>
    sceneAgents
      .filter(toAgent => fromAgent.id !== toAgent.id && fromAgent.sceneStatus === 'active')
      .map(toAgent => ({ id: fromAgent.id + '-' + toAgent.id, fromId: fromAgent.id, toId: toAgent.id, status: 'active' as const }))
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0, background: 'radial-gradient(ellipse at 50% 0%, #1a0d06 0%, #0d0804 55%, #080604 100%)' }}>
      {/* View mode toggle + camera presets */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
        {viewMode === '3d' ? (
          <div style={{ display: 'flex', gap: '4px', flexDirection: 'column', alignItems: 'flex-end' }}>
            {/* Camera presets */}
            <div style={{ display: 'flex', gap: '3px' }}>
              {CAMERA_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => {
                    cameraTargetRef.current = preset.target;
                    setActivePreset(preset.label);
                    setAutoRotating(false);
                    lastInteractionRef.current = Date.now();
                  }}
                  title={preset.title}
                  style={{
                    background: activePreset === preset.label ? 'rgba(59,122,255,0.2)' : 'rgba(10,14,26,0.8)',
                    border: '1px solid ' + (activePreset === preset.label ? '#3b7aff' : 'var(--border)'),
                    borderRadius: '7px', color: activePreset === preset.label ? '#3b7aff' : 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '11px', fontFamily: 'Space Grotesk, sans-serif',
                    fontWeight: 600, padding: '5px 10px', letterSpacing: '0.3px',
                    boxShadow: activePreset === preset.label ? '0 0 8px rgba(59,122,255,0.25)' : 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {/* Reset + view mode buttons */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={handleCameraReset}
                title="Reset camera to default view"
                style={{
                  background: 'rgba(10,14,26,0.8)',
                  border: '1px solid var(--border)',
                  borderRadius: '7px', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '11px', fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: 600, padding: '5px 10px', letterSpacing: '0.3px',
                  boxShadow: 'none', transition: 'all 0.2s',
                }}
              >
                ↺
              </button>
              {(['3d', '2d'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  style={{
                    background: viewMode === mode ? 'rgba(59,122,255,0.2)' : 'rgba(10,14,26,0.8)',
                    border: '1px solid ' + (viewMode === mode ? '#3b7aff' : 'var(--border)'),
                    borderRadius: '7px', color: viewMode === mode ? '#3b7aff' : 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '11px', fontFamily: 'Space Grotesk, sans-serif',
                    fontWeight: 600, padding: '5px 12px', letterSpacing: '0.3px',
                    boxShadow: viewMode === mode ? '0 0 10px rgba(59,122,255,0.25)' : 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  {mode === '3d' ? '◈ 3D View' : '⊞ 2D View'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['3d', '2d'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                style={{
                  background: viewMode === mode ? 'rgba(59,122,255,0.2)' : 'rgba(10,14,26,0.8)',
                  border: '1px solid ' + (viewMode === mode ? '#3b7aff' : 'var(--border)'),
                  borderRadius: '7px', color: viewMode === mode ? '#3b7aff' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '11px', fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: 600, padding: '5px 12px', letterSpacing: '0.3px',
                  boxShadow: viewMode === mode ? '0 0 10px rgba(59,122,255,0.25)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {mode === '3d' ? '◈ 3D View' : '⊞ 2D View'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Header bar */}
      <div style={{
        position: 'absolute', top: '10px', left: '14px', zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: '3px',
      }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
          🕹️ Agent Workshop
        </h3>
        <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: 0 }}>
          {sceneAgents.filter(a => a.sceneStatus === 'active').length} active · {sceneAgents.filter(a => a.sceneStatus === 'thinking').length} thinking
        </p>
        {autoRotating && viewMode === '3d' && (
          <p style={{ fontSize: '9px', color: 'var(--cyan)', margin: 0, opacity: 0.8, fontStyle: 'italic' }}>
            ↻ Auto-rotating — click to interact
          </p>
        )}
        {!autoRotating && viewMode === '3d' && (
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', margin: 0, opacity: 0.5 }}>
            Drag to orbit · Two fingers to pan · Scroll to zoom
          </p>
        )}
      </div>

      {/* 3D Scene Activity Ticker — in-canvas header */}
      <SceneActivityTicker />

      {viewMode === '3d' ? (
        <Canvas
          shadows
          camera={{ position: [0, 4, 10], fov: 50 }}
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onPointerDown={handlePointerInteract}
          onCreated={({ gl }) => {
            canvasRef.current = gl.domElement;
            gl.domElement.style.touchAction = 'none';
          }}
        >
          <Suspense fallback={null}>
            <Scene
              agents={sceneAgents}
              selectedAgentId={effectiveSelectedId}
              hoveredAgentId={hoveredAgentId}
              onHover={setHoveredAgentId}
              onSelectAgent={handleSelect}
              taskFlows={taskFlows}
              autoRotating={autoRotating}
              cameraTargetRef={cameraTargetRef}
              canvas={canvasRef.current}
            />
          </Suspense>
        </Canvas>
      ) : (
        <Fallback2DWorkshop
          agents={sceneAgents}
          selectedAgentId={effectiveSelectedId}
          onAgentClick={handleSelect}
        />
      )}
    </div>
  );
}
