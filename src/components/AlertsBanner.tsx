import { useState, useEffect, useRef } from 'react';
import type { SubAgent, Agent } from '../types';

// ─── Alert types ───────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  icon: string;
  title: string;
  detail: string;
  /** If provided, clicking the alert navigates to this action label */
  actionLabel?: string;
  onAction?: () => void;
  /** Key used to deduplicate alerts of the same type */
  alertKey: string;
  createdAt: number;
  acknowledged: boolean;
}

interface Props {
  subAgents: SubAgent[];
  agents: Agent[];
  gatewayConnected: boolean;
  pingLatency: number | null;
  cpuUsage: number | null;
  /** Cron jobs that failed in the last run */
  failedCronCount: number;
  /** Current estimated cost for today's sessions */
  todayCost: number;
  /** Cost threshold in dollars that triggers a warning alert */
  costThreshold?: number;
  onNavigateToTab?: (tab: string) => void;
  onOpenNotificationPanel?: () => void;
}

const COST_WARNING_THRESHOLD = 5; // $
const COST_CRITICAL_THRESHOLD = 15; // $
const LONG_RUNNING_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
const CRITICAL_RUNNING_THRESHOLD_MS = 40 * 60 * 1000; // 40 minutes
const HIGH_CPU_THRESHOLD = 85; // %
const HIGH_LATENCY_THRESHOLD = 500; // ms
const CONTEXT_PRESSURE_THRESHOLD = 80; // % — if any session is using >80% of estimated context budget

// ─── Cost estimation helpers (mirrors CostHistory.ts) ───────────────────────

const MODEL_PRICING: Record<string, [number, number]> = {
  dev:    [0.50, 1.50],
  pi:     [0.35, 1.05],
  gemini: [0.35, 1.05],
  default:[0.50, 1.50],
};

function estimateSessionCost(sa: SubAgent): number {
  const [inp, out] = MODEL_PRICING[sa.runtime] ?? MODEL_PRICING.default;
  const total = sa.tokenUsage ?? 0;
  const outputToks = Math.round(total * 0.30);
  const inputToks = total - outputToks;
  return (inputToks / 1_000_000) * inp + (outputToks / 1_000_000) * out;
}

// ─── Build current alert list ─────────────────────────────────────────────────

function buildAlerts(props: Props): Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>[] {
  const alerts: Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>[] = [];
  const { subAgents, agents, gatewayConnected, pingLatency, cpuUsage, failedCronCount, todayCost, costThreshold = COST_WARNING_THRESHOLD } = props;
  const now = Date.now();

  // 1. Gateway offline
  if (!gatewayConnected) {
    alerts.push({
      severity: 'critical',
      icon: '◉',
      title: 'Gateway Unreachable',
      detail: 'Cannot reach the OpenClaw gateway. Check that it is running.',
      alertKey: 'gateway_offline',
      actionLabel: 'Retry',
      onAction: () => window.dispatchEvent(new CustomEvent('mc:refresh')),
    });
  }

  // 2. High latency
  if (gatewayConnected && pingLatency !== null && pingLatency > HIGH_LATENCY_THRESHOLD) {
    alerts.push({
      severity: 'warning',
      icon: '📡',
      title: 'High Gateway Latency',
      detail: `Gateway ping is ${pingLatency}ms (threshold: ${HIGH_LATENCY_THRESHOLD}ms).`,
      alertKey: 'high_latency',
    });
  }

  // 3. High CPU
  if (cpuUsage !== null && cpuUsage > HIGH_CPU_THRESHOLD) {
    alerts.push({
      severity: gatewayConnected ? 'warning' : 'critical',
      icon: '📊',
      title: 'High CPU Usage',
      detail: `Gateway CPU is at ${cpuUsage}% (threshold: ${HIGH_CPU_THRESHOLD}%).`,
      alertKey: 'high_cpu',
    });
  }

  // 4. Failed cron jobs
  if (failedCronCount > 0) {
    alerts.push({
      severity: 'warning',
      icon: '⏰',
      title: `${failedCronCount} Cron Job${failedCronCount !== 1 ? 's' : ''} Failed`,
      detail: `Recent cron runs ended in failure. Check the Cron tab for details.`,
      alertKey: 'failed_crons',
      actionLabel: 'View Cron Jobs',
      onAction: () => props.onNavigateToTab?.('cron'),
    });
  }

  // 5. Session at risk of timing out (>20 min)
  const atRiskSessions = subAgents.filter(sa => sa.startedAt && (now - sa.startedAt) > LONG_RUNNING_THRESHOLD_MS && (now - sa.startedAt) <= CRITICAL_RUNNING_THRESHOLD_MS);
  if (atRiskSessions.length > 0) {
    alerts.push({
      severity: 'warning',
      icon: '⏱',
      title: `${atRiskSessions.length} Session${atRiskSessions.length !== 1 ? 's' : ''} At Risk`,
      detail: `Long-running sessions approaching the 60-minute timeout. Consider reviewing.`,
      alertKey: 'sessions_at_risk',
      actionLabel: 'View Sessions',
      onAction: () => props.onNavigateToTab?.('monitor'),
    });
  }

  // 6. Sessions at critical timeout risk (>40 min)
  const criticalSessions = subAgents.filter(sa => sa.startedAt && (now - sa.startedAt) > CRITICAL_RUNNING_THRESHOLD_MS);
  if (criticalSessions.length > 0) {
    alerts.push({
      severity: 'critical',
      icon: '🚨',
      title: `${criticalSessions.length} Critical Session${criticalSessions.length !== 1 ? 's' : ''}`,
      detail: `Sessions exceeding 40 minutes — imminent timeout risk.`,
      alertKey: 'sessions_critical',
      actionLabel: 'View Sessions',
      onAction: () => props.onNavigateToTab?.('monitor'),
    });
  }

  // 7. Session slot near capacity
  if (subAgents.length >= 4 && subAgents.length < 5) {
    alerts.push({
      severity: 'info',
      icon: '🔗',
      title: 'Session Slots Nearly Full',
      detail: `${subAgents.length}/5 session slots in use. New spawns may fail.`,
      alertKey: 'slots_near_full',
    });
  } else if (subAgents.length >= 5) {
    alerts.push({
      severity: 'critical',
      icon: '🔗',
      title: 'All Session Slots Occupied',
      detail: `All 5 session slots are in use. No new sessions can be spawned until slots free up.`,
      alertKey: 'slots_full',
      actionLabel: 'View Sessions',
      onAction: () => props.onNavigateToTab?.('monitor'),
    });
  }

  // 8. High context pressure (tokens growing rapidly in short time)
  const highContextSessions = subAgents.filter(sa => {
    if (!sa.startedAt || !sa.tokenUsage) return false;
    const ageSecs = (now - sa.startedAt) / 1000;
    if (ageSecs < 60) return false; // need at least 1 min of data
    const rate = (sa.tokenUsage / ageSecs) * 60; // tokens per minute
    // Flag if rate > 2000 tok/min (rapid consumer)
    return rate > 2000;
  });
  if (highContextSessions.length > 0) {
    alerts.push({
      severity: 'warning',
      icon: '🧠',
      title: `${highContextSessions.length} Context-Hungry Session${highContextSessions.length !== 1 ? 's' : ''}`,
      detail: `Rapid token consumption: ${highContextSessions.map(s => s.taskName?.slice(0, 20) || s.sessionKey.slice(0, 8)).join(', ')}. May exhaust context budget.`,
      alertKey: 'high_context',
    });
  }

  // 9. All agents idle + sessions running (possible deadlock)
  const idleAgents = agents.filter(a => a.status === 'idle');
  if (idleAgents.length === agents.length && agents.length > 0 && subAgents.length === 0) {
    alerts.push({
      severity: 'info',
      icon: '💤',
      title: 'All Agents Idle',
      detail: `No active sessions and all agents are idle. System is waiting for tasks.`,
      alertKey: 'all_idle',
    });
  }

  return alerts;
}

// ─── Single alert chip ─────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<AlertSeverity, { bg: string; border: string; color: string; iconBg: string }> = {
  critical: {
    bg: 'rgba(248,113,113,0.12)',
    border: 'rgba(248,113,113,0.4)',
    color: 'var(--red)',
    iconBg: 'rgba(248,113,113,0.2)',
  },
  warning: {
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.3)',
    color: 'var(--yellow)',
    iconBg: 'rgba(251,191,36,0.15)',
  },
  info: {
    bg: 'rgba(59,122,255,0.08)',
    border: 'rgba(59,122,255,0.25)',
    color: 'var(--accent)',
    iconBg: 'rgba(59,122,255,0.12)',
  },
};

function AlertChip({ alert, onDismiss, onAction }: {
  alert: Alert;
  onDismiss: (id: string) => void;
  onAction?: (alert: Alert) => void;
}) {
  const styles = SEVERITY_STYLES[alert.severity];
  return (
    <div
      className={`ab-alert-chip${alert.severity === 'critical' ? ' ab-alert-chip--critical' : alert.severity === 'warning' ? ' ab-alert-chip--warning' : ' ab-alert-chip--info'}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: '8px',
        padding: '4px 8px',
        fontSize: '11px',
        fontFamily: "'Space Grotesk', sans-serif",
        color: styles.color,
        boxShadow: alert.severity === 'critical' ? '0 0 8px rgba(248,113,113,0.2)' : 'none',
        animation: alert.severity === 'critical' ? 'ab-pulse-critical 2s ease-in-out infinite' : undefined,
        flexShrink: 0,
        maxWidth: '280px',
      }}
      title={alert.detail}
    >
      {/* Icon */}
      <span style={{
        fontSize: '12px',
        background: styles.iconBg,
        borderRadius: '5px',
        padding: '2px 4px',
        flexShrink: 0,
        lineHeight: 1,
      }}>
        {alert.icon}
      </span>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {alert.title}
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
          {alert.detail}
        </div>
      </div>

      {/* Action button */}
      {alert.actionLabel && onAction && (
        <button
          onClick={(e) => { e.stopPropagation(); onAction(alert); }}
          style={{
            background: styles.iconBg,
            border: `1px solid ${styles.border}`,
            borderRadius: '5px',
            color: styles.color,
            cursor: 'pointer',
            fontSize: '9px',
            fontWeight: 700,
            fontFamily: "'Space Grotesk', sans-serif",
            padding: '2px 6px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          {alert.actionLabel}
        </button>
      )}

      {/* Dismiss */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
        title="Dismiss alert"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '10px',
          padding: '2px',
          flexShrink: 0,
          lineHeight: 1,
          borderRadius: '3px',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = styles.color)}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

let _alertIdCounter = 0;
function nextId() { return `alert-${++_alertIdCounter}-${Date.now()}`; }

export default function AlertsBanner(props: Props) {
  // Persist acknowledged/dismissed alerts in memory across re-renders
  // (keyed by alertKey — dismissed alerts stay dismissed until condition clears)
  const acknowledgedRef = useRef<Set<string>>(new Set());
  const [visibleAlerts, setVisibleAlerts] = useState<Alert[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Rebuild alerts whenever inputs change
  useEffect(() => {
    const newAlerts = buildAlerts(props);
    const now = Date.now();

    // Merge: keep existing acknowledged state, create new Alert objects
    const merged: Alert[] = newAlerts.map(a => {
      const wasAcknowledged = acknowledgedRef.current.has(a.alertKey);
      return {
        ...a,
        id: nextId(),
        createdAt: now,
        acknowledged: wasAcknowledged,
      };
    });

    setVisibleAlerts(merged);
  }, [
    props.subAgents.length,
    props.subAgents.map(sa => `${sa.sessionKey}:${sa.startedAt}:${sa.tokenUsage}`).join(','),
    props.agents.map(a => `${a.id}:${a.status}`).join(','),
    props.gatewayConnected,
    props.pingLatency,
    props.cpuUsage,
    props.failedCronCount,
    props.todayCost,
  ]);

  // Separate critical/warning from info for display
  const criticalAlerts = visibleAlerts.filter(a => a.severity === 'critical' && !a.acknowledged);
  const warningAlerts = visibleAlerts.filter(a => a.severity === 'warning' && !a.acknowledged);
  const infoAlerts = visibleAlerts.filter(a => a.severity === 'info' && !a.acknowledged);
  const acknowledgedAlerts = visibleAlerts.filter(a => a.acknowledged);

  const totalActive = criticalAlerts.length + warningAlerts.length + infoAlerts.length;

  function handleDismiss(id: string) {
    const alert = visibleAlerts.find(a => a.id === id);
    if (alert) {
      acknowledgedRef.current.add(alert.alertKey);
      setVisibleAlerts(prev => prev.filter(a => a.id !== id));
    }
  }

  function handleAction(alert: Alert) {
    alert.onAction?.();
    // Auto-dismiss info-level alerts when action is taken
    if (alert.severity === 'info') {
      handleDismiss(alert.id);
    }
  }

  if (totalActive === 0 && acknowledgedAlerts.length === 0) {
    return null;
  }

  const MAX_VISIBLE = 4;
  const visible = showAll
    ? [...criticalAlerts, ...warningAlerts, ...infoAlerts]
    : [...criticalAlerts, ...warningAlerts].slice(0, MAX_VISIBLE);

  return (
    <div
      className="alerts-banner"
      style={{
        background: 'rgba(15,17,26,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${criticalAlerts.length > 0 ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`,
        padding: '5px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflow: 'hidden',
        transition: 'border-color 0.4s',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {/* Banner label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        flexShrink: 0,
        fontSize: '10px',
        fontWeight: 700,
        color: criticalAlerts.length > 0 ? 'var(--red)' : warningAlerts.length > 0 ? 'var(--yellow)' : 'var(--accent)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
      }}>
        {criticalAlerts.length > 0 && <span style={{ fontSize: '12px' }}>🚨</span>}
        {warningAlerts.length > 0 && criticalAlerts.length === 0 && <span style={{ fontSize: '12px' }}>⚠</span>}
        {totalActive === 0 && acknowledgedAlerts.length > 0 && <span style={{ fontSize: '12px' }}>✓</span>}
        <span>Alerts</span>
        {totalActive > 0 && (
          <span style={{
            background: criticalAlerts.length > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(251,191,36,0.2)',
            color: criticalAlerts.length > 0 ? 'var(--red)' : 'var(--yellow)',
            border: `1px solid ${criticalAlerts.length > 0 ? 'rgba(248,113,113,0.4)' : 'rgba(251,191,36,0.4)'}`,
            borderRadius: '10px',
            padding: '0 5px',
            fontSize: '9px',
            fontWeight: 800,
          }}>
            {totalActive}
          </span>
        )}
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        overflow: 'hidden',
      }}>
        {/* Show active alerts */}
        {visible.map(alert => (
          <AlertChip
            key={alert.id}
            alert={alert}
            onDismiss={handleDismiss}
            onAction={handleAction}
          />
        ))}

        {/* Show ellipsis when hiding some alerts */}
        {!showAll && totalActive > MAX_VISIBLE && (
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: 'rgba(59,122,255,0.1)',
              border: '1px solid rgba(59,122,255,0.25)',
              borderRadius: '8px',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '10px',
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              padding: '4px 8px',
              flexShrink: 0,
            }}
          >
            +{totalActive - MAX_VISIBLE} more
          </button>
        )}

        {/* Show count of acknowledged alerts */}
        {acknowledgedAlerts.length > 0 && (
          <span style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '2px 6px',
            flexShrink: 0,
          }}>
            ✓ {acknowledgedAlerts.length} resolved
          </span>
        )}
      </div>

      {/* Expand/collapse */}
      {(criticalAlerts.length + warningAlerts.length + infoAlerts.length) > 1 && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '9px',
            fontFamily: "'Space Grotesk', sans-serif",
            padding: '2px 7px',
            flexShrink: 0,
          }}
          title={expanded ? 'Collapse alerts' : 'Expand all alerts'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      )}
    </div>
  );
}
