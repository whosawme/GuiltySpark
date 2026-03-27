import { useState, useEffect } from 'react';
import type { SessionSummary, SubstitutionEntry } from '../types.ts';

interface Props {
  sessions: SessionSummary[];
  onRefresh: () => void;
}

interface MapResponse {
  sessionId: string;
  entries: Array<SubstitutionEntry & { id: string }>;
}

function ago(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function SessionCard({ session, onDestroy }: { session: SessionSummary; onDestroy: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [destroyed, setDestroyed] = useState(false);

  const loadMap = async () => {
    if (mapData) { setExpanded(e => !e); return; }
    setLoadingMap(true);
    setExpanded(true);
    try {
      const r = await fetch(`/api/sessions/${session.sessionId}/map`);
      const data = await r.json() as MapResponse;
      setMapData(data);
    } finally {
      setLoadingMap(false);
    }
  };

  const destroy = async () => {
    await fetch(`/api/sessions/${session.sessionId}`, { method: 'DELETE' });
    setDestroyed(true);
    onDestroy();
  };

  if (destroyed) return null;

  return (
    <div className="border border-gs-border rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-gs-surface">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gs-accent">{session.sessionId.slice(0, 16)}…</span>
            <span className="text-[10px] text-gs-text opacity-50">
              {session.entryCount} substitution{session.entryCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-0.5 text-[10px] text-gs-text opacity-50">
            <span>Created {ago(session.createdAt)}</span>
            <span>Last used {ago(session.lastUsedAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={loadMap}
            className="px-2 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
          >
            {expanded ? 'Hide Map' : 'View Map'}
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="px-2 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-red hover:text-gs-red transition-colors"
            >
              Destroy
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gs-yellow">Sure?</span>
              <button
                onClick={destroy}
                className="px-2 py-1 text-xs border border-gs-red/50 rounded text-gs-red hover:bg-gs-red/10 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-2 py-1 text-xs border border-gs-border rounded text-gs-text transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Map table */}
      {expanded && (
        <div className="border-t border-gs-border">
          {loadingMap && (
            <div className="text-center py-6 text-xs text-gs-text">Loading…</div>
          )}
          {!loadingMap && mapData && mapData.entries.length === 0 && (
            <div className="text-center py-6 text-xs text-gs-text">No substitutions in this session</div>
          )}
          {!loadingMap && mapData && mapData.entries.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-gs-bg border-b border-gs-border">
                <tr>
                  <th className="text-left px-4 py-2 text-gs-text font-medium">Original</th>
                  <th className="text-left px-4 py-2 text-gs-text font-medium">Synthetic</th>
                  <th className="text-left px-4 py-2 text-gs-text font-medium">Type</th>
                  <th className="text-left px-4 py-2 text-gs-text font-medium">ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gs-border/30">
                {mapData.entries.map(e => (
                  <tr key={e.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-1.5">
                      <OriginalCell value={e.original} />
                    </td>
                    <td className="px-4 py-1.5 font-mono text-gs-accent">{e.synthetic}</td>
                    <td className="px-4 py-1.5 text-gs-text">{e.customLabel ?? e.type}</td>
                    <td className="px-4 py-1.5 text-gs-text opacity-50">{e.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function OriginalCell({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`font-mono cursor-pointer transition-all ${revealed ? 'text-gs-red' : 'masked text-gs-red'}`}
      onClick={() => setRevealed(r => !r)}
    >
      {value}
    </span>
  );
}

export default function SessionManager({ sessions, onRefresh }: Props) {
  const [localSessions, setLocalSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  const destroyAll = async () => {
    await Promise.all(localSessions.map(s =>
      fetch(`/api/sessions/${s.sessionId}`, { method: 'DELETE' })
    ));
    setLocalSessions([]);
    onRefresh();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gs-border flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-gs-heading font-semibold">Session Manager</h1>
          <p className="text-xs text-gs-text mt-0.5">Active and recent sessions with their substitution maps</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="px-3 py-1 text-xs border border-gs-border rounded text-gs-text hover:border-gs-accent hover:text-gs-accent transition-colors"
          >
            ↺ Refresh
          </button>
          {localSessions.length > 1 && (
            <button
              onClick={destroyAll}
              className="px-3 py-1 text-xs border border-gs-red/40 rounded text-gs-red hover:bg-gs-red/10 transition-colors"
            >
              Destroy All
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {localSessions.length === 0 && (
          <div className="text-center py-16 text-gs-text text-sm">
            <div className="text-4xl mb-3 opacity-30">◻</div>
            <div>No active sessions</div>
            <div className="text-xs mt-1 opacity-60">Sessions are created automatically when the first prompt is processed</div>
          </div>
        )}
        {localSessions.map(s => (
          <SessionCard
            key={s.sessionId}
            session={s}
            onDestroy={onRefresh}
          />
        ))}
      </div>

      {/* Footer */}
      {localSessions.length > 0 && (
        <div className="px-6 py-3 border-t border-gs-border text-xs text-gs-text flex-shrink-0">
          {localSessions.length} active session{localSessions.length !== 1 ? 's' : ''} ·{' '}
          {localSessions.reduce((n, s) => n + s.entryCount, 0)} total substitutions in memory
        </div>
      )}
    </div>
  );
}
