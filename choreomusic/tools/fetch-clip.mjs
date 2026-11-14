#!/usr/bin/env node
// Fetch a demo clip: download a video with yt-dlp, strip the audio, write clips/<name>.mp4 (H.264, <= 720p).
//
//   node tools/fetch-clip.mjs <url> <name> [--max-height 720] [--keep-temp]
//
// yt-dlp is located without touching system packages, in this order:
//   1. $YT_DLP (path to a binary)
//   2. a standalone binary already present in .cache/bin/
//   3. `yt-dlp` on PATH
//   4. `uv tool run --from yt-dlp[default] yt-dlp` (uv keeps it in its own cache)
//   5. the standalone binary from the official GitHub releases, downloaded into .cache/bin/
// Audio is never kept: only a video stream is requested, and ffmpeg-static writes the result with -an.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const BIN_DIR = path.join(CACHE, 'bin');
const CLIPS = path.join(ROOT, 'clips');

function fail(msg) {
  console.error(`fetch-clip: ${msg}`);
  process.exit(1);
}

/** Run a process; resolves with { code, stdout, stderr }. `inherit` streams stderr to the terminal as well. */
function run(cmd, args, { inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (inherit) process.stderr.write(d);
    });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function exists(p, mode = FS.F_OK) {
  try { await access(p, mode); return true; } catch { return false; }
}

function standaloneName() {
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'win32') return 'yt-dlp.exe';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

async function downloadStandalone() {
  const name = standaloneName();
  const dest = path.join(BIN_DIR, name);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;
  console.error(`fetch-clip: downloading ${url}`);
  await mkdir(BIN_DIR, { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await chmod(tmp, 0o755);
  await rename(tmp, dest);
  return dest;
}

/** Returns { cmd, prefix, label } for a yt-dlp that answers --version, or throws with everything that was tried. */
async function locateYtDlp() {
  const tried = [];
  const check = async (cmd, prefix, label) => {
    const r = await run(cmd, [...prefix, '--version']);
    if (r.code === 0 && r.stdout.trim()) return { cmd, prefix, label: `${label} (${r.stdout.trim()})` };
    tried.push(`${label}: ${(r.stderr.trim().split('\n').pop() ?? '').slice(0, 200) || `exit ${r.code}`}`);
    return null;
  };

  if (process.env.YT_DLP) {
    const hit = await check(process.env.YT_DLP, [], '$YT_DLP');
    if (hit) return hit;
  }
  const local = path.join(BIN_DIR, standaloneName());
  if (await exists(local, FS.X_OK)) {
    const hit = await check(local, [], '.cache/bin standalone');
    if (hit) return hit;
  }
  {
    const hit = await check('yt-dlp', [], 'yt-dlp on PATH');
    if (hit) return hit;
  }
  {
    const hit = await check('uv', ['tool', 'run', '--from', 'yt-dlp[default]', 'yt-dlp'], 'uv tool run yt-dlp');
    if (hit) return hit;
  }
  try {
    const bin = await downloadStandalone();
    const hit = await check(bin, [], 'downloaded standalone');
    if (hit) return hit;
  } catch (err) {
    tried.push(`standalone download: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(`could not find or obtain yt-dlp:\n  ${tried.join('\n  ')}`);
}

/** Parse the first video stream (and whether any audio stream exists) out of `ffmpeg -i` stderr. */
async function probe(file) {
  const r = await run(ffmpegPath, ['-hide_banner', '-i', file]);
  const text = r.stderr;
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const video = /Stream #\d+:\d+.*?: Video: (\w+)([^\n]*)/.exec(text);
  const size = video ? /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(video[2]) : null;
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(text) ?? /rotate\s*:\s*(-?\d+)/.exec(text);
  let width = size ? Number(size[1]) : 0;
  let height = size ? Number(size[2]) : 0;
  if (rotation && Math.abs(Math.round(Number(rotation[1]))) % 180 === 90) [width, height] = [height, width];
  return {
    durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    codec: video ? video[1] : null,
    pixFmt: video ? (/\b(yuvj?4\d\dp(?:\d\d[lb]e)?|nv12|rgb24|gbrp)\b/.exec(video[2])?.[1] ?? null) : null,
    width,
    height,
    rotated: Boolean(rotation && Math.round(Number(rotation[1])) % 360 !== 0),
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(text),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  let maxHeight = 720;
  let keepTemp = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-height') maxHeight = Number(argv[++i]);
    else if (argv[i] === '--keep-temp') keepTemp = true;
    else positional.push(argv[i]);
  }
  const [url, name] = positional;
  if (!url || !name) fail('usage: node tools/fetch-clip.mjs <url> <name> [--max-height 720] [--keep-temp]');
  if (!/^[\w][\w.-]*$/.test(name)) fail(`name must be a plain file stem (letters, digits, - _ .), got "${name}"`);
  if (!Number.isFinite(maxHeight) || maxHeight < 144) fail('--max-height must be a number >= 144');
  if (!ffmpegPath) fail('ffmpeg-static did not provide a binary (run npm install)');

  const ytdlp = await locateYtDlp().catch((err) => fail(err.message));
  console.error(`fetch-clip: using ${ytdlp.label}`);

  await mkdir(CLIPS, { recursive: true });
  await mkdir(path.join(CACHE, 'fetch'), { recursive: true });
  const tmpDir = await mkdtemp(path.join(CACHE, 'fetch', `${name}-`));

  try {
    // Video-only formats first (nothing to merge, no audio ever lands on disk); H.264 preferred so we can remux.
    const format = [
      `bv*[height<=${maxHeight}][vcodec^=avc1]`,
      `bv*[height<=${maxHeight}]`,
      `b[height<=${maxHeight}]`,
      'bv*',
      'b',
    ].join('/');
    const dlArgs = [
      ...ytdlp.prefix,
      '--no-playlist',
      '--no-progress',
      '--ffmpeg-location', ffmpegPath,
      '--js-runtimes', `node:${process.execPath}`,
      '-f', format,
      '-o', path.join(tmpDir, 'source.%(ext)s'),
      '--print', 'before_dl:META\t%(id)s\t%(title)s\t%(uploader)s\t%(duration)s\t%(webpage_url)s',
      '--no-simulate',
      url,
    ];
    console.error('fetch-clip: downloading video stream');
    let dl = await run(ytdlp.cmd, dlArgs, { inherit: true });
    if (dl.code !== 0 && /no such option: --js-runtimes/.test(dl.stderr)) {
      // Older yt-dlp builds do not know the option (and do not need it).
      const at = dlArgs.indexOf('--js-runtimes');
      dl = await run(ytdlp.cmd, [...dlArgs.slice(0, at), ...dlArgs.slice(at + 2)], { inherit: true });
    }
    if (dl.code !== 0) fail(`yt-dlp exited with ${dl.code}`);

    const files = (await readdir(tmpDir)).filter((f) => f.startsWith('source.') && !f.endsWith('.part'));
    if (files.length === 0) fail('yt-dlp reported success but produced no file');
    const source = path.join(tmpDir, files[0]);
    const metaLine = dl.stdout.split('\n').find((l) => l.startsWith('META\t'));
    const [, id, title, uploader, duration, pageUrl] = metaLine ? metaLine.split('\t') : [];

    const src = await probe(source);
    if (!src.codec) fail(`downloaded file has no video stream: ${source}`);
    const shortSide = Math.min(src.width, src.height);
    const canCopy = src.codec === 'h264' && src.pixFmt === 'yuv420p' && shortSide <= maxHeight && !src.rotated;

    const out = path.join(CLIPS, `${name}.mp4`);
    const tmpOut = path.join(tmpDir, 'out.mp4');
    const common = ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1'];
    const encode = [
      // Short side <= maxHeight, never upscaled, even dimensions.
      '-vf', `scale='if(gt(iw,ih),-2,min(${maxHeight},iw))':'if(gt(iw,ih),min(${maxHeight},ih),-2)',scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    ];
    const tail = ['-movflags', '+faststart', tmpOut];
    console.error(`fetch-clip: ${canCopy ? 'remuxing' : 'transcoding'} ${src.codec} ${src.width}x${src.height} without audio`);
    let ff = await run(ffmpegPath, [...common, ...(canCopy ? ['-c:v', 'copy'] : encode), ...tail], { inherit: true });
    if (ff.code !== 0 && canCopy) {
      console.error('fetch-clip: remux failed, transcoding instead');
      ff = await run(ffmpegPath, [...common, ...encode, ...tail], { inherit: true });
    }
    if (ff.code !== 0) fail(`ffmpeg exited with ${ff.code}`);

    // Verify: no audio stream, H.264, and the whole file decodes.
    const res = await probe(tmpOut);
    if (res.hasAudio) fail('output still has an audio stream');
    if (res.codec !== 'h264') fail(`output codec is ${res.codec}, expected h264`);
    const decode = await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-i', tmpOut, '-f', 'null', '-']);
    if (decode.code !== 0 || decode.stderr.trim()) fail(`output does not decode cleanly:\n${decode.stderr}`);

    await rename(tmpOut, out);
    const bytes = (await stat(out)).size;
    const info = {
      name,
      file: `clips/${name}.mp4`,
      sourceUrl: pageUrl || url,
      id: id ?? null,
      title: title ?? null,
      uploader: uploader ?? null,
      sourceDurationSec: duration ? Number(duration) : null,
      durationSec: res.durationSec,
      width: res.width,
      height: res.height,
      codec: res.codec,
      audio: false,
      bytes,
      fetchedAt: new Date().toISOString(),
    };
    await writeFile(path.join(CLIPS, `${name}.source.json`), `${JSON.stringify(info, null, 2)}\n`);
    console.log(JSON.stringify(info, null, 2));
  } finally {
    if (!keepTemp) await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
