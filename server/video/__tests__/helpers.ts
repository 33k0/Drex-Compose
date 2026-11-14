// Synthetic test clips, generated with ffmpeg's lavfi sources into a temp directory (no downloads).

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFfmpeg } from '../ffmpeg.ts';

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `choreo-${prefix}-`));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];

/** Run ffmpeg with the given arguments (output path last); throws with ffmpeg's message on failure. */
export async function ffmpeg(args: string[]): Promise<void> {
  const res = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  if (res.code !== 0) throw new Error(`ffmpeg failed (${res.code}): ${res.stderr.trim()}\nargs: ${args.join(' ')}`);
}

async function lavfi(out: string, graph: string, extra: string[] = X264): Promise<string> {
  await ffmpeg(['-f', 'lavfi', '-i', graph, ...extra, out]);
  return out;
}

export interface SynthOptions {
  seconds?: number;
  fps?: number;
  size?: string;
}

/**
 * A disc that pops to a larger radius exactly on every beat and shrinks back before the next one.
 * Beats are at offsetSec + k * 60 / bpm.
 */
export function pulseClip(out: string, bpm: number, offsetSec = 0, o: SynthOptions = {}): Promise<string> {
  const { seconds = 10, fps = 30, size = '160x90' } = o;
  const [w, h] = size.split('x').map(Number);
  const phase = `mod((T-${offsetSec})*${bpm}/60+1000,1)`;
  const radius = `${h * 0.1}+${h * 0.14}*exp(-5*${phase})`;
  return lavfi(out, `color=c=black:s=${size}:r=${fps}:d=${seconds},geq=lum='if(lt(hypot(X-${w / 2},Y-${h / 2}),${radius}),235,40)':cb=128:cr=128`);
}

/** A box that drops to the floor and bounces: it touches the floor exactly on every beat (k * 60 / bpm). */
export function bounceClip(out: string, bpm: number, o: SynthOptions = {}): Promise<string> {
  const { seconds = 10, fps = 30, size = '320x180' } = o;
  return lavfi(
    out,
    `color=c=0x202830:s=${size}:r=${fps}:d=${seconds}[bg];color=c=white:s=24x24:r=${fps}:d=${seconds}[box];[bg][box]overlay=x=148:y='140-110*abs(sin(PI*t*${bpm}/60))'`,
  );
}

/**
 * A box swaying left-right: it crosses the centre at full speed on every beat (k * 60 / bpm) and stops at the
 * extremes half-way between beats; a full cycle takes two beats.
 */
export function swayClip(out: string, bpm: number, o: SynthOptions = {}): Promise<string> {
  const { seconds = 10, fps = 30, size = '320x180' } = o;
  return lavfi(
    out,
    `color=c=0x203020:s=${size}:r=${fps}:d=${seconds}[bg];color=c=0xf0d020:s=30x60:r=${fps}:d=${seconds}[box];[bg][box]overlay=x='145+100*sin(PI*t*${bpm}/60)':y=60`,
  );
}

/**
 * Differently coloured scenes joined by hard cuts, with a small box moving throughout so there is ordinary
 * motion as well. `scenes` = [colour, seconds][]; cuts fall at the cumulative durations.
 */
export function cutsClip(out: string, scenes: [string, number][], o: SynthOptions = {}): Promise<string> {
  const { fps = 30, size = '320x180' } = o;
  const total = scenes.reduce((a, [, d]) => a + d, 0);
  const parts = scenes.map(([c, d], i) => `color=c=${c}:s=${size}:r=${fps}:d=${d}[s${i}]`).join(';');
  const labels = scenes.map((_, i) => `[s${i}]`).join('');
  return lavfi(
    out,
    `${parts};${labels}concat=n=${scenes.length}:v=1:a=0[bg];color=c=white:s=20x20:r=${fps}:d=${total}[box];[bg][box]overlay=x='150+120*sin(2*PI*t*0.37)':y='80+60*sin(2*PI*t*0.23+1)'`,
  );
}

/** A large box moving fast and irregularly for the whole clip: sustained strong motion, no cuts. */
export function busyClip(out: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 8, fps = 30, size = '320x180' } = o;
  return lavfi(
    out,
    `testsrc2=s=${size}:r=${fps}:d=${seconds}[bg];color=c=0xe04040:s=140x110:r=${fps}:d=${seconds}[box];[bg][box]overlay=x='90+85*sin(2*PI*t*1.31)+20*sin(2*PI*t*3.7)':y='35+30*sin(2*PI*t*1.93+1)+15*sin(2*PI*t*4.3)'`,
  );
}

export function colorClip(out: string, color: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 4, fps = 30, size = '320x180' } = o;
  return lavfi(out, `color=c=${color}:s=${size}:r=${fps}:d=${seconds}`);
}

/** Fresh random noise on every frame: lots of change, no rhythm. */
export function noiseClip(out: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 10, fps = 30, size = '160x90' } = o;
  return lavfi(out, `color=c=gray:s=${size}:r=${fps}:d=${seconds},noise=alls=60:allf=t+u`);
}

/**
 * A box swinging left-right faster and faster (0.5 Hz rising to about 3 Hz over ten seconds): plenty of
 * motion, but no steady tempo.
 */
export function chirpClip(out: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 10, fps = 30, size = '320x180' } = o;
  return lavfi(
    out,
    `color=c=0x302020:s=${size}:r=${fps}:d=${seconds}[bg];color=c=0x40c0f0:s=30x60:r=${fps}:d=${seconds}[box];[bg][box]overlay=x='145+100*sin(2*PI*(0.5*t+0.125*t*t))':y=60`,
  );
}

/** Detailed moving test pattern (used for size checks and odd-input cases). */
export function patternClip(out: string, o: SynthOptions & { codecArgs?: string[]; audio?: boolean } = {}): Promise<string> {
  const { seconds = 3, fps = 30, size = '640x360', codecArgs = X264, audio = false } = o;
  const inputs = ['-f', 'lavfi', '-i', `testsrc2=s=${size}:r=${fps}:d=${seconds}`];
  if (audio) inputs.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  return ffmpeg([...inputs, ...codecArgs, ...(audio ? ['-c:a', 'aac', '-shortest'] : []), out]).then(() => out);
}

/** The whole frame flashes bright every 1.5 s (at 1.0, 2.5, 4.0 ...) and fades back within about 0.3 s. */
export function flashClip(out: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 6, fps = 30, size = '160x90' } = o;
  return lavfi(out, `color=c=black:s=${size}:r=${fps}:d=${seconds},geq=lum='60+170*exp(-10*mod(T+0.5,1.5))*gte(T,0.9)':cb=128:cr=128`);
}

/** Nothing moves for `stillSeconds`, then a box slides across for the rest of the clip. */
export function lateMotionClip(out: string, stillSeconds: number, o: SynthOptions = {}): Promise<string> {
  const { seconds = 6, fps = 30, size = '320x180' } = o;
  return lavfi(
    out,
    `color=c=0x202830:s=${size}:r=${fps}:d=${seconds}[bg];color=c=white:s=40x40:r=${fps}:d=${seconds}[box];[bg][box]overlay=x='if(lt(t,${stillSeconds}),20,20+80*(t-${stillSeconds}))':y=70`,
  );
}

/** Half of the frame switches abruptly to another colour for four frames once a second, then abruptly back. */
export function strobeClip(out: string, o: SynthOptions = {}): Promise<string> {
  const { seconds = 6, fps = 30, size = '160x90' } = o;
  const [w] = size.split('x').map(Number);
  return lavfi(out, `color=c=black:s=${size}:r=${fps}:d=${seconds},geq=lum='if(lt(X,${w / 2})*lt(mod(T+0.5,1),${3.5 / fps}),220,50)':cb='if(lt(X,${w / 2})*lt(mod(T+0.5,1),${3.5 / fps}),90,128)':cr=128`);
}
