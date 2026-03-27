/**
 * PII Scanner — two-stage detection pipeline.
 *
 * Stage 1: Fast regex patterns (synchronous, zero network overhead)
 *   - Covers deterministic, high-precision patterns: emails, SSNs, credit cards,
 *     phone numbers, IP addresses, API keys, UUIDs, JWTs.
 *   - Each match gets confidence: 0.95 (high but not 1.0 due to edge case
 *     false positives, e.g. "123-45-6789" that's a product code not an SSN).
 *
 * Stage 2: Ollama NER (async, local LLM)
 *   - Sends text to a local Ollama model with a structured JSON prompt.
 *   - Catches semantic entities: names, addresses, orgs, contextual dates.
 *   - Falls back gracefully if Ollama is unavailable.
 *
 * Results are merged with overlap resolution (higher confidence wins).
 */

import { Ollama } from 'ollama';
import type { DetectedEntity, EntityType, ProtectionConfig, ScanResult } from './types.js';
import type { AppConfig } from './types.js';

// ─── Regex patterns ────────────────────────────────────────────────────────────

interface RegexRule {
  type: EntityType;
  pattern: RegExp;
  confidence: number;
}

const REGEX_RULES: RegexRule[] = [
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.97,
  },
  {
    type: 'PHONE',
    // US phone: optional +1, optional parens around area code, various separators
    pattern: /\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    confidence: 0.90,
  },
  {
    type: 'SSN',
    // Social Security Number: 3-2-4 digit format
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.88,
  },
  {
    type: 'CREDIT_CARD',
    // Visa (16), Mastercard (16), Amex (15), Discover (16) — spaced or unspaced
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})\b|\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g,
    confidence: 0.92,
  },
  {
    type: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.95,
  },
  {
    type: 'API_KEY',
    // Common API key prefixes
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|[A-Za-z0-9]{32,}(?=\s|$)(?=[A-Z0-9]{32,}))/g,
    confidence: 0.85,
  },
  {
    type: 'FINANCIAL_ACCOUNT',
    // UUID format (often used as account identifiers)
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    confidence: 0.80,
  },
  {
    // JWTs: three base64url segments separated by dots
    type: 'API_KEY',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g,
    confidence: 0.98,
  },
];

// ─── Stage 1: Regex scan ───────────────────────────────────────────────────────

export function regexScan(text: string, config: ProtectionConfig): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const protected_ = new Set(config.protect);

  for (const rule of REGEX_RULES) {
    if (!protected_.has(rule.type)) continue;

    rule.pattern.lastIndex = 0; // reset stateful global regex
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const original = match[0];
      entities.push({
        original,
        type: rule.type,
        confidence: rule.confidence,
        start: match.index,
        end: match.index + original.length,
        source: 'regex',
      });
    }
  }

  // Run user-defined custom patterns
  for (const custom of config.customPatterns) {
    const pat = new RegExp(custom.pattern, 'g');
    let match: RegExpExecArray | null;
    while ((match = pat.exec(text)) !== null) {
      const original = match[0];
      entities.push({
        original,
        type: 'CUSTOM',
        confidence: 0.90,
        start: match.index,
        end: match.index + original.length,
        source: 'regex',
      });
    }
  }

  return entities;
}

// ─── Stage 2: Ollama NER scan ──────────────────────────────────────────────────

const NER_PROMPT = `You are a Named Entity Recognition system. Extract all sensitive personally identifiable information (PII) from the following text.

For each entity found, output a JSON object with these fields:
- "text": the exact matched string as it appears in the source (do not modify)
- "type": one of: PERSON_NAME, EMAIL, PHONE, ADDRESS, SSN, CREDIT_CARD, API_KEY, IP_ADDRESS, DATE_OF_BIRTH, COMPANY_INTERNAL, FINANCIAL_ACCOUNT, MEDICAL_INFO
- "confidence": a float from 0.0 to 1.0 representing your certainty

Only include entities you are genuinely confident about. If there is no PII, return an empty array [].
Output ONLY a valid JSON array, no other text.

Text:
"""
{TEXT}
"""`;

interface OllamaEntity {
  text: string;
  type: string;
  confidence: number;
}

export async function ollamaScan(
  text: string,
  config: ProtectionConfig,
  ollamaConfig: AppConfig['ollama'],
): Promise<DetectedEntity[]> {
  const ollama = new Ollama({ host: ollamaConfig.baseUrl });
  const protected_ = new Set(config.protect);

  const prompt = NER_PROMPT.replace('{TEXT}', text);

  let rawResponse: string;
  try {
    const response = await ollama.generate({
      model: ollamaConfig.model,
      prompt,
      stream: false,
      options: { temperature: 0 }, // deterministic output
    });
    rawResponse = response.response;
  } catch (err) {
    // Ollama unavailable or model not found — degrade gracefully to regex-only
    console.warn('[pii-scanner] Ollama unavailable, falling back to regex-only:', (err as Error).message);
    return [];
  }

  // Extract JSON array from response (model may wrap it in markdown code blocks)
  const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('[pii-scanner] Ollama returned non-JSON response, ignoring LLM results');
    return [];
  }

  let parsed: OllamaEntity[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as OllamaEntity[];
  } catch {
    console.warn('[pii-scanner] Failed to parse Ollama JSON response');
    return [];
  }

  const entities: DetectedEntity[] = [];

  for (const item of parsed) {
    if (!item.text || !item.type || typeof item.confidence !== 'number') continue;
    if (item.confidence < config.nerConfidenceThreshold) continue;

    const entityType = item.type as EntityType;
    if (!protected_.has(entityType)) continue;

    // Find the position of this entity in the source text
    const idx = text.indexOf(item.text);
    if (idx === -1) continue;

    entities.push({
      original: item.text,
      type: entityType,
      confidence: item.confidence,
      start: idx,
      end: idx + item.text.length,
      source: 'llm',
    });
  }

  return entities;
}

// ─── Merge and dedup ───────────────────────────────────────────────────────────

/**
 * Merge regex and LLM results. For overlapping spans, keep the higher-confidence match.
 * Sort by position in text for downstream processing.
 */
export function mergeEntities(
  regexEntities: DetectedEntity[],
  llmEntities: DetectedEntity[],
): DetectedEntity[] {
  const all = [...regexEntities, ...llmEntities];

  // Sort by start position, then by confidence descending
  all.sort((a, b) => a.start - b.start || b.confidence - a.confidence);

  const merged: DetectedEntity[] = [];
  let lastEnd = -1;

  for (const entity of all) {
    // Skip if this span is fully contained within a previously accepted span
    if (entity.start >= lastEnd) {
      merged.push(entity);
      lastEnd = Math.max(lastEnd, entity.end);
    } else if (entity.start < lastEnd && entity.confidence > (merged[merged.length - 1]?.confidence ?? 0)) {
      // Higher confidence entity overlaps — replace the last one
      merged[merged.length - 1] = entity;
      lastEnd = Math.max(lastEnd, entity.end);
    }
  }

  return merged;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function scanText(
  texts: string[],
  config: ProtectionConfig,
  ollamaConfig: AppConfig['ollama'],
): Promise<ScanResult> {
  const start = Date.now();
  const allEntities: DetectedEntity[] = [];

  for (const text of texts) {
    const regexResults = regexScan(text, config);
    const llmResults = await ollamaScan(text, config, ollamaConfig);
    const merged = mergeEntities(regexResults, llmResults);
    allEntities.push(...merged);
  }

  return {
    entities: allEntities,
    durationMs: Date.now() - start,
  };
}
