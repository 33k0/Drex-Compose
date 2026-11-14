// HTTP + WebSocket server. Serves the sample library and hall recordings under /assets and runs
// one composing session per socket.

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { ClientEvent, ServerEvent } from '../shared/types.ts';
import { apiKey } from './gateway/gateway.ts';
import { modelFor } from './gateway/models.ts';
import { pack, ROOT } from './pack.ts';
import { Session } from './session.ts';

const app = express();
app.use('/assets', express.static(join(ROOT, 'assets'), { maxAge: '1h', fallthrough: false }));
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    standin: !apiKey(),
    model: apiKey() ? modelFor('setup') : 'stand-in',
    packRules: pack.rules.length,
    workedExamples: pack.examples.length,
  });
});
const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|assets|ws).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  let session: Session | null = null;
  const send = (event: ServerEvent) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  };
  socket.on('message', (raw) => {
    let event: ClientEvent;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (event.type === 'start') {
      session?.stop();
      const prompt = String(event.prompt ?? '').trim().slice(0, 600) || 'a quiet piece';
      session = new Session({ prompt, seed: event.seed, paced: true, send });
      void session.run();
    } else {
      session?.onClient(event);
      if (event.type === 'stop') session = null;
    }
  });
  socket.on('close', () => session?.stop());
});

const port = Number(process.env.PORT) || 8787;
server.listen(port, () => {
  console.log(`Drex Composer server on http://localhost:${port}`);
  console.log(apiKey() ? `Drex: live, model ${modelFor('setup')}` : 'Drex: no NACE_API_KEY set, the local STAND-IN is answering');
  console.log(`Context pack: ${pack.rules.length} rules, ${pack.examples.length} worked examples`);
});
