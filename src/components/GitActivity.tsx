import { useState, useEffect, useRef } from 'react';

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  email?: string;
  date: number;
  dateStr: string;
  relativeStr: string;
  message: string;
  repo: string;       // workspace-relative path
  repoName: string;   // just the directory name
  branch?: string;
  isHead: boolean;    // true if this is the most recent commit of its repo
}

interface RepoInfo {
  path: string;       // full workspace-relative path
  name: string;
  branch: string;
  ahead: number;
  behind: number;
  isDirty: boolean;
}

const STORAGE_KEY = 'mc_git_activity_v2';
const MAX_COMMITS = 30;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 min

function loadGitActivity(): { commits: Commit[]; lastFetched: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { commits: [], lastFetched: 0 };
}

function saveGitActivity(data: { commits: Commit[]; lastFetched: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function authorInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}

function authorColor(name: string): string {
  // Pick a deterministic hue based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 40%)`;
}

function shortMessage(msg: string): string {
  const first = msg.split('\n')[0];
  return first.length > 60 ? first.slice(0, 60) + '…' : first;
}

async function findGitRepos(workspaceDir: string): Promise<string[]> {
  try {
    const res = await fetch('/__gateway/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: `find ${workspaceDir.replace(/'/g, "'\\''")} -name .git -type d 2>/dev/null | head -20`,
        timeout: 10000,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.stdout) {
      return data.stdout
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean)
        .map((p: string) => p.replace(/\/\.git$/, ''));
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchRepoCommits(repoPath: string, maxCount = 5): Promise<{ commits: Commit[]; info: RepoInfo }> {
  const escapedPath = repoPath.replace(/'/g, "'\\''");
  const infoRes = await fetch('/__gateway/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: `cd ${escapedPath} && git branch --show-current 2>/dev/null || echo "" && git status --porcelain 2>/dev/null | wc -l | tr -d ' '`,
      timeout: 8000,
    }),
  });

  let branch = 'main';
  let isDirty = false;
  if (infoRes.ok) {
    const data = await infoRes.json();
    if (data.stdout) {
      const lines = data.stdout.trim().split('\n');
      if (lines[0] !== undefined) branch = lines[0] || 'main';
      isDirty = parseInt(lines[1] || '0', 10) > 0;
    }
  }

  const commitRes = await fetch('/__gateway/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: `cd ${escapedPath} && git log --format="%H|%h|%an|%ae|%aI|%s" --no-merges -n ${maxCount} 2>/dev/null`,
      timeout: 8000,
    }),
  });

  const commits: Commit[] = [];
  const repoName = repoPath.split('/').pop() || repoPath;

  if (commitRes.ok) {
    const data = await commitRes.json();
    if (data.stdout) {
      const lines = data.stdout.trim().split('\n').filter(Boolean);
      lines.forEach((line: string, idx: number) => {
        const parts = line.split('|');
        if (parts.length >= 6) {
          const dateStr = parts[4];
          commits.push({
            hash: parts[0],
            shortHash: parts[1],
            author: parts[2],
            email: parts[3],
            date: new Date(dateStr).getTime(),
            dateStr,
            relativeStr: relativeTime(new Date(dateStr).getTime()),
            message: parts[5],
            repo: repoPath,
            repoName,
            branch,
            isHead: idx === 0,
          });
        }
      });
    }
  }

  return {
    commits,
    info: { path: repoPath, name: repoName, branch, ahead: 0, behind: 0, isDirty },
  };
}

async function fetchAllCommits(workspaceDir: string): Promise<{ commits: Commit[]; repos: RepoInfo[] }> {
  const repos = await findGitRepos(workspaceDir);
  const allCommits: Commit[] = [];
  const allRepos: RepoInfo[] = [];

  await Promise.all(
    repos.map(async (repo) => {
      try {
        const { commits, info } = await fetchRepoCommits(repo, 5);
        allCommits.push(...commits);
        allRepos.push(info);
      } catch {}
    })
  );

  // Sort by date descending
  allCommits.sort((a, b) => b.date - a.date);
  return { commits: allCommits.slice(0, MAX_COMMITS), repos: allRepos };
}

function CommitRow({ commit, expanded, onToggle }: { commit: Commit; expanded: boolean; onToggle: () => void }) {
  const ageColor =
    Date.now() - commit.date < 3600 * 1000
      ? 'var(--green)'
      : Date.now() - commit.date < 24 * 3600 * 1000
      ? 'var(--yellow)'
      : 'var(--text-muted)';

  return (
    <div
      className="git-commit-row"
      onClick={onToggle}
      title={`${commit.repoName}/${commit.branch} · ${commit.hash}\n${commit.message}\n\nAuthor: ${commit.author}\nDate: ${new Date(commit.date).toLocaleString()}`}
    >
      {/* Author avatar */}
      <div
        className="git-author-avatar"
        style={{ background: authorColor(commit.author) }}
        title={commit.author}
      >
        {authorInitials(commit.author)}
      </div>

      {/* Commit message + meta */}
      <div className="git-commit-body">
        <div className="git-commit-message">{shortMessage(commit.message)}</div>
        <div className="git-commit-meta">
          <span className="git-commit-repo" title={commit.repo}>{commit.repoName}</span>
          <span className="git-commit-sep">·</span>
          <span className="git-commit-branch" style={{ color: 'var(--accent)' }}>{commit.branch}</span>
          <span className="git-commit-sep">·</span>
          <span className="git-commit-time" style={{ color: ageColor }}>{commit.relativeStr}</span>
          <span className="git-commit-sep">·</span>
          <span
            className="git-commit-hash"
            title={commit.hash}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(commit.hash).catch(() => {});
            }}
          >
            {commit.shortHash}
          </span>
        </div>
        {expanded && (
          <div className="git-commit-expanded" onClick={(e) => e.stopPropagation()}>
            <div className="git-commit-full-msg">{commit.message}</div>
            <div className="git-commit-full-meta">
              <span>{commit.author}{commit.email ? ` <${commit.email}>` : ''}</span>
              <span> — {new Date(commit.date).toLocaleString()}</span>
            </div>
            <div className="git-commit-actions">
              <button
                className="git-commit-action-btn"
                onClick={() => navigator.clipboard?.writeText(commit.hash).catch(() => {})}
                title="Copy full SHA"
              >
                📋 Copy SHA
              </button>
              <button
                className="git-commit-action-btn"
                onClick={() => navigator.clipboard?.writeText(commit.message).catch(() => {})}
                title="Copy commit message"
              >
                📋 Copy message
              </button>
              <button
                className="git-commit-action-btn"
                onClick={() => {
                  const cmd = `cd ${commit.repo} && git show ${commit.shortHash} --stat`;
                  navigator.clipboard?.writeText(cmd).catch(() => {});
                }}
                title="Copy git show command"
              >
                📋 Copy show cmd
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New commit indicator */}
      {commit.isHead && (
        <div className="git-commit-head-badge" title="Most recent commit in this repo">HEAD</div>
      )}

      {/* Expand arrow */}
      <div className="git-commit-toggle" style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>
        {expanded ? '▲' : '▶'}
      </div>
    </div>
  );
}

interface GitActivityProps {
  workspaceDir?: string;
}

export default function GitActivity({ workspaceDir = '.' }: GitActivityProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCommits = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { commits: newCommits, repos: newRepos } = await fetchAllCommits(workspaceDir);
      setCommits(newCommits);
      setRepos(newRepos);
      setLastFetched(Date.now());
      saveGitActivity({ commits: newCommits, lastFetched: Date.now() });
    } catch (e) {
      setError('Failed to fetch git activity');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Initial load: try localStorage first, then refresh
  useEffect(() => {
    const cached = loadGitActivity();
    if (cached.commits.length > 0) {
      setCommits(cached.commits);
      setLastFetched(cached.lastFetched);
    }
    fetchCommits(cached.commits.length === 0);

    // Auto-refresh every 5 min
    fetchTimerRef.current = setInterval(() => fetchCommits(false), REFRESH_INTERVAL_MS);
    return () => {
      if (fetchTimerRef.current) clearInterval(fetchTimerRef.current);
    };
  }, [workspaceDir]);

  const toggleCommit = (hash: string) => {
    setExpandedCommits(prev => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const repoCount = repos.length;
  const dirtyRepos = repos.filter(r => r.isDirty).length;
  const lastCommitTime = commits[0]?.date ? relativeTime(commits[0].date) : null;

  if (!expanded) {
    // Collapsed: single-line summary chip in header
    return (
      <div
        className="git-activity-widget-collapsed"
        onClick={() => setExpanded(v => !v)}
        title={`Git Activity · ${repoCount} repo${repoCount !== 1 ? 's' : ''}${dirtyRepos > 0 ? ` · ${dirtyRepos} with uncommitted changes` : ''}\nLast commit: ${lastCommitTime || 'none'}\nClick to expand`}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          background: commits.length > 0 ? 'rgba(59,122,255,0.08)' : 'var(--bg-input)',
          border: `1px solid ${commits.length > 0 ? 'rgba(59,122,255,0.2)' : 'var(--border)'}`,
          borderRadius: '8px', padding: '3px 9px',
          fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
          color: commits.length > 0 ? 'var(--accent)' : 'var(--text-muted)',
          cursor: 'pointer', transition: 'all 0.15s',
          boxShadow: commits.length > 0 ? '0 0 6px rgba(59,122,255,0.1)' : 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11px' }}>⎇</span>
        <span style={{ fontWeight: 600 }}>Git</span>
        {loading ? (
          <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>loading…</span>
        ) : (
          <>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>
              {commits.length}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              commit{commits.length !== 1 ? 's' : ''}
            </span>
            {dirtyRepos > 0 && (
              <span style={{ fontSize: '9px', color: 'var(--yellow)', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '8px', padding: '0 4px' }}>
                ⚠ {dirtyRepos} dirty
              </span>
            )}
            {lastCommitTime && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                · {lastCommitTime}
              </span>
            )}
          </>
        )}
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '2px' }}>▼</span>
      </div>
    );
  }

  // Expanded: full panel
  return (
    <div
      className="git-activity-widget-expanded"
      style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(10,14,26,0.8)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '60px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
    >
      <div
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '16px', width: '620px', maxWidth: '95vw',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          fontFamily: "'Space Grotesk', sans-serif",
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⎇</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Git Activity</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                {repoCount} repo{repoCount !== 1 ? 's' : ''} · {commits.length} recent commit{commits.length !== 1 ? 's' : ''}
                {dirtyRepos > 0 && <span style={{ color: 'var(--yellow)' }}> · {dirtyRepos} dirty</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastFetched && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                Updated {relativeTime(lastFetched)}
              </span>
            )}
            <button
              onClick={() => fetchCommits(true)}
              disabled={loading}
              style={{
                background: 'rgba(59,122,255,0.1)', border: '1px solid rgba(59,122,255,0.25)',
                borderRadius: '6px', color: 'var(--accent)',
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: '11px',
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
                padding: '4px 10px', opacity: loading ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {loading ? '↻…' : '↻ Refresh'}
            </button>
            <button
              onClick={() => setExpanded(false)}
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: '12px', padding: '4px 10px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Repo status bar */}
        {repos.length > 0 && (
          <div style={{
            display: 'flex', gap: '6px', padding: '8px 20px',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
            overflowX: 'auto', flexWrap: 'wrap',
          }}>
            {repos.map(repo => (
              <div
                key={repo.path}
                title={`${repo.path}\nBranch: ${repo.branch}${repo.isDirty ? '\n⚠ Uncommitted changes' : '\n✓ Clean'}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: repo.isDirty ? 'rgba(251,191,36,0.08)' : 'rgba(52,211,153,0.06)',
                  border: `1px solid ${repo.isDirty ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.2)'}`,
                  borderRadius: '8px', padding: '3px 8px',
                  fontSize: '10px', fontFamily: "'Space Grotesk', sans-serif",
                  color: repo.isDirty ? 'var(--yellow)' : 'var(--green)',
                  flexShrink: 0,
                }}
              >
                <span>{repo.isDirty ? '⚠' : '✓'}</span>
                <span style={{ fontWeight: 600 }}>{repo.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{repo.branch}</span>
              </div>
            ))}
          </div>
        )}

        {/* Commit list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {error && (
            <div style={{ padding: '16px 20px', color: 'var(--red)', fontSize: '12px', textAlign: 'center' }}>
              {error}
            </div>
          )}
          {!error && commits.length === 0 && !loading && (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⎇</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>No git repositories found</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
                Git repos in the workspace will appear here
              </div>
            </div>
          )}
          {commits.map(commit => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              expanded={expandedCommits.has(commit.hash)}
              onToggle={() => toggleCommit(commit.hash)}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            Auto-refreshes every 5 min · Shows last {MAX_COMMITS} commits across all workspace repos
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
            Click repo name to copy path
          </span>
        </div>
      </div>
    </div>
  );
}
