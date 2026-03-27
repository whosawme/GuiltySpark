/**
 * Substitution Engine — generates realistic synthetic PII replacements.
 *
 * Design decisions:
 * - Deterministic per session: a seed derived from the session ID ensures the
 *   same original always maps to the same synthetic within a session.
 * - Type-aware: each entity type has its own generator to preserve format and
 *   plausibility (a name stays a name, a phone number stays a phone number).
 * - No external faker library dependency: we use lightweight inline generators
 *   to keep the install footprint small and avoid supply-chain risk.
 */

import type { DetectedEntity, EntityType, SubstitutionMap } from './types.js';
import { insertEntry, lookupOriginal } from './substitution-map.js';

// ─── Seeded PRNG (xorshift32) ──────────────────────────────────────────────────

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function seedFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = Math.imul(31, hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ─── Name pools ───────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'William', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Wei', 'Mei', 'Raj', 'Priya',
  'Omar', 'Fatima', 'Carlos', 'Maria', 'Liam', 'Emma', 'Noah', 'Olivia',
  'Hiroshi', 'Yuki', 'Andre', 'Isabelle', 'Mohammed', 'Aisha', 'Chen', 'Lin',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Wilson', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Jackson',
  'Chen', 'Wang', 'Zhang', 'Patel', 'Kim', 'Singh', 'Nguyen', 'Yamamoto',
  'Mueller', 'Kowalski', 'Johansson', 'Bergström', 'Okonkwo', 'Mensah', 'Diallo', 'Santos',
];

const EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'protonmail.com', 'icloud.com',
  'fastmail.com', 'tutanota.com', 'mail.com',
];

const COMPANY_SUFFIXES = ['Solutions', 'Technologies', 'Group', 'Partners', 'Systems', 'Consulting', 'Ventures'];
const COMPANY_PREFIXES = [
  'Meridian', 'Apex', 'Vanguard', 'Nexus', 'Pinnacle', 'Horizon', 'Summit',
  'Atlas', 'Sterling', 'Cascade', 'Orion', 'Titan', 'Crestview', 'Westbrook',
];

const STREET_NAMES = [
  'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Main', 'Park', 'Lake',
  'River', 'Hill', 'Valley', 'Forest', 'Meadow', 'Highland', 'Sunset',
];

const STREET_TYPES = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd', 'Way', 'Ct'];

const CITIES = [
  'Springfield', 'Franklin', 'Greenville', 'Bristol', 'Clinton', 'Salem',
  'Georgetown', 'Madison', 'Oxford', 'Arlington', 'Burlington', 'Fairview',
];

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
];

// ─── Generators ───────────────────────────────────────────────────────────────

type Rng = () => number;

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randDigits(n: number, rng: Rng): string {
  return Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
}

function generatePersonName(rng: Rng): string {
  return `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`;
}

function generateEmail(rng: Rng): string {
  const first = pick(FIRST_NAMES, rng).toLowerCase();
  const last = pick(LAST_NAMES, rng).toLowerCase();
  const domain = pick(EMAIL_DOMAINS, rng);
  const sep = pick(['.', '_', ''], rng);
  return `${first}${sep}${last}@${domain}`;
}

function generatePhone(rng: Rng): string {
  // US phone: area code 200-999, exchange 200-999
  const area = String(Math.floor(200 + rng() * 800));
  const exchange = String(Math.floor(200 + rng() * 800));
  const subscriber = randDigits(4, rng);
  return `(${area}) ${exchange}-${subscriber}`;
}

function generateSSN(rng: Rng): string {
  // Avoid real SSN ranges: area 000, 666, 900-999 are invalid
  const area = String(Math.floor(100 + rng() * 565)).padStart(3, '0');
  const group = randDigits(2, rng).padStart(2, '0');
  const serial = randDigits(4, rng).padStart(4, '0');
  return `${area}-${group}-${serial}`;
}

function generateCreditCard(rng: Rng): string {
  // Generate a Visa-style 16-digit number (starts with 4)
  const digits = '4' + Array.from({ length: 14 }, () => Math.floor(rng() * 10)).join('');
  // Compute Luhn check digit
  const sum = digits.split('').reduce((acc, d, i) => {
    let n = parseInt(d, 10);
    if ((15 - i) % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    return acc + n;
  }, 0);
  const check = (10 - (sum % 10)) % 10;
  const full = digits + check;
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8, 12)} ${full.slice(12)}`;
}

function generateIPAddress(rng: Rng): string {
  // Generate a private IP in 10.x.x.x range
  return `10.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}`;
}

function generateAPIKey(rng: Rng): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const key = Array.from({ length: 48 }, () => chars[Math.floor(rng() * chars.length)]).join('');
  return `sk-${key}`;
}

function generateAddress(rng: Rng): string {
  const num = Math.floor(100 + rng() * 9900);
  const street = `${pick(STREET_NAMES, rng)} ${pick(STREET_TYPES, rng)}`;
  const city = pick(CITIES, rng);
  const state = pick(STATES, rng);
  const zip = randDigits(5, rng);
  return `${num} ${street}, ${city}, ${state} ${zip}`;
}

function generateDOB(rng: Rng): string {
  const year = 1940 + Math.floor(rng() * 65);
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${year}`;
}

function generateCompanyName(rng: Rng): string {
  return `${pick(COMPANY_PREFIXES, rng)} ${pick(COMPANY_SUFFIXES, rng)}`;
}

function generateFinancialAccount(rng: Rng): string {
  return randDigits(16, rng).replace(/(\d{4})/g, '$1-').slice(0, -1);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function generateSynthetic(type: EntityType, original: string, sessionId: string): string {
  // Seed the RNG from (sessionId + original) so the same original always
  // produces the same synthetic within a session, but different sessions
  // produce different synthetics for the same original.
  const seed = seedFromString(sessionId + ':' + original);
  const rng = makeSeededRng(seed);

  switch (type) {
    case 'PERSON_NAME':     return generatePersonName(rng);
    case 'EMAIL':           return generateEmail(rng);
    case 'PHONE':           return generatePhone(rng);
    case 'SSN':             return generateSSN(rng);
    case 'CREDIT_CARD':     return generateCreditCard(rng);
    case 'IP_ADDRESS':      return generateIPAddress(rng);
    case 'API_KEY':         return generateAPIKey(rng);
    case 'ADDRESS':         return generateAddress(rng);
    case 'DATE_OF_BIRTH':   return generateDOB(rng);
    case 'COMPANY_INTERNAL':return generateCompanyName(rng);
    case 'FINANCIAL_ACCOUNT': return generateFinancialAccount(rng);
    case 'MEDICAL_INFO':    return '[MEDICAL_INFO]'; // No realistic substitute
    case 'CUSTOM':          return `[CUSTOM_${Math.floor(rng() * 9999)}]`;
    default:                return `[REDACTED_${type}]`;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply substitutions to a text string, updating the session map with any new entries.
 * Returns the transformed text.
 */
export function applySubstitutions(
  text: string,
  entities: DetectedEntity[],
  sessionMap: SubstitutionMap,
): string {
  if (entities.length === 0) return text;

  // Sort entities by start position descending so we can splice from the end
  // without invalidating earlier offsets
  const sorted = [...entities].sort((a, b) => b.start - a.start);

  let result = text;
  for (const entity of sorted) {
    const existing = lookupOriginal(sessionMap, entity.original);
    const synthetic = existing?.synthetic ?? generateSynthetic(entity.type, entity.original, sessionMap.sessionId);

    if (!existing) {
      insertEntry(sessionMap, entity.original, synthetic, entity.type);
    }

    // Replace this occurrence by position (preserves multi-occurrence consistency)
    result = result.slice(0, entity.start) + synthetic + result.slice(entity.end);
  }

  return result;
}

/**
 * Get or create a synthetic value for an entity without applying it to text.
 * Useful for pre-populating the map or checking existing mappings.
 */
export function getOrCreateSynthetic(
  original: string,
  type: EntityType,
  sessionMap: SubstitutionMap,
): string {
  const existing = lookupOriginal(sessionMap, original);
  if (existing) return existing.synthetic;

  const synthetic = generateSynthetic(type, original, sessionMap.sessionId);
  insertEntry(sessionMap, original, synthetic, type);
  return synthetic;
}
