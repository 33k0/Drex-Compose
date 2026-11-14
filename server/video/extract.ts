// Frame extractor: six evenly spaced JPEG frames per second for the whole clip, plus a browser-playable
// H.264 MP4 with no audio track. Results are cached on disk, keyed by a hash of the file.
//
// Timestamps: frame `index` covers the window [index/6, (index+1)/6) and `t` is the CENTRE of that window,
// t = (index + 0.5) / 6, measured from the first video frame. The picture is the last source frame before
// that instant (so at most one source frame earlier than `t`).

import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastLines, probeVideo, runFfmpeg, type VideoProbe } from './ffmpeg.ts';

export interface ClipFrame {
  index: number;
  /** Seconds from clip start: the centre of this frame's 1/6 s window, (index + 0.5) / 6. */
  t: number;
  /** Absolute path to a JPEG on disk. */
  file: string;
}

export interface ExtractedClip {
  /** Stable hash of the file (size + mtime + first 64 KiB). */
  id: string;
  /** Absolute path of the video. */
  source: string;
  durationSec: number;
  /** Size of the extracted frames. */
  width: number;
  height: number;
  fps: 6;
  /** Six frames per second, evenly spaced, whole clip. */
  frames: ClipFrame[];
  /** Absolute path to an H.264/yuv420p MP4 without an audio track. */
  playable: string;
}

export interface ExtractOptions {
  /** Long side of the extracted frames in pixels (default 512). Never upscales. */
  longSide?: number;
  /** Cache ROOT; each clip gets `<cacheDir>/<id>/`. Default `<project>/.cache/clips`. */
  cacheDir?: string;
  onProgress?: (done: number, total: number) => void;
}

export const FRAMES_PER_SECOND = 6;
export const DEFAULT_LONG_SIDE = 512;
export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../.cache/clips', import.meta.url));

/** JPEG quantiser scale for ffmpeg's mjpeg encoder (2 = best, 31 = worst). */
const JPEG_Q = 4;
/** Long side cap used only when the playable file has to be re-encoded. */
const PLAYABLE_MAX_LONG_SIDE = 1280;
const META_VERSION = 1;

interface ClipMeta {
  version: number;
  id: string;
  source: string;
  durationSec: number;
  width: number;
  height: number;
  fps: 6;
  longSide: number;
  frameCount: number;
  /** 'source' = the source file itself is the playable; 'file' = playable.mp4 in the cache directory. */
  playable: 'source' | 'file';
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Stable id for a video file: sha256 over size, mtime and the first 64 KiB. */
export async function clipId(videoPath: string): Promise<string> {
  const st = await stat(videoPath);
  if (!st.isFile()) throw new Error(`not a file: ${videoPath}`);
  const head = Buffer.alloc(Math.min(65536, st.size));
  const fh = await open(videoPath, 'r');
  try {
    await fh.read(head, 0, head.length, 0);
  } finally {
    await fh.close();
  }
  return createHash('sha256')
    .update(`${st.size}:${Math.round(st.mtimeMs)}:`)
    .update(head)
    .digest('hex')
    .slice(0, 16);
}

function frameName(index: number): string {
  return `${String(index).padStart(6, '0')}.jpg`;
}

function frameTime(index: number): number {
  return Math.round(((index + 0.5) / FRAMES_PER_SECOND) * 10000) / 10000;
}

function metaName(longSide: number): string {
  return longSide === DEFAULT_LONG_SIDE ? 'clip.json' : `clip-${longSide}.json`;
}

function buildClip(meta: ClipMeta, dir: string, source: string): ExtractedClip {
  const framesDir = path.join(dir, `frames-${meta.longSide}`);
  const frames: ClipFrame[] = [];
  for (let i = 0; i < meta.frameCount; i++) {
    frames.push({ index: i, t: frameTime(i), file: path.join(framesDir, frameName(i)) });
  }
  return {
    id: meta.id,
    source,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    fps: 6,
    frames,
    playable: meta.playable === 'source' ? source : path.join(dir, 'playable.mp4'),
  };
}

async function loadCached(dir: string, longSide: number, source: string): Promise<ExtractedClip | null> {
  let meta: ClipMeta;
  try {
    meta = JSON.parse(await readFile(path.join(dir, metaName(longSide)), 'utf8')) as ClipMeta;
  } catch {
    return null;
  }
  if (meta.version !== META_VERSION || meta.longSide !== longSide || !(meta.frameCount > 0)) return null;
  const clip = buildClip(meta, dir, source);
  const first = clip.frames[0];
  const last = clip.frames[clip.frames.length - 1];
  if (!(await exists(first.file)) || !(await exists(last.file)) || !(await exists(clip.playable))) return null;
  return clip;
}

/** Read width/height from a JPEG's start-of-frame marker. */
async function jpegSize(file: string): Promise<{ width: number; height: number }> {
  const buf = await readFile(file);
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`could not read JPEG size: ${file}`);
}

/** Even output size with the displayed long side capped at `longSide`; never upscales (beyond rounding to even). */
function scaleFilter(longSide: number): string {
  const f = `min(1,${longSide}/max(iw*sar,ih))`;
  return `scale=w='max(2,2*round(iw*sar*${f}/2))':h='max(2,2*round(ih*${f}/2))':flags=bicubic,setsar=1`;
}

async function extractFrames(
  source: string,
  outDir: string,
  longSide: number,
  expectedTotal: number,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const base = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source, '-map', '0:V:0', '-an', '-sn', '-dn'];
  const tail = ['-fps_mode', 'passthrough', '-pix_fmt', 'yuvj420p', '-q:v', String(JPEG_Q), '-start_number', '0'];
  let pending = '';
  let lastReported = -1;
  const res = await runFfmpeg(
    [
      ...base,
      // setpts makes the timeline start at the first video frame; fps picks one source frame per 1/6 s by timestamp,
      // so variable frame rate sources still give evenly spaced frames.
      '-vf', `setpts=PTS-STARTPTS,fps=${FRAMES_PER_SECOND},${scaleFilter(longSide)}`,
      ...tail,
      '-progress', 'pipe:1', '-nostats',
      path.join(outDir, '%06d.jpg'),
    ],
    {
      onStdout: (chunk) => {
        if (!onProgress) return;
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^frame=\s*(\d+)/.exec(line);
          if (!m) continue;
          const done = Number(m[1]);
          if (done !== lastReported) {
            lastReported = done;
            onProgress(Math.min(done, Math.max(expectedTotal, done)), Math.max(expectedTotal, done));
          }
        }
      },
    },
  );
  let count = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).length;
  if (res.code !== 0 && count === 0) throw new Error(`frame extraction failed for ${source}: ${lastLines(res.stderr)}`);
  if (count === 0) {
    // Degenerate clip (e.g. a single frame the fps filter rounded away): keep its first picture.
    const one = await runFfmpeg([...base, '-vf', scaleFilter(longSide), '-frames:v', '1', ...tail, path.join(outDir, '%06d.jpg')]);
    count = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).length;
    if (count === 0) throw new Error(`no frames could be decoded from ${source}: ${lastLines(one.stderr)}`);
  }
  return count;
}

const playableInflight = new Map<string, Promise<'source' | 'file'>>();

/** Make sure a browser-playable, audio-less H.264 MP4 exists; returns where it lives. */
function ensurePlayable(source: string, dir: string, probe: VideoProbe): Promise<'source' | 'file'> {
  const key = `${dir}|${source}`;
  const running = playableInflight.get(key);
  if (running) return running;
  const job = makePlayable(source, dir, probe).finally(() => playableInflight.delete(key));
  playableInflight.set(key, job);
  return job;
}

async function makePlayable(source: string, dir: string, probe: VideoProbe): Promise<'source' | 'file'> {
  const h264Ok = probe.codec === 'h264' && probe.pixFmt === 'yuv420p' && probe.rotation % 360 === 0;
  const isMp4 = /\bmp4\b/.test(probe.container) && /\.(mp4|m4v)$/i.test(source);
  if (h264Ok && isMp4 && !probe.hasAudio) return 'source';

  const out = path.join(dir, 'playable.mp4');
  if (await exists(out)) return 'file';
  const tmp = path.join(dir, `playable.tmp-${randomBytes(4).toString('hex')}.mp4`);
  const head = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source, '-map', '0:V:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1'];
  const tail = ['-movflags', '+faststart', tmp];
  try {
    let done = false;
    if (h264Ok) {
      // Already H.264/yuv420p: copy the video stream, drop everything else.
      const copy = await runFfmpeg([...head, '-c:v', 'copy', ...tail]);
      done = copy.code === 0 && (await exists(tmp)) && (await stat(tmp)).size > 0;
    }
    if (!done) {
      const f = `min(1,${PLAYABLE_MAX_LONG_SIDE}/max(iw*sar,ih))`;
      const vf = `scale=w='max(2,2*round(iw*sar*${f}/2))':h='max(2,2*round(ih*${f}/2))':flags=bicubic,setsar=1,format=yuv420p`;
      const enc = await runFfmpeg([...head, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', ...tail]);
      if (enc.code !== 0) throw new Error(`could not transcode ${source} to H.264: ${lastLines(enc.stderr)}`);
    }
    await rename(tmp, out);
  } finally {
    await rm(tmp, { force: true });
  }
  return 'file';
}

const inflight = new Map<string, Promise<ExtractedClip>>();

export async function extractClip(videoPath: string, opts: ExtractOptions = {}): Promise<ExtractedClip> {
  const source = path.resolve(videoPath);
  const longSide = Math.max(16, Math.min(4096, Math.round(opts.longSide ?? DEFAULT_LONG_SIDE)));
  const root = path.resolve(opts.cacheDir ?? DEFAULT_CACHE_DIR);
  const id = await clipId(source);
  const dir = path.join(root, id);

  const cached = await loadCached(dir, longSide, source);
  if (cached) {
    opts.onProgress?.(cached.frames.length, cached.frames.length);
    return cached;
  }

  // Concurrent calls for the same file share one extraction (only the first caller's onProgress is wired up).
  const key = `${dir}|${longSide}|${source}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = doExtract(source, id, dir, longSide, opts.onProgress).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function doExtract(
  source: string,
  id: string,
  dir: string,
  longSide: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedClip> {
  const probe = await probeVideo(source);
  await mkdir(dir, { recursive: true });

  const framesDir = path.join(dir, `frames-${longSide}`);
  const tmpFrames = `${framesDir}.tmp-${randomBytes(4).toString('hex')}`;
  const expected = Math.max(1, Math.round((probe.durationSec ?? 0) * FRAMES_PER_SECOND));

  let count: number;
  let playable: 'source' | 'file';
  try {
    [count, playable] = await Promise.all([
      extractFrames(source, tmpFrames, longSide, expected, onProgress),
      ensurePlayable(source, dir, probe),
    ]);
  } catch (err) {
    await rm(tmpFrames, { recursive: true, force: true });
    throw err;
  }

  // Duration of the video track alone, as the browser will play it.
  const playablePath = playable === 'source' ? source : path.join(dir, 'playable.mp4');
  let durationSec = playable === 'source' ? probe.durationSec : (await probeVideo(playablePath)).durationSec;
  if (!durationSec || !(durationSec > 0)) durationSec = count / FRAMES_PER_SECOND;

  // Drop frames whose timestamp would fall past the end of the playable video (rounding at EOF).
  let keep = count;
  while (keep > 1 && (keep - 1 + 0.5) / FRAMES_PER_SECOND >= durationSec) keep--;
  for (let i = keep; i < count; i++) await rm(path.join(tmpFrames, frameName(i)), { force: true });

  const size = await jpegSize(path.join(tmpFrames, frameName(0)));
  await rm(framesDir, { recursive: true, force: true });
  await rename(tmpFrames, framesDir);

  const meta: ClipMeta = {
    version: META_VERSION,
    id,
    source,
    durationSec: Math.round(durationSec * 1000) / 1000,
    width: size.width,
    height: size.height,
    fps: 6,
    longSide,
    frameCount: keep,
    playable,
  };
  const metaPath = path.join(dir, metaName(longSide));
  const tmpMeta = `${metaPath}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(tmpMeta, `${JSON.stringify(meta, null, 2)}\n`);
  await rename(tmpMeta, metaPath);

  onProgress?.(keep, keep);
  return buildClip(meta, dir, source);
}

/** Raw base64 (no `data:` prefix) of the frame's JPEG. */
export async function frameBase64(frame: ClipFrame): Promise<string> {
  return (await readFile(frame.file)).toString('base64');
}

/** The (up to six) frames with second <= t < second + 1. */
export function framesForSecond(clip: ExtractedClip, second: number): ClipFrame[] {
  return clip.frames.filter((f) => f.t >= second && f.t < second + 1);
}
