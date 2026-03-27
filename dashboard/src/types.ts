// Shared types mirroring the backend event/API shapes

export type EntityType =
  | 'PERSON_NAME' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'SSN'
  | 'CREDIT_CARD' | 'API_KEY' | 'IP_ADDRESS' | 'DATE_OF_BIRTH'
  | 'COMPANY_INTERNAL' | 'FINANCIAL_ACCOUNT' | 'MEDICAL_INFO' | 'CUSTOM';

export type SubstitutionMode = 'realistic' | 'obvious';
export type Decision = 'approve' | 'reject';

export interface DetectedEntity {
  original: string;
  type: EntityType;
  confidence: number;
  start: number;
  end: number;
  source: 'llm' | 'regex';
  customLabel?: string;
}

export interface SubstitutionEntry {
  original: string;
  synthetic: string;
  type: EntityType;
  id: string;
  customLabel?: string;
  createdAt: number;
}

// ─── WebSocket message shapes ─────────────────────────────────────────────────

export interface EntityDetectedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  entity: DetectedEntity;
}

export interface SubstitutionAppliedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  entry: SubstitutionEntry;
  isNew: boolean;
}

export interface RequestProcessedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  originalText: string;
  sanitizedText: string;
  entitiesFound: number;
  durationMs: number;
  provider?: string;
}

export interface ResponseDecodedEvent {
  sessionId: string;
  requestId: string;
  timestamp: number;
  llmResponse: string;
  decodedResponse: string;
}

export interface PendingReviewCreatedEvent {
  pendingId: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  entities: DetectedEntity[];
  originalText: string;
}

export interface PendingReviewResolvedEvent {
  pendingId: string;
  decisions: Record<string, Decision>;
}

export type WsMessage =
  | { type: 'entity:detected'; data: EntityDetectedEvent }
  | { type: 'substitution:applied'; data: SubstitutionAppliedEvent }
  | { type: 'request:processed'; data: RequestProcessedEvent }
  | { type: 'response:decoded'; data: ResponseDecodedEvent }
  | { type: 'pending:review:created'; data: PendingReviewCreatedEvent }
  | { type: 'pending:review:resolved'; data: PendingReviewResolvedEvent }
  | { type: 'init'; data: InitData };

export interface SessionSummary {
  sessionId: string;
  entryCount: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  originalText: string;
  sanitizedText: string;
  llmResponse?: string;
  decodedResponse?: string;
  entitiesFound: number;
  provider?: string;
  durationMs: number;
}

export interface PendingReview {
  pendingId: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  entities: DetectedEntity[];
  originalText: string;
}

export interface CustomEntityDefinition {
  name: string;
  label: string;
  examples?: string[];
  patterns?: string[];
  description?: string;
  replacement_type?: EntityType;
}

export interface AppConfig {
  ollama: {
    baseUrl: string;
    model: string;
    timeout: number;
    ner_confidence_threshold: number;
  };
  protect: EntityType[];
  allow: EntityType[];
  custom_patterns: Array<{ pattern: string; label: string }>;
  custom_entities: CustomEntityDefinition[];
  substitution_mode: SubstitutionMode;
  passthrough_if_local: boolean;
  session: { timeout_ms: number; max_entries: number };
  proxy: { port: number; anthropic_base_url?: string; openai_base_url?: string };
  dashboard: { port: number; enabled: boolean };
  confirm_mode: boolean;
  warn_threshold: number;
  redact_threshold: number;
}

export interface InitData {
  sessions: SessionSummary[];
  auditLog: AuditEntry[];
  pending: PendingReview[];
  config: AppConfig;
}

// ─── Feed entry (Live Monitor) ────────────────────────────────────────────────

export type ActionKind = 'redacted' | 'warned' | 'ignored' | 'pending' | 'approved' | 'rejected';

export interface FeedEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  requestId: string;
  entityType: EntityType | string;
  original: string;
  synthetic: string;
  confidence: number;
  source: 'llm' | 'regex';
  action: ActionKind;
}
