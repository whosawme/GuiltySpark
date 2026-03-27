import { useCallback, useReducer } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket.ts';
import Layout from './components/Layout.tsx';
import LiveMonitor from './pages/LiveMonitor.tsx';
import SubstitutionMap from './pages/SubstitutionMap.tsx';
import AuditLog from './pages/AuditLog.tsx';
import Configuration from './pages/Configuration.tsx';
import SessionManager from './pages/SessionManager.tsx';
import type {
  WsMessage, FeedEntry, AuditEntry, PendingReview,
  SessionSummary, AppConfig, ActionKind,
} from './types.ts';

// ─── Global app state ─────────────────────────────────────────────────────────

export interface AppState {
  feed: FeedEntry[];
  auditLog: AuditEntry[];
  pending: PendingReview[];
  sessions: SessionSummary[];
  config: AppConfig | null;
}

type Action =
  | { type: 'INIT'; payload: { sessions: SessionSummary[]; auditLog: AuditEntry[]; pending: PendingReview[]; config: AppConfig } }
  | { type: 'FEED_ENTRY'; payload: FeedEntry }
  | { type: 'AUDIT_UPDATE'; payload: Partial<AuditEntry> & { requestId: string } }
  | { type: 'PENDING_ADD'; payload: PendingReview }
  | { type: 'PENDING_REMOVE'; payload: string }
  | { type: 'SESSION_REFRESH'; payload: SessionSummary[] }
  | { type: 'CONFIG_UPDATE'; payload: AppConfig };

const MAX_FEED = 500;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        sessions: action.payload.sessions,
        auditLog: action.payload.auditLog,
        pending: action.payload.pending,
        config: action.payload.config,
      };

    case 'FEED_ENTRY': {
      const feed = [action.payload, ...state.feed].slice(0, MAX_FEED);
      return { ...state, feed };
    }

    case 'AUDIT_UPDATE': {
      const auditLog = state.auditLog.map(e =>
        e.requestId === action.payload.requestId ? { ...e, ...action.payload } : e,
      );
      // If not found, it was processed before init — ignore
      return { ...state, auditLog };
    }

    case 'PENDING_ADD':
      return { ...state, pending: [...state.pending, action.payload] };

    case 'PENDING_REMOVE':
      return { ...state, pending: state.pending.filter(p => p.pendingId !== action.payload) };

    case 'SESSION_REFRESH':
      return { ...state, sessions: action.payload };

    case 'CONFIG_UPDATE':
      return { ...state, config: action.payload };

    default:
      return state;
  }
}

const initialState: AppState = {
  feed: [],
  auditLog: [],
  pending: [],
  sessions: [],
  config: null,
};

// ─── Message → state mapping ──────────────────────────────────────────────────

function classifyAction(confidence: number, config: AppConfig | null): ActionKind {
  const redact = config?.redact_threshold ?? 0.8;
  const warn = config?.warn_threshold ?? 0.6;
  if (confidence >= redact) return 'redacted';
  if (confidence >= warn) return 'warned';
  return 'ignored';
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'init':
        dispatch({ type: 'INIT', payload: msg.data });
        break;

      case 'entity:detected': {
        const { entity, sessionId, requestId, timestamp } = msg.data;
        const action = classifyAction(entity.confidence, state.config);
        const entry: FeedEntry = {
          id: `${requestId}-${entity.original}-${timestamp}`,
          timestamp,
          sessionId,
          requestId,
          entityType: entity.customLabel ?? entity.type,
          original: entity.original,
          synthetic: '',
          confidence: entity.confidence,
          source: entity.source,
          action,
        };
        dispatch({ type: 'FEED_ENTRY', payload: entry });
        break;
      }

      case 'substitution:applied': {
        // Enrich the matching feed entry with the synthetic value
        const { entry, sessionId, requestId, timestamp } = msg.data;
        const feedEntry: FeedEntry = {
          id: `${requestId}-${entry.original}-${timestamp}`,
          timestamp,
          sessionId,
          requestId,
          entityType: entry.customLabel ?? entry.type,
          original: entry.original,
          synthetic: entry.synthetic,
          confidence: 1,
          source: 'regex',
          action: 'redacted',
        };
        dispatch({ type: 'FEED_ENTRY', payload: feedEntry });
        break;
      }

      case 'request:processed':
        // Audit log entries come in the init payload and via audit-log API
        break;

      case 'response:decoded':
        dispatch({
          type: 'AUDIT_UPDATE',
          payload: {
            requestId: msg.data.requestId,
            llmResponse: msg.data.llmResponse,
            decodedResponse: msg.data.decodedResponse,
          },
        });
        break;

      case 'pending:review:created':
        dispatch({ type: 'PENDING_ADD', payload: msg.data });
        break;

      case 'pending:review:resolved':
        dispatch({ type: 'PENDING_REMOVE', payload: msg.data.pendingId });
        break;
    }
  }, [state.config]);

  const wsStatus = useWebSocket(handleMessage);

  const refreshSessions = useCallback(async () => {
    const r = await fetch('/api/sessions');
    const sessions = await r.json() as SessionSummary[];
    dispatch({ type: 'SESSION_REFRESH', payload: sessions });
  }, []);

  const updateConfig = useCallback((cfg: AppConfig) => {
    dispatch({ type: 'CONFIG_UPDATE', payload: cfg });
  }, []);

  return (
    <Layout wsStatus={wsStatus} pendingCount={state.pending.length}>
      <Routes>
        <Route path="/" element={<Navigate to="/monitor" replace />} />
        <Route path="/monitor" element={<LiveMonitor feed={state.feed} pending={state.pending} config={state.config} />} />
        <Route path="/map" element={<SubstitutionMap sessions={state.sessions} onRefresh={refreshSessions} />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/config" element={<Configuration config={state.config} onUpdate={updateConfig} />} />
        <Route path="/sessions" element={<SessionManager sessions={state.sessions} onRefresh={refreshSessions} />} />
      </Routes>
    </Layout>
  );
}
