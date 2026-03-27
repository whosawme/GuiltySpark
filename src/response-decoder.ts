/**
 * Response Decoder — reverse substitution pass on LLM responses.
 *
 * Takes the LLM's response (which references synthetic values) and restores
 * the original values from the session's SubstitutionMap.
 *
 * Handles:
 * - Exact matches
 * - Case variations (the LLM may capitalize names in headings: "ROBERT CHEN")
 * - Possessives ("Robert Chen's" → "John Smith's")
 */

import type { SubstitutionMap } from './types.js';
import { allEntries } from './substitution-map.js';

export function decodeResponse(text: string, sessionMap: SubstitutionMap): string {
  const entries = allEntries(sessionMap);
  if (entries.length === 0) return text;

  // Sort by synthetic length descending — replace longer strings first to avoid
  // partial replacement when one synthetic is a substring of another
  entries.sort((a, b) => b.synthetic.length - a.synthetic.length);

  let result = text;

  for (const entry of entries) {
    const { synthetic, original } = entry;

    // Exact case replacement
    result = result.split(synthetic).join(original);

    // Case-insensitive replacement for variations the LLM might introduce
    const upperSynthetic = synthetic.toUpperCase();
    const upperOriginal = original.toUpperCase();
    if (result.includes(upperSynthetic)) {
      result = result.split(upperSynthetic).join(upperOriginal);
    }

    // Title case (first letter of each word capitalized)
    const titleSynthetic = toTitleCase(synthetic);
    const titleOriginal = toTitleCase(original);
    if (titleSynthetic !== synthetic && result.includes(titleSynthetic)) {
      result = result.split(titleSynthetic).join(titleOriginal);
    }
  }

  return result;
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}
