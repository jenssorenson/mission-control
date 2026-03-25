import React, { useMemo } from 'react';

interface ContextPressureIndicatorProps {
  tokenUsage: number;
  startedAt: string | number;
  runtime: 'dev' | 'pi' | 'gemini';
  sessionKey: string;
}

// Context window sizes in tokens
const CONTEXT_WINDOWS: Record<string, number> = {
  dev: 1_000_000,    // 1M tokens
  pi: 128_000,       // 128K tokens
  gemini: 32_000,    // 32K tokens
};

export default function ContextPressureIndicator({
  tokenUsage,
  startedAt,
  runtime,
}: ContextPressureIndicatorProps) {
  const contextWindow = CONTEXT_WINDOWS[runtime] ?? CONTEXT_WINDOWS.dev;

  const metrics = useMemo(() => {
    const now = Date.now();
    const start = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt;
    const elapsedMs = Math.max(now - start, 0);
    const elapsedMinutes = elapsedMs / 60_000;

    const contextUsedPct = Math.min((tokenUsage / contextWindow) * 100, 100);
    const estimatedTokensRemaining = Math.max(contextWindow - tokenUsage, 0);

    let tokenRate = 0;
    let minutesUntilExhaustion: number | null = null;

    if (elapsedMinutes > 0 && tokenUsage > 0) {
      tokenRate = tokenUsage / elapsedMinutes;
      if (tokenRate > 0) {
        minutesUntilExhaustion = estimatedTokensRemaining / tokenRate;
      }
    }

    // Determine pressure level
    let level: 'healthy' | 'warm' | 'critical';
    let icon: string;
    let glowColor: string;

    if (contextUsedPct < 50) {
      level = 'healthy';
      icon = '💧';
      glowColor = 'rgba(74, 222, 128, 0.3)';
    } else if (contextUsedPct < 80) {
      level = 'warm';
      icon = '🌡️';
      glowColor = 'rgba(255, 183, 77, 0.35)';
    } else {
      level = 'critical';
      icon = '🔥';
      glowColor = 'rgba(255, 77, 77, 0.4)';
    }

    // Pick the more alarming text
    const isTimeCritical = minutesUntilExhaustion !== null && minutesUntilExhaustion < 15;
    const showMinutesLeft = isTimeCritical || contextUsedPct > 80;

    let labelText: string;
    if (showMinutesLeft && minutesUntilExhaustion !== null) {
      if (minutesUntilExhaustion < 1) {
        labelText = '<1min left';
      } else {
        labelText = `~${Math.round(minutesUntilExhaustion)}min left`;
      }
    } else {
      labelText = `${Math.round(contextUsedPct)}% full`;
    }

    return { contextUsedPct, level, icon, glowColor, labelText, tokenRate };
  }, [tokenUsage, startedAt, runtime, contextWindow]);

  const barColor = metrics.level === 'healthy'
    ? 'var(--green, #4ade80)'
    : metrics.level === 'warm'
    ? 'var(--yellow, #ffb74d)'
    : 'var(--red, #ff4d4d)';

  return (
    <div
      title={`${metrics.tokenRate > 0 ? `${Math.round(metrics.tokenRate).toLocaleString()}` : '—'} tokens/min`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height: '20px',
        padding: '0 4px',
        borderRadius: '4px',
        background: 'var(--bg-input, rgba(255,255,255,0.05))',
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        boxShadow: metrics.contextUsedPct > 50 ? `0 0 6px ${metrics.glowColor}` : 'none',
        transition: 'box-shadow 0.3s ease',
        cursor: 'default',
        minWidth: '90px',
      }}
    >
      <span style={{ fontSize: '10px', lineHeight: 1, flexShrink: 0 }}>{metrics.icon}</span>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: '4px',
          borderRadius: '2px',
          background: 'var(--bg-input, rgba(255,255,255,0.08))',
          overflow: 'hidden',
          minWidth: '40px',
        }}
      >
        <div
          style={{
            width: `${metrics.contextUsedPct}%`,
            height: '100%',
            borderRadius: '2px',
            background: barColor,
            boxShadow: `0 0 4px ${metrics.glowColor}`,
            transition: 'width 0.5s ease, background 0.3s ease',
          }}
        />
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: '9px',
          fontWeight: 600,
          color: barColor,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          letterSpacing: '0.02em',
        }}
      >
        {metrics.labelText}
      </span>
    </div>
  );
}
