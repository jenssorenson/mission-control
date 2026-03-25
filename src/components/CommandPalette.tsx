import { useState, useEffect, useRef, useCallback } from 'react';
import type { Agent, SubAgent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  subAgents: SubAgent[];
  agents: Agent[];
  onSelectSession: (sessionKey: string) => void;
  onAction: (action: string) => void;
  onSwitchView: (view: string) => void;
  pollingPaused: boolean;
}

interface PaletteItem {
  id: string;
  icon: string;
  label: string;
  subtitle?: string;
  category: 'quick' | 'session' | 'view';
  action: () => void;
  badge?: string; // runtime badge for sessions
  elapsed?: string; // session elapsed time
}

// ─── Fuzzy search helper ─────────────────────────────────────────────────────

function fuzzyMatch(text: string, query: string): { matched: boolean; segments: { text: string; highlight: boolean }[] } {
  if (!query.trim()) return { matched: true, segments: [{ text, highlight: false }] };

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let hIdx = 0;
  let nIdx = 0;
  const segments: { text: string; highlight: boolean }[] = [];
  let buf = '';
  let matched = true;

  while (hIdx < haystack.length && nIdx < needle.length) {
    if (haystack[hIdx] === needle[nIdx]) {
      if (buf) { segments.push({ text: buf, highlight: false }); buf = ''; }
      let chunk = '';
      while (hIdx < haystack.length && nIdx < needle.length && haystack[hIdx] === needle[nIdx]) {
        chunk += text[hIdx];
        hIdx++;
        nIdx++;
      }
      segments.push({ text: chunk, highlight: true });
    } else {
      buf += text[hIdx];
      hIdx++;
      matched = false;
    }
  }

  if (nIdx < needle.length) matched = false;
  if (buf) segments.push({ text: buf, highlight: false });
  // Append any remaining characters from last highlighted chunk
  // (already included in chunk)

  return { matched, segments: segments.length > 0 ? segments : [{ text, highlight: false }] };
}

// ─── Highlighted label ────────────────────────────────────────────────────────

function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const { segments } = fuzzyMatch(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <span key={i} className="cp-highlight">{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

// ─── Command Palette ──────────────────────────────────────────────────────────

export default function CommandPalette({
  isOpen,
  onClose,
  subAgents,
  agents,
  onSelectSession,
  onAction,
  onSwitchView,
  pollingPaused,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  // ── Build item lists ─────────────────────────────────────────────────────

  const quickActions: PaletteItem[] = [
    {
      id: 'toggle-polling',
      icon: pollingPaused ? '▶' : '⏸',
      label: pollingPaused ? 'Resume Polling' : 'Pause Polling',
      subtitle: pollingPaused ? 'Resume gateway polling' : 'Pause gateway polling',
      category: 'quick',
      action: () => { onAction('toggle-polling'); onClose(); },
    },
    {
      id: 'refresh',
      icon: '↻',
      label: 'Refresh Status',
      subtitle: 'Re-fetch gateway and agent state',
      category: 'quick',
      action: () => { onAction('refresh'); onClose(); },
    },
    {
      id: 'export-sessions',
      icon: '📋',
      label: 'Export Sessions JSON',
      subtitle: 'Copy all session data to clipboard',
      category: 'quick',
      action: () => { onAction('export-sessions'); onClose(); },
    },
    {
      id: 'clear-activity',
      icon: '🗑',
      label: 'Clear Activity Feed',
      subtitle: 'Remove all events from the activity feed',
      category: 'quick',
      action: () => { onAction('clear-activity'); onClose(); },
    },
    {
      id: 'clear-todos',
      icon: '✅',
      label: 'Clear Completed Todos',
      subtitle: 'Remove all completed todo items',
      category: 'quick',
      action: () => { onAction('clear-todos'); onClose(); },
    },
    {
      id: 'kanban-view',
      icon: '📋',
      label: 'Switch to Kanban View',
      subtitle: 'Show sessions as Kanban board',
      category: 'quick',
      action: () => { onAction('kanban-view'); onClose(); },
    },
    {
      id: 'list-view',
      icon: '📝',
      label: 'Switch to List View',
      subtitle: 'Show sessions as compact list',
      category: 'quick',
      action: () => { onAction('list-view'); onClose(); },
    },
    {
      id: 'open-gateway',
      icon: '🌐',
      label: 'Open Gateway UI',
      subtitle: 'Launch gateway in new tab',
      category: 'quick',
      action: () => { onAction('open-gateway'); onClose(); },
    },
    {
      id: 'shortcuts',
      icon: '⌨',
      label: 'Show Keyboard Shortcuts',
      subtitle: 'Display shortcut reference',
      category: 'quick',
      action: () => { onAction('shortcuts'); onClose(); },
    },
  ];

  const sessionItems: PaletteItem[] = subAgents.slice(0, 8).map(sa => {
    const elapsed = sa.startedAt
      ? (() => {
          const secs = Math.floor((Date.now() - sa.startedAt) / 1000);
          if (secs < 60) return `${secs}s`;
          if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
          return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
        })()
      : '—';
    return {
      id: `session-${sa.sessionKey}`,
      icon: '▶',
      label: sa.taskName || sa.sessionKey,
      subtitle: sa.sessionKey.length > 20 ? sa.sessionKey.slice(0, 18) + '…' : sa.sessionKey,
      category: 'session',
      action: () => { onSelectSession(sa.sessionKey); onClose(); },
      badge: sa.runtime,
      elapsed,
    };
  });

  const viewItems: PaletteItem[] = [
    { id: 'view-monitor', icon: '📡', label: 'Monitor', subtitle: 'Agent Monitor', category: 'view', action: () => { onSwitchView('monitor'); onClose(); } },
    { id: 'view-todos', icon: '✅', label: 'Todo List', subtitle: 'Todo management', category: 'view', action: () => { onSwitchView('todos'); onClose(); } },
    { id: 'view-activity', icon: '📡', label: 'Activity Feed', subtitle: 'Real-time event stream', category: 'view', action: () => { onSwitchView('activity'); onClose(); } },
    { id: 'view-workshop', icon: '🎮', label: 'Workshop', subtitle: '3D Agent Workshop', category: 'view', action: () => { onSwitchView('workshop'); onClose(); } },
    { id: 'view-timeline', icon: '📊', label: 'Session Timeline', subtitle: 'Historical session view', category: 'view', action: () => { onSwitchView('timeline'); onClose(); } },
    { id: 'view-memory', icon: '🧠', label: 'Memory Browser', subtitle: 'Long-term memory & context', category: 'view', action: () => { onSwitchView('memory'); onClose(); } },
    { id: 'view-cost', icon: '💰', label: 'Cost History', subtitle: 'Token cost analytics', category: 'view', action: () => { onSwitchView('cost'); onClose(); } },
    { id: 'view-cron', icon: '⏰', label: 'Cron Jobs', subtitle: 'Scheduled tasks & agents', category: 'view', action: () => { onSwitchView('cron'); onClose(); } },
    { id: 'view-convoys', icon: '🚛', label: 'Convoys', subtitle: 'Pipeline & convoy system', category: 'view', action: () => { onSwitchView('convoys'); onClose(); } },
  ];

  // ── Filter by query ──────────────────────────────────────────────────────

  const filterItems = useCallback((items: PaletteItem[], q: string): PaletteItem[] => {
    if (!q.trim()) return items;
    const ql = q.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(ql) ||
      (item.subtitle?.toLowerCase().includes(ql) ?? false) ||
      item.id.toLowerCase().includes(ql)
    );
  }, []);

  const filteredQuick = filterItems(quickActions, query).slice(0, 6);
  const filteredSessions = filterItems(sessionItems, query).slice(0, 6);
  const filteredViews = filterItems(viewItems, query).slice(0, 6);

  const hasQuick = filteredQuick.length > 0;
  const hasSessions = filteredSessions.length > 0;
  const hasViews = filteredViews.length > 0;
  const hasResults = hasQuick || hasSessions || hasViews;

  // ── Flat list for keyboard navigation ──────────────────────────────────

  type Section = { category: string; items: PaletteItem[] };
  const sections: Section[] = [
    { category: '⚡ Quick Actions', items: filteredQuick },
    { category: '📋 Sessions', items: filteredSessions },
    { category: '🔀 Views', items: filteredViews },
  ].filter(s => s.items.length > 0);

  const flatItems = sections.flatMap(s => s.items);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  // ── Keyboard navigation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, flatItems.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[selectedIdx];
        if (item) item.action();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, flatItems, selectedIdx, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>('.cp-item--selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!isOpen) return null;

  // ── Runtime badge color ─────────────────────────────────────────────────

  const runtimeColor: Record<string, string> = {
    dev: 'var(--dev)',
    pi: 'var(--pi)',
    gemini: 'var(--gemini)',
  };

  // ── Render ─────────────────────────────────────────────────────────────

  let globalIdx = 0;

  return (
    <div
      className="command-palette-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="command-palette-modal">
        {/* Search input */}
        <div className="cp-search-row">
          <span className="cp-search-icon">🔍</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search commands, sessions, views..."
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc-hint">ESC</kbd>
        </div>

        {/* Results */}
        <div className="cp-results" ref={listRef}>
          {!hasResults && query.trim() && (
            <div className="cp-empty">
              No results for <strong>"{query}"</strong>
            </div>
          )}
          {sections.map(section => (
            <div key={section.category} className="cp-category">
              <div className="cp-category-header">{section.category}</div>
              {section.items.map(item => {
                const isSelected = globalIdx === selectedIdx;
                const idx = globalIdx++;
                return (
                  <div
                    key={item.id}
                    className={`cp-item${isSelected ? ' cp-item--selected' : ''}`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="cp-item-icon">{item.icon}</span>
                    <span className="cp-item-label">
                      <HighlightedLabel text={item.label} query={query} />
                    </span>
                    {item.badge && (
                      <span
                        className="cp-item-badge"
                        style={{
                          color: runtimeColor[item.badge] || 'var(--accent)',
                          border: `1px solid ${runtimeColor[item.badge] || 'var(--accent)'}44`,
                          background: `${runtimeColor[item.badge] || 'var(--accent)'}14`,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                    {item.elapsed && (
                      <span className="cp-item-elapsed">{item.elapsed}</span>
                    )}
                    {item.subtitle && (
                      <span className="cp-item-subtitle">
                        <HighlightedLabel text={item.subtitle} query={query} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
