import { regexScan, mergeEntities } from '../src/pii-scanner.js';
import type { ProtectionConfig, DetectedEntity } from '../src/types.js';

const fullConfig: ProtectionConfig = {
  protect: [
    'PERSON_NAME', 'EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD',
    'API_KEY', 'IP_ADDRESS', 'DATE_OF_BIRTH', 'ADDRESS',
    'FINANCIAL_ACCOUNT', 'MEDICAL_INFO', 'COMPANY_INTERNAL', 'CUSTOM',
  ],
  allow: [],
  customPatterns: [],
  nerConfidenceThreshold: 0.6,
};

describe('regexScan', () => {
  test('detects email addresses', () => {
    const entities = regexScan('Contact me at john.smith@example.com for details.', fullConfig);
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('EMAIL');
    expect(entities[0].original).toBe('john.smith@example.com');
    expect(entities[0].confidence).toBeGreaterThan(0.9);
  });

  test('detects US phone numbers', () => {
    const entities = regexScan('Call me at (555) 867-5309 anytime.', fullConfig);
    const phones = entities.filter(e => e.type === 'PHONE');
    expect(phones).toHaveLength(1);
    expect(phones[0].original).toContain('555');
  });

  test('detects SSNs', () => {
    const entities = regexScan('My SSN is 123-45-6789.', fullConfig);
    const ssns = entities.filter(e => e.type === 'SSN');
    expect(ssns).toHaveLength(1);
    expect(ssns[0].original).toBe('123-45-6789');
  });

  test('detects IP addresses', () => {
    const entities = regexScan('Server at 192.168.1.100 is down.', fullConfig);
    const ips = entities.filter(e => e.type === 'IP_ADDRESS');
    expect(ips).toHaveLength(1);
    expect(ips[0].original).toBe('192.168.1.100');
  });

  test('detects JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.abc123def456';
    const entities = regexScan(`Token: ${jwt}`, fullConfig);
    const keys = entities.filter(e => e.type === 'API_KEY');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0].original).toContain('eyJ');
  });

  test('detects credit cards', () => {
    const entities = regexScan('Card: 4111 1111 1111 1111', fullConfig);
    const cards = entities.filter(e => e.type === 'CREDIT_CARD');
    expect(cards).toHaveLength(1);
  });

  test('respects protect config — skips disabled types', () => {
    const noEmailConfig: ProtectionConfig = { ...fullConfig, protect: ['PHONE', 'SSN'] };
    const entities = regexScan('Email: test@test.com Phone: (555) 123-4567', noEmailConfig);
    expect(entities.every(e => e.type !== 'EMAIL')).toBe(true);
    expect(entities.some(e => e.type === 'PHONE')).toBe(true);
  });

  test('detects custom patterns', () => {
    const customConfig: ProtectionConfig = {
      ...fullConfig,
      customPatterns: [{ pattern: 'Project (Nightingale|Falcon)', label: 'CODENAME' }],
    };
    const entities = regexScan('Working on Project Nightingale today.', customConfig);
    const custom = entities.filter(e => e.type === 'CUSTOM');
    expect(custom).toHaveLength(1);
    expect(custom[0].original).toBe('Project Nightingale');
  });

  test('returns empty array for clean text', () => {
    const entities = regexScan('The weather is nice today.', fullConfig);
    expect(entities).toHaveLength(0);
  });
});

describe('mergeEntities', () => {
  test('merges non-overlapping entities from both sources', () => {
    const regex: DetectedEntity[] = [
      { original: 'test@test.com', type: 'EMAIL', confidence: 0.97, start: 0, end: 13, source: 'regex' },
    ];
    const llm: DetectedEntity[] = [
      { original: 'John Smith', type: 'PERSON_NAME', confidence: 0.9, start: 20, end: 30, source: 'llm' },
    ];
    const merged = mergeEntities(regex, llm);
    expect(merged).toHaveLength(2);
  });

  test('resolves overlapping spans by keeping higher confidence', () => {
    const regex: DetectedEntity[] = [
      { original: '123-45-6789', type: 'SSN', confidence: 0.88, start: 5, end: 16, source: 'regex' },
    ];
    const llm: DetectedEntity[] = [
      { original: '123-45-678', type: 'SSN', confidence: 0.70, start: 5, end: 15, source: 'llm' },
    ];
    const merged = mergeEntities(regex, llm);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('regex'); // regex had higher confidence
  });
});
