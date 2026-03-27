import { useState, useEffect } from 'react';
import type { AppConfig, EntityType, CustomEntityDefinition, SubstitutionMode } from '../types.ts';

interface Props {
  config: AppConfig | null;
  onUpdate: (cfg: AppConfig) => void;
}

const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON_NAME', 'EMAIL', 'PHONE', 'ADDRESS', 'SSN', 'CREDIT_CARD',
  'API_KEY', 'IP_ADDRESS', 'DATE_OF_BIRTH', 'COMPANY_INTERNAL',
  'FINANCIAL_ACCOUNT', 'MEDICAL_INFO', 'CUSTOM',
];

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05 }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gs-text">{label}</span>
        <span className="text-gs-accent font-mono">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-gs-accent"
      />
    </div>
  );
}

function EntityToggle({ type, active, onToggle }: {
  type: EntityType; active: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`px-2 py-1 rounded text-xs border transition-colors ${
        active
          ? 'bg-gs-accent/10 border-gs-accent/50 text-gs-accent'
          : 'bg-transparent border-gs-border text-gs-text hover:border-gs-text'
      }`}
    >
      {type}
    </button>
  );
}

export default function Configuration({ config, onUpdate }: Props) {
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newEntity, setNewEntity] = useState<Partial<CustomEntityDefinition>>({});
  const [addingEntity, setAddingEntity] = useState(false);

  useEffect(() => {
    if (config && !draft) setDraft(JSON.parse(JSON.stringify(config)) as AppConfig);
  }, [config, draft]);

  if (!draft) {
    return (
      <div className="flex items-center justify-center h-full text-gs-text text-sm">
        Loading config…
      </div>
    );
  }

  const update = (patch: Partial<AppConfig>) => {
    setDraft(d => d ? { ...d, ...patch } : d);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      onUpdate(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const toggleProtect = (type: EntityType) => {
    const protect = draft.protect.includes(type)
      ? draft.protect.filter(t => t !== type)
      : [...draft.protect, type];
    update({ protect });
  };

  const addCustomEntity = () => {
    if (!newEntity.name || !newEntity.label) return;
    const entity: CustomEntityDefinition = {
      name: newEntity.name,
      label: newEntity.label.toUpperCase().replace(/\s+/g, '_'),
      patterns: newEntity.patterns,
      description: newEntity.description,
      examples: newEntity.examples,
    };
    update({ custom_entities: [...draft.custom_entities, entity] });
    setNewEntity({});
    setAddingEntity(false);
  };

  const removeCustomEntity = (label: string) => {
    update({ custom_entities: draft.custom_entities.filter(e => e.label !== label) });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gs-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-gs-heading font-semibold">Configuration</h1>
          <p className="text-xs text-gs-text mt-0.5">Changes are saved to guiltyspark.config.yaml immediately</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className={`px-4 py-1.5 text-xs font-medium rounded border transition-colors ${
            saved
              ? 'border-gs-green text-gs-green bg-gs-green/10'
              : 'border-gs-accent text-gs-accent bg-gs-accent/10 hover:bg-gs-accent/20 disabled:opacity-50'
          }`}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 max-w-2xl">

        {/* Substitution mode */}
        <section>
          <h2 className="text-gs-heading text-sm font-semibold mb-3">Substitution Mode</h2>
          <div className="flex gap-3">
            {(['realistic', 'obvious'] as SubstitutionMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => update({ substitution_mode: mode })}
                className={`flex-1 py-3 rounded border text-sm transition-colors ${
                  draft.substitution_mode === mode
                    ? 'border-gs-accent bg-gs-accent/10 text-gs-accent'
                    : 'border-gs-border text-gs-text hover:border-gs-text'
                }`}
              >
                <div className="font-medium capitalize">{mode}</div>
                <div className="text-xs opacity-70 mt-1">
                  {mode === 'realistic'
                    ? 'John Smith → Wei Zhang (believable)'
                    : 'John Smith → [PERSON_NAME_0] (obvious)'}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Detection thresholds */}
        <section>
          <h2 className="text-gs-heading text-sm font-semibold mb-3">Detection Thresholds</h2>
          <div className="space-y-4 bg-gs-surface rounded-lg p-4 border border-gs-border">
            <Slider
              label="Redact threshold — auto-substitute entities above this"
              value={draft.redact_threshold}
              onChange={v => update({ redact_threshold: v })}
            />
            <Slider
              label="Warn threshold — flag entities above this (below redact)"
              value={draft.warn_threshold}
              onChange={v => update({ warn_threshold: v })}
            />
            <Slider
              label="NER confidence threshold (Ollama)"
              value={draft.ollama.ner_confidence_threshold}
              onChange={v => update({ ollama: { ...draft.ollama, ner_confidence_threshold: v } })}
            />
            {/* Preview bar */}
            <div className="mt-2">
              <div className="text-xs text-gs-text mb-1">Threshold preview</div>
              <div className="relative h-3 rounded-full bg-gs-border overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-gs-text/30"
                  style={{ width: `${draft.warn_threshold * 100}%` }}
                />
                <div
                  className="absolute top-0 h-full bg-gs-yellow/60"
                  style={{
                    left: `${draft.warn_threshold * 100}%`,
                    width: `${(draft.redact_threshold - draft.warn_threshold) * 100}%`,
                  }}
                />
                <div
                  className="absolute right-0 top-0 h-full bg-gs-red/70"
                  style={{ width: `${(1 - draft.redact_threshold) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gs-text mt-0.5">
                <span>0% ignored</span>
                <span>{Math.round(draft.warn_threshold * 100)}% warn</span>
                <span>{Math.round(draft.redact_threshold * 100)}% redact</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Confirm mode */}
        <section>
          <h2 className="text-gs-heading text-sm font-semibold mb-3">Confirm Before Send</h2>
          <div className="bg-gs-surface rounded-lg p-4 border border-gs-border">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.confirm_mode}
                onChange={e => update({ confirm_mode: e.target.checked })}
                className="mt-0.5 accent-gs-accent"
              />
              <div>
                <div className="text-gs-heading text-sm">Enable confirm mode</div>
                <div className="text-xs text-gs-text mt-0.5">
                  Borderline detections (warn ≤ confidence &lt; redact) are held for manual
                  review in the Live Monitor before the request is forwarded to the LLM.
                </div>
              </div>
            </label>
          </div>
        </section>

        {/* Protected entity types */}
        <section>
          <h2 className="text-gs-heading text-sm font-semibold mb-3">Protected Entity Types</h2>
          <div className="flex flex-wrap gap-2">
            {ALL_ENTITY_TYPES.map(type => (
              <EntityToggle
                key={type}
                type={type}
                active={draft.protect.includes(type)}
                onToggle={() => toggleProtect(type)}
              />
            ))}
          </div>
        </section>

        {/* Custom entities */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-gs-heading text-sm font-semibold">Custom Entity Definitions</h2>
            <button
              onClick={() => setAddingEntity(a => !a)}
              className="px-2 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
            >
              + Add
            </button>
          </div>

          {addingEntity && (
            <div className="mb-4 p-4 bg-gs-surface rounded-lg border border-gs-accent/30 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gs-text block mb-1">Name</label>
                  <input
                    type="text"
                    placeholder="Employee ID"
                    value={newEntity.name ?? ''}
                    onChange={e => setNewEntity(n => ({ ...n, name: e.target.value }))}
                    className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-gs-text block mb-1">Label (SCREAMING_SNAKE)</label>
                  <input
                    type="text"
                    placeholder="EMPLOYEE_ID"
                    value={newEntity.label ?? ''}
                    onChange={e => setNewEntity(n => ({ ...n, label: e.target.value }))}
                    className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gs-text block mb-1">Regex patterns (one per line)</label>
                <textarea
                  placeholder="\\bEMP-\\d{5}\\b"
                  rows={2}
                  value={(newEntity.patterns ?? []).join('\n')}
                  onChange={e => setNewEntity(n => ({ ...n, patterns: e.target.value.split('\n').filter(Boolean) }))}
                  className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent font-mono resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-gs-text block mb-1">Description (for Ollama NER)</label>
                <input
                  type="text"
                  placeholder="Internal employee identifiers"
                  value={newEntity.description ?? ''}
                  onChange={e => setNewEntity(n => ({ ...n, description: e.target.value }))}
                  className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAddingEntity(false)} className="px-3 py-1 text-xs text-gs-text hover:text-gs-heading">
                  Cancel
                </button>
                <button
                  onClick={addCustomEntity}
                  disabled={!newEntity.name || !newEntity.label}
                  className="px-3 py-1 text-xs bg-gs-accent/10 border border-gs-accent/40 text-gs-accent rounded hover:bg-gs-accent/20 disabled:opacity-40 transition-colors"
                >
                  Add Entity
                </button>
              </div>
            </div>
          )}

          {draft.custom_entities.length === 0 && (
            <p className="text-xs text-gs-text italic">No custom entities defined</p>
          )}

          <div className="space-y-2">
            {draft.custom_entities.map(e => (
              <div key={e.label} className="flex items-start gap-3 p-3 bg-gs-surface rounded border border-gs-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gs-heading">{e.name}</span>
                    <span className="text-[10px] text-gs-accent font-mono bg-gs-accent/10 px-1.5 rounded">{e.label}</span>
                  </div>
                  {e.description && <p className="text-xs text-gs-text mt-0.5">{e.description}</p>}
                  {e.patterns && e.patterns.length > 0 && (
                    <p className="text-[10px] font-mono text-gs-text opacity-60 mt-0.5">
                      {e.patterns.join(' | ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeCustomEntity(e.label)}
                  className="text-xs text-gs-text hover:text-gs-red transition-colors flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Ollama settings */}
        <section>
          <h2 className="text-gs-heading text-sm font-semibold mb-3">Ollama Settings</h2>
          <div className="space-y-3 bg-gs-surface rounded-lg p-4 border border-gs-border">
            <div>
              <label className="text-xs text-gs-text block mb-1">Base URL</label>
              <input
                type="text"
                value={draft.ollama.baseUrl}
                onChange={e => update({ ollama: { ...draft.ollama, baseUrl: e.target.value } })}
                className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gs-text block mb-1">Model</label>
              <input
                type="text"
                value={draft.ollama.model}
                onChange={e => update({ ollama: { ...draft.ollama, model: e.target.value } })}
                className="w-full bg-gs-bg border border-gs-border rounded px-2 py-1 text-xs text-gs-heading focus:outline-none focus:border-gs-accent font-mono"
              />
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
