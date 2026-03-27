/**
 * Pending review queue for confirm_mode.
 *
 * When confirm_mode is enabled, borderline entity detections (confidence
 * between warn_threshold and redact_threshold) are placed here. The proxy
 * suspends the outbound request until the dashboard user resolves each item.
 *
 * Each pending review is backed by a Promise whose resolver is called when
 * the dashboard POSTs a decision. An auto-timeout approves all entities if
 * the user doesn't respond in time.
 */

import type { DetectedEntity } from './types.js';

export type Decision = 'approve' | 'reject';
export type Decisions = Record<string, Decision>; // keyed by entity.original

export interface PendingReview {
  pendingId: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  entities: DetectedEntity[];
  originalText: string;
}

interface QueueEntry extends PendingReview {
  resolver: (decisions: Decisions) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const queue = new Map<string, QueueEntry>();

/**
 * Add a pending review and return a Promise that resolves with the decisions.
 * Auto-approves all entities after `timeoutMs` milliseconds.
 */
export function createPendingReview(review: PendingReview, timeoutMs = 60_000): Promise<Decisions> {
  return new Promise<Decisions>((resolve) => {
    const timeoutId = setTimeout(() => {
      if (queue.has(review.pendingId)) {
        queue.delete(review.pendingId);
        const auto: Decisions = {};
        for (const e of review.entities) {
          auto[e.original] = 'approve';
        }
        resolve(auto);
      }
    }, timeoutMs);

    queue.set(review.pendingId, { ...review, resolver: resolve, timeoutId });
  });
}

/** Resolve a pending review with explicit decisions. Returns false if not found. */
export function resolvePendingReview(pendingId: string, decisions: Decisions): boolean {
  const entry = queue.get(pendingId);
  if (!entry) return false;
  clearTimeout(entry.timeoutId);
  queue.delete(pendingId);
  entry.resolver(decisions);
  return true;
}

export function getAllPending(): PendingReview[] {
  return Array.from(queue.values()).map(({ resolver: _r, timeoutId: _t, ...review }) => review);
}

export function getPendingById(pendingId: string): PendingReview | undefined {
  const entry = queue.get(pendingId);
  if (!entry) return undefined;
  const { resolver: _r, timeoutId: _t, ...review } = entry;
  return review;
}
