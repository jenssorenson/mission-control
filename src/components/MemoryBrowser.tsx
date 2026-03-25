import { useState, useEffect, useCallback } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryFile {
  name: string;
  path: string;
  type: 'daily' | 'memory' | 'agents' | 'todo';
  size: number;
  mtime: number;
}

interface MemoryContent {
  path: string;
  content: string;
  size: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelDate(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(ms);
}

function isToday(ms: number): boolean {
  const d = new Date(ms);
  const today = new Date();
  return d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
}

function getDateFromName(name: string): { date: Date; label: string } | null {
  // e.g. 2026-03-23.md
  const match = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const date = new Date(match[1] + 'T12:00:00');
  const label = isToday(date.getTime())
    ? 'Today'
    : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return { date, label };
}

function getFileIcon(file: MemoryFile): string {
  if (file.type === 'memory') return '🧠';
  if (file.type === 'daily') return '📝';
  if (file.type === 'agents') return '👤';
  return '📄';
}

function getFileAccentColor(file: MemoryFile): string {
  if (file.type === 'memory') return 'var(--accent)';
  if (file.type === 'daily') return 'var(--cyan)';
  if (file.type === 'agents') return 'var(--green)';
  return 'var(--yellow)';
}

function getFileLabel(file: MemoryFile): string {
  if (file.type === 'memory') return 'Long-term Memory';
  if (file.type === 'daily') {
    const info = getDateFromName(file.name);
    return info ? info.label : file.name.replace('.md', '');
  }
  if (file.type === 'agents') return file.name.replace('.md', '').replace(/_/g, ' ');
  return file.name.replace('.md', '');
}

// ─── Simple Markdown Renderer ─────────────────────────────────────────────────

interface RenderSegment {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'numbered' | 'code' | 'hr' | 'text';
  content: string;
  indent?: number;
}

function parseMarkdownLines(lines: string[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let inCodeBlock = false;
  let codeContent = '';

  for (const rawLine of lines) {
    const line = rawLine;

    // Code block toggle
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeContent = '';
      } else {
        inCodeBlock = false;
        segments.push({ type: 'code', content: codeContent.trimEnd() });
        codeContent = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      segments.push({ type: 'hr', content: '' });
      continue;
    }

    // Headings
    const h1 = line.match(/^# (.+)/);
    if (h1) { segments.push({ type: 'h1', content: h1[1] }); continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { segments.push({ type: 'h2', content: h2[1] }); continue; }
    const h3 = line.match(/^### (.+)/);
    if (h3) { segments.push({ type: 'h3', content: h3[1] }); continue; }
    const h4 = line.match(/^#### (.+)/);
    if (h4) { segments.push({ type: 'h4', content: h4[1] }); continue; }

    // Bullet list
    const bullet = line.match(/^(\s*)[-*] (.+)/);
    if (bullet) {
      segments.push({ type: 'bullet', content: bullet[2], indent: Math.floor(bullet[1].length / 2) });
      continue;
    }

    // Numbered list
    const numbered = line.match(/^(\s*)\d+\. (.+)/);
    if (numbered) {
      segments.push({ type: 'numbered', content: numbered[2], indent: Math.floor(numbered[1].length / 2) });
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') continue;

    // Plain text
    segments.push({ type: 'text', content: line });
  }

  return segments;
}

// ─── Code block syntax highlighter (simple) ───────────────────────────────────

function highlightCode(code: string): string {
  // Very simple highlighting: strings, keywords, comments
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(["'`])(.*?)(\1)/g, '<span class="md-string">$1$2$3</span>')
    .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|interface|type|extends|implements|new|this|true|false|null|undefined)\b/g, '<span class="md-keyword">$1</span>')
    .replace(/(#.*$|\/\/.*$|\/\*[\s\S]*?\*\/)/g, '<span class="md-comment">$1</span>');
}

// ─── Content Viewer ────────────────────────────────────────────────────────────

function ContentViewer({ content, fileName }: { content: string; fileName: string }) {
  const lines = content.split('\n');
  const segments = parseMarkdownLines(lines);

  return (
    <div className="mb-content-viewer">
      <div className="mb-content-header">
        <span className="mb-content-filename">{fileName}</span>
        <span className="mb-content-meta">
          {content.split('\n').length} lines · {formatFileSize(content.length)}
        </span>
      </div>
      <div className="mb-content-body">
        {segments.length === 0 && (
          <div className="mb-empty-content">This file is empty.</div>
        )}
        {segments.map((seg, i) => {
          if (seg.type === 'h1') return (
            <h1 key={i} className="mb-h1">{seg.content}</h1>
          );
          if (seg.type === 'h2') return (
            <h2 key={i} className="mb-h2">{seg.content}</h2>
          );
          if (seg.type === 'h3') return (
            <h3 key={i} className="mb-h3">{seg.content}</h3>
          );
          if (seg.type === 'h4') return (
            <h4 key={i} className="mb-h4">{seg.content}</h4>
          );
          if (seg.type === 'hr') return (
            <hr key={i} className="mb-hr" />
          );
          if (seg.type === 'bullet') return (
            <div key={i} className="mb-bullet" style={{ marginLeft: `${(seg.indent ?? 0) * 16}px` }}>
              <span className="mb-bullet-dot">•</span>
              <span className="mb-bullet-text">{seg.content}</span>
            </div>
          );
          if (seg.type === 'numbered') return (
            <div key={i} className="mb-numbered" style={{ marginLeft: `${(seg.indent ?? 0) * 16}px` }}>
              <span className="mb-numbered-num">{seg.content.match(/^\d+/)?.[0]}</span>
              <span className="mb-bullet-text">{seg.content.replace(/^\d+\.\s*/, '')}</span>
            </div>
          );
          if (seg.type === 'code') return (
            <pre key={i} className="mb-code-block">
              <code dangerouslySetInnerHTML={{ __html: highlightCode(seg.content) }} />
            </pre>
          );
          return (
            <p key={i} className="mb-paragraph">{seg.content}</p>
          );
        })}
      </div>
    </div>
  );
}

// ─── File List Item ───────────────────────────────────────────────────────────

function FileListItem({
  file,
  isSelected,
  onClick,
}: {
  file: MemoryFile;
  isSelected: boolean;
  onClick: () => void;
}) {
  const accentColor = getFileAccentColor(file);
  const icon = getFileIcon(file);
  const label = getFileLabel(file);

  return (
    <button
      className={`mb-file-item${isSelected ? ' mb-file-item--selected' : ''}`}
      onClick={onClick}
      style={isSelected ? {
        background: `${accentColor}12`,
        borderLeft: `2px solid ${accentColor}`,
      } : {}}
      title={`${file.name}\n${formatFileSize(file.size)} · ${formatRelDate(file.mtime)}`}
    >
      <span className="mb-file-icon" style={{ color: accentColor }}>{icon}</span>
      <div className="mb-file-info">
        <span className="mb-file-label" style={isSelected ? { color: accentColor } : {}}>
          {label}
        </span>
        <span className="mb-file-meta">
          {file.name}
          <span className="mb-file-dot">·</span>
          {formatFileSize(file.size)}
          <span className="mb-file-dot">·</span>
          {formatRelDate(file.mtime)}
        </span>
      </div>
      {isSelected && (
        <span className="mb-file-selected-dot" style={{ background: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
      )}
    </button>
  );
}

// ─── Section Divider ─────────────────────────────────────────────────────────

function SectionDivider({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-section-divider">
      <span>{label}</span>
      <span className="mb-section-count">{count}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface MemoryBrowserProps {
  onSelectSession?: (sessionKey: string) => void;
}

export default function MemoryBrowser({ onSelectSession }: MemoryBrowserProps) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<'all' | 'daily' | 'memory' | 'agents'>('all');

  // Load file list
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/memory/files')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setFiles(data);
          if (data.length > 0 && !selectedFile) {
            // Auto-select most recent MEMORY.md or most recent daily
            const memFile = data.find((f: MemoryFile) => f.type === 'memory');
            const dailyFiles = data.filter((f: MemoryFile) => f.type === 'daily');
            const defaultFile = memFile ?? dailyFiles[0] ?? data[0];
            setSelectedFile(defaultFile);
          }
        } else {
          setError(data.error ?? 'Failed to load memory files');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Load selected file content
  useEffect(() => {
    if (!selectedFile) { setContent(null); return; }
    setLoadingContent(true);
    setContent(null);
    fetch(`/api/memory/content?file=${encodeURIComponent(selectedFile.path)}`)
      .then(r => r.json())
      .then(data => {
        if (data.content !== undefined) {
          setContent(data.content);
        } else {
          setError(data.error ?? 'Failed to load file content');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingContent(false));
  }, [selectedFile]);

  // Filter files
  const filteredFiles = files.filter(f => {
    if (section !== 'all' && f.type !== section) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return f.name.toLowerCase().includes(q) || getFileLabel(f).toLowerCase().includes(q);
    }
    return true;
  });

  const dailyFiles = filteredFiles.filter(f => f.type === 'daily');
  const memoryFiles = filteredFiles.filter(f => f.type === 'memory');
  const agentFiles = filteredFiles.filter(f => f.type === 'agents');
  const otherFiles = filteredFiles.filter(f => f.type === 'todo');

  const sections: { key: 'all' | 'daily' | 'memory' | 'agents'; label: string; files: MemoryFile[] }[] = [
    { key: 'daily', label: '📝 Daily Notes', files: dailyFiles },
    { key: 'memory', label: '🧠 Long-term Memory', files: memoryFiles },
    { key: 'agents', label: '👤 Agent Identity', files: agentFiles },
  ];

  const renderSections = section === 'all';

  return (
    <ErrorBoundary name="MemoryBrowser">
      <div className="memory-browser-panel">
        {/* Panel header */}
        <div className="panel-header">
          <div className="panel-header-left">
            <h3>🧠 Memory Browser</h3>
            {files.length > 0 && (
              <span className="mb-file-count-badge" title={`${files.length} memory files`}>
                {files.length} files
              </span>
            )}
          </div>
          <div className="panel-header-right">
            {/* Section filter */}
            <div className="mb-section-tabs">
              {(['all', 'daily', 'memory', 'agents'] as const).map(s => (
                <button
                  key={s}
                  className={`mb-section-tab${section === s ? ' active' : ''}`}
                  onClick={() => setSection(s)}
                >
                  {s === 'all' ? 'All' : s === 'daily' ? 'Daily' : s === 'memory' ? 'Memory' : 'Identity'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-body">
          {/* File list sidebar */}
          <div className="mb-sidebar">
            {/* Search */}
            <div className="mb-search-wrap">
              <span className="mb-search-icon">🔍</span>
              <input
                type="text"
                className="mb-search-input"
                placeholder="Search files..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="mb-search-clear" onClick={() => setSearch('')}>✕</button>
              )}
            </div>

            {/* Loading state */}
            {loading && (
              <div className="mb-loading">
                <div className="mb-spinner" />
                <span>Loading memory files…</span>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="mb-error">
                <span>⚠ {error}</span>
                <button className="mb-retry-btn" onClick={() => { setError(null); setLoading(true); window.location.reload(); }}>
                  Retry
                </button>
              </div>
            )}

            {/* File list */}
            {!loading && !error && (
              <div className="mb-file-list">
                {files.length === 0 && (
                  <div className="mb-empty-files">
                    <span style={{ fontSize: '24px' }}>🧠</span>
                    <span>No memory files found</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Memory files are created by your agents automatically
                    </span>
                  </div>
                )}

                {renderSections ? (
                  <>
                    {memoryFiles.length > 0 && (
                      <>
                        <SectionDivider label="🧠 Long-term Memory" count={memoryFiles.length} />
                        {memoryFiles.map(f => (
                          <FileListItem
                            key={f.path}
                            file={f}
                            isSelected={selectedFile?.path === f.path}
                            onClick={() => setSelectedFile(f)}
                          />
                        ))}
                      </>
                    )}
                    {dailyFiles.length > 0 && (
                      <>
                        <SectionDivider label="📝 Daily Notes" count={dailyFiles.length} />
                        {dailyFiles.map(f => (
                          <FileListItem
                            key={f.path}
                            file={f}
                            isSelected={selectedFile?.path === f.path}
                            onClick={() => setSelectedFile(f)}
                          />
                        ))}
                      </>
                    )}
                    {agentFiles.length > 0 && (
                      <>
                        <SectionDivider label="👤 Agent Identity" count={agentFiles.length} />
                        {agentFiles.map(f => (
                          <FileListItem
                            key={f.path}
                            file={f}
                            isSelected={selectedFile?.path === f.path}
                            onClick={() => setSelectedFile(f)}
                          />
                        ))}
                      </>
                    )}
                    {otherFiles.length > 0 && (
                      <>
                        <SectionDivider label="📄 Other Files" count={otherFiles.length} />
                        {otherFiles.map(f => (
                          <FileListItem
                            key={f.path}
                            file={f}
                            isSelected={selectedFile?.path === f.path}
                            onClick={() => setSelectedFile(f)}
                          />
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  filteredFiles.map(f => (
                    <FileListItem
                      key={f.path}
                      file={f}
                      isSelected={selectedFile?.path === f.path}
                      onClick={() => setSelectedFile(f)}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Content viewer */}
          <div className="mb-content-area">
            {!selectedFile && !loadingContent && (
              <div className="mb-select-prompt">
                <span style={{ fontSize: '32px' }}>🧠</span>
                <h4>Select a memory file</h4>
                <p>Choose a file from the list to view its contents</p>
              </div>
            )}
            {loadingContent && (
              <div className="mb-loading-content">
                <div className="mb-spinner" />
                <span>Loading file…</span>
              </div>
            )}
            {content !== null && selectedFile && !loadingContent && (
              <ContentViewer content={content} fileName={selectedFile.name} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mb-footer">
          <span className="mb-footer-info">
            {files.length > 0 && `🧠 ${files.length} memory file${files.length !== 1 ? 's' : ''} · Workspace memory`}
          </span>
          <span className="mb-footer-hint">
            Files are created by agents writing to MEMORY.md or memory/YYYY-MM-DD.md
          </span>
        </div>
      </div>
    </ErrorBoundary>
  );
}
