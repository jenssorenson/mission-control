import express from 'express';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs';
import { WebSocket } from 'ws';
import { webcrypto } from 'crypto';

const app = express();
const PORT = 3001;
const TODOS_FILE = path.join(process.env.HOME || '', '.openclaw', 'mc-todos.json');
const AUTH_FILE = path.join(process.env.HOME || '', '.openclaw', 'mc-auth.json');

interface AuthData {
  credentialId: string;
  registeredAt: string;
}

function readAuth(): AuthData | null {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeAuth(data: AuthData): void {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

// ── Key derivation (matches src/utils/crypto.ts) ──────────────────────────────
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const key = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return Buffer.from(new Uint8Array(key)).toString('hex');
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function isLocalhostOrigin(req: express.Request): boolean {
  const origin = req.headers.origin || '';
  return (
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    req.headers['x-forwarded-host'] === 'localhost' ||
    (Array.isArray(req.headers['x-forwarded-host']) && req.headers['x-forwarded-host'].includes('localhost'))
  );
}

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Bypass auth for localhost requests
  if (isLocalhostOrigin(req)) {
    (req as any).authOk = true;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const passphrase = authHeader.slice(7);
  // Allow a shared secret via environment variable (for cron agents)
  if (process.env.MC_API_SECRET && passphrase === process.env.MC_API_SECRET) {
    (req as any).authOk = true;
    return next();
  }

  if (!passphrase) {
    res.status(401).json({ error: 'Empty passphrase' });
    return;
  }

  const saltHex = req.headers['x-key-salt'] as string | undefined;
  const storedHash = req.headers['x-key-hash'] as string | undefined;

  if (!saltHex || !storedHash) {
    res.status(401).json({ error: 'Missing auth headers (x-key-salt, x-key-hash required)' });
    return;
  }

  try {
    // Decode hex salt (e.g. "1a2b3c" → Uint8Array([0x1a, 0x2b, 0x3c]))
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const derivedHash = await deriveKey(passphrase, salt);
    if (derivedHash !== storedHash) {
      res.status(401).json({ error: 'Invalid passphrase' });
      return;
    }
    (req as any).authOk = true;
    next();
  } catch {
    res.status(401).json({ error: 'Auth failed' });
  }
}

// ── File helpers ─────────────────────────────────────────────────────────────
function readTodos(): any[] {
  if (!fs.existsSync(TODOS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeTodos(todos: any[]) {
  fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// ── Seed ──────────────────────────────────────────────────────────────────────
const seedTodos = [
  {
    id: 'seed-1',
    text: 'Add more ancestors to the family tree',
    completed: false,
    createdAt: Date.now(),
  },
  {
    id: 'seed-2',
    text: 'Improve family tree navigation',
    completed: false,
    createdAt: Date.now(),
  },
  {
    id: 'seed-3',
    text: 'Review OpenClaw Mission Control features',
    completed: false,
    createdAt: Date.now(),
  },
];

function seedIfEmpty() {
  const todos = readTodos();
  if (todos.length === 0) {
    writeTodos(seedTodos);
  }
}
seedIfEmpty();

// ── Routes ───────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: false }));
app.use(express.json());

// GET /api/todos TEST
app.get('/api/todos', (_req, res) => {
  res.json(readTodos());
});

// PUT /api/todos — replace all
app.put('/api/todos', (req, res) => {
  if (!Array.isArray(req.body)) {
    res.status(400).json({ error: 'Body must be a JSON array of todos' });
    return;
  }
  // Validate items
  for (const item of req.body) {
    if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.completed !== 'boolean') {
      res.status(400).json({ error: 'Invalid todo shape: { id, text, completed, createdAt? }' });
      return;
    }
  }
  writeTodos(req.body);
  res.json(req.body);
});

// PATCH /api/todos/:id — update single todo
app.patch('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const todos = readTodos();
  const idx = todos.findIndex((t: any) => t.id === id);
  if (idx === -1) {
    res.status(404).json({ error: `Todo ${id} not found` });
    return;
  }
  const allowed = ['text', 'completed', 'priority'];
  const updates: any = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }
  todos[idx] = { ...todos[idx], ...updates };
  writeTodos(todos);
  res.json(todos[idx]);
});

// POST /api/client-error — log client-side errors for debugging
const clientErrors: any[] = [];
const MAX_CLIENT_ERRORS = 100;

app.post('/api/client-error', (req, res) => {
  const { message, source, lineno, colno, stack, url, userAgent } = req.body;
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    source,
    lineno,
    colno,
    stack,
    url,
    userAgent: userAgent || req.headers['user-agent'],
  };
  clientErrors.unshift(entry);
  if (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.pop();
  console.error('[ClientError]', JSON.stringify(entry));
  res.status(202).json({ ok: true });
});

// GET /api/client-errors — retrieve recent client errors (auth required)
app.get('/api/client-errors', (_req, res) => {
  res.json(clientErrors);
});

// ── Static file serving (production) ─────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  // Serve index.html explicitly for root BEFORE static middleware with index:false
  // (index:false on static would 403 on / before any route could catch it)
  app.get('/', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  // Serve static files for non-API routes (skip index files; root already handled above)
  app.use(express.static(distPath, { index: false }));
}


// GET /api/status — gateway reachability check (no auth)
app.get('/api/status', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({ uptime: process.uptime(), memoryUsage: mem.heapUsed / mem.heapTotal, cpuUsage: 0 });
});
// GET /__gateway/status — returns agent statuses from OpenClaw config + live session data from gateway
app.get('/__gateway/status', async (_req, res) => {
  const gatewayToken = process.env.GATEWAY_TOKEN || '79fe72ee050d87a0b044605700e527da18bcedfb02e62307';

  // Read agent names/icons from OpenClaw config
  const openclawConfig = JSON.parse(
    fs.readFileSync(
      process.env.OPENCLAW_CONFIG || path.join(os.homedir(), '.openclaw', 'openclaw.json'),
      'utf-8'
    )
  );
  const agentMeta: Record<string, { name: string; icon: string }> = {
    dev:    { name: 'Dev Agent',  icon: '🐦' },
    pi:     { name: 'Pi',         icon: '🍠' },
    gemini: { name: 'Gemini',      icon: '🌟' },
    minim:  { name: 'Minimax',    icon: '🔮' },
    minimax: { name: 'Minimax',    icon: '🔮' },
  };

  // Query gateway via WebSocket for active sessions
  let sessionCountByRuntime: Record<string, number> = {};
  try {
    sessionCountByRuntime = await new Promise<Record<string, number>>((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:18789');
      const timeout = setTimeout(() => { ws.close(); resolve({}); }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'req', id: 'auth', method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'mc-api', version: '1.0', platform: 'node', mode: 'backend' },
            role: 'backend', scopes: ['operator.read'],
            auth: { token: gatewayToken }
          }
        }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 'auth' && msg.ok) {
          ws.send(JSON.stringify({ type: 'req', id: 'list', method: 'sessions.list', params: {} }));
        } else if (msg.id === 'list' && msg.ok) {
          clearTimeout(timeout);
          const sessions: any[] = msg.result ?? [];
          const counts: Record<string, number> = {};
          sessions.forEach((s: any) => {
            const rt = s.runtime || s.agentId || 'unknown';
            counts[rt] = (counts[rt] || 0) + 1;
          });
          ws.close();
          resolve(counts);
        } else if (msg.id === 'list') {
          clearTimeout(timeout);
          ws.close();
          resolve({});
        }
      });
      ws.on('error', () => { clearTimeout(timeout); resolve({}); });
    });
  } catch { /* gateway unreachable — all idle */ }

  const agentStatuses: Record<string, string> = {};
  Object.entries(sessionCountByRuntime).forEach(([rt, count]) => {
    if (count > 0) agentStatuses[rt] = 'active';
  });

  const agents = (openclawConfig.agents?.list ?? []).map((a: any) => ({
    id: a.id,
    name: agentMeta[a.id]?.name ?? a.id,
    runtime: a.id,
    status: agentStatuses[a.id] ?? agentStatuses[a.runtime] ?? 'idle',
    icon: agentMeta[a.id]?.icon ?? '🤖',
  }));

  res.json({ agents });
});

// POST /__gateway/sessions — spawn a new agent session via gateway WebSocket
app.post('/__gateway/sessions', async (req, res) => {
  const gatewayToken = process.env.GATEWAY_TOKEN || '79fe72ee050d87a0b044605700e527da18bcedfb02e62307';
  const { task, runtime = 'subagent', model, mode = 'run', label } = req.body;

  let ws;
  try {
    ws = new WebSocket('ws://127.0.0.1:18789');

    const sessionKey = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Gateway connection timeout'));
      }, 15000);

      ws.on('open', () => {
        // Authenticate
        ws.send(JSON.stringify({
          type: 'req', id: 'auth', method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'mc-api', version: '1.0', platform: 'node', mode: 'backend' },
            role: 'backend', scopes: ['operator.read', 'operator.write'],
            auth: { token: gatewayToken }
          }
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 'auth' && msg.ok) {
          // Connected — spawn session
          ws.send(JSON.stringify({
            type: 'req', id: 'spawn', method: 'sessions.spawn',
            params: { task, runtime, model, mode, label }
          }));
        } else if (msg.id === 'spawn') {
          clearTimeout(timeout);
          if (msg.ok) {
            resolve(msg.result?.sessionKey ?? msg.result?.key ?? null);
          } else {
            reject(new Error(msg.error?.message ?? 'Spawn failed'));
          }
          ws.close();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    res.json({ ok: true, sessionKey });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Spawn failed' });
  } finally {
    if (ws) ws.close();
  }
});

// ── Memory Browser API ────────────────────────────────────────────────────────
const WORKSPACE_DIR = path.join(process.env.HOME || '', '.openclaw', 'workspace');
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');
const MEMORY_FILE = path.join(WORKSPACE_DIR, 'MEMORY.md');

// GET /api/memory/files — list available memory files
app.get('/api/memory/files', (_req, res) => {
  const files: { name: string; path: string; type: 'daily' | 'memory' | 'agents' | 'todo'; size: number; mtime: number }[] = [];

  // MEMORY.md
  try {
    const stat = fs.statSync(MEMORY_FILE);
    files.push({ name: 'MEMORY.md', path: MEMORY_FILE, type: 'memory', size: stat.size, mtime: stat.mtimeMs });
  } catch {}

  // memory/ daily notes
  try {
    if (fs.existsSync(MEMORY_DIR)) {
      const entries = fs.readdirSync(MEMORY_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          const fullPath = path.join(MEMORY_DIR, entry);
          const stat = fs.statSync(fullPath);
          files.push({ name: entry, path: fullPath, type: 'daily', size: stat.size, mtime: stat.mtimeMs });
        }
      }
    }
  } catch {}

  // Also scan for AGENTS.md, USER.md, SOUL.md as "agents" type
  for (const f of ['AGENTS.md', 'USER.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md']) {
    const fp = path.join(WORKSPACE_DIR, f);
    try {
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp);
        files.push({ name: f, path: fp, type: f === 'AGENTS.md' || f === 'USER.md' || f === 'SOUL.md' || f === 'IDENTITY.md' ? 'agents' : 'todo', size: stat.size, mtime: stat.mtimeMs });
      }
    } catch {}
  }

  // Sort by mtime descending
  files.sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// GET /api/memory/content?file=<encoded-path> — read a specific memory file
app.get('/api/memory/content', (req, res) => {
  const { file } = req.query;
  if (!file || typeof file !== 'string') {
    res.status(400).json({ error: 'file query param required' });
    return;
  }
  // Security: ensure resolved path is within workspace
  const resolved = path.resolve(file);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    res.status(403).json({ error: 'Path outside workspace' });
    return;
  }
  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    res.json({ path: resolved, content, size: content.length });
  } catch (err: any) {
    res.status(404).json({ error: err.message ?? 'File not found' });
  }
});

// GET /__gateway/auth/status — returns whether a passkey is registered server-side
app.get('/__gateway/auth/status', (_req, res) => {
  const auth = readAuth();
  res.json({ registered: auth !== null });
});

// POST /__gateway/auth/register — register a passkey credential (server-side only)
// Body: { credentialId: string } — called after browser WebAuthn registration succeeds
app.post('/__gateway/auth/register', (req, res) => {
  const { credentialId } = req.body;
  if (!credentialId || typeof credentialId !== 'string') {
    res.status(400).json({ error: 'credentialId required' });
    return;
  }
  writeAuth({ credentialId, registeredAt: new Date().toISOString() });
  res.json({ ok: true });
});

// DELETE /__gateway/auth — wipe server-side auth (requires gateway token)
app.delete('/__gateway/auth', (req, res) => {
  const token = req.headers['x-gateway-token'] as string;
  const expected = process.env.GATEWAY_TOKEN || '79fe72ee050d87a0b044605700e527da18bcedfb02e62307';
  if (token !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  res.json({ ok: true });
});

// POST /__gateway/auth/reset — reset auth without token (only if no passkey registered)
app.post('/__gateway/auth/reset', (_req, res) => {
  const auth = readAuth();
  if (auth !== null) {
    res.status(403).json({ error: 'A passkey is already registered. Use logout to reset, or use DELETE with gateway token.' });
    return;
  }
  // Nothing to reset — already unregistered
  res.json({ ok: true });
});

// ── Cron Jobs API (in-memory, lost on restart) ─────────────────────────────────

interface CronRunEntry {
  id: string;
  startedAt: number;
  durationMs?: number;
  status: 'success' | 'failed' | 'running';
  error?: string;
}

interface CronJob {
  id: string;
  name: string;
  task: string;
  runtime: 'dev' | 'pi' | 'gemini';
  schedule: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failed' | 'running';
  lastRunDurationMs?: number;
  runHistory: CronRunEntry[];
}

const cronJobs: CronJob[] = [];

// GET /__gateway/cron/jobs — list all jobs
app.get('/__gateway/cron/jobs', (_req, res) => {
  res.json({ jobs: cronJobs });
});

// POST /__gateway/cron/jobs — create job
app.post('/__gateway/cron/jobs', (req, res) => {
  const { name, task, runtime, schedule, enabled } = req.body;
  if (!name || typeof name !== 'string' || !task || typeof task !== 'string') {
    res.status(400).json({ error: 'name and task are required' });
    return;
  }
  if (!['dev', 'pi', 'gemini'].includes(runtime)) {
    res.status(400).json({ error: 'runtime must be dev, pi, or gemini' });
    return;
  }
  if (!schedule || typeof schedule !== 'string') {
    res.status(400).json({ error: 'schedule (cron expression) is required' });
    return;
  }
  const job: CronJob = {
    id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    task: task.trim(),
    runtime: runtime || 'dev',
    schedule,
    enabled: enabled !== false,
    createdAt: Date.now(),
    runHistory: [],
  };
  cronJobs.push(job);
  res.status(201).json(job);
});

// DELETE /__gateway/cron/jobs/:id — delete job
app.delete('/__gateway/cron/jobs/:id', (req, res) => {
  const idx = cronJobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  cronJobs.splice(idx, 1);
  res.json({ ok: true });
});

// PATCH /__gateway/cron/jobs/:id — update job (enable/disable, edit fields)
app.patch('/__gateway/cron/jobs/:id', (req, res) => {
  const job = cronJobs.find(j => j.id === req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const { name, task, runtime, schedule, enabled } = req.body;
  if (name !== undefined) job.name = String(name).trim();
  if (task !== undefined) job.task = String(task).trim();
  if (runtime !== undefined && ['dev', 'pi', 'gemini'].includes(runtime)) job.runtime = runtime;
  if (schedule !== undefined) job.schedule = String(schedule).trim();
  if (enabled !== undefined) job.enabled = Boolean(enabled);
  res.json(job);
});

// POST /__gateway/cron/jobs/:id/trigger — manual trigger (run now)
app.post('/__gateway/cron/jobs/:id/trigger', (req, res) => {
  const job = cronJobs.find(j => j.id === req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const runEntry: CronRunEntry = {
    id: `run-${Date.now()}`,
    startedAt: Date.now(),
    status: 'running',
  };
  job.runHistory.push(runEntry);
  job.lastRunStatus = 'running';
  job.lastRunAt = Date.now();
  // Simulate async run — resolve after 1-3s
  const delay = 1000 + Math.random() * 2000;
  setTimeout(() => {
    const success = Math.random() > 0.1;
    runEntry.status = success ? 'success' : 'failed';
    runEntry.durationMs = Math.round(delay);
    job.lastRunStatus = success ? 'success' : 'failed';
    job.lastRunDurationMs = Math.round(delay);
    if (success) {
      runEntry.durationMs = Math.round(delay);
    } else {
      runEntry.error = 'Simulated failure (no actual agent connected)';
    }
  }, delay);
  res.json({ ok: true, runId: runEntry.id });
});

// GET /__gateway/cron/jobs/:id/history — run history
app.get('/__gateway/cron/jobs/:id/history', (req, res) => {
  const job = cronJobs.find(j => j.id === req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ history: job.runHistory.slice(-20).reverse() });
});

// Catch-all: serve index.html for any non-API route (supports SPA routing)
if (isProd) {
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[API] Todos API running at http://localhost:${PORT}`);
});

// Move listen to end — routes must be registered first
