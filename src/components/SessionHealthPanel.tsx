import { useState } from 'react';
import type { SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

interface SessionHealth {
  sessionKey: string;
  taskName?: string;
  runtime: string;
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: HealthIssue[];
  recommendation: string;
  // raw metrics
  tokenRate: number | null;
  ageMin: number;
  tokens: number;
  status: string;
  startedAt?: number;
}

interface HealthIssue {
  icon: string;
  label: string;
  detail: string;
  severity: 'info' | 'warn' | 'critical';
}

const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

function calcSessionHealth(sa: SubAgent): SessionHealth {
  const now = Date.now();
  const ageMs = sa.startedAt ? now - sa.startedAt : 0;
  const ageMin = Math.floor(ageMs / 60000);
  const elapsedSecs = ageMs / 1000;
  const tokenRate = elapsedSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / elapsedSecs) * 60) : null;
  const tokens = sa.tokenUsage ?? 0;

  const issues: HealthIssue[] = [];
  let score = 100;
  const agePct = (ageMs / SESSION_MAX_AGE_MS) * 100;

  // ── Age scoring ────────────────────────────────────────────────────────────
  if (agePct >= 100) {
    issues.push({ icon: '⏱', label: 'Expired', detail: `Session has exceeded the 60min hard limit`, severity: 'critical' });
    score -= 60;
  } else if (agePct >= 80) {
    issues.push({ icon: '⏱', label: 'Near timeout', detail: `${ageMin}+ min — approaching 60min limit`, severity: 'critical' });
    score -= 40;
  } else if (agePct >= 50) {
    issues.push({ icon: '⏱', label: 'Long-running', detail: `${ageMin} min — past half the session limit`, severity: 'warn' });
    score -= 20;
  } else if (ageMin >= 5) {
    issues.push({ icon: '⏱', label: 'Aging', detail: `Running for ${ageMin} min`, severity: 'info' });
    score -= 5;
  }

  // ── Token rate scoring ─────────────────────────────────────────────────────
  if (tokenRate !== null) {
    if (tokenRate > 1500) {
      issues.push({ icon: '📈', label: 'High burn', detail: `${tokenRate} tok/min — very high consumption`, severity: 'critical' });
      score -= 35;
    } else if (tokenRate > 1000) {
      issues.push({ icon: '📈', label: 'Elevated burn', detail: `${tokenRate} tok/min — above normal range`, severity: 'warn' });
      score -= 20;
    } else if (tokenRate > 600) {
      issues.push({ icon: '📈', label: 'Moderate burn', detail: `${tokenRate} tok/min`, severity: 'info' });
      score -= 8;
    } else if (tokenRate < 10 && ageMin > 2) {
      issues.push({ icon: '🐢', label: 'Stalled', detail: `Only ${tokenRate} tok/min after ${ageMin} min — may be idle or stuck`, severity: 'warn' });
      score -= 25;
    }
  } else if (ageMin > 1) {
    issues.push({ icon: '❓', label: 'No output yet', detail: `No tokens measured after ${ageMin}+ min`, severity: 'warn' });
    score -= 15;
  }

  // ── Status scoring ────────────────────────────────────────────────────────
  const statusLower = (sa.status || '').toLowerCase();
  if (statusLower.includes('error')) {
    issues.push({ icon: '✕', label: 'Error state', detail: `Session status: ${sa.status}`, severity: 'critical' });
    score -= 50;
  } else if (statusLower.includes('think') && ageMin > 10) {
    issues.push({ icon: '💭', label: 'Stuck thinking', detail: `Thinking for ${ageMin}+ min`, severity: 'warn' });
    score -= 15;
  }

  // ── Cost scoring ──────────────────────────────────────────────────────────
  const cost = tokens > 0 ? ((tokens * 0.70) / 1e6) * 0.50 + ((tokens * 0.30) / 1e6) * 1.50 : 0;
  if (cost > 5) {
    issues.push({ icon: '💰', label: 'Expensive', detail: `~$${cost.toFixed(2)} estimated cost`, severity: 'warn' });
    score -= 15;
  } else if (cost > 2) {
    issues.push({ icon: '💰', label: 'Costly', detail: `~$${cost.toFixed(2)} so far`, severity: 'info' });
    score -= 5;
  }

  // ── Tokens without rate (very new session) ────────────────────────────────
  if (tokens > 5000 && (tokenRate === null || tokenRate === 0) && ageMin < 2) {
    issues.push({ icon: '🚀', label: 'Heavy start', detail: `${tokens.toLocaleString()} tokens in first 2 min`, severity: 'info' });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 30 ? 'D' : 'F';

  // ── Recommendation ───────────────────────────────────────────────────────
  let recommendation = '';
  if (grade === 'A') {
    recommendation = 'Healthy — no action needed';
  } else if (issues.some(i => i.severity === 'critical')) {
    const critical = issues.find(i => i.severity === 'critical');
    recommendation = `Kill or wait — ${critical?.label.toLowerCase()}`;
  } else if (grade === 'D' || grade === 'F') {
    recommendation = 'Consider terminating — multiple issues';
  } else {
    recommendation = 'Monitor closely — some concerns';
  }

  return {
    sessionKey: sa.sessionKey,
    taskName: sa.taskName,
    runtime: sa.runtime,
    score,
    grade,
    issues,
    recommendation,
    tokenRate,
    ageMin,
    tokens,
    status: sa.status || 'unknown',
    startedAt: sa.startedAt,
  };
}

function HealthGradeRing({ score, size = 36 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 30 ? 'D' : 'F';
  const gradeColor = score >= 90 ? 'var(--green)' : score >= 75 ? 'var(--cyan)' : score >= 55 ? 'var(--yellow)' : score >= 30 ? 'var(--orange)' : 'var(--red)';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-input)" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={gradeColor} strokeWidth={3}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s', filter: `drop-shadow(0 0 4px ${gradeColor}66)` }}
        />
      </svg>
      <span style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size === 36 ? '12px' : '10px', fontWeight: 800,
        fontFamily: "'JetBrains Mono', monospace",
        color: gradeColor,
      }}>
        {grade}
      </span>
    </div>
  );
}

function FleetHealthBar({ healthScores }: { healthScores: number[] }) {
  if (healthScores.length === 0) return null;
  const avg = Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length);
  const gradeColor = avg >= 90 ? 'var(--green)' : avg >= 75 ? 'var(--cyan)' : avg >= 55 ? 'var(--yellow)' : avg >= 30 ? 'var(--orange)' : 'var(--red)';
  const countByGrade = healthScores.reduce((acc, s) => {
    const g = s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 55 ? 'C' : s >= 30 ? 'D' : 'F';
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const grades = ['A', 'B', 'C', 'D', 'F'] as const;
  const gradeColors: Record<string, string> = { A: 'var(--green)', B: 'var(--cyan)', C: 'var(--yellow)', D: 'var(--orange)', F: 'var(--red)' };

  return (
    <div style={{
      background: 'var(--bg-input)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: '14px',
    }}>
      {/* Fleet score */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: gradeColor, lineHeight: 1 }}>{avg}</span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>Fleet score</span>
      </div>
      <div style={{ width: '1px', height: '32px', background: 'var(--border)' }} />
      {/* Grade distribution */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1 }}>
        {grades.map(g => {
          const cnt = countByGrade[g] || 0;
          if (cnt === 0) return null;
          return (
            <div key={g} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: gradeColors[g] }}>{g}</span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>×{cnt}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif", minWidth: '36px' }}>Health</span>
          <div style={{ flex: 1, height: '6px', background: 'var(--bg-deep)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{
              width: `${avg}%`, height: '100%',
              background: `linear-gradient(90deg, ${gradeColor}, ${gradeColor}aa)`,
              borderRadius: '3px',
              boxShadow: `0 0 6px ${gradeColor}55`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: gradeColor, minWidth: '24px', textAlign: 'right' }}>{avg}</span>
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
          Avg across {healthScores.length} session{healthScores.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}

function SessionHealthRow({ health, expanded, onToggle }: {
  health: SessionHealth;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gradeColor = health.score >= 90 ? 'var(--green)' : health.score >= 75 ? 'var(--cyan)' : health.score >= 55 ? 'var(--yellow)' : health.score >= 30 ? 'var(--orange)' : 'var(--red)';
  const runtimeColor = health.runtime === 'dev' ? 'var(--dev)' : health.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)';

  return (
    <div className={`health-session-row health-session-row--${health.grade.toLowerCase()}`}>
      <div className="health-session-header" onClick={onToggle}>
        <HealthGradeRing score={health.score} />
        <div className="health-session-info" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '11px', fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--accent)', flexShrink: 0,
              }}
              title={health.sessionKey}
            >
              {health.sessionKey.slice(0, 10)}…
            </span>
            <span
              style={{
                fontSize: '10px', fontWeight: 600, color: runtimeColor,
                background: `${runtimeColor}14`, border: `1px solid ${runtimeColor}44`,
                borderRadius: '8px', padding: '1px 5px', flexShrink: 0,
              }}
            >
              {health.runtime === 'pi' ? 'Pi' : health.runtime.charAt(0).toUpperCase() + health.runtime.slice(1)}
            </span>
            {health.taskName && (
              <span style={{
                fontSize: '10px', color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              }}>
                {health.taskName.length > 40 ? health.taskName.slice(0, 40) + '…' : health.taskName}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
              {health.ageMin}m · {health.tokens >= 1000 ? `${(health.tokens / 1000).toFixed(0)}k` : health.tokens} tok
            </span>
            {health.tokenRate !== null && (
              <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: health.tokenRate > 1000 ? 'var(--yellow)' : health.tokenRate > 500 ? 'var(--cyan)' : 'var(--text-muted)' }}>
                {health.tokenRate} tok/min
              </span>
            )}
            <span style={{
              fontSize: '9px', fontFamily: "'Space Grotesk', sans-serif",
              color: gradeColor, fontWeight: 600,
            }}>
              {health.recommendation}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {health.issues.filter(i => i.severity === 'critical').length > 0 && (
            <span style={{
              fontSize: '9px', fontWeight: 700, color: 'var(--red)',
              background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: '8px', padding: '1px 5px',
            }}>
              ⚠ {health.issues.filter(i => i.severity === 'critical').length} critical
            </span>
          )}
          <button
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '12px', padding: '2px 4px',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▼
          </button>
        </div>
      </div>

      {expanded && (
        <div className="health-session-detail">
          {health.issues.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--green)', padding: '4px 8px' }}>
              ✓ Session is healthy — no issues detected
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' }}>
              {health.issues.map((issue, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '5px 8px',
                  background: issue.severity === 'critical' ? 'rgba(248,113,113,0.06)' :
                              issue.severity === 'warn' ? 'rgba(251,191,36,0.06)' :
                              'rgba(59,122,255,0.04)',
                  border: `1px solid ${issue.severity === 'critical' ? 'rgba(248,113,113,0.2)' : issue.severity === 'warn' ? 'rgba(251,191,36,0.2)' : 'rgba(59,122,255,0.1)'}`,
                  borderRadius: '6px',
                }}>
                  <span style={{ fontSize: '12px', flexShrink: 0 }}>{issue.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        fontSize: '10px', fontWeight: 700,
                        color: issue.severity === 'critical' ? 'var(--red)' : issue.severity === 'warn' ? 'var(--yellow)' : 'var(--accent)',
                        fontFamily: "'Space Grotesk', sans-serif",
                      }}>
                        {issue.label}
                      </span>
                      <span style={{
                        fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px',
                        color: issue.severity === 'critical' ? 'var(--red)' : issue.severity === 'warn' ? 'var(--yellow)' : 'var(--text-muted)',
                        background: issue.severity === 'critical' ? 'rgba(248,113,113,0.1)' :
                                    issue.severity === 'warn' ? 'rgba(251,191,36,0.1)' :
                                    'rgba(59,122,255,0.08)',
                        borderRadius: '4px', padding: '1px 4px',
                      }}>
                        {issue.severity}
                      </span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: "'Space Grotesk', sans-serif" }}>
                      {issue.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  subAgents: SubAgent[];
  onKillSession?: (sessionKey: string, taskName?: string) => void;
}

export default function SessionHealthPanel({ subAgents, onKillSession }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'score' | 'age' | 'rate'>('score');

  const healthList: SessionHealth[] = subAgents.map(calcSessionHealth);

  const sorted = [...healthList].sort((a, b) => {
    if (sortBy === 'score') return a.score - b.score; // worst first
    if (sortBy === 'age') return b.ageMin - a.ageMin;
    if (sortBy === 'rate') return (b.tokenRate ?? 0) - (a.tokenRate ?? 0);
    return 0;
  });

  const fleetScores = healthList.map(h => h.score);
  const avgHealth = fleetScores.length > 0 ? Math.round(fleetScores.reduce((a, b) => a + b, 0) / fleetScores.length) : null;
  const criticalCount = healthList.filter(h => h.grade === 'F' || h.grade === 'D').length;
  const needsAttention = healthList.filter(h => h.score < 75);

  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (subAgents.length === 0) {
    return (
      <div className="health-panel">
        <div className="health-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🏥</span>
            <h3 style={{ margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>Session Health</h3>
          </div>
        </div>
        <div style={{
          textAlign: 'center', padding: '24px', color: 'var(--text-muted)',
          fontSize: '12px', fontFamily: "'Space Grotesk', sans-serif",
        }}>
          No sessions to evaluate — spawn sessions from the Monitor tab to see health data
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary name="SessionHealthPanel">
      <div className="health-panel">
        <div className="health-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🏥</span>
            <h3 style={{ margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>Session Health</h3>
            {criticalCount > 0 && (
              <span style={{
                fontSize: '10px', fontWeight: 700, color: 'var(--red)',
                background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: '8px', padding: '1px 6px',
              }}>
                ⚠ {criticalCount} need attention
              </span>
            )}
            {needsAttention.length === 0 && subAgents.length > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 600 }}>✓ All healthy</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              {(['score', 'age', 'rate'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  style={{
                    background: sortBy === s ? 'rgba(59,122,255,0.15)' : 'transparent',
                    border: `1px solid ${sortBy === s ? 'rgba(59,122,255,0.4)' : 'var(--border)'}`,
                    borderRadius: '6px', color: sortBy === s ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                    fontFamily: "'Space Grotesk', sans-serif",
                    padding: '2px 7px', transition: 'all 0.15s',
                  }}
                >
                  {s === 'score' ? 'Score' : s === 'age' ? 'Age' : 'Rate'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: '11px', padding: '3px 8px', fontFamily: "'Space Grotesk', sans-serif",
                transition: 'all 0.15s',
              }}
            >
              {expanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </div>

        {/* Fleet health bar */}
        <FleetHealthBar healthScores={fleetScores} />

        {/* Aggregate recommendation banner */}
        {needsAttention.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '8px', padding: '7px 12px', marginTop: '8px',
          }}>
            <span style={{ fontSize: '13px' }}>💡</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--yellow)', fontFamily: "'Space Grotesk', sans-serif" }}>
                {needsAttention.length} session{needsAttention.length !== 1 ? 's' : ''} need attention
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginLeft: '6px', fontFamily: "'Space Grotesk', sans-serif" }}>
                Worst: {needsAttention[0]?.taskName?.slice(0, 35) || needsAttention[0]?.sessionKey.slice(0, 10)}…
                ({needsAttention[0]?.grade} — {needsAttention[0]?.recommendation})
              </span>
            </div>
            {onKillSession && needsAttention.length > 0 && (
              <button
                onClick={() => {
                  const worst = needsAttention[0];
                  if (worst && confirm(`Kill session "${worst.taskName?.slice(0, 40) || worst.sessionKey.slice(0, 8)}"?`)) {
                    onKillSession(worst.sessionKey, worst.taskName);
                  }
                }}
                style={{
                  background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                  borderRadius: '6px', color: 'var(--red)', cursor: 'pointer',
                  fontSize: '10px', fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
                  padding: '3px 8px', flexShrink: 0,
                }}
              >
                Kill worst
              </button>
            )}
          </div>
        )}

        {/* Session health rows */}
        <div className="health-session-list">
          {sorted.map(health => (
            <SessionHealthRow
              key={health.sessionKey}
              health={health}
              expanded={expanded || expandedRows.has(health.sessionKey)}
              onToggle={() => toggleRow(health.sessionKey)}
            />
          ))}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: '12px', flexWrap: 'wrap',
          padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: '4px',
        }}>
          {[
            { grade: 'A', range: '90–100', desc: 'Healthy', color: 'var(--green)' },
            { grade: 'B', range: '75–89', desc: 'Minor issues', color: 'var(--cyan)' },
            { grade: 'C', range: '55–74', desc: 'Moderate concerns', color: 'var(--yellow)' },
            { grade: 'D', range: '30–54', desc: 'Significant issues', color: 'var(--orange)' },
            { grade: 'F', range: '0–29', desc: 'Critical / kill', color: 'var(--red)' },
          ].map(({ grade, range, desc, color }) => (
            <div key={grade} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                fontSize: '10px', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                color, background: `${color}14`, border: `1px solid ${color}44`,
                borderRadius: '5px', padding: '1px 5px',
              }}>
                {grade}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                {desc} ({range})
              </span>
            </div>
          ))}
        </div>
      </div>
    </ErrorBoundary>
  );
}
