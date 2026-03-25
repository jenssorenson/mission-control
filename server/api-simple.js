const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const TODO_FILE = '/Users/jens/.openclaw/mc-todos.json';

function readTodos() {
  try {
    if (!fs.existsSync(TODO_FILE)) {
      const defaultTodos = [
        { id: '1', text: 'Improve family tree navigation UI', completed: false },
        { id: '2', text: 'Add ancestor search feature', completed: false },
        { id: '3', text: 'Polish 3D workshop animations', completed: false }
      ];
      fs.writeFileSync(TODO_FILE, JSON.stringify(defaultTodos, null, 2));
      return defaultTodos;
    }
    return JSON.parse(fs.readFileSync(TODO_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeTodos(todos) {
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

function verifyAuth(headers) {
  const auth = headers['authorization'];
  const keySalt = headers['x-key-salt'];
  const keyHash = headers['x-key-hash'];
  
  if (!auth || !keySalt || !keyHash) {
    return false;
  }
  
  // Simple check - in production this would verify the PBKDF2 hash
  return true;
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key-salt, x-key-hash');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Simple auth - allow all for now since WebAuthn handles auth
  const todos = readTodos();

  if (req.url === '/api/todos' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(todos));
    return;
  }

  if (req.url.startsWith('/api/todos') && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newTodos = JSON.parse(body);
        writeTodos(newTodos);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newTodos));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url.startsWith('/api/todos/') && req.method === 'PATCH') {
    const id = req.url.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        const todos = readTodos();
        const idx = todos.findIndex(t => t.id === id);
        if (idx !== -1) {
          todos[idx] = { ...todos[idx], ...update };
          writeTodos(todos);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(todos));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
