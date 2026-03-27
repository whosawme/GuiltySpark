import { useState, useEffect } from 'react';
import type { SessionSummary, SubstitutionEntry, EntityType } from '../types.ts';

interface Props {
  sessions: SessionSummary[];
  onRefresh: () => void;
}

interface MapResponse {
  sessionId: string;
  entries: Array<SubstitutionEntry & { id: string }>;
}

function MaskedCell({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`font-mono text-xs cursor-pointer select-none transition-all ${revealed ? 'text-gs-red' : 'masked text-gs-red'}`}
      onClick={() => setRevealed(r => !r)}
      title={revealed ? 'Click to mask' : 'Click to reveal original'}
    >
      {value}
    </span>
  );
}

const TYPE_COLOR: Partial<Record<EntityType | string, string>> = {
  PERSON_NAME:       'text-gs-purple',
  EMAIL:             'text-gs-accent',
  PHONE:             'text-gs-green',
  SSN:               'text-gs-red',
  CREDIT_CARD:       'text-gs-red',
  API_KEY:           'text-gs-yellow',
  IP_ADDRESS:        'text-gs-text',
  ADDRESS:           'text-gs-green',
  DATE_OF_BIRTH:     'text-gs-purple',
  COMPANY_INTERNAL:  'text-gs-accent',
  FINANCIAL_ACCOUNT: 'text-gs-yellow',
  MEDICAL_INFO:      'text-gs-red',
  CUSTOM:            'text-gs-text',
};

export default function SubstitutionMap({ sessions, onRefresh }: Props) {
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      setSelectedSession(sessions[0].sessionId);
    }
  }, [sessions, selectedSession]);

  useEffect(() => {
    if (!selectedSession) return;
    setLoading(true);
    fetch(`/api/sessions/${selectedSession}/map`)
      .then(r => r.json())
      .then((data: MapResponse) => { setMapData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedSession]);

  const allTypes = mapData
    ? Array.from(new Set(mapData.entries.map(e => e.customLabel ?? e.type)))
    : [];

  const filtered = (mapData?.entries ?? []).filter(e => {
    const matchType = filterType === 'all' || (e.customLabel ?? e.type) === filterType;
    const matchSearch = !search || e.synthetic.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const exportJSON = () => {
    if (!mapData) return;
    const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `substitution-map-${selectedSession.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gs-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-gs-heading font-semibold">Substitution Map</h1>
          <p className="text-xs text-gs-text mt-0.5">Original ↔ Synthetic mapping for a session</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
          >
            ↺ Refresh
          </button>
          <button
            onClick={exportJSON}
            disabled={!mapData}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors disabled:opacity-40"
          >
            ↓ Export JSON
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-gs-border flex items-center gap-3 flex-shrink-0">
        <select
          value={selectedSession}
          onChange={e => setSelectedSession(e.target.value)}
          className="bg-gs-surface border border-gs-border rounded px-2 py-1 text-xs text-gs-text focus:outline-none focus:border-gs-accent max-w-xs"
        >
          {sessions.length === 0 && <option value="">No sessions</option>}
          {sessions.map(s => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId.slice(0, 12)}… ({s.entryCount} entries)
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-gs-surface border border-gs-border rounded px-2 py-1 text-xs text-gs-text focus:outline-none focus:border-gs-accent"
        >
          <option value="all">All types</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <input
          type="text"
          placeholder="Search synthetics…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gs-surface border border-gs-border rounded px-2 py-1 text-xs text-gs-text focus:outline-none focus:border-gs-accent w-48 placeholder-gs-border"
        />

        <span className="ml-auto text-xs text-gs-text">
          {filtered.length} / {mapData?.entries.length ?? 0} entries
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="text-center py-16 text-gs-text text-sm">Loading…</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="text-center py-16 text-gs-text text-sm">
            <div className="text-4xl mb-3 opacity-30">⇄</div>
            <div>No active sessions</div>
          </div>
        )}
        {!loading && mapData && filtered.length === 0 && (
          <div className="text-center py-16 text-gs-text text-sm">No entries match</div>
        )}
        {!loading && filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gs-surface border-b border-gs-border">
              <tr>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Original</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Synthetic</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Type</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">ID</th>
                <th className="text-left px-4 py-2 text-gs-text font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gs-border/30">
              {filtered.map(entry => (
                <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2">
                    <MaskedCell value={entry.original} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-gs-accent">{entry.synthetic}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`font-medium ${TYPE_COLOR[entry.customLabel ?? entry.type] ?? 'text-gs-text'}`}>
                      {entry.customLabel ?? entry.type}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-gs-text opacity-60">{entry.id}</span>
                  </td>
                  <td className="px-4 py-2 text-gs-text opacity-60">
                    {new Date(entry.createdAt).toLocaleTimeString([], { hour12: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
