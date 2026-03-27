import { applySubstitutions, getOrCreateSynthetic } from '../src/substitution-engine.js';
import { createSubstitutionMap, lookupOriginal, lookupSynthetic, entryCount } from '../src/substitution-map.js';
import type { DetectedEntity } from '../src/types.js';

// ─── Realistic mode (default) ─────────────────────────────────────────────────

describe('applySubstitutions — realistic mode', () => {
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
    const entities2: DetectedEntity[] = [
      { original: 'alice@corp.com', type: 'EMAIL', confidence: 0.97, start: 16, end: 29, source: 'regex' },
    ];
    const result2 = applySubstitutions('Second mention: alice@corp.com', entities2, map);

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

// ─── Obvious mode ─────────────────────────────────────────────────────────────

describe('applySubstitutions — obvious mode', () => {
  test('produces bracketed placeholder for email', () => {
    const map = createSubstitutionMap('obvious-session-1');
    const entities: DetectedEntity[] = [
      { original: 'secret@company.com', type: 'EMAIL', confidence: 0.97, start: 0, end: 18, source: 'regex' },
    ];
    const result = applySubstitutions('secret@company.com', entities, map, 'obvious');
    expect(result).toBe('[EMAIL_0]');
    expect(result).not.toContain('secret@company.com');
  });

  test('increments counter per entity type', () => {
    const map = createSubstitutionMap('obvious-session-2');
    const entities: DetectedEntity[] = [
      { original: 'alice@corp.com', type: 'EMAIL', confidence: 0.97, start: 0, end: 14, source: 'regex' },
      { original: 'bob@corp.com', type: 'EMAIL', confidence: 0.97, start: 20, end: 32, source: 'regex' },
    ];
    const text = 'alice@corp.com and bob@corp.com here';
    // Apply one at a time to control order
    const e1 = [entities[0]];
    const e2 = [{ ...entities[1], start: 20, end: 32 }];
    applySubstitutions('alice@corp.com', e1, map, 'obvious');
    applySubstitutions(' and bob@corp.com', e2, map, 'obvious');

    const s1 = lookupOriginal(map, 'alice@corp.com')?.synthetic;
    const s2 = lookupOriginal(map, 'bob@corp.com')?.synthetic;
    expect(s1).toBe('[EMAIL_0]');
    expect(s2).toBe('[EMAIL_1]');
  });

  test('different types get independent counters', () => {
    const map = createSubstitutionMap('obvious-session-3');
    const emailEntity: DetectedEntity = { original: 'a@b.com', type: 'EMAIL', confidence: 0.97, start: 0, end: 7, source: 'regex' };
    const phoneEntity: DetectedEntity = { original: '555-0000', type: 'PHONE', confidence: 0.90, start: 0, end: 8, source: 'regex' };

    const s1 = getOrCreateSynthetic('a@b.com', 'EMAIL', map, 'obvious');
    const s2 = getOrCreateSynthetic('555-0000', 'PHONE', map, 'obvious');
    expect(s1).toBe('[EMAIL_0]');
    expect(s2).toBe('[PHONE_0]');  // PHONE counter starts at 0, not 1
  });

  test('same entity always gets the same placeholder (consistency)', () => {
    const map = createSubstitutionMap('obvious-session-4');
    const s1 = getOrCreateSynthetic('john@real.com', 'EMAIL', map, 'obvious');
    const s2 = getOrCreateSynthetic('john@real.com', 'EMAIL', map, 'obvious');
    expect(s1).toBe(s2);
    expect(entryCount(map)).toBe(1); // not duplicated
  });

  test('obvious mode produces non-realistic-looking placeholder', () => {
    const map = createSubstitutionMap('obvious-session-5');
    const synthetic = getOrCreateSynthetic('(999) 555-1234', 'PHONE', map, 'obvious');
    // Should be a bracket label, not a phone number
    expect(synthetic).toMatch(/^\[PHONE_\d+\]$/);
    expect(synthetic).not.toMatch(/\d{3}-\d{4}/);
  });
});

// ─── Custom entity label support ──────────────────────────────────────────────

describe('custom entity substitution', () => {
  test('obvious mode uses custom label in placeholder', () => {
    const map = createSubstitutionMap('custom-session-1');
    const synthetic = getOrCreateSynthetic('EMP-00123', 'CUSTOM', map, 'obvious', 'EMPLOYEE_ID');
    expect(synthetic).toBe('[EMPLOYEE_ID_0]');
  });

  test('custom labels get independent counters from built-in CUSTOM type', () => {
    const map = createSubstitutionMap('custom-session-2');
    // First, register a bare CUSTOM entity
    const s1 = getOrCreateSynthetic('plain-custom', 'CUSTOM', map, 'obvious');
    expect(s1).toBe('[CUSTOM_0]');

    // Then register a custom-labeled entity — should start at 0 for its own label
    const s2 = getOrCreateSynthetic('EMP-99999', 'CUSTOM', map, 'obvious', 'EMPLOYEE_ID');
    expect(s2).toBe('[EMPLOYEE_ID_0]'); // own counter, not CUSTOM_1
  });

  test('realistic mode with replacement_type delegates to that generator', () => {
    const map = createSubstitutionMap('custom-session-3');
    const customDefs = [{
      name: 'Project Codename',
      label: 'CODENAME',
      replacement_type: 'COMPANY_INTERNAL' as const,
    }];
    const entity: DetectedEntity = {
      original: 'Project Nightingale',
      type: 'CUSTOM',
      confidence: 0.92,
      start: 0, end: 19,
      source: 'regex',
      customLabel: 'CODENAME',
    };
    const result = applySubstitutions('Project Nightingale', [entity], map, 'realistic', customDefs);
    // Should be a company-style name, not the original
    expect(result).not.toBe('Project Nightingale');
    expect(result).not.toMatch(/^\[CODENAME_\d+\]$/); // not obvious-style
  });

  test('realistic mode without replacement_type falls back to bracket label', () => {
    const map = createSubstitutionMap('custom-session-4');
    const entity: DetectedEntity = {
      original: 'EMP-00456',
      type: 'CUSTOM',
      confidence: 0.92,
      start: 0, end: 9,
      source: 'regex',
      customLabel: 'EMPLOYEE_ID',
    };
    // No customDefs with replacement_type — should produce [EMPLOYEE_ID]
    const result = applySubstitutions('EMP-00456', [entity], map, 'realistic', []);
    expect(result).toBe('[EMPLOYEE_ID]');
  });
});

// ─── Realistic mode generators ────────────────────────────────────────────────

describe('getOrCreateSynthetic — format validation', () => {
  test('generates different synthetics for different session IDs', () => {
    const map1 = createSubstitutionMap('session-aaa');
    const map2 = createSubstitutionMap('session-bbb');

    const s1 = getOrCreateSynthetic('john@real.com', 'EMAIL', map1);
    const s2 = getOrCreateSynthetic('john@real.com', 'EMAIL', map2);
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

// ─── SubstitutionMap bidirectional lookup ─────────────────────────────────────

describe('SubstitutionMap bidirectional lookup', () => {
  test('supports reverse lookup (synthetic → original)', () => {
    const map = createSubstitutionMap('session-reverse');
    const synthetic = getOrCreateSynthetic('real@company.com', 'EMAIL', map);

    const forward = lookupOriginal(map, 'real@company.com');
    const reverse = lookupSynthetic(map, synthetic);

    expect(forward?.synthetic).toBe(synthetic);
    expect(reverse?.original).toBe('real@company.com');
  });

  test('obvious mode entries also support reverse lookup for decoding', () => {
    const map = createSubstitutionMap('session-reverse-obvious');
    const synthetic = getOrCreateSynthetic('john@secret.com', 'EMAIL', map, 'obvious');
    expect(synthetic).toBe('[EMAIL_0]');

    const reverse = lookupSynthetic(map, '[EMAIL_0]');
    expect(reverse?.original).toBe('john@secret.com');
  });
});
