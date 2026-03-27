import { useState, useEffect } from 'react';
import type { AuditEntry } from '../types.ts';

const PAGE_SIZE = 50;

function DiffView({ original, sanitized }: { original: string; sanitized: string }) {
  // Highlight differences between original and sanitized
  if (original === sanitized) {
    return <pre className="text-xs text-gs-text font-mono whitespace-pre-wrap">{original}</pre>;
  }
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gs-red/70 mb-1">Original</div>
        <pre className="text-xs font-mono whitespace-pre-wrap text-gs-heading bg-gs-red/5 border border-gs-red/20 rounded p-2">{original}</pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gs-green/70 mb-1">Sanitized (sent to LLM)</div>
        <pre className="text-xs font-mono whitespace-pre-wrap text-gs-heading bg-gs-green/5 border border-gs-green/20 rounded p-2">{sanitized}</pre>
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-white/[0.02] transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-2 text-gs-text opacity-60">
          {new Date(entry.timestamp).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </td>
        <td className="px-4 py-2">
          <span className="font-mono text-xs text-gs-text opacity-60">{entry.sessionId.slice(0, 8)}…</span>
        </td>
        <td className="px-4 py-2">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${
            entry.entitiesFound > 0
              ? 'text-gs-red border-gs-red/30 bg-gs-red/5'
              : 'text-gs-text border-gs-border'
          }`}>
            {entry.entitiesFound} entities
          </span>
        </td>
        <td className="px-4 py-2 text-xs text-gs-text opacity-60">{entry.provider ?? '—'}</td>
        <td className="px-4 py-2 text-xs text-gs-text opacity-60">{entry.durationMs}ms</td>
        <td className="px-4 py-2 text-xs text-gs-accent">{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr className="bg-gs-surface/50">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-4 max-w-4xl">
              <DiffView original={entry.originalText} sanitized={entry.sanitizedText} />
              {entry.llmResponse && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gs-accent/70 mb-1">LLM Response (raw with synthetics)</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-gs-text bg-gs-accent/5 border border-gs-accent/20 rounded p-2">{entry.llmResponse}</pre>
                </div>
              )}
              {entry.decodedResponse && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gs-green/70 mb-1">Decoded Response (returned to user)</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-gs-heading bg-gs-green/5 border border-gs-green/20 rounded p-2">{entry.decodedResponse}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterSession, setFilterSession] = useState('');

  const load = (off: number) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) });
    fetch(`/api/audit-log?${params}`)
      .then(r => r.json())
      .then((data: { entries: AuditEntry[]; total: number }) => {
        setEntries(data.entries);
        setTotal(data.total);
        setOffset(off);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(0); }, []);

  const filtered = filterSession
    ? entries.filter(e => e.sessionId.includes(filterSession))
    : entries;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gs-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-gs-heading font-semibold">Audit Log</h1>
          <p className="text-xs text-gs-text mt-0.5">History of all processed requests</p>
        </div>
        <button
          onClick={() => load(0)}
          className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-gs-border flex items-center gap-3 flex-shrink-0">
        <input
          type="text"
          placeholder="Filter by session ID…"
          value={filterSession}
          onChange={e => setFilterSession(e.target.value)}
          className="bg-gs-surface border border-gs-border rounded px-2 py-1 text-xs text-gs-text focus:outline-none focus:border-gs-accent w-56 placeholder-gs-border"
        />
        <span className="ml-auto text-xs text-gs-text">
          {filtered.length} shown · {total} total
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="text-center py-16 text-gs-text text-sm">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-gs-text text-sm">
            <div className="text-4xl mb-3 opacity-30">≡</div>
            <div>No audit entries yet</div>
            <div className="text-xs mt-1 opacity-60">Requests processed through the privacy layer will appear here</div>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gs-surface border-b border-gs-border">
              <tr>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Timestamp</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Session</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Entities</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Provider</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Duration</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gs-border/30">
              {filtered.map(e => <EntryRow key={e.id} entry={e} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="px-6 py-3 border-t border-gs-border flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-xs text-gs-text">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => load(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
