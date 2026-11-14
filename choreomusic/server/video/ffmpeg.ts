// Thin wrappers around the bundled ffmpeg binary. There is no ffprobe: stream facts are read from
// the banner ffmpeg prints on stderr for `ffmpeg -i <file>`.

import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export function ffmpegBinary(): string {
  const bin = ffmpegStatic as unknown as string | null;
  if (!bin) throw new Error('ffmpeg-static did not provide a binary for this platform');
  return bin;
}

export interface FfmpegResult {
  code: number;
  stderr: string;
}

/**
 * Run ffmpeg. stdout chunks go to `onStdout` (they are discarded otherwise); stderr is collected
 * (last 64 KiB) and returned. Never rejects on a non-zero exit: callers decide what a failure means.
 */
export function runFfmpeg(
  args: string[],
  opts: { onStdout?: (chunk: Buffer) => void } = {},
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => opts.onStdout?.(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 131072) stderr = stderr.slice(-65536);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

export function lastLines(text: string, n = 3): string {
  return text.trim().split('\n').slice(-n).join('\n');
}

export interface VideoProbe {
  /** Container duration in seconds (may include a longer audio track); null when ffmpeg prints N/A. */
  durationSec: number | null;
  /** Demuxer names, e.g. "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
  container: string;
  codec: string;
  pixFmt: string;
  /** Stored picture size. */
  codedWidth: number;
  codedHeight: number;
  /** Size as displayed: sample aspect ratio and rotation metadata applied. */
  width: number;
  height: number;
  /** Rotation metadata in degrees (0 when absent). */
  rotation: number;
  /** Average frame rate when ffmpeg reports one (falls back to tbr); null when unknown. */
  fps: number | null;
  /** ffmpeg's guess at the underlying constant frame rate ("tbr"); differs from fps for variable frame rate files. */
  tbr: number | null;
  hasAudio: boolean;
}

function parseRate(text: string, unit: 'fps' | 'tbr'): number | null {
  const m = new RegExp(`(\\d+(?:\\.\\d+)?)(k?) ${unit}\\b`).exec(text);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Remove (...) groups, including nested ones, so the remaining text can be split on commas. */
function stripParens(text: string): string {
  let out = text;
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/\([^()]*\)/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Facts about the first real video stream (cover art is skipped). Throws when there is none. */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostdin', '-i', file]);
  const lines = stderr.split('\n');
  const inputLine = lines.find((l) => l.startsWith('Input #0'));
  if (!inputLine) throw new Error(`ffmpeg could not read ${file}: ${lastLines(stderr, 2)}`);
  const container = /^Input #0, ([^,]+(?:,[^, ]+)*), from /.exec(inputLine)?.[1] ?? '';

  let durationSec: number | null = null;
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (dur) durationSec = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);

  const streamRe = /^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: (Video|Audio|Subtitle|Data|Attachment): (.*)$/;
  let video: { desc: string; rotation: number } | null = null;
  let current: 'video' | 'other' | null = null;
  let hasAudio = false;
  for (const line of lines) {
    if (line.startsWith('Output #') || line.startsWith('At least one output')) break;
    const m = streamRe.exec(line);
    if (m) {
      if (m[1] === 'Audio') hasAudio = true;
      if (m[1] === 'Video' && !video && !/\(attached pic\)/.test(m[2])) {
        video = { desc: m[2], rotation: 0 };
        current = 'video';
      } else {
        current = 'other';
      }
      continue;
    }
    if (current === 'video' && video) {
      const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(line) ?? /^\s*rotate\s*:\s*(-?\d+)/.exec(line);
      if (rot) video.rotation = Math.round(Number(rot[1]));
    }
  }
  if (!video) throw new Error(`no video stream in ${file}`);

  const tokens = stripParens(video.desc).split(',').map((t) => t.trim());
  const codec = tokens[0]?.split(/\s+/)[0] ?? '';
  const pixFmt = tokens[1]?.split(/\s+/)[0] ?? '';
  const sizeToken = tokens.find((t) => /^\d{1,5}x\d{1,5}\b/.test(t)) ?? '';
  const size = /^(\d{1,5})x(\d{1,5})/.exec(sizeToken);
  const codedWidth = size ? Number(size[1]) : 0;
  const codedHeight = size ? Number(size[2]) : 0;
  const sar = /SAR (\d+):(\d+)/.exec(video.desc);
  const sarValue = sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 ? Number(sar[1]) / Number(sar[2]) : 1;
  let width = Math.round(codedWidth * sarValue);
  let height = codedHeight;
  if (Math.abs(video.rotation) % 180 === 90) [width, height] = [height, width];

  return {
    durationSec,
    container,
    codec,
    pixFmt,
    codedWidth,
    codedHeight,
    width,
    height,
    rotation: video.rotation,
    fps: parseRate(video.desc, 'fps') ?? parseRate(video.desc, 'tbr'),
    tbr: parseRate(video.desc, 'tbr'),
    hasAudio,
  };
}
