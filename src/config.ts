import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { AppConfig, EntityType, ProtectionConfig } from './types.js';

const DEFAULT_CONFIG: AppConfig = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    timeout: 30000,
    ner_confidence_threshold: 0.6,
  },
  protect: [
    'PERSON_NAME', 'EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD',
    'API_KEY', 'IP_ADDRESS', 'DATE_OF_BIRTH', 'ADDRESS', 'FINANCIAL_ACCOUNT',
  ] as EntityType[],
  allow: [],
  custom_patterns: [],
  custom_entities: [],
  substitution_mode: 'realistic',
  passthrough_if_local: false,
  session: {
    timeout_ms: 3_600_000,
    max_entries: 10_000,
  },
  proxy: {
    port: 8787,
  },
  dashboard: {
    port: 8788,
    enabled: true,
  },
  confirm_mode: false,
  warn_threshold: 0.6,
  redact_threshold: 0.8,
};

let cachedConfig: AppConfig | null = null;

export function loadConfig(configPath?: string): AppConfig {
  if (cachedConfig) return cachedConfig;

  const searchPaths = [
    configPath,
    './guiltyspark.config.yaml',
    './guiltyspark.config.yml',
    join(process.env.HOME ?? '~', '.guiltyspark.yaml'),
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        const parsed = yaml.load(raw) as Partial<AppConfig>;
        cachedConfig = deepMerge(DEFAULT_CONFIG, parsed);
        return cachedConfig;
      } catch (err) {
        console.error(`[config] Failed to parse ${p}:`, err);
      }
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

export function toProtectionConfig(appConfig: AppConfig): ProtectionConfig {
  return {
    protect: appConfig.protect,
    allow: appConfig.allow,
    customPatterns: appConfig.custom_patterns,
    customEntities: appConfig.custom_entities,
    nerConfidenceThreshold: appConfig.ollama.ner_confidence_threshold,
    substitutionMode: appConfig.substitution_mode,
  };
}

let configFilePath = './guiltyspark.config.yaml';

export function saveConfig(config: AppConfig, filePath?: string): void {
  const target = filePath ?? configFilePath;
  const yamlStr = yaml.dump(config, { lineWidth: 120 });
  writeFileSync(target, yamlStr, 'utf-8');
  configFilePath = target;
  cachedConfig = config;
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (typeof val === 'object' && !Array.isArray(val) && typeof base[key] === 'object') {
        result[key] = deepMerge(base[key] as object, val as object) as T[keyof T];
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}
