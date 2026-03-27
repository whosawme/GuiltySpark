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

/**
 * User-nominated sensitive data type.
 *
 * Allows users to teach GuiltySpark about domain-specific PII that the built-in
 * rules don't cover — project codenames, internal IDs, employee numbers, etc.
 *
 * Both detection stages use these definitions:
 *  - Stage 1 (regex): each entry in `patterns` becomes a compiled RegExp rule
 *  - Stage 2 (Ollama NER): `description` and `examples` are injected into the
 *    NER prompt so the model understands what to look for contextually
 *
 * `replacement_type` controls which synthetic generator fires in "realistic" mode.
 * If omitted, obvious-style bracketed placeholders are used in both modes.
 */
export interface CustomEntityDefinition {
  name: string;                    // human-readable: "Employee ID", "Project Codename"
  label: string;                   // SCREAMING_SNAKE placeholder: "EMPLOYEE_ID", "CODENAME"
  examples?: string[];             // sample values shown to Ollama: ["EMP-00123", "EMP-00456"]
  patterns?: string[];             // regex strings for stage-1 detection
  description?: string;            // natural language description for NER prompt
  replacement_type?: EntityType;   // in realistic mode, delegate to this type's generator
}

/** Substitution mode controls the style of synthetic replacements. */
export type SubstitutionMode = 'realistic' | 'obvious';

export interface DetectedEntity {
  original: string;        // exact matched text from source
  type: EntityType;
  confidence: number;      // 0.0 – 1.0
  start: number;           // character offset in source text
  end: number;
  source: 'llm' | 'regex'; // which detection path found it
  customLabel?: string;    // set for user-defined entities; used as placeholder label
}

export interface SubstitutionEntry {
  original: string;
  synthetic: string;
  type: EntityType;
  id: string;              // e.g. "PERSON_0", "EMAIL_1"
  customLabel?: string;    // preserved for custom entities
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
  customPatterns: Array<{ pattern: string; label: string }>; // legacy simple patterns
  customEntities: CustomEntityDefinition[];                  // richer user-nominated types
  nerConfidenceThreshold: number;
  substitutionMode: SubstitutionMode;
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

export interface ProxyConfig {
  port: number;
  // Optional: override target URLs per provider. If unset, standard endpoints are used.
  anthropic_base_url?: string;
  openai_base_url?: string;
}

export interface AppConfig {
  ollama: OllamaConfig;
  protect: EntityType[];
  allow: EntityType[];
  custom_patterns: Array<{ pattern: string; label: string }>; // legacy
  custom_entities: CustomEntityDefinition[];                  // richer user-nominated types
  substitution_mode: SubstitutionMode;
  passthrough_if_local: boolean;
  session: SessionConfig;
  proxy: ProxyConfig;
}

// Forward declaration — SubstitutionMap is defined in substitution-map.ts
export interface SubstitutionMap {
  sessionId: string;
  entries: Map<string, SubstitutionEntry>;         // original → entry (real→synthetic)
  reverseIndex: Map<string, SubstitutionEntry>;    // synthetic → entry (synthetic→real)
  // Keyed by EntityType OR custom label string so user-defined entities get their own
  // incrementing counters independent from the built-in CUSTOM bucket.
  counters: Map<string, number>;
  createdAt: number;
  lastUsedAt: number;
}
