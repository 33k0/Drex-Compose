// The movement-only beat tracker: synthetic bodies with a known beat, and the real dance clip
// graded against reference beats measured from its soundtrack.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyseBeat, CLEAR_CONFIDENCE, findLandings, gridAccuracy, gridBeats, LANDING_LAG_SEC, type PoseData } from '../video/beat.ts';
import { mulberry32 } from '../core/rng.ts';

const JOINTS = ['nose', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle'];
const REST: [number, number][] = [[0.5, 0.2], [0.45, 0.3], [0.55, 0.3], [0.42, 0.4], [0.58, 0.4], [0.4, 0.5], [0.6, 0.5], [0.47, 0.55], [0.53, 0.55], [0.47, 0.7], [0.53, 0.7], [0.47, 0.85], [0.53, 0.85]];

/**
 * A stick figure that bounces: it drops and lands exactly `lagSec` after each beat of `bpm`
 * during [from, to), stands still otherwise, with tracking jitter on every joint.
 */
function bouncer(opts: { bpm: number; seconds: number; fps?: number; from?: number; to?: number; firstBeat?: number; lagSec?: number; jitter?: number; seed?: number; random?: boolean }): PoseData {
  const { bpm, seconds, fps = 30, from = 0, to = seconds, firstBeat = 0.2, lagSec = LANDING_LAG_SEC, jitter = 0.002, seed = 1, random = false } = opts;
  const rng = mulberry32(seed);
  const period = 60 / bpm;
  let wander = 0;
  const frames = Array.from({ length: Math.round(seconds * fps) }, (_x, i) => {
    const t = i / fps;
    let drop = 0;
    if (random) {
      wander += (rng() - 0.5) * 0.02;
      wander *= 0.9;
      drop = wander;
    } else if (t >= from && t < to) {
      // Lowest point (largest y) exactly at the landing time; a rounded bounce in between.
      const phase = (((t - firstBeat - lagSec) / period) % 1 + 1) % 1;
      drop = 0.03 * Math.cos(2 * Math.PI * phase);
    }
    return { t, people: [REST.map(([x, y]) => [x + (rng() - 0.5) * jitter, y + drop + (rng() - 0.5) * jitter, 1])] };
  });
  return { fps, joints: JOINTS, frames };
}

test('finds the tempo and the beat of a bouncing body', () => {
  for (const bpm of [96, 118.5, 131, 150]) {
    const pose = bouncer({ bpm, seconds: 60, firstBeat: 0.2 });
    const beat = analyseBeat(pose, 16 / 9);
    const top = beat.candidates[0];
    assert.ok(Math.abs(top.bpm - bpm) < 0.15, `${bpm} BPM: got ${top.bpm}`);
    assert.ok(beat.confidence >= CLEAR_CONFIDENCE, `confidence ${beat.confidence}`);
    const period = 60 / bpm;
    const off = (((top.firstBeatSec - 0.2 + period / 2) % period) + period) % period - period / 2;
    assert.ok(Math.abs(off) < 0.03, `${bpm} BPM: first beat ${top.firstBeatSec} is ${Math.round(off * 1000)} ms from the true beat`);
    assert.ok(beat.candidates.some((c) => c.relation === 'half' && Math.abs(c.bpm - bpm / 2) < 1) || bpm / 2 < 55, 'half time is offered');
  }
});

test('a grid fitted to the whole clip carries through a stretch where nobody dances', () => {
  // Dancing for 30 s, standing still for 30 s, dancing again for 30 s: same tempo, same phase.
  const a = bouncer({ bpm: 124, seconds: 90, from: 0, to: 30 });
  const b = bouncer({ bpm: 124, seconds: 90, from: 60, to: 90, seed: 2 });
  const pose: PoseData = { ...a, frames: a.frames.map((f, i) => (i / a.fps >= 45 ? b.frames[i] : f)) };
  const beat = analyseBeat(pose, 16 / 9);
  assert.ok(Math.abs(beat.candidates[0].bpm - 124) < 0.1, `got ${beat.candidates[0].bpm}`);
  const still = beat.stretches.filter((s) => s.startSec >= 30 && s.endSec <= 60);
  assert.ok(still.length > 0 && still.every((s) => !s.clear), 'the still stretch is marked unclear');
  assert.ok(beat.stretches.some((s) => s.clear && s.endSec <= 30) && beat.stretches.some((s) => s.clear && s.startSec >= 60), 'both dancing stretches are clear');
  // The grid is still right at the very end of the clip.
  const grid = gridBeats(beat.candidates[0].bpm, beat.candidates[0].firstBeatSec, 90);
  const truth = Array.from({ length: 50 }, (_x, k) => 0.2 + (120 + k) * (60 / 124)).filter((t) => t < 90);
  assert.ok(gridAccuracy(grid, truth, 0.04).within > 0.95, 'beats in the last stretch are on the grid');
});

test('movement with no beat in it is reported as unclear, not given a confident tempo', () => {
  for (const seed of [1, 2, 3]) {
    const beat = analyseBeat(bouncer({ bpm: 120, seconds: 60, random: true, seed }), 16 / 9);
    assert.ok(beat.confidence < CLEAR_CONFIDENCE, `seed ${seed}: confidence ${beat.confidence}`);
  }
  const empty: PoseData = { fps: 30, joints: JOINTS, frames: Array.from({ length: 300 }, (_x, i) => ({ t: i / 30, people: [] })) };
  const none = analyseBeat(empty, 16 / 9);
  assert.equal(none.candidates.length, 0);
  assert.equal(none.confidence, 0);
  assert.equal(findLandings(empty, 16 / 9).landings.length, 0);
});

const truthDir = new URL('../../eval/ground-truth/firestarter-choreo/', import.meta.url);
test('on the real dance clip, the grid from movement alone lands on the true beats', { skip: existsSync(new URL('pose.json', truthDir)) ? false : 'no ground-truth pose file' }, () => {
  const pose = JSON.parse(readFileSync(new URL('pose.json', truthDir), 'utf8')) as PoseData;
  const truth = JSON.parse(readFileSync(new URL('beats.json', truthDir), 'utf8')) as { aspect: number; beatTimes: number[] };
  const beat = analyseBeat(pose, truth.aspect);
  const top = beat.candidates[0];
  assert.ok(Math.abs(top.bpm - 131) < 0.2, `tempo ${top.bpm}`);
  assert.equal(top.relation, 'base');
  assert.ok(beat.confidence >= 0.8);
  const reference = truth.beatTimes.filter((t) => t > 8 && t < 180);
  const acc = gridAccuracy(gridBeats(top.bpm, top.firstBeatSec, pose.frames.length / pose.fps), reference, 0.07);
  assert.ok(acc.within > 0.85, `only ${Math.round(acc.within * 100)}% of true beats within 70 ms`);
  assert.ok(Math.abs(acc.meanOffsetMs) < 30, `grid sits ${acc.meanOffsetMs} ms off the beat`);
  assert.ok(Math.abs(acc.driftMs) < 40, `drift ${acc.driftMs} ms over the clip`);
});
