/**
 * GuiltySpark Dashboard Server
 *
 * Serves the React dashboard UI (built output from dashboard/) and a REST +
 * WebSocket API for real-time visibility into the privacy pipeline.
 *
 * Port: 8788 (configurable via dashboard.port in guiltyspark.config.yaml)
 *
 * REST API:
 *   GET    /api/sessions              — list all active sessions
 *   GET    /api/sessions/:id/map      — substitution map for a session
 *   DELETE /api/sessions/:id          — destroy a session
 *   GET    /api/audit-log             — request history (?limit=&offset=)
 *   GET    /api/pending               — pending review queue (confirm_mode)
 *   POST   /api/pending/:id/resolve   — resolve a pending review
 *   GET    /api/config                — current app config
 *   PUT    /api/config                — update config (writes to disk)
 *
 * WebSocket (ws://localhost:8788):
 *   On connect → sends { type: 'init', data: { sessions, auditLog, pending, config } }
 *   Live events → broadcast to all clients as { type, data } frames
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { createReadStream, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { gsEvents, GS_EVENTS } from './events.js';
import { getAllSessions, getSession, destroySession } from './session-registry.js';
import { getAuditLog, getTotalCount } from './audit-log.js';
import { getAllPending, resolvePendingReview } from './pending-queue.js';
import { loadConfig, saveConfig, invalidateConfigCache } from './config.js';
import { allEntries } from './substitution-map.js';
import type { AppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Built React app lives at <repo-root>/dashboard/dist/
const DASHBOARD_BUILD = join(__dirname, '..', 'dashboard', 'dist');

// ─── Helpers ───────────────────────────────────────────────────────────────────

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  html: 'text/html',
  js:   'application/javascript',
  mjs:  'application/javascript',
  css:  'text/css',
  json: 'application/json',
  svg:  'image/svg+xml',
  png:  'image/png',
  ico:  'image/x-icon',
  woff2:'font/woff2',
};

function serveFile(filePath: string, res: ServerResponse): void {
  if (!existsSync(filePath)) {
    res.writeHead(404); res.end('Not Found');
    return;
  }
  const ext = filePath.split('.').pop() ?? '';
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

// ─── API handler ───────────────────────────────────────────────────────────────

async function handleAPI(
  pathname: string,
  method: string,
  searchParams: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // GET /api/sessions
  if (method === 'GET' && pathname === '/api/sessions') {
    const list = getAllSessions().map(s => ({
      sessionId: s.sessionId,
      entryCount: s.entries.size,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
    json(res, list);
    return;
  }

  // GET /api/sessions/:id/map
  const mapMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/map$/);
  if (method === 'GET' && mapMatch) {
    const session = getSession(mapMatch[1]);
    if (!session) { json(res, { error: 'Session not found' }, 404); return; }
    const entries = allEntries(session).map(e => ({
      id: e.id,
      type: e.type,
      customLabel: e.customLabel,
      original: e.original,
      synthetic: e.synthetic,
      createdAt: e.createdAt,
    }));
    json(res, { sessionId: session.sessionId, entries });
    return;
  }

  // DELETE /api/sessions/:id
  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === 'DELETE' && sessionMatch) {
    const ok = destroySession(sessionMatch[1]);
    json(res, { ok }, ok ? 200 : 404);
    return;
  }

  // GET /api/audit-log
  if (method === 'GET' && pathname === '/api/audit-log') {
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    json(res, { entries: getAuditLog(limit, offset), total: getTotalCount() });
    return;
  }

  // GET /api/pending
  if (method === 'GET' && pathname === '/api/pending') {
    json(res, getAllPending());
    return;
  }

  // POST /api/pending/:id/resolve
  const pendingMatch = pathname.match(/^\/api\/pending\/([^/]+)\/resolve$/);
  if (method === 'POST' && pendingMatch) {
    const body = await readBody(req) as { decisions: Record<string, 'approve' | 'reject'> };
    const ok = resolvePendingReview(pendingMatch[1], body.decisions ?? {});
    if (ok) {
      gsEvents.emit(GS_EVENTS.PENDING_REVIEW_RESOLVED, {
        pendingId: pendingMatch[1],
        decisions: body.decisions,
      });
    }
    json(res, { ok }, ok ? 200 : 404);
    return;
  }

  // GET /api/config
  if (method === 'GET' && pathname === '/api/config') {
    json(res, loadConfig());
    return;
  }

  // PUT /api/config
  if (method === 'PUT' && pathname === '/api/config') {
    try {
      const body = await readBody(req) as AppConfig;
      invalidateConfigCache();
      saveConfig(body);
      json(res, { ok: true });
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
    return;
  }

  json(res, { error: 'Not Found' }, 404);
}

// ─── Server factory ────────────────────────────────────────────────────────────

export async function startDashboard(port = 8788): Promise<void> {
  const clients = new Set<WebSocket>();

  function broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  // Forward pipeline events to dashboard clients
  const eventNames = [
    GS_EVENTS.ENTITY_DETECTED,
    GS_EVENTS.SUBSTITUTION_APPLIED,
    GS_EVENTS.REQUEST_PROCESSED,
    GS_EVENTS.RESPONSE_DECODED,
    GS_EVENTS.PENDING_REVIEW_CREATED,
    GS_EVENTS.PENDING_REVIEW_RESOLVED,
  ] as const;

  for (const name of eventNames) {
    gsEvents.on(name, (data) => broadcast({ type: name, data }));
  }

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const { pathname, searchParams } = url;

    // CORS preflight
    if (method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // REST API
    if (pathname.startsWith('/api/')) {
      await handleAPI(pathname, method, searchParams, req, res);
      return;
    }

    // Serve built React frontend
    if (!existsSync(DASHBOARD_BUILD)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>GuiltySpark Dashboard</title></head>
<body style="background:#0f172a;color:#94a3b8;font-family:monospace;padding:2rem;max-width:600px;margin:0 auto">
  <h1 style="color:#f1f5f9;margin-top:2rem">GuiltySpark Dashboard</h1>
  <p>The frontend hasn't been built yet.</p>
  <p>Run the following to build it:</p>
  <pre style="background:#1e293b;padding:1rem;border-radius:6px;color:#22d3ee">cd dashboard &amp;&amp; npm install &amp;&amp; npm run build</pre>
  <p>Then restart the server. The REST API and WebSocket are already active:</p>
  <ul>
    <li>REST: <code style="color:#22d3ee">http://localhost:${port}/api/</code></li>
    <li>WebSocket: <code style="color:#22d3ee">ws://localhost:${port}</code></li>
  </ul>
</body>
</html>`);
      return;
    }

    // Map SPA routes to index.html; asset files served directly
    let filePath: string;
    if (pathname === '/' || !pathname.includes('.')) {
      filePath = join(DASHBOARD_BUILD, 'index.html');
    } else {
      filePath = join(DASHBOARD_BUILD, pathname);
    }

    // Guard against path traversal
    if (!filePath.startsWith(DASHBOARD_BUILD)) {
      res.writeHead(403); res.end('Forbidden');
      return;
    }

    serveFile(filePath, res);
  });

  // WebSocket server shares the HTTP server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    // Send current state to the new client immediately
    const sessionList = getAllSessions().map(s => ({
      sessionId: s.sessionId,
      entryCount: s.entries.size,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));

    ws.send(JSON.stringify({
      type: 'init',
      data: {
        sessions: sessionList,
        auditLog: getAuditLog(100),
        pending: getAllPending(),
        config: loadConfig(),
      },
    }));

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, '127.0.0.1', () => {
      console.error(`[guiltyspark-dashboard] Listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}
