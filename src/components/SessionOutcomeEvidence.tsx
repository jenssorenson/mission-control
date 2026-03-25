import { useState } from 'react';
import type { SubAgent, ActivityEvent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Work type inference ───────────────────────────────────────────────────────

type WorkType = 'bugfix' | 'feature' | 'refactor' | 'review' | 'research' | 'docs' | 'test' | 'unknown';

const WORK_TYPE_CONFIG: Record<WorkType, { icon: string; label: string; color: string; keywords: string[] }> = {
  bugfix:    { icon: '🐛', label: 'Bug Fix',     color: 'var(--red)',    keywords: ['bug', 'fix', 'error', 'crash', 'broken', 'issue', 'patch', 'hotfix'] },
  feature:   { icon: '✨', label: 'Feature',    color: 'var(--green)',  keywords: ['implement', 'add', 'create', 'build', 'feature', 'new', ' functionality'] },
  refactor:  { icon: '♻️',  label: 'Refactor',   color: 'var(--cyan)',   keywords: ['refactor', 'restructure', 'clean', 'improve', 'optimize', 'rewrite'] },
  review:    { icon: '🔍', label: 'Code Review',color: 'var(--yellow)', keywords: ['review', 'audit', 'check', 'analyze', 'assess', 'evaluate'] },
  research:  { icon: '🔬', label: 'Research',   color: 'var(--accent)', keywords: ['research', 'investigate', 'explore', 'find', 'search', 'study'] },
  docs:      { icon: '📝', label: 'Docs',       color: 'var(--text-muted)', keywords: ['doc', 'readme', 'comment', 'guide', 'tutorial', 'documentation'] },
  test:      { icon: '🧪', label: 'Test',       color: 'var(--pi)',     keywords: ['test', 'spec', 'coverage', 'unit test', 'integration test'] },
  unknown:   { icon: '⚙️',  label: 'Task',      color: 'var(--text-secondary)', keywords: [] },
};

function inferWorkType(taskName?: string): WorkType {
  if (!taskName) return 'unknown';
  const lower = taskName.toLowerCase();
  let bestMatch: WorkType = 'unknown';
  let bestScore = 0;
  for (const [type, config] of Object.entries(WORK_TYPE_CONFIG)) {
    if (type === 'unknown') continue;
    let score = 0;
    for (const kw of config.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = type as WorkType;
    }
  }
  return bestScore > 0 ? bestMatch : 'unknown';
}

// ─── File path extraction from task text ──────────────────────────────────────

function extractFilePaths(taskName?: string): string[] {
  if (!taskName) return [];
  // Match common file path patterns
  const patterns = [
    // /path/to/file.ext or ~/path or ./path
    /(?:~|\.|\/)[^\s'",;]+(?:\.[a-zA-Z0-9]+)/g,
    // "file.ext" at word boundaries
    /"[^\n"]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|html|css|py|sh|sql|env)"/g,
  ];
  const matches = new Set<string>();
  for (const pattern of patterns) {
    const found = taskName.match(pattern);
    if (found) {
      found.forEach(m => {
        // Clean up surrounding quotes/punctuation
        const cleaned = m.replace(/^["']|["']$/g, '').trim();
        if (cleaned.length > 2 && cleaned.length < 200) {
          matches.add(cleaned);
        }
      });
    }
  }
  return Array.from(matches).slice(0, 8);
}

// ─── Outcome summary generation ────────────────────────────────────────────────

interface OutcomeEvidence {
  workType: WorkType;
  workTypeConfig: typeof WORK_TYPE_CONFIG[keyof typeof WORK_TYPE_CONFIG];
  filePaths: string[];
  summary: string;
  outcome: 'completed' | 'killed' | 'timeout' | 'error' | 'unknown';
  outcomeConfig: { icon: string; color: string; label: string };
  durationSecs: number;
  tokensPerMin: number | null;
}

function buildEvidence(sa: SubAgent, activities: ActivityEvent[]): OutcomeEvidence {
  const workType = inferWorkType(sa.taskName);
  const workTypeConfig = WORK_TYPE_CONFIG[workType];
  const filePaths = extractFilePaths(sa.taskName);

  // Determine outcome from status and session state
  let outcome: OutcomeEvidence['outcome'] = 'unknown';
  const statusLower = (sa.status || '').toLowerCase();
  if (statusLower.includes('error') || statusLower.includes('fail')) {
    outcome = 'error';
  } else if (sa.startedAt && sa.tokenUsage === 0) {
    outcome = 'timeout';
  } else if (!sa.startedAt) {
    outcome = 'killed';
  } else {
    outcome = 'completed';
  }

  const outcomeConfig = {
    completed: { icon: '✓', color: 'var(--green)', label: 'Completed' },
    killed:    { icon: '■',  color: 'var(--yellow)', label: 'Killed' },
    timeout:   { icon: '⏱', color: 'var(--orange)', label: 'Timeout' },
    error:     { icon: '✕', color: 'var(--red)', label: 'Error' },
    unknown:   { icon: '?',  color: 'var(--text-muted)', label: 'Unknown' },
  }[outcome];

  const durationSecs = sa.startedAt ? Math.floor((Date.now() - sa.startedAt) / 1000) : 0;
  const tokensPerMin = durationSecs > 0 && sa.tokenUsage ? Math.round((sa.tokenUsage / durationSecs) * 60) : null;

  // Generate summary sentence
  const tokens = sa.tokenUsage ?? 0;
  const tokensStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

  let summary = '';
  if (outcome === 'completed') {
    if (workType === 'bugfix') {
      summary = `Investigated and fixed a bug${filePaths.length > 0 ? ` in ${filePaths[0].split('/').pop()}` : ''}, consuming ${tokensStr} tokens in ${durationSecs}s.`;
    } else if (workType === 'feature') {
      summary = `Implemented a new feature${filePaths.length > 0 ? `, creating/modifying ${filePaths.length} file${filePaths.length !== 1 ? 's' : ''}` : ''}, using ${tokensStr} tokens.`;
    } else if (workType === 'refactor') {
      summary = `Refactored code${filePaths.length > 0 ? ` in ${filePaths.length} file${filePaths.length !== 1 ? 's' : ''}` : ''}, consuming ${tokensStr} tokens.`;
    } else if (workType === 'review') {
      summary = `Reviewed code${filePaths.length > 0 ? ` (${filePaths.slice(0, 2).map(p => p.split('/').pop()).join(', ')})` : ''}, analyzing ${tokensStr} tokens of context.`;
    } else if (workType === 'research') {
      summary = `Researched topic${filePaths.length > 0 ? `, examining ${filePaths.length} source${filePaths.length !== 1 ? 's' : ''}` : ''}, consuming ${tokensStr} tokens.`;
    } else if (workType === 'docs') {
      summary = `Wrote or updated documentation${filePaths.length > 0 ? ` (${filePaths.slice(0, 2).map(p => p.split('/').pop()).join(', ')})` : ''}.`;
    } else if (workType === 'test') {
      summary = `Wrote or ran tests${filePaths.length > 0 ? ` for ${filePaths.slice(0, 2).map(p => p.split('/').pop()).join(', ')}` : ''}, processing ${tokensStr} tokens.`;
    } else {
      summary = `Completed task${filePaths.length > 0 ? ` involving ${filePaths.length} file${filePaths.length !== 1 ? 's' : ''}` : ''}, using ${tokensStr} tokens in ${durationSecs}s.`;
    }
  } else if (outcome === 'killed') {
    summary = `Session was manually terminated after ${durationSecs}s.`;
  } else if (outcome === 'timeout') {
    summary = `Session ran to the ${Math.round(durationSecs / 60)}min timeout limit without producing output.`;
  } else if (outcome === 'error') {
    summary = `Session encountered an error after ${durationSecs}s.`;
  } else {
    summary = `Session ended after ${durationSecs}s with ${tokensStr} tokens consumed.`;
  }

  return {
    workType,
    workTypeConfig,
    filePaths,
    summary,
    outcome,
    outcomeConfig,
    durationSecs,
    tokensPerMin,
  };
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    ts: '🔷', tsx: '⚛', js: '🟨', jsx: '⚛',
    json: '📋', md: '📝', yml: '⚙️', yaml: '⚙️',
    html: '🌐', css: '🎨', py: '🐍', sh: '📜',
    sql: '🗃', toml: '⚙️', env: '🔐',
  };
  return iconMap[ext] || '📄';
}

function getParentDir(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length < 2) return filePath;
  const file = parts.pop()!;
  const parent = parts.slice(-2).join('/');
  return `${parent}/${file}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  subAgent: SubAgent;
  activities: ActivityEvent[];
  expanded?: boolean;
}

export default function SessionOutcomeEvidence({ subAgent: sa, activities, expanded: defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const evidence = buildEvidence(sa, activities);

  const fmtTok = (t?: number) => formatTokens(t);

  return (
    <ErrorBoundary name="SessionOutcomeEvidence">
      <div className="soe-panel">
        {/* Header row — always visible */}
        <div className="soe-header" onClick={() => setExpanded(v => !v)}>
          {/* Work type badge */}
          <span
            className="soe-worktype-badge"
            style={{
              background: `${evidence.workTypeConfig.color}14`,
              border: `1px solid ${evidence.workTypeConfig.color}44`,
              color: evidence.workTypeConfig.color,
            }}
            title={`Inferred work type: ${evidence.workTypeConfig.label}`}
          >
            <span style={{ fontSize: '10px' }}>{evidence.workTypeConfig.icon}</span>
            <span>{evidence.workTypeConfig.label}</span>
          </span>

          {/* Summary */}
          <span className="soe-summary">{evidence.summary}</span>

          {/* Outcome badge */}
          <span
            className="soe-outcome-badge"
            style={{
              background: `${evidence.outcomeConfig.color}14`,
              border: `1px solid ${evidence.outcomeConfig.color}44`,
              color: evidence.outcomeConfig.color,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '9px' }}>{evidence.outcomeConfig.icon}</span>
            <span>{evidence.outcomeConfig.label}</span>
          </span>

          {/* Toggle */}
          <button
            className="soe-toggle"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '11px', padding: '2px 4px',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s', flexShrink: 0,
            }}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            ▼
          </button>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="soe-detail">
            {/* Stats row */}
            <div className="soe-stats-row">
              <div className="soe-stat">
                <span className="soe-stat-label">Duration</span>
                <span className="soe-stat-value" style={{ color: 'var(--cyan)' }}>
                  {formatDuration(evidence.durationSecs)}
                </span>
              </div>
              <div className="soe-stat">
                <span className="soe-stat-label">Tokens</span>
                <span className="soe-stat-value" style={{ color: 'var(--green)' }}>
                  {fmtTok(sa.tokenUsage)}
                </span>
              </div>
              {evidence.tokensPerMin !== null && (
                <div className="soe-stat">
                  <span className="soe-stat-label">Tok/min</span>
                  <span
                    className="soe-stat-value"
                    style={{ color: evidence.tokensPerMin > 1000 ? 'var(--yellow)' : 'var(--text-secondary)' }}
                  >
                    {evidence.tokensPerMin}
                  </span>
                </div>
              )}
              <div className="soe-stat">
                <span className="soe-stat-label">Runtime</span>
                <span className="soe-stat-value" style={{ color: sa.runtime === 'dev' ? 'var(--dev)' : sa.runtime === 'pi' ? 'var(--pi)' : 'var(--gemini)' }}>
                  {sa.runtime === 'pi' ? 'Pi' : sa.runtime.charAt(0).toUpperCase() + sa.runtime.slice(1)}
                </span>
              </div>
            </div>

            {/* File paths */}
            {evidence.filePaths.length > 0 && (
              <div className="soe-files-section">
                <span className="soe-section-label">Files referenced in task</span>
                <div className="soe-files-list">
                  {evidence.filePaths.map((fp, i) => (
                    <span key={i} className="soe-file-chip" title={fp}>
                      <span style={{ fontSize: '9px' }}>{getFileIcon(fp)}</span>
                      <span className="soe-file-name">{fp.split('/').pop()}</span>
                      <span className="soe-file-dir" title={getParentDir(fp)}>
                        {getParentDir(fp).split('/').slice(-2).join('/').replace(/\/[^/]+$/, '')}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Task description */}
            {sa.taskName && (
              <div className="soe-task-section">
                <span className="soe-section-label">Task description</span>
                <div className="soe-task-text">{sa.taskName}</div>
              </div>
            )}

            {/* Cost */}
            {sa.tokenUsage && sa.tokenUsage > 0 && (
              <div className="soe-cost-row">
                <span className="soe-section-label">Estimated cost</span>
                {(() => {
                  const toks = sa.tokenUsage;
                  const cost = ((toks * 0.70) / 1e6) * 0.50 + ((toks * 0.30) / 1e6) * 1.50;
                  const fmtC = (d: number) => d < 0.001 ? `${(d * 1000).toFixed(1)}¢` : d < 1 ? `$${d.toFixed(3)}` : `$${d.toFixed(2)}`;
                  const costColor = cost > 1 ? 'var(--red)' : cost > 0.10 ? 'var(--yellow)' : 'var(--green)';
                  return (
                    <span className="soe-cost-value" style={{ color: costColor }}>
                      {fmtC(cost)}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
