// Core type definitions for GuiltySpark

export type EntityType =
  | 'PERSON_NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'API_KEY'
  | 'IP_ADDRESS'
  | 'DATE_OF_BIRTH'
  | 'COMPANY_INTERNAL'
  | 'FINANCIAL_ACCOUNT'
  | 'MEDICAL_INFO'
  | 'CUSTOM';

export interface DetectedEntity {
  original: string;        // exact matched text from source
  type: EntityType;
  confidence: number;      // 0.0 – 1.0
  start: number;           // character offset in source text
  end: number;
  source: 'llm' | 'regex'; // which detection path found it
}

export interface SubstitutionEntry {
  original: string;
  synthetic: string;
  type: EntityType;
  id: string;              // e.g. "PERSON_0", "EMAIL_1"
  createdAt: number;       // unix timestamp ms
}

export interface ScanRequest {
  texts: string[];
  config: ProtectionConfig;
}

export interface ScanResult {
  entities: DetectedEntity[];
  durationMs: number;
}

export interface SubstituteRequest {
  entities: DetectedEntity[];
  sessionMap: SubstitutionMap;
}

export interface DecodeRequest {
  text: string;
  sessionMap: SubstitutionMap;
}

export interface ProtectionConfig {
  protect: EntityType[];
  allow: EntityType[];
  customPatterns: Array<{ pattern: string; label: string }>;
  nerConfidenceThreshold: number;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  ner_confidence_threshold: number;
}

export interface SessionConfig {
  timeout_ms: number;
  max_entries: number;
}

export interface AppConfig {
  ollama: OllamaConfig;
  protect: EntityType[];
  allow: EntityType[];
  custom_patterns: Array<{ pattern: string; label: string }>;
  passthrough_if_local: boolean;
  session: SessionConfig;
}

// Forward declaration — SubstitutionMap is defined in substitution-map.ts
export interface SubstitutionMap {
  sessionId: string;
  entries: Map<string, SubstitutionEntry>;         // original → entry (real→synthetic)
  reverseIndex: Map<string, SubstitutionEntry>;    // synthetic → entry (synthetic→real)
  counters: Map<EntityType, number>;               // per-type counters for ID generation
  createdAt: number;
  lastUsedAt: number;
}
