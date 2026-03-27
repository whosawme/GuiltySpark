import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsMessage } from '../types.ts';

type MessageHandler = (msg: WsMessage) => void;

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const WS_URL = `ws://${window.location.host}`;
const RECONNECT_DELAY = 2000;

export function useWebSocket(onMessage: MessageHandler) {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        handlerRef.current(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => setStatus('error');

    ws.onclose = () => {
      setStatus('disconnected');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return status;
}
