import { useState } from 'react';
import type { FeedEntry, PendingReview, AppConfig, Decision } from '../types.ts';

interface Props {
  feed: FeedEntry[];
  pending: PendingReview[];
  config: AppConfig | null;
}

const ACTION_STYLE: Record<string, string> = {
  redacted: 'text-gs-red border-gs-red/30 bg-gs-red/5',
  warned:   'text-gs-yellow border-gs-yellow/30 bg-gs-yellow/5',
  ignored:  'text-gs-text border-gs-border bg-transparent',
  pending:  'text-gs-yellow border-gs-yellow/50 bg-gs-yellow/10',
  approved: 'text-gs-green border-gs-green/30 bg-gs-green/5',
  rejected: 'text-gs-text border-gs-border/50 bg-transparent opacity-50',
};

const CONFIDENCE_BAR: Record<string, string> = {
  redacted: 'bg-gs-red',
  warned:   'bg-gs-yellow',
  ignored:  'bg-gs-border',
  pending:  'bg-gs-yellow',
  approved: 'bg-gs-green',
  rejected: 'bg-gs-border',
};

function MaskedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return <span className="text-gs-border italic text-xs">—</span>;
  return (
    <span
      className={`font-mono text-xs cursor-pointer transition-all ${revealed ? 'text-gs-heading' : 'masked text-gs-heading'}`}
      onClick={() => setRevealed(r => !r)}
      title={revealed ? 'Click to mask' : 'Click to reveal'}
    >
      {value}
    </span>
  );
}

function ConfidenceBadge({ value, action }: { value: number; action: string }) {
  const pct = Math.round(value * 100);
  const barColor = CONFIDENCE_BAR[action] ?? 'bg-gs-border';
  return (
    <div className="flex items-center gap-1.5 min-w-[64px]">
      <div className="flex-1 h-1.5 bg-gs-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gs-text w-8 text-right">{pct}%</span>
    </div>
  );
}

interface PendingCardProps {
  review: PendingReview;
}

function PendingCard({ review }: PendingCardProps) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const toggle = (original: string) => {
    setDecisions(d => ({ ...d, [original]: d[original] === 'reject' ? 'approve' : 'reject' }));
  };

  const submit = async () => {
    setSubmitting(true);
    // Default undecided → approve
    const final: Record<string, Decision> = {};
    for (const e of review.entities) {
      final[e.original] = decisions[e.original] ?? 'approve';
    }
    await fetch(`/api/pending/${review.pendingId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: final }),
    });
    setDone(true);
    setSubmitting(false);
  };

  if (done) return null;

  return (
    <div className="border border-gs-yellow/50 rounded-lg p-4 bg-gs-yellow/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gs-yellow pulse-dot" />
          <span className="text-gs-yellow text-sm font-medium">Review Required</span>
        </div>
        <span className="text-xs text-gs-text font-mono">{review.sessionId.slice(0, 8)}…</span>
      </div>

      <div className="text-xs text-gs-text mb-3 font-mono bg-black/20 rounded p-2 line-clamp-3">
        {review.originalText}
      </div>

      <div className="space-y-2 mb-3">
        {review.entities.map(e => {
          const dec = decisions[e.original] ?? 'approve';
          return (
            <div key={e.original} className="flex items-center gap-3">
              <button
                onClick={() => toggle(e.original)}
                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                  dec === 'approve'
                    ? 'bg-gs-red/10 border-gs-red/40 text-gs-red'
                    : 'bg-gs-border/20 border-gs-border text-gs-text line-through'
                }`}
              >
                {dec === 'approve' ? 'Redact' : 'Keep'}
              </button>
              <span className="text-xs text-gs-heading font-mono">{e.original}</span>
              <span className="text-xs text-gs-text ml-auto">{e.type}</span>
              <span className="text-xs text-gs-text">{Math.round(e.confidence * 100)}%</span>
            </div>
          );
        })}
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-1.5 text-xs font-medium rounded bg-gs-accent/10 border border-gs-accent/40 text-gs-accent hover:bg-gs-accent/20 transition-colors disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Release Request'}
      </button>
    </div>
  );
}

export default function LiveMonitor({ feed, pending, config }: Props) {
  const [paused, setPaused] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [filterAction, setFilterAction] = useState<string>('all');

  const displayed = paused ? [] : feed.filter(e => filterAction === 'all' || e.action === filterAction);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gs-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-gs-heading font-semibold">Live Monitor</h1>
          <p className="text-xs text-gs-text mt-0.5">Real-time entity detection feed</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="bg-gs-surface border border-gs-border rounded px-2 py-1 text-xs text-gs-text focus:outline-none focus:border-gs-accent"
          >
            <option value="all">All actions</option>
            <option value="redacted">Redacted</option>
            <option value="warned">Warned</option>
            <option value="ignored">Ignored</option>
            <option value="pending">Pending</option>
          </select>
          <button
            onClick={() => setRevealAll(r => !r)}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
          >
            {revealAll ? 'Mask All' : 'Reveal All'}
          </button>
          <button
            onClick={() => setPaused(p => !p)}
            className={`px-3 py-1 text-xs border rounded transition-colors ${
              paused
                ? 'border-gs-green text-gs-green hover:bg-gs-green/10'
                : 'border-gs-border text-gs-text hover:border-gs-yellow hover:text-gs-yellow'
            }`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex gap-0">
        {/* Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {paused && (
            <div className="text-center py-8 text-gs-yellow text-sm">⏸ Feed paused</div>
          )}
          {!paused && displayed.length === 0 && (
            <div className="text-center py-16 text-gs-text text-sm">
              <div className="text-4xl mb-3 opacity-30">⬤</div>
              <div>Waiting for entities…</div>
              <div className="text-xs mt-1 opacity-60">Send a prompt through the privacy layer to see detections here</div>
            </div>
          )}
          {displayed.map(entry => (
            <div
              key={entry.id}
              className={`feed-entry flex items-center gap-3 px-3 py-2 rounded border text-xs ${ACTION_STYLE[entry.action] ?? ACTION_STYLE.ignored}`}
            >
              {/* Timestamp */}
              <span className="text-gs-text opacity-50 w-16 flex-shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}
              </span>

              {/* Entity type */}
              <span className="w-28 flex-shrink-0 font-medium truncate">{entry.entityType}</span>

              {/* Original (masked) */}
              <div className="w-32 flex-shrink-0 truncate">
                {revealAll
                  ? <span className="font-mono text-gs-heading">{entry.original}</span>
                  : <MaskedValue value={entry.original} />
                }
              </div>

              {/* Arrow */}
              <span className="text-gs-border flex-shrink-0">→</span>

              {/* Synthetic */}
              <div className="w-32 flex-shrink-0 truncate">
                <span className="font-mono text-gs-accent">{entry.synthetic || '—'}</span>
              </div>

              {/* Confidence bar */}
              <div className="flex-shrink-0">
                <ConfidenceBadge value={entry.confidence} action={entry.action} />
              </div>

              {/* Source */}
              <span className="text-gs-text opacity-60 w-10 flex-shrink-0 text-center">
                {entry.source === 'regex' ? 'rgx' : 'llm'}
              </span>

              {/* Action badge */}
              <span className={`ml-auto flex-shrink-0 px-2 py-0.5 rounded-full uppercase tracking-wider text-[10px] font-semibold border ${ACTION_STYLE[entry.action] ?? ''}`}>
                {entry.action}
              </span>
            </div>
          ))}
        </div>

        {/* Pending review panel */}
        {pending.length > 0 && (
          <div className="w-72 flex-shrink-0 border-l border-gs-border overflow-y-auto p-3 space-y-3">
            <div className="text-xs font-semibold text-gs-yellow uppercase tracking-wider px-1 py-1">
              Pending Review ({pending.length})
            </div>
            {config?.confirm_mode && pending.map(p => (
              <PendingCard key={p.pendingId} review={p} />
            ))}
            {!config?.confirm_mode && (
              <p className="text-xs text-gs-text px-1">
                Enable <code className="text-gs-accent">confirm_mode</code> in Configuration to review borderline detections before they're sent.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-6 py-2 border-t border-gs-border flex items-center gap-6 text-xs text-gs-text flex-shrink-0">
        <span>Total: <b className="text-gs-heading">{feed.length}</b></span>
        <span>Redacted: <b className="text-gs-red">{feed.filter(e => e.action === 'redacted').length}</b></span>
        <span>Warned: <b className="text-gs-yellow">{feed.filter(e => e.action === 'warned').length}</b></span>
        <span>Ignored: <b className="text-gs-text">{feed.filter(e => e.action === 'ignored').length}</b></span>
        {config && (
          <span className="ml-auto opacity-60">
            redact ≥ {Math.round(config.redact_threshold * 100)}% · warn ≥ {Math.round(config.warn_threshold * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
