// Body tracking: runs the MediaPipe Pose sidecar (tools/pose/track.py) over a clip and caches the
// joints it finds. Python and its packages are fetched and isolated by `uv`; nothing is installed
// system-wide. The model file ships in assets/models.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoseData } from './beat.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'tools/pose/track.py');
const MODEL = join(ROOT, 'assets/models/pose_landmarker_full.task');

export class PoseUnavailable extends Error {}

/**
 * Track the bodies in a video. `cacheFile` is where the result is kept (a second call returns it
 * at once). Throws PoseUnavailable with a plain reason when tracking cannot run on this machine.
 */
export async function trackPose(videoPath: string, cacheFile: string, onProgress?: (done: number, total: number) => void): Promise<PoseData> {
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8')) as PoseData;
  if (!existsSync(MODEL)) throw new PoseUnavailable(`body-tracking model missing: ${MODEL}`);
  mkdirSync(dirname(cacheFile), { recursive: true });
  const args = ['run', '-q', '--python', '3.12', '--with', 'mediapipe', '--with', 'opencv-python-headless', 'python', '-I', SCRIPT, videoPath, cacheFile, '--model', MODEL, '--people', '6'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('uv', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const text = String(chunk);
      err = (err + text).slice(-4000);
      const m = /(\d+)\/(\d+)\s*$/m.exec(text.trim());
      if (m && onProgress) onProgress(Number(m[1]), Number(m[2]));
    });
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(new PoseUnavailable(e.code === 'ENOENT' ? 'body tracking needs `uv` (https://docs.astral.sh/uv/) on the PATH' : `could not start body tracking: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0 && existsSync(cacheFile)) resolve();
      else reject(new PoseUnavailable(`body tracking failed (exit ${code}): ${err.split('\n').filter((l) => l.trim() && !/^[WI]0000|Sparsity|INFO:/.test(l)).slice(-3).join(' | ')}`));
    });
  });
  return JSON.parse(readFileSync(cacheFile, 'utf8')) as PoseData;
}
