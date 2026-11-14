// HTTP + WebSocket server: lists and accepts video files, serves frames, the muted video and the
// sample library, and runs one scoring session per socket.

import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { ChoreoClientEvent, ChoreoServerEvent, ClipListing } from '../shared/choreo.ts';
import { apiKey } from './gateway/gateway.ts';
import { modelFor } from './gateway/models.ts';
import { pack, ROOT } from './pack.ts';
import { CLIPS, Session } from './session.ts';

const CLIP_DIR = join(ROOT, 'clips');
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];
mkdirSync(CLIP_DIR, { recursive: true });

function listClips(): ClipListing[] {
  return readdirSync(CLIP_DIR)
    .filter((f) => VIDEO_EXT.includes(extname(f).toLowerCase()))
    .map((file) => ({ name: file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file, sizeMb: Math.round((statSync(join(CLIP_DIR, file)).size / 1e6) * 10) / 10 }));
}

const app = express();
app.use('/assets', express.static(join(ROOT, 'assets'), { maxAge: '1h', fallthrough: false }));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, standin: !apiKey(), model: apiKey() ? modelFor('frame_reading', true) : 'stand-in', packRules: pack.rules.length, clips: listClips().length });
});
app.get('/api/clips', (_req, res) => res.json(listClips()));
// The file itself, for the preview on the clip stage (played muted) before any scoring run exists.
app.get('/api/clips/:file', (req, res) => {
  const listing = listClips().find((c) => c.file === req.params.file);
  if (!listing) return res.status(404).end();
  res.sendFile(join(CLIP_DIR, listing.file));
});
// Video files only (input is files, no webcam). The body is the raw file.
app.post('/api/clips', async (req, res) => {
  const raw = String(req.query.name ?? 'clip.mp4');
  const ext = extname(raw).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) return res.status(415).json({ error: `Not a video file type: ${ext || 'none'}` });
  const safe = raw.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'clip';
  const file = `${safe}${ext}`;
  try {
    await pipeline(req, createWriteStream(join(CLIP_DIR, file)));
    res.json({ file });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
app.get('/media/:id/video', (req, res) => {
  const clip = CLIPS.get(req.params.id);
  if (!clip) return res.status(404).end();
  // Extracted files live under .cache, which Express treats as a dotfile path unless told otherwise.
  res.sendFile(clip.playable, { dotfiles: 'allow' });
});
app.get('/media/:id/frame/:file', (req, res) => {
  const clip = CLIPS.get(req.params.id);
  const frame = clip?.frames[Number.parseInt(req.params.file, 10)];
  if (!frame) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(frame.file, { dotfiles: 'allow' });
});
const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|assets|media|ws).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  let session: Session | null = null;
  const send = (event: ChoreoServerEvent) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  };
  socket.on('message', (raw) => {
    let event: ChoreoClientEvent;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (event.type === 'start_clip') {
      session?.stop();
      const listing = listClips().find((c) => c.file === event.clip);
      if (!listing) return send({ type: 'error', message: `No such clip: ${event.clip}` });
      session = new Session({ clipPath: join(CLIP_DIR, listing.file), prompt: String(event.prompt ?? '').slice(0, 600), seed: event.seed, tap: event.tap, send });
      void session.run();
    } else {
      session?.onClient(event);
      if (event.type === 'video_time' && event.sec < 0.6) session?.resetLive();
      if (event.type === 'stop') session = null;
    }
  });
  socket.on('close', () => session?.stop());
});

const port = Number(process.env.PORT) || 8788;
server.listen(port, () => {
  console.log(`Drex Choreomusic server on http://localhost:${port}`);
  console.log(apiKey() ? `Drex: live, model ${modelFor('frame_reading', true)}` : 'Drex: no NACE_API_KEY set, the local STAND-IN is answering (it cannot see frames; it reads the motion analysis instead)');
  console.log(`Clips: ${listClips().map((c) => c.file).join(', ') || 'none yet: put video files in clips/'}`);
});
