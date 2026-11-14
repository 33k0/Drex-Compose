// Where server events come from and client events go: the /ws socket (with reconnect and
// backoff), or the scripted mock feed when the URL has ?mock=1.

import type { ChoreoClientEvent, ChoreoServerEvent } from '../../shared/choreo';
import type { Conn } from './state';
import { createMockFeed } from './mock/feed';

export interface Transport {
  send(event: ChoreoClientEvent): void;
  close(): void;
}

interface Handlers {
  onEvent(event: ChoreoServerEvent): void;
  onConn(conn: Conn): void;
}

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 8000;
const OUTBOX_LIMIT = 24;

export function createSocketTransport(handlers: Handlers): Transport {
  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = BACKOFF_START_MS;
  let retry: number | null = null;
  let everOpened = false;
  const outbox: ChoreoClientEvent[] = [];

  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

  function connect(): void {
    if (closed) return;
    handlers.onConn(everOpened ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      everOpened = true;
      backoff = BACKOFF_START_MS;
      handlers.onConn('open');
      while (outbox.length && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(outbox.shift()));
      }
    };
    ws.onmessage = (msg) => {
      if (typeof msg.data !== 'string') return;
      let event: ChoreoServerEvent;
      try {
        event = JSON.parse(msg.data) as ChoreoServerEvent;
      } catch {
        return;
      }
      if (event && typeof event === 'object' && typeof event.type === 'string') handlers.onEvent(event);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      schedule();
    };
    ws.onerror = () => {
      try { ws.close(); } catch { /* already closing */ }
    };
  }

  function schedule(): void {
    if (closed || retry !== null) return;
    handlers.onConn(everOpened ? 'reconnecting' : 'connecting');
    retry = window.setTimeout(() => {
      retry = null;
      connect();
    }, backoff);
    backoff = Math.min(BACKOFF_MAX_MS, Math.round(backoff * 1.7));
  }

  connect();

  return {
    send(event) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
        return;
      }
      // Video-time reports are only meaningful live; a start or stop is worth delivering late.
      if (event.type === 'start_clip' || event.type === 'stop') {
        outbox.push(event);
        if (outbox.length > OUTBOX_LIMIT) outbox.shift();
      }
    },
    close() {
      closed = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
    },
  };
}

export function createMockTransport(handlers: Handlers): Transport {
  const feed = createMockFeed((event) => handlers.onEvent(event));
  handlers.onConn('mock');
  return {
    send(event) {
      if (event.type === 'start_clip') feed.start(event);
      else if (event.type === 'stop') feed.stop();
      else feed.client(event);
    },
    close() {
      feed.stop();
    },
  };
}

export function isMockMode(): boolean {
  return new URLSearchParams(location.search).get('mock') === '1';
}
