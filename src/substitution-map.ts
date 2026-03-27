/**
 * SubstitutionMap — the core data structure for tracking PII substitutions.
 *
 * DATA STRUCTURE CHOICE: Two synchronized Maps (one forward, one reverse).
 *
 * WHY TWO MAPS instead of a single bidirectional structure:
 *   - O(1) lookup in both directions without secondary scan
 *   - Encoding step: original → synthetic (Map<string, SubstitutionEntry>)
 *   - Decoding step: synthetic → original (Map<string, SubstitutionEntry>)
 *   - Memory cost is doubled but entries are small strings; the lookup speed
 *     benefit far outweighs the cost for typical session sizes (<10k entries)
 *
 * WHY NOT a database or persistent store by default:
 *   - Session-scoped ephemeral storage is the primary threat model guarantee.
 *     If PII never touches disk, it cannot be recovered from a crashed process,
 *     swap file, or core dump. In-memory Maps enforce this guarantee by default.
 *   - Optional encrypted persistence can be layered on top for multi-session
 *     continuity (see README), but is opt-in so the default is most secure.
 *
 * WHY PER-SESSION ISOLATION:
 *   - Each session gets its own SubstitutionMap instance. This prevents
 *     cross-session correlation: if "John Smith" maps to "Robert Chen" in
 *     session A, it may map to "Wei Zhang" in session B. An attacker who
 *     observes both sessions cannot link them through synthetic values.
 *   - The session seed (used by the substitution engine) is derived from
 *     the session ID, ensuring deterministic but session-unique synthetics.
 *
 * COUNTER KEY DESIGN:
 *   - Counters are keyed by string (EntityType OR custom label).
 *   - Built-in types use their EntityType string: "PERSON_NAME", "EMAIL", etc.
 *   - User-defined custom entities use their label: "EMPLOYEE_ID", "CODENAME".
 *   - This ensures each entity type gets its own independent incrementing counter,
 *     so obvious-mode placeholders are [EMPLOYEE_ID_0], [EMPLOYEE_ID_1] — not
 *     [CUSTOM_0], [CUSTOM_1] which would be ambiguous across custom types.
 */

import { randomUUID } from 'crypto';
import type { EntityType, SubstitutionEntry, SubstitutionMap } from './types.js';
// EntityType is used in the insertEntry signature; string counters handle custom labels

export function createSubstitutionMap(sessionId?: string): SubstitutionMap {
  return {
    sessionId: sessionId ?? randomUUID(),
    // Forward index: original text → substitution entry
    // Used during the encoding pass (before sending to LLM)
    entries: new Map<string, SubstitutionEntry>(),
    // Reverse index: synthetic text → substitution entry
    // Used during the decoding pass (after receiving LLM response)
    reverseIndex: new Map<string, SubstitutionEntry>(),
    // Per-type counters keyed by EntityType string OR custom label.
    // Built-ins: "PERSON_NAME" → 0, 1, 2 ...
    // Custom:    "EMPLOYEE_ID" → 0, 1, 2 ... (independent of built-in CUSTOM bucket)
    counters: new Map<string, number>(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

/** Look up the synthetic value for an original string. Returns undefined on miss. */
export function lookupOriginal(map: SubstitutionMap, original: string): SubstitutionEntry | undefined {
  return map.entries.get(original);
}

/** Look up the original value for a synthetic string. Returns undefined on miss. */
export function lookupSynthetic(map: SubstitutionMap, synthetic: string): SubstitutionEntry | undefined {
  return map.reverseIndex.get(synthetic);
}

/**
 * Insert a new substitution entry and update both indexes atomically.
 *
 * @param customLabel - For user-defined entities, the user's label string (e.g. "EMPLOYEE_ID").
 *   When provided, this is used as the counter key so each custom type has its own
 *   independent sequence: EMPLOYEE_ID_0, EMPLOYEE_ID_1 rather than CUSTOM_0, CUSTOM_1.
 */
export function insertEntry(
  map: SubstitutionMap,
  original: string,
  synthetic: string,
  type: EntityType,
  customLabel?: string,
): SubstitutionEntry {
  // Check if original already has a mapping (idempotent within session)
  const existing = map.entries.get(original);
  if (existing) return existing;

  // Use custom label as counter key when present so user-defined types each get
  // their own independent counter, producing CODENAME_0, CODENAME_1 — not CUSTOM_0.
  const counterKey = customLabel ?? type;
  const count = map.counters.get(counterKey) ?? 0;
  map.counters.set(counterKey, count + 1);
  const id = `${counterKey}_${count}`;

  const entry: SubstitutionEntry = {
    original,
    synthetic,
    type,
    id,
    customLabel,
    createdAt: Date.now(),
  };

  // Atomically update both indexes so they never diverge
  map.entries.set(original, entry);
  map.reverseIndex.set(synthetic, entry);

  map.lastUsedAt = Date.now();
  return entry;
}

/** Return all entries as an array (for debugging/serialization). */
export function allEntries(map: SubstitutionMap): SubstitutionEntry[] {
  return Array.from(map.entries.values());
}

/** Return the number of substitutions tracked. */
export function entryCount(map: SubstitutionMap): number {
  return map.entries.size;
}

/** Clear all data from the map (call on session teardown). */
export function clearMap(map: SubstitutionMap): void {
  map.entries.clear();
  map.reverseIndex.clear();
  map.counters.clear();
}
