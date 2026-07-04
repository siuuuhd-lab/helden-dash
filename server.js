const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database('dashboard.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    access_key TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8080,
    server_name TEXT DEFAULT '',
    motd TEXT DEFAULT '',
    online_players INTEGER DEFAULT 0,
    max_players INTEGER DEFAULT 0,
    server_version TEXT DEFAULT '',
    plugin_version TEXT DEFAULT '',
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    is_online INTEGER DEFAULT 1
  )
`);

app.use(express.json());
const publicDir = path.join(__dirname, 'public');
const staticDir = require('fs').existsSync(publicDir) ? publicDir : __dirname;
app.use(express.static(staticDir));

app.post('/api/register', (req, res) => {
  const { key, ip, port, server_name, motd, online_players, max_players, server_version, plugin_version } = req.body;

  if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
    return res.status(400).json({ status: 'error', message: 'Invalid key format' });
  }
  if (!ip) {
    return res.status(400).json({ status: 'error', message: 'Missing ip' });
  }

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT first_seen FROM servers WHERE access_key = ?').get(key);
  const first_seen = existing ? existing.first_seen : now;

  db.prepare(`
    INSERT OR REPLACE INTO servers
    (access_key, ip, port, server_name, motd, online_players, max_players,
     server_version, plugin_version, first_seen, last_seen, is_online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(key, ip, port || 8080, server_name || '', motd || '',
        online_players || 0, max_players || 0,
        server_version || '', plugin_version || '',
        first_seen, now);

  res.json({ status: 'ok', message: 'Server registered successfully' });
});

app.post('/api/login', (req, res) => {
  const { key } = req.body;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
    return res.status(400).json({ status: 'error', message: 'Invalid key' });
  }

  const server = db.prepare('SELECT * FROM servers WHERE access_key = ?').get(key);
  if (!server) {
    return res.status(404).json({ status: 'error', message: 'Invalid key' });
  }

  const now = new Date();
  const lastSeen = new Date(server.last_seen);
  const diffMin = (now - lastSeen) / 60000;
  const isOnline = diffMin <= 2;

  if (!isOnline) {
    db.prepare('UPDATE servers SET is_online = 0 WHERE access_key = ?').run(key);
  }

  const response = {
    status: 'ok',
    server: {
      server_name: server.server_name,
      motd: server.motd,
      online_players: isOnline ? server.online_players : 0,
      max_players: isOnline ? server.max_players : 0,
      ip: server.ip,
      port: server.port,
      server_version: server.server_version,
      plugin_version: server.plugin_version,
      online: isOnline,
      last_seen: server.last_seen
    }
  };

  if (!isOnline) {
    response.warning = `Server offline \u2013 last contact ${Math.round(diffMin)} min ago`;
  }

  res.json(response);
});

app.get('/api/v1/*', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(401).json({ error: 'Missing key' });

  const server = db.prepare('SELECT ip, port FROM servers WHERE access_key = ?').get(key);
  if (!server) return res.status(404).json({ error: 'Invalid key' });

  const targetPath = req.originalUrl.split('?')[0];
  const targetUrl = `http://${server.ip}:${server.port}${targetPath}?key=${key}`;

  try {
    const response = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Server error' });
    }
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'Server unreachable' });
  }
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(staticDir, 'dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});
