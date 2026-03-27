/**
 * Shared session registry used by both the MCP server and HTTP proxy.
 *
 * Extracted from the per-transport implementations so the dashboard server
 * can enumerate and destroy sessions without coupling to a specific transport.
 */

import { createSubstitutionMap } from './substitution-map.js';
import type { SubstitutionMap } from './types.js';

export const sessions = new Map<string, SubstitutionMap>();

let defaultTimeoutMs = 3_600_000;

export function setDefaultTimeout(ms: number): void {
  defaultTimeoutMs = ms;
}

export function getOrCreateSession(sessionId?: string, timeoutMs?: number): SubstitutionMap {
  const timeout = timeoutMs ?? defaultTimeoutMs;
  if (sessionId && sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)!;
    existing.lastUsedAt = Date.now();
    return existing;
  }
  const map = createSubstitutionMap(sessionId);
  sessions.set(map.sessionId, map);
  setTimeout(() => sessions.delete(map.sessionId), timeout);
  return map;
}

export function getAllSessions(): SubstitutionMap[] {
  return Array.from(sessions.values());
}

export function getSession(sessionId: string): SubstitutionMap | undefined {
  return sessions.get(sessionId);
}

export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}
