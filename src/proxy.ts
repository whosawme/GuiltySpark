/**
 * GuiltySpark HTTP Proxy Adapter
 *
 * A local HTTP server that intercepts OpenAI-compatible and Anthropic API
 * requests, runs them through the PII scanner + substitution engine, forwards
 * sanitized requests to the real provider, and decodes the response before
 * returning it to the caller.
 *
 * USAGE:
 *   node dist/proxy.js
 *
 * Then point any tool at http://localhost:8787:
 *   OPENAI_BASE_URL=http://localhost:8787/v1 codex "draft a response to John Smith at john@acme.com"
 *   ANTHROPIC_BASE_URL=http://localhost:8787  claude "..."
 *
 * SUPPORTED ENDPOINTS:
 *   POST /v1/chat/completions   — OpenAI-compatible (Codex, Gemini, DeepSeek, etc.)
 *   POST /v1/messages           — Anthropic format
 *   GET  /health                — Health check
 *
 * DESIGN:
 * The proxy is intentionally thin on transport logic. It reuses the same five
 * core modules (PII Scanner, Substitution Engine, Substitution Map, Response
 * Decoder, LLM Relay) as the MCP server — the only difference is the transport
 * layer (HTTP instead of stdio MCP).
 *
 * Each request gets its own session (no cross-request state leakage). For
 * multi-turn conversations, clients can pass X-GuiltySpark-Session-Id header
 * to reuse an existing session and get consistent substitutions across turns.
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { loadConfig, toProtectionConfig } from './config.js';
import { createSubstitutionMap } from './substitution-map.js';
import { scanText } from './pii-scanner.js';
import { applySubstitutions } from './substitution-engine.js';
import { decodeResponse } from './response-decoder.js';
import type { SubstitutionMap } from './types.js';

// ─── Session registry ──────────────────────────────────────────────────────────

const sessions = new Map<string, SubstitutionMap>();

function getOrCreateSession(sessionId?: string, timeoutMs = 3_600_000): SubstitutionMap {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }
  const map = createSubstitutionMap(sessionId);
  sessions.set(map.sessionId, map);
  setTimeout(() => sessions.delete(map.sessionId), timeoutMs);
  return map;
}

// ─── Body parsing ──────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ─── Text extraction helpers ───────────────────────────────────────────────────

/**
 * Extract all user-facing text strings from an OpenAI-format request body.
 * Returns an array of [text, setter] pairs where setter writes back the sanitized text.
 */
function extractOpenAITexts(body: Record<string, unknown>): Array<{ text: string; index: number }> {
  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!Array.isArray(messages)) return [];

  const spans: Array<{ text: string; index: number }> = [];
  messages.forEach((msg, i) => {
    if (typeof msg.content === 'string') {
      spans.push({ text: msg.content, index: i });
    }
    // content can also be an array of parts (vision API) — only handle text parts
    if (Array.isArray(msg.content)) {
      msg.content.forEach((part: unknown) => {
        if (typeof part === 'object' && part !== null && (part as { type: string }).type === 'text') {
          spans.push({ text: (part as { text: string }).text, index: i });
        }
      });
    }
  });
  return spans;
}

/**
 * Apply substitutions back into the message array in-place.
 * Returns a new body with all message content sanitized.
 */
function substituteOpenAIBody(
  body: Record<string, unknown>,
  substituted: Map<number, string>,
): Record<string, unknown> {
  const messages = (body.messages as Array<{ role: string; content: unknown }>).map((msg, i) => {
    if (substituted.has(i) && typeof msg.content === 'string') {
      return { ...msg, content: substituted.get(i) };
    }
    return msg;
  });
  return { ...body, messages };
}

/**
 * Extract texts from an Anthropic-format request body.
 * Anthropic uses { messages: [{ role, content: string | ContentBlock[] }], system?: string }
 */
function extractAnthropicTexts(body: Record<string, unknown>): Array<{ text: string; key: string }> {
  const spans: Array<{ text: string; key: string }> = [];

  if (typeof body.system === 'string') {
    spans.push({ text: body.system, key: 'system' });
  }

  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (Array.isArray(messages)) {
    messages.forEach((msg, i) => {
      if (typeof msg.content === 'string') {
        spans.push({ text: msg.content, key: `msg_${i}` });
      }
      if (Array.isArray(msg.content)) {
        (msg.content as Array<{ type: string; text?: string }>).forEach((part, j) => {
          if (part.type === 'text' && typeof part.text === 'string') {
            spans.push({ text: part.text, key: `msg_${i}_part_${j}` });
          }
        });
      }
    });
  }
  return spans;
}

function substituteAnthropicBody(
  body: Record<string, unknown>,
  substituted: Map<string, string>,
): Record<string, unknown> {
  const result = { ...body };

  if (substituted.has('system')) {
    result.system = substituted.get('system');
  }

  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (Array.isArray(messages)) {
    result.messages = messages.map((msg, i) => {
      const key = `msg_${i}`;
      if (substituted.has(key) && typeof msg.content === 'string') {
        return { ...msg, content: substituted.get(key) };
      }
      if (Array.isArray(msg.content)) {
        const content = (msg.content as Array<{ type: string; text?: string }>).map((part, j) => {
          const pkey = `msg_${i}_part_${j}`;
          if (part.type === 'text' && substituted.has(pkey)) {
            return { ...part, text: substituted.get(pkey) };
          }
          return part;
        });
        return { ...msg, content };
      }
      return msg;
    });
  }

  return result;
}

// ─── Response text extraction/substitution ─────────────────────────────────────

function extractOpenAIResponseText(respBody: Record<string, unknown>): string {
  const choices = respBody.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content ?? '';
}

function patchOpenAIResponseText(respBody: Record<string, unknown>, decoded: string): Record<string, unknown> {
  const choices = (respBody.choices as Array<{ message?: { content?: string } }>).map((c, i) =>
    i === 0 && c.message ? { ...c, message: { ...c.message, content: decoded } } : c,
  );
  return { ...respBody, choices };
}

function extractAnthropicResponseText(respBody: Record<string, unknown>): string {
  const content = respBody.content as Array<{ type: string; text?: string }> | undefined;
  return content?.filter(b => b.type === 'text').map(b => b.text).join('') ?? '';
}

function patchAnthropicResponseText(respBody: Record<string, unknown>, decoded: string): Record<string, unknown> {
  const content = (respBody.content as Array<{ type: string; text?: string }>).map((b, i) =>
    i === 0 && b.type === 'text' ? { ...b, text: decoded } : b,
  );
  return { ...respBody, content };
}

// ─── Forwarding ────────────────────────────────────────────────────────────────

async function forwardRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });

  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => { respHeaders[key] = value; });
  const respBody = await resp.text();

  return { status: resp.status, headers: respHeaders, body: respBody };
}

// ─── Core request handler ──────────────────────────────────────────────────────

export async function createProxyServer() {
  const appConfig = loadConfig();
  const protectionConfig = toProtectionConfig(appConfig);
  const { port, anthropic_base_url, openai_base_url } = appConfig.proxy;

  const ANTHROPIC_URL = anthropic_base_url ?? 'https://api.anthropic.com';
  const OPENAI_URL = openai_base_url ?? 'https://api.openai.com';

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Health check
    if (method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      return;
    }

    if (method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const isOpenAI = url === '/v1/chat/completions';
    const isAnthropic = url === '/v1/messages';

    if (!isOpenAI && !isAnthropic) {
      res.writeHead(404);
      res.end('Not Found — supported endpoints: POST /v1/chat/completions, POST /v1/messages');
      return;
    }

    try {
      const rawBody = await readBody(req);
      let reqBody: Record<string, unknown>;
      try {
        reqBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
        return;
      }

      // Resolve or create session — clients can pass a header for multi-turn continuity
      const sessionId = req.headers['x-guiltyspark-session-id'] as string | undefined;
      const session = getOrCreateSession(sessionId, appConfig.session.timeout_ms);

      // ── Sanitize request ──────────────────────────────────────────────────

      let sanitizedBody: Record<string, unknown>;

      if (isOpenAI) {
        const spans = extractOpenAITexts(reqBody);
        const substituted = new Map<number, string>();
        for (const { text, index } of spans) {
          const scanResult = await scanText([text], protectionConfig, appConfig.ollama);
          substituted.set(index, applySubstitutions(
            text,
            scanResult.entities,
            session,
            protectionConfig.substitutionMode,
            protectionConfig.customEntities,
          ));
        }
        sanitizedBody = substituteOpenAIBody(reqBody, substituted);
      } else {
        // Anthropic
        const spans = extractAnthropicTexts(reqBody);
        const substituted = new Map<string, string>();
        for (const { text, key } of spans) {
          const scanResult = await scanText([text], protectionConfig, appConfig.ollama);
          substituted.set(key, applySubstitutions(
            text,
            scanResult.entities,
            session,
            protectionConfig.substitutionMode,
            protectionConfig.customEntities,
          ));
        }
        sanitizedBody = substituteAnthropicBody(reqBody, substituted);
      }

      // ── Forward sanitized request ─────────────────────────────────────────

      const targetBase = isOpenAI ? OPENAI_URL : ANTHROPIC_URL;
      const targetUrl = `${targetBase}${url}`;

      // Pass through auth headers from the original request
      const forwardHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string' && (
          key === 'authorization' ||
          key === 'x-api-key' ||
          key === 'anthropic-version' ||
          key === 'anthropic-beta'
        )) {
          forwardHeaders[key] = value;
        }
      }

      const upstream = await forwardRequest(
        targetUrl,
        'POST',
        forwardHeaders,
        JSON.stringify(sanitizedBody),
      );

      // ── Decode response ───────────────────────────────────────────────────

      let finalBody = upstream.body;

      if (upstream.status === 200) {
        try {
          const respJson = JSON.parse(upstream.body) as Record<string, unknown>;
          let rawText: string;
          let patchedJson: Record<string, unknown>;

          if (isOpenAI) {
            rawText = extractOpenAIResponseText(respJson);
            const decoded = decodeResponse(rawText, session);
            patchedJson = patchOpenAIResponseText(respJson, decoded);
          } else {
            rawText = extractAnthropicResponseText(respJson);
            const decoded = decodeResponse(rawText, session);
            patchedJson = patchAnthropicResponseText(respJson, decoded);
          }

          finalBody = JSON.stringify(patchedJson);
        } catch {
          // If response parsing fails, pass through unmodified
        }
      }

      // Return session ID header so clients can maintain multi-turn sessions
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'X-GuiltySpark-Session-Id': session.sessionId,
      });
      res.end(finalBody);

    } catch (err) {
      console.error('[proxy] Unhandled error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal proxy error', message: (err as Error).message }));
    }
  });

  return { server, port };
}

export async function startProxy(): Promise<void> {
  const { server, port } = await createProxyServer();

  server.listen(port, '127.0.0.1', () => {
    console.error(`[guiltyspark-proxy] Listening on http://127.0.0.1:${port}`);
    console.error(`[guiltyspark-proxy] Endpoints:`);
    console.error(`  POST /v1/chat/completions  (OpenAI-compatible)`);
    console.error(`  POST /v1/messages          (Anthropic)`);
    console.error(`  GET  /health`);
    console.error(`[guiltyspark-proxy] Usage:`);
    console.error(`  OPENAI_BASE_URL=http://127.0.0.1:${port}/v1 your-tool ...`);
    console.error(`  ANTHROPIC_BASE_URL=http://127.0.0.1:${port}  your-tool ...`);
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}
