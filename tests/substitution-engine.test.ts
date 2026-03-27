import { applySubstitutions, getOrCreateSynthetic } from '../src/substitution-engine.js';
import { createSubstitutionMap, lookupOriginal, lookupSynthetic, entryCount } from '../src/substitution-map.js';
import type { DetectedEntity } from '../src/types.js';

describe('applySubstitutions', () => {
  test('replaces a detected entity in text', () => {
    const map = createSubstitutionMap('test-session-1');
    const entities: DetectedEntity[] = [
      { original: 'john@acme.com', type: 'EMAIL', confidence: 0.97, start: 16, end: 29, source: 'regex' },
    ];
    const result = applySubstitutions('Contact email: john@acme.com today', entities, map);
    expect(result).not.toContain('john@acme.com');
    expect(result).toContain('@'); // synthetic is still an email
  });

  test('maintains consistency within a session', () => {
    const map = createSubstitutionMap('test-session-2');
    const entities: DetectedEntity[] = [
      { original: 'alice@corp.com', type: 'EMAIL', confidence: 0.97, start: 0, end: 13, source: 'regex' },
    ];

    const result1 = applySubstitutions('alice@corp.com', entities, map);
    // Re-applying with the same map should produce the same synthetic
    const entities2: DetectedEntity[] = [
      { original: 'alice@corp.com', type: 'EMAIL', confidence: 0.97, start: 16, end: 29, source: 'regex' },
    ];
    const result2 = applySubstitutions('Second mention: alice@corp.com', entities2, map);

    // Both should use the same synthetic
    const synthetic = lookupOriginal(map, 'alice@corp.com')?.synthetic;
    expect(synthetic).toBeDefined();
    expect(result1).toBe(synthetic);
    expect(result2).toContain(synthetic!);
  });

  test('returns original text unchanged when no entities', () => {
    const map = createSubstitutionMap('test-session-3');
    const result = applySubstitutions('Nothing sensitive here.', [], map);
    expect(result).toBe('Nothing sensitive here.');
  });

  test('handles multiple entities in one text', () => {
    const map = createSubstitutionMap('test-session-4');
    const text = 'John Smith: john@example.com, SSN: 123-45-6789';
    const entities: DetectedEntity[] = [
      { original: '123-45-6789', type: 'SSN', confidence: 0.88, start: 35, end: 46, source: 'regex' },
      { original: 'john@example.com', type: 'EMAIL', confidence: 0.97, start: 12, end: 28, source: 'regex' },
    ];
    const result = applySubstitutions(text, entities, map);
    expect(result).not.toContain('john@example.com');
    expect(result).not.toContain('123-45-6789');
    expect(result).toContain('John Smith'); // not substituted (no entity for it)
  });
});

describe('getOrCreateSynthetic', () => {
  test('generates different synthetics for different session IDs', () => {
    const map1 = createSubstitutionMap('session-aaa');
    const map2 = createSubstitutionMap('session-bbb');

    const s1 = getOrCreateSynthetic('john@real.com', 'EMAIL', map1);
    const s2 = getOrCreateSynthetic('john@real.com', 'EMAIL', map2);

    // Cross-session isolation: different sessions produce different synthetics
    expect(s1).not.toBe(s2);
  });

  test('returns same synthetic on repeated calls within same session', () => {
    const map = createSubstitutionMap('session-ccc');
    const s1 = getOrCreateSynthetic('555-123-4567', 'PHONE', map);
    const s2 = getOrCreateSynthetic('555-123-4567', 'PHONE', map);
    expect(s1).toBe(s2);
    expect(entryCount(map)).toBe(1); // not duplicated
  });

  test('generates valid phone number format', () => {
    const map = createSubstitutionMap('session-phone-test');
    const synthetic = getOrCreateSynthetic('(999) 999-9999', 'PHONE', map);
    // Should look like a phone number
    expect(synthetic).toMatch(/\(\d{3}\) \d{3}-\d{4}/);
  });

  test('generates valid SSN format', () => {
    const map = createSubstitutionMap('session-ssn-test');
    const synthetic = getOrCreateSynthetic('123-45-6789', 'SSN', map);
    expect(synthetic).toMatch(/\d{3}-\d{2}-\d{4}/);
  });

  test('generates valid email format', () => {
    const map = createSubstitutionMap('session-email-test');
    const synthetic = getOrCreateSynthetic('real@company.com', 'EMAIL', map);
    expect(synthetic).toMatch(/^[a-z._]+@[a-z.]+\.[a-z]{2,}$/);
  });
});

describe('SubstitutionMap bidirectional lookup', () => {
  test('supports reverse lookup (synthetic → original)', () => {
    const map = createSubstitutionMap('session-reverse');
    const synthetic = getOrCreateSynthetic('real@company.com', 'EMAIL', map);

    const forward = lookupOriginal(map, 'real@company.com');
    const reverse = lookupSynthetic(map, synthetic);

    expect(forward?.synthetic).toBe(synthetic);
    expect(reverse?.original).toBe('real@company.com');
  });
});
