import { useState, useEffect, useRef } from 'react';
import type { Agent, SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  subAgents: SubAgent[];
  agents: Agent[];
  onSelectSession: (sessionKey: string) => void;
  onKillSession?: (sessionKey: string, taskName?: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
  return String(tokens);
}

function statusColor(status?: string): string {
  if (!status) return 'var(--text-muted)';
  const s = status.toLowerCase();
  if (s.includes('run') || s.includes('active')) return 'var(--green)';
  if (s.includes('think')) return 'var(--yellow)';
  if (s.includes('error') || s.includes('fail')) return 'var(--red)';
  return 'var(--accent)';
}

const RUNTIME_COLORS: Record<string, string> = {
  dev:    'var(--dev)',
  pi:     'var(--pi)',
  gemini: 'var(--gemini)',
};

const MAX_TREE_DEPTH = 3;

// ─── Tree node type ────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  label: string;
  runtime: string;
  status: string;
  sessionKey: string;
  taskName: string;
  tokenUsage?: number;
  startedAt?: number;
  parentId?: string;
  children: TreeNode[];
  depth: number;
  // Internal: computed end time for temporal parent-child inference
  _computedEnd?: number;
}

// ─── Build tree from flat session list ────────────────────────────────────────
// Strategy: infer parent-child from task name patterns (e.g., "Parent > Child" or
// "Parent : Step 1") and from temporal overlap during parent session lifetimes.
// Sessions with no detected parent become root nodes.

function buildSessionTree(subAgents: SubAgent[], agents: Agent[]): TreeNode[] {
  if (subAgents.length === 0) return [];

  // Detect root sessions: sessions whose task name doesn't appear to be a child
  // A session is likely a CHILD if its task name contains a parent task name
  // OR if it was spawned while a parent session was active and shares some tokens
  const sortedByStart = [...subAgents]
    .filter(sa => sa.startedAt)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  // Build a map of sessionKey -> node
  const nodeMap = new Map<string, TreeNode>();

  subAgents.forEach(sa => {
    const label = sa.taskName
      ? (sa.taskName.length > 50 ? sa.taskName.slice(0, 50) + '…' : sa.taskName)
      : sa.sessionKey.slice(0, 12) + '…';
    nodeMap.set(sa.sessionKey, {
      id: sa.sessionKey,
      label,
      runtime: sa.runtime || 'dev',
      status: sa.status || 'unknown',
      sessionKey: sa.sessionKey,
      taskName: sa.taskName || '',
      tokenUsage: sa.tokenUsage,
      startedAt: sa.startedAt,
      children: [],
      depth: 0,
    });
  });

  // Try to find parent for each node based on task name nesting patterns
  // Pattern 1: "Parent task > Child task" or "Parent task : Step 1"
  // Pattern 2: Child session starts during (overlaps with) parent session
  const nodesArr = Array.from(nodeMap.values());

  nodesArr.forEach(node => {
    if (!node.taskName) return;

    // Look for parent indicators in task name
    const separators = [' › ', ' ›', '›', ' > ', ' >', '>', ' : ', ' :', ':', ' // ', '/', ' ⌁ ', '▸ '];
    let parentTaskName: string | null = null;

    for (const sep of separators) {
      const idx = node.taskName.indexOf(sep);
      if (idx > 0 && idx < node.taskName.length - 1) {
        parentTaskName = node.taskName.slice(0, idx).trim();
        break;
      }
    }

    if (parentTaskName) {
      // Find a session whose task name matches (or starts with) the parent task name
      const parentNode = nodesArr.find(other =>
        other.id !== node.id &&
        other.taskName &&
        (other.taskName === parentTaskName ||
         other.taskName.startsWith(parentTaskName + ' ›') ||
         other.taskName.startsWith(parentTaskName + ' >') ||
         other.taskName.startsWith(parentTaskName + ' :') ||
         other.taskName.startsWith(parentTaskName + ' //') ||
         other.taskName.startsWith(parentTaskName + ' /') ||
         other.taskName.startsWith(parentTaskName + ' ⌁') ||
         other.taskName.startsWith(parentTaskName + '▸') ||
         parentTaskName.startsWith(other.taskName.slice(0, 30)))
      );
      if (parentNode && nodeMap.has(parentNode.id)) {
        node.parentId = parentNode.id;
      }
    }
  });

  // Second pass: use temporal overlap to find additional parent-child relationships
  // A session B is a child of session A if B started while A was running
  // and B doesn't already have a parent
  nodesArr.forEach(node => {
    if (node.parentId) return;
    if (!node.startedAt) return;

    const nodeAge = (now: number) => now - (node.startedAt || 0);
    const now = Date.now();

    // Find sessions that were running when this session started
    const potentialParents = nodesArr.filter(other => {
      if (other.id === node.id) return false;
      if (!other.startedAt) return false;
      const otherEnd = other._computedEnd || now;
      // Other was running when this node started
      return other.startedAt <= node.startedAt! && otherEnd >= node.startedAt!;
    });

    // Pick the most likely parent: the one with the most similar runtime or
    // the one whose task name most overlaps with this node's task name
    if (potentialParents.length > 0) {
      let best = potentialParents[0];
      let bestScore = 0;
      potentialParents.forEach(parent => {
        let score = 0;
        // Prefer same runtime
        if (parent.runtime === node.runtime) score += 3;
        // Prefer overlapping task names
        if (node.taskName && parent.taskName) {
          const wordsA = new Set(node.taskName.toLowerCase().split(/\s+/).slice(0, 5));
          const wordsB = new Set(parent.taskName.toLowerCase().split(/\s+/).slice(0, 5));
          wordsA.forEach(w => { if (wordsB.has(w) && w.length > 3) score += 1; });
        }
        // Prefer the most recently started parent (likely the immediate parent)
        if (score > bestScore) {
          bestScore = score;
          best = parent;
        }
      });
      // Only assign if we have some confidence
      if (bestScore >= 1 || best.runtime === node.runtime) {
        node.parentId = best.id;
      }
    }
  });

  // Add helper to track "end time" for temporal analysis
  // We approximate: sessions that have been running a long time are still active
  nodesArr.forEach(node => {
    if (node.startedAt) {
      // If running > 60min, treat as still running (active session)
      const ageMs = Date.now() - node.startedAt;
      (node as any)._computedEnd = ageMs < 60 * 60 * 1000 ? Date.now() : node.startedAt + 60 * 60 * 1000;
    }
  });

  // Assign depth via BFS from root nodes
  const roots: TreeNode[] = [];
  nodeMap.forEach(node => {
    if (!node.parentId) {
      roots.push(node);
    }
  });

  // Assign depth to children
  function assignDepth(node: TreeNode, depth: number) {
    node.depth = Math.min(depth, MAX_TREE_DEPTH);
    node.children.forEach(child => assignDepth(child, depth + 1));
  }
  roots.forEach(root => assignDepth(root, 0));

  // Build parent-child links
  nodesArr.forEach(node => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      if (parent.children.length < 10) { // cap children display
        parent.children.push(node);
      }
    }
  });

  // Sort roots by start time (newest first), children by start time
  const sortByStart = (a: TreeNode, b: TreeNode) => (b.startedAt || 0) - (a.startedAt || 0);
  roots.sort(sortByStart);
  roots.forEach(r => r.children.sort(sortByStart));

  return roots;
}

// ─── Live elapsed ticker ───────────────────────────────────────────────────────

function ElapsedTicker({ startedAt }: { startedAt?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  return (
    <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)' }}>
      {formatDuration(secs)}
    </span>
  );
}

// ─── Tree node component ──────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  onSelectSession,
  onKillSession,
  defaultExpanded,
}: {
  node: TreeNode;
  onSelectSession: (sessionKey: string) => void;
  onKillSession?: (sessionKey: string, taskName?: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;
  const rtColor = RUNTIME_COLORS[node.runtime] || 'var(--text-muted)';
  const statColor = statusColor(node.status);
  const isLongRunning = node.startedAt && (Date.now() - node.startedAt) > 20 * 60 * 1000;
  const isCritical = node.startedAt && (Date.now() - node.startedAt) > 40 * 60 * 1000;

  return (
    <div className="sdt-node" style={{ marginLeft: node.depth > 0 ? `${node.depth * 18}px` : 0 }}>
      {/* Connector line for children */}
      {node.depth > 0 && (
        <div
          className="sdt-connector"
          style={{
            position: 'absolute',
            left: `-${10 + (node.depth - 1) * 18}px`,
            top: '50%',
            width: `${8 + (node.depth - 1) * 18}px`,
            height: '1px',
            background: `linear-gradient(90deg, transparent, ${rtColor}44)`,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        className={`sdt-node-row${hasChildren ? ' sdt-node-row--has-children' : ''}${isCritical ? ' sdt-node-row--critical' : isLongRunning ? ' sdt-node-row--warning' : ''}`}
        style={{
          borderLeft: `2px solid ${rtColor}${node.depth > 0 ? '88' : ''}`,
          background: node.depth === 0
            ? `${rtColor}08`
            : 'transparent',
        }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            className="sdt-expand-btn"
            onClick={() => setExpanded(v => !v)}
            title={expanded ? 'Collapse children' : `Expand ${node.children.length} child session(s)`}
            style={{ color: rtColor }}
          >
            <span style={{
              display: 'inline-block',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              fontSize: '10px',
            }}>
              ▶
            </span>
          </button>
        ) : (
          <span className="sdt-expand-placeholder">·</span>
        )}

        {/* Runtime dot */}
        <span
          className="sdt-runtime-dot"
          style={{
            background: rtColor,
            boxShadow: `0 0 5px ${rtColor}`,
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            flexShrink: 0,
          }}
        />

        {/* Status indicator */}
        <span style={{ fontSize: '9px', color: statColor, flexShrink: 0 }} title={`Status: ${node.status}`}>
          {node.status.toLowerCase().includes('run') || node.status.toLowerCase().includes('active') ? '●' :
           node.status.toLowerCase().includes('think') ? '◐' :
           node.status.toLowerCase().includes('error') ? '✕' : '○'}
        </span>

        {/* Runtime label */}
        <span
          className="sdt-runtime-label"
          style={{ color: rtColor, fontSize: '9px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}
        >
          {node.runtime === 'pi' ? 'Pi' : node.runtime.charAt(0).toUpperCase() + node.runtime.slice(1)}
        </span>

        {/* Task/session label */}
        <button
          className="sdt-label-btn"
          onClick={() => onSelectSession(node.sessionKey)}
          title={`${node.taskName || node.sessionKey}\nClick to view session details`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <span style={{
            fontSize: '11px',
            fontFamily: "'Space Grotesk', sans-serif",
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
          }}>
            {node.taskName || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{node.sessionKey.slice(0, 16)}…</span>}
          </span>
        </button>

        {/* Age ticker */}
        <ElapsedTicker startedAt={node.startedAt} />

        {/* Token usage */}
        {node.tokenUsage ? (
          <span style={{ fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--cyan)', flexShrink: 0, minWidth: '32px', textAlign: 'right' }}>
            {formatTokens(node.tokenUsage)}
          </span>
        ) : (
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', flexShrink: 0, minWidth: '24px' }}>—</span>
        )}

        {/* Child count badge */}
        {hasChildren && (
          <span
            className="sdt-child-badge"
            title={`${node.children.length} child session${node.children.length !== 1 ? 's' : ''}`}
            style={{
              background: `${rtColor}18`,
              border: `1px solid ${rtColor}44`,
              color: rtColor,
              fontSize: '9px',
              fontWeight: 700,
              borderRadius: '8px',
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            +{node.children.length}
          </span>
        )}

        {/* Kill button */}
        {onKillSession && (
          <button
            className="sdt-kill-btn"
            title={`Kill session`}
            onClick={() => {
              if (confirm(`Kill session "${node.taskName?.slice(0, 40) || node.sessionKey.slice(0, 8)}"?`)) {
                onKillSession(node.sessionKey, node.taskName);
              }
            }}
            style={{
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: '5px',
              color: 'var(--red)',
              cursor: 'pointer',
              fontSize: '10px',
              padding: '2px 5px',
              flexShrink: 0,
              opacity: 0.7,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
          >
            ✕
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="sdt-children">
          {node.children.map(child => (
            <TreeNodeRow
              key={child.id}
              node={child}
              onSelectSession={onSelectSession}
              onKillSession={onKillSession}
              defaultExpanded={child.depth < MAX_TREE_DEPTH - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SessionDependencyTree({ subAgents, agents, onSelectSession, onKillSession }: Props) {
  const [showTree, setShowTree] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);

  const tree = buildSessionTree(subAgents, agents);
  const totalNodes = tree.reduce((sum: number, n: TreeNode) => sum + 1 + n.children.length, 0);
  const rootCount = tree.length;
  const hasMultiLevel = tree.some(n => n.children.length > 0);

  // Auto-expand if there are parent-child relationships
  useEffect(() => {
    if (tree.some(n => n.children.length > 0)) {
      setShowTree(true);
    }
  }, [subAgents.length]);

  if (subAgents.length === 0) {
    return null;
  }

  return (
    <ErrorBoundary name="SessionDependencyTree">
      <div className="sdt-panel">
        {/* Header */}
        <div className="sdt-header" onClick={() => setShowTree(v => !v)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px' }}>🌲</span>
            <h3 style={{ margin: 0, fontSize: '13px', fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text-primary)' }}>
              Session Dependency Tree
            </h3>
            {rootCount > 0 && (
              <span style={{
                fontSize: '10px', fontWeight: 700, color: 'var(--accent)',
                background: 'rgba(59,122,255,0.1)', border: '1px solid rgba(59,122,255,0.25)',
                borderRadius: '8px', padding: '1px 6px',
              }}>
                {rootCount} root · {totalNodes} total
              </span>
            )}
            {hasMultiLevel && (
              <span style={{ fontSize: '9px', color: 'var(--yellow)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px', padding: '1px 5px' }}>
                ⚠ hierarchical
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {showTree && rootCount > 0 && (
              <button
                className="sdt-expand-all-btn"
                onClick={(e) => { e.stopPropagation(); setExpandAll(v => !v); }}
                title={expandAll ? 'Collapse all' : 'Expand all'}
                style={{
                  background: expandAll ? 'rgba(59,122,255,0.12)' : 'transparent',
                  border: `1px solid ${expandAll ? 'rgba(59,122,255,0.4)' : 'var(--border)'}`,
                  borderRadius: '6px', color: expandAll ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                  fontFamily: "'Space Grotesk', sans-serif",
                  padding: '2px 8px', transition: 'all 0.15s',
                }}
              >
                {expandAll ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            <span style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              transition: 'transform 0.2s',
              transform: showTree ? 'rotate(90deg)' : 'rotate(0deg)',
              display: 'inline-block',
            }}>
              ▶
            </span>
          </div>
        </div>

        {/* Tree body */}
        {showTree && (
          <div className="sdt-body" ref={treeRef}>
            {tree.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '20px', color: 'var(--text-muted)',
                fontSize: '12px', fontFamily: "'Space Grotesk', sans-serif",
              }}>
                No session hierarchy detected — all sessions are root sessions
              </div>
            ) : (
              <div className="sdt-tree-list">
                {/* Legend */}
                <div className="sdt-legend">
                  {([
                    { color: 'var(--green)', label: 'Active/Running' },
                    { color: 'var(--yellow)', label: 'Thinking' },
                    { color: 'var(--red)', label: 'Error' },
                    { color: 'var(--accent)', label: 'Idle' },
                  ] as { color: string; label: string }[]).map(({ color, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 3px ${color}`, flexShrink: 0 }} />
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>{label}</span>
                    </div>
                  ))}
                  <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'Space Grotesk', sans-serif" }}>
                    Click label to view · ▶ to expand
                  </div>
                </div>

                {/* Nodes */}
                {tree.map(node => (
                  <TreeNodeRow
                    key={node.id}
                    node={node}
                    onSelectSession={onSelectSession}
                    onKillSession={onKillSession}
                    defaultExpanded={expandAll || node.depth < MAX_TREE_DEPTH - 1}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
