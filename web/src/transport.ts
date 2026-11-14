// Where ServerEvents come from and ClientEvents go: the /ws socket (with reconnect and
// backoff), or the scripted mock feed when the URL has ?mock=1.

import type { ClientEvent, ServerEvent } from '../../shared/types';
import type { Conn } from './state';
import { createMockFeed } from './mock/feed';

export interface Transport {
  send(event: ClientEvent): void;
  close(): void;
}

interface Handlers {
  onEvent(event: ServerEvent): void;
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
  const outbox: ClientEvent[] = [];

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
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data) as ServerEvent;
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
      // Playback reports are only meaningful live; a start or stop is worth delivering late.
      if (event.type === 'start' || event.type === 'stop') {
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
      if (event.type === 'start') feed.start(event.prompt, event.seed);
      else if (event.type === 'stop') feed.stop();
      else feed.client(event);
    },
    close() {
      feed.stop();
    },
  };
}

/** /?replay=<name>: the saved run eval/results/<name>/events.json, or null when not replaying. */
export function replayName(): string | null {
  const name = new URLSearchParams(location.search).get('replay');
  return name && /^[A-Za-z0-9_.-]+$/.test(name) ? name : null;
}

/**
 * Replays a saved run: every event Drex's session produced, fed through the same path as a live run,
 * so the real engine plays it with its samples and hall. No request goes to Drex.
 */
export function createReplayTransport(name: string, handlers: Handlers): Transport {
  let run = 0;
  handlers.onConn('replay');
  return {
    send(event) {
      if (event.type === 'stop') {
        run += 1;
        return;
      }
      if (event.type !== 'start') return; // playback reports have no server to go to
      const mine = ++run;
      fetch(`/api/replay/${encodeURIComponent(name)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
          return (await res.json()) as ServerEvent[];
        })
        .then((events) => {
          for (const e of events) {
            if (mine !== run) return;
            handlers.onEvent(e);
          }
        })
        .catch((err: unknown) => {
          if (mine !== run) return;
          handlers.onEvent({ type: 'error', message: `Could not load saved run "${name}": ${err instanceof Error ? err.message : String(err)}` });
          handlers.onEvent({ type: 'status', stage: 'error', message: `Could not load saved run "${name}"` });
        });
    },
    close() {
      run += 1;
    },
  };
}

export function isMockMode(): boolean {
  return new URLSearchParams(location.search).get('mock') === '1';
}
