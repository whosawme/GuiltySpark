/**
 * In-memory audit log for all requests processed by the privacy pipeline.
 * Capped at MAX_ENTRIES; oldest entries are evicted when the cap is reached.
 * Nothing is written to disk — data is lost on server restart.
 */

const MAX_ENTRIES = 1000;

export interface AuditEntry {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  originalText: string;
  sanitizedText: string;
  llmResponse?: string;
  decodedResponse?: string;
  entitiesFound: number;
  provider?: string;
  durationMs: number;
}

const entries: AuditEntry[] = [];

export function addAuditEntry(entry: AuditEntry): void {
  entries.unshift(entry); // newest first
  if (entries.length > MAX_ENTRIES) {
    entries.pop();
  }
}

export function getAuditLog(limit = 100, offset = 0): AuditEntry[] {
  return entries.slice(offset, offset + limit);
}

export function getAuditEntry(id: string): AuditEntry | undefined {
  return entries.find(e => e.id === id);
}

export function updateAuditEntry(id: string, updates: Partial<AuditEntry>): void {
  const idx = entries.findIndex(e => e.id === id);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...updates };
  }
}

export function clearAuditLog(): void {
  entries.length = 0;
}

export function getTotalCount(): number {
  return entries.length;
}
