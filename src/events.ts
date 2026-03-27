/**
 * GuiltySpark Event Bus
 *
 * Singleton EventEmitter used by the privacy pipeline to broadcast internal
 * lifecycle events. The dashboard server subscribes here and forwards events
 * to connected WebSocket clients.
 */

import { EventEmitter } from 'events';
import type { DetectedEntity, SubstitutionEntry } from './types.js';

// ─── Event payload types ───────────────────────────────────────────────────────

export interface EntityDetectedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  entity: DetectedEntity;
}

export interface SubstitutionAppliedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  entry: SubstitutionEntry;
  isNew: boolean; // true if this is the first time this original was substituted
}

export interface RequestProcessedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  originalText: string;
  sanitizedText: string;
  entitiesFound: number;
  durationMs: number;
  provider?: string;
}

export interface ResponseDecodedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  llmResponse: string;
  decodedResponse: string;
}

export interface PendingReviewCreatedEvent {
  pendingId: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  entities: DetectedEntity[];
  originalText: string;
}

export interface PendingReviewResolvedEvent {
  pendingId: string;
  decisions: Record<string, 'approve' | 'reject'>;
}

// ─── Event name constants ──────────────────────────────────────────────────────

export const GS_EVENTS = {
  ENTITY_DETECTED: 'entity:detected',
  SUBSTITUTION_APPLIED: 'substitution:applied',
  REQUEST_PROCESSED: 'request:processed',
  RESPONSE_DECODED: 'response:decoded',
  PENDING_REVIEW_CREATED: 'pending:review:created',
  PENDING_REVIEW_RESOLVED: 'pending:review:resolved',
} as const;

// ─── Singleton emitter ─────────────────────────────────────────────────────────

class GuiltySparkEventEmitter extends EventEmitter {}

export const gsEvents = new GuiltySparkEventEmitter();
gsEvents.setMaxListeners(50);
