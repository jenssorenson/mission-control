import { useState, useEffect, useRef } from 'react';
import type { Todo } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

const API_BASE = '/api/todos';

function authHeaders(): Record<string, string> {
  const passphrase = localStorage.getItem('mc_passphrase') || '';
  const saltRaw = localStorage.getItem('mc_key_salt') || '';
  const hash = localStorage.getItem('mc_key_hash') || '';
  return {
    'Authorization': `Bearer ${passphrase}`,
    'x-key-salt': saltRaw,
    'x-key-hash': hash,
  };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type Priority = 'low' | 'medium' | 'high';

const PRIORITY_CONFIG: Record<Priority, { icon: string; color: string; label: string }> = {
  low: { icon: '⬇', color: 'var(--text-muted)', label: 'Low' },
  medium: { icon: '➖', color: 'var(--yellow)', label: 'Med' },
  high: { icon: '⬆', color: 'var(--red)', label: 'High' },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className="priority-badge" style={{ color: cfg.color }} title={`${cfg.label} priority`}>
      {cfg.icon}
    </span>
  );
}

function PrioritySelect({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <select
      className="priority-select"
      value={value}
      onChange={e => onChange(e.target.value as Priority)}
      title="Set priority"
    >
      <option value="low">⬇ Low</option>
      <option value="medium">➖ Med</option>
      <option value="high">⬆ High</option>
    </select>
  );
}

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [sortMode, setSortMode] = useState<'priority' | 'date'>('priority');
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'today'>('all');
  // Tick relative timestamps
  const [, tick] = useState(0);
  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showQuickPriority, setShowQuickPriority] = useState(false);
  const [completionFlash, setCompletionFlash] = useState(false);
  const prevPendingCountRef = useRef<number>(0);
  // Undo for completed tasks — tracks the last completed todo and its previous state
  const [undoTarget, setUndoTarget] = useState<{ id: string; wasCompleted: boolean } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchTodos();
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  async function fetchTodos() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API_BASE, { headers: authHeaders() });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: Todo[] = await res.json();
      // Ensure priority field exists
      setTodos(data.map(t => ({ ...t, priority: t.priority || 'medium' })));
    } catch (e: any) {
      const isNetwork = e?.name === 'TypeError' || e?.message?.includes('fetch') || e?.message?.includes('network');
      setError(isNetwork
        ? 'API unreachable — todos are stored locally only. Start the API server for persistence.'
        : `Failed to load todos — ${e?.message || 'server error'}`);
      setTodos([]);
    } finally {
      setLoading(false);
    }
  }

  async function apiMutate(method: 'PUT' | 'PATCH', body: any, id?: string) {
    const url = id ? `${API_BASE}/${id}` : API_BASE;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    try {
      const newTodo: Todo = {
        id: crypto.randomUUID(),
        text,
        completed: false,
        createdAt: Date.now(),
        priority: newPriority,
        dueDate: newDueDate ? new Date(newDueDate).getTime() : undefined,
      };
      const updated = await apiMutate('PUT', [...todos, newTodo]);
      setTodos(updated);
      setNewPriority('medium');
      setNewDueDate('');
    } catch {
      setError('Failed to add todo');
    }
  }

  async function toggleTodo(id: string) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const wasCompleted = todo.completed;
    try {
      const updated = await apiMutate('PATCH', { completed: !todo.completed }, id);
      setTodos(todos.map(t => t.id === id ? { ...t, ...updated } : t));
      // If marking as complete, set up undo window for 4 seconds
      if (!wasCompleted) {
        setUndoTarget({ id, wasCompleted: false });
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => setUndoTarget(null), 4000);
      } else {
        // If un-completing, cancel any pending undo
        setUndoTarget(null);
        if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
      }
    } catch {
      setError('Failed to update todo');
    }
  }

  async function setPriority(id: string, priority: Priority) {
    try {
      const updated = await apiMutate('PATCH', { priority }, id);
      setTodos(todos.map(t => t.id === id ? { ...t, ...updated } : t));
    } catch {
      setError('Failed to update priority');
    }
  }

  async function deleteTodo(id: string) {
    try {
      const updated = await apiMutate('PUT', todos.filter(t => t.id !== id));
      setTodos(updated);
    } catch {
      setError('Failed to delete todo');
    }
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.id);
    setEditText(todo.text);
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) { setEditingId(null); return; }
    const todo = todos.find(t => t.id === id);
    if (!todo) { setEditingId(null); return; }
    try {
      const updated = await apiMutate('PATCH', { text }, id);
      setTodos(todos.map(t => t.id === id ? { ...t, ...updated } : t));
    } catch {
      setError('Failed to update todo');
    } finally {
      setEditingId(null);
    }
  }

  async function clearCompleted() {
    try {
      const updated = await apiMutate('PUT', todos.filter(t => !t.completed));
      setTodos(updated);
    } catch {
      setError('Failed to clear completed');
    }
  }

  async function markAllComplete() {
    if (pending.length === 0) return;
    try {
      // Optimistically update UI first
      const updatedTodos = todos.map(t => ({ ...t, completed: true }));
      setTodos(updatedTodos);
      // Persist each completed todo
      await Promise.all(pending.map(t =>
        fetch(`${API_BASE}/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ completed: true }),
        })
      ));
    } catch {
      setError('Failed to mark all complete');
      fetchTodos();
    }
  }

  const pending = todos.filter(t => !t.completed);
  const completed = todos.filter(t => t.completed);
  const highPriorityPending = pending.filter(t => (t.priority as Priority) === 'high');

  // Task completion celebration: when pending count goes from 1 → 0
  useEffect(() => {
    if (prevPendingCountRef.current === 1 && pending.length === 0) {
      setCompletionFlash(true);
      const timer = setTimeout(() => setCompletionFlash(false), 1800);
      return () => clearTimeout(timer);
    }
    prevPendingCountRef.current = pending.length;
  }, [pending.length]);
  const overdueCount = pending.filter(t => t.dueDate ? t.dueDate < Date.now() : false).length;

  // Sort pending: high first, then medium, then low (default); or by creation date
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  const isOverdue = (todo: Todo) => todo.dueDate ? todo.dueDate < Date.now() : false;
  const isDueToday = (todo: Todo) => {
    if (!todo.dueDate) return false;
    const now = new Date();
    const due = new Date(todo.dueDate);
    return due.toDateString() === now.toDateString();
  };

  let displayPending = [...pending];
  if (dueFilter === 'overdue') displayPending = displayPending.filter(isOverdue);
  else if (dueFilter === 'today') displayPending = displayPending.filter(isDueToday);

  const sortedPending = displayPending.sort((a, b) => {
    if (sortMode === 'date') {
      return b.createdAt - a.createdAt;
    }
    return priorityOrder[a.priority || 'medium'] - priorityOrder[b.priority || 'medium'];
  });

  return (
    <ErrorBoundary name="TodoList">
    <div className="todo-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <h3>✅ Todo List</h3>
          {pending.length > 0 && <span className="todo-total-badge">{pending.length}</span>}
          {highPriorityPending.length > 0 && <span className="high-priority-badge" title={`${highPriorityPending.length} high-priority task${highPriorityPending.length > 1 ? 's' : ''}`}>⚠ {highPriorityPending.length}</span>}
          {overdueCount > 0 && <span className="overdue-count-badge" title={`${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`}>⏰ {overdueCount} overdue</span>}
        </div>
        {todos.length > 0 && (
          <div className="panel-header-left" style={{ flex: 1, justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '4px 10px',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>
                {completed.length}/{todos.length}
              </span>
              <div style={{
                width: '60px', height: '4px', background: 'var(--bg-deep)',
                borderRadius: '2px', overflow: 'hidden', border: '1px solid var(--border)',
              }}>
                <div className={`todo-progress-fill${completionFlash ? ' todo-progress-fill--celebrate' : ''}`}
                  style={{
                    width: `${Math.round((completed.length / todos.length) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--green), var(--cyan))',
                    borderRadius: '2px',
                    transition: 'width 0.4s ease',
                    boxShadow: completionFlash ? '0 0 12px rgba(52,211,153,0.8), 0 0 24px rgba(52,211,153,0.4)' : '0 0 4px rgba(52,211,153,0.4)',
                  }} />
              </div>
              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--cyan)', minWidth: '30px', textAlign: 'right' }}>
                {Math.round((completed.length / todos.length) * 100)}%
              </span>
            </div>
          </div>
        )}
        <div className="panel-header-right">
          {todos.length > 0 && (
            <button
              className="todo-sort-btn"
              onClick={() => {
                const json = JSON.stringify(todos, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `todos-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Export todos as JSON"
            >
              📤 Export
            </button>
          )}
          <button
            className="todo-sort-btn"
            onClick={() => setSortMode(m => m === 'priority' ? 'date' : 'priority')}
            title={`Sorted by ${sortMode === 'priority' ? 'priority' : 'date'}`}
          >
            {sortMode === 'priority' ? '⬇ Prio' : '📅 Date'}
          </button>
          {(['all', 'overdue', 'today'] as const).map(f => (
            <button
              key={f}
              className={`todo-due-filter-btn${dueFilter === f ? ' active' : ''}`}
              onClick={() => setDueFilter(f)}
            >
              {f === 'overdue' ? '⚠ Overdue' : f === 'today' ? '📅 Today' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="todo-error">{error}</div>}

      <form className="todo-form" onSubmit={addTodo} style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '200px' }}>
          <input
            className="todo-input"
            placeholder="Add a new task..."
            value={input}
            onChange={e => { setInput(e.target.value); setShowQuickPriority(e.target.value.length > 0); }}
            onFocus={() => input.length > 0 && setShowQuickPriority(true)}
            onBlur={() => setTimeout(() => setShowQuickPriority(false), 200)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setInput('');
                setShowQuickPriority(false);
                e.currentTarget.blur();
              }
            }}
            maxLength={200}
            style={{ flex: 1 }}
          />
          {/* Quick-add priority presets */}
          {showQuickPriority && (
            <div className="quick-priority-presets" style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  className="quick-priority-btn"
                  title={`Set ${p} priority`}
                  onMouseDown={() => { setNewPriority(p); setShowQuickPriority(false); }}
                  style={{
                    background: newPriority === p ? (p === 'low' ? 'rgba(74,85,128,0.3)' : p === 'medium' ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.2)') : 'var(--bg-input)',
                    border: `1px solid ${newPriority === p ? (p === 'low' ? 'var(--text-muted)' : p === 'medium' ? 'var(--yellow)' : 'var(--red)') : 'var(--border)'}`,
                    borderRadius: '4px', color: p === 'low' ? 'var(--text-muted)' : p === 'medium' ? 'var(--yellow)' : 'var(--red)',
                    fontSize: '10px', fontWeight: 700, cursor: 'pointer', padding: '2px 6px',
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  {p === 'low' ? 'L' : p === 'medium' ? 'M' : 'H'}
                </button>
              ))}
            </div>
          )}
          <PrioritySelect value={newPriority} onChange={setNewPriority} />
          <input
            type="date"
            className="todo-due-date-input"
            value={newDueDate}
            onChange={e => setNewDueDate(e.target.value)}
            title="Due date (optional)"
          />
        </div>
        <button type="submit" className="todo-add-btn" disabled={!input.trim()} style={{ alignSelf: 'flex-start' }}>
          Add
        </button>
      </form>
      <div className="todo-hint">Enter to add · Esc to clear</div>

      <div className="todo-list">
        {sortedPending.map(todo => {
          const overdue = todo.dueDate ? todo.dueDate < Date.now() : false;
          return (
          <div key={todo.id} className={`todo-item${(todo.priority as Priority) === 'high' ? ' high-priority' : ''}${overdue ? ' todo-item--overdue' : ''}`}>
            <label className="todo-label">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
                className="todo-checkbox"
              />
              <PriorityBadge priority={(todo.priority as Priority) || 'medium'} />
              {todo.dueDate && (
                <span
                  className={`todo-due-badge${overdue ? ' overdue' : ''}`}
                  title={`Due: ${new Date(todo.dueDate).toLocaleDateString()}`}
                >
                  {overdue
                    ? `${Math.ceil((Date.now() - todo.dueDate) / 86400000)}d overdue`
                    : new Date(todo.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
              {editingId === todo.id ? (
                <input
                  className="todo-edit-input"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onBlur={() => saveEdit(todo.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit(todo.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  maxLength={200}
                />
              ) : (
                <span
                  className="todo-text"
                  onClick={() => startEdit(todo)}
                  title="Click to edit"
                >
                  {todo.text}
                </span>
              )}
            </label>
            <div className="todo-meta">
              <span className="todo-time" title={new Date(todo.createdAt).toLocaleString()}>
                {formatRelative(todo.createdAt)}
              </span>
              {editingId !== todo.id && (
                <select
                  className="priority-select-inline"
                  value={todo.priority || 'medium'}
                  onChange={e => setPriority(todo.id, e.target.value as Priority)}
                  onClick={e => e.stopPropagation()}
                >
                  <option value="low">⬇</option>
                  <option value="medium">➖</option>
                  <option value="high">⬆</option>
                </select>
              )}
              <button
                className="todo-delete"
                onClick={() => deleteTodo(todo.id)}
                title="Delete"
              >
                ✕
              </button>
              <button
                className="todo-delete"
                onClick={async () => {
                  const text = todo.text.trim();
                  if (!text) return;
                  const newTodo: Todo = {
                    id: crypto.randomUUID(),
                    text,
                    completed: false,
                    createdAt: Date.now(),
                    priority: todo.priority,
                    dueDate: todo.dueDate,
                  };
                  try {
                    const updated = await apiMutate('PUT', [...todos, newTodo]);
                    setTodos(updated);
                  } catch {
                    setError('Failed to duplicate todo');
                  }
                }}
                title="Duplicate todo"
              >
                ⧉
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {completed.length > 0 && (
        <div className="todo-completed-section">
          <div className="todo-completed-header">
            <span>Completed ({completed.length})</span>
            {undoTarget && undoTarget.wasCompleted === false && (
              <button
                className="todo-undo-btn"
                title={`Undo: restore the last completed task`}
                onClick={async () => {
                  const todo = todos.find(t => t.id === undoTarget.id);
                  if (!todo || todo.completed) return;
                  try {
                    const updated = await apiMutate('PATCH', { completed: false }, undoTarget.id);
                    setTodos(todos.map(t => t.id === undoTarget.id ? { ...t, ...updated } : t));
                    setUndoTarget(null);
                    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
                  } catch {
                    setError('Failed to undo');
                  }
                }}
              >
                ↩ Undo
              </button>
            )}
            {pending.length > 0 && (
              <button className="clear-completed-btn" onClick={markAllComplete} title="Mark all pending as complete" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,0.3)' }}>
                ✓ Mark all done
              </button>
            )}
            <button className="clear-completed-btn" onClick={clearCompleted} title="Clear all completed">
              Clear completed
            </button>
          </div>
          {completed.slice(0, 5).map(todo => (
            <div key={todo.id} className="todo-item completed">
              <label className="todo-label">
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                  className="todo-checkbox"
                />
                <span className="todo-text">{todo.text}</span>
              </label>
              <button
                className="todo-delete"
                onClick={() => deleteTodo(todo.id)}
                title="Delete"
              >
                ✕
              </button>
              <button
                className="todo-delete"
                onClick={async () => {
                  const text = todo.text.trim();
                  if (!text) return;
                  const newTodo: Todo = {
                    id: crypto.randomUUID(),
                    text,
                    completed: false,
                    createdAt: Date.now(),
                    priority: todo.priority,
                    dueDate: todo.dueDate,
                  };
                  try {
                    const updated = await apiMutate('PUT', [...todos, newTodo]);
                    setTodos(updated);
                  } catch {
                    setError('Failed to duplicate todo');
                  }
                }}
                title="Duplicate todo"
              >
                ⧉
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="todo-empty">Loading...</div>}
      {!loading && todos.length === 0 && !error && (
        <div className="todo-empty">No tasks yet. Add one above!</div>
      )}
    </div>
    </ErrorBoundary>
  );
}
