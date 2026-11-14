import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { analyseMotion, analyseMotionSeries, detectCuts, type MotionAnalysis, type MotionSeries } from '../motion.ts';
import {
  strobeClip,
  bounceClip,
  busyClip,
  chirpClip,
  colorClip,
  cutsClip,
  flashClip,
  lateMotionClip,
  makeTempDir,
  noiseClip,
  pulseClip,
  removeDir,
  swayClip,
} from './helpers.ts';

let dir = '';
const file = (name: string) => path.join(dir, name);
const cache = new Map<string, Promise<MotionAnalysis>>();
/** Analyse a generated clip once and share the result between tests. */
function analysed(name: string): Promise<MotionAnalysis> {
  let job = cache.get(name);
  if (!job) {
    job = analyseMotion(file(name));
    cache.set(name, job);
  }
  return job;
}

/** Clips with an exactly known pulse: [file, bpm, time of the first pulse]. */
const PERIODIC: [string, number, number][] = [
  ['pulse120.mp4', 120, 0],
  ['pulse136.mp4', 136, 0.2],
  ['bounce90.mp4', 90, 0],
  ['sway75.mp4', 75, 0],
];
const ALL = [...PERIODIC.map(([name]) => name), 'cuts.mp4', 'busy.mp4', 'black.mp4', 'noise.mp4', 'chirp.mp4', 'flash.mp4', 'late.mp4', 'vertical90.mp4'];

/** Smallest distance from `bpm` to the true tempo, its half or its double. */
function octaveError(bpm: number, truth: number): number {
  return Math.min(Math.abs(bpm - truth), Math.abs(bpm - truth / 2), Math.abs(bpm - truth * 2));
}

/** Distance from time t to the nearest point of the grid first + k * period. */
function gridDistance(t: number, first: number, period: number): number {
  const m = (((t - first) % period) + period) % period;
  return Math.min(m, period - m);
}

before(async () => {
  dir = await makeTempDir('motion');
  await Promise.all([
    pulseClip(file('pulse120.mp4'), 120),
    pulseClip(file('pulse136.mp4'), 136, 0.2),
    pulseClip(file('pulse120-24fps.mp4'), 120, 0, { fps: 24 }),
    pulseClip(file('pulse100-60fps.mp4'), 100, 0, { fps: 60 }),
    bounceClip(file('bounce90.mp4'), 90),
    bounceClip(file('vertical90.mp4'), 90, { size: '180x320' }),
    swayClip(file('sway75.mp4'), 75),
    cutsClip(file('cuts.mp4'), [['red', 2], ['green', 1.5], ['blue', 2.5], ['0x808080', 2]]),
    busyClip(file('busy.mp4')),
    colorClip(file('black.mp4'), 'black', { seconds: 4 }),
    noiseClip(file('noise.mp4')),
    chirpClip(file('chirp.mp4')),
    flashClip(file('flash.mp4')),
    strobeClip(file('strobe.mp4')),
    lateMotionClip(file('late.mp4'), 3),
  ]);
});

after(async () => {
  await removeDir(dir);
});

describe('analyseMotion: output contract', () => {
  for (const name of ALL) {
    test(`shape and ranges: ${name}`, async () => {
      const a = await analysed(name);
      assert.equal(a.sampleRate, 30);
      const duration = a.curve.length / a.sampleRate;
      assert.ok(a.curve.length > 0);
      assert.ok(a.curve.every((v) => v >= 0 && v <= 1));
      assert.equal(a.perSecond.length, Math.ceil(duration));
      assert.ok(a.perSecond.every((v) => v >= 0 && v <= 1));
      assert.deepEqual(a.peaksSec, [...a.peaksSec].sort((x, y) => x - y));
      assert.ok(a.peaksSec.every((t) => t >= 0 && t <= duration));
      assert.ok(a.cuts.every((t) => t > 0 && t <= duration));
      assert.ok(a.periodSec === null || a.periodSec > 0);

      const c = a.tempo.candidates;
      assert.ok(c.length >= 3 && c.length <= 6, `${c.length} candidates`);
      assert.ok(c.every((x) => x.bpm >= 58.8 && x.bpm <= 183.6), JSON.stringify(c));
      assert.ok(c.every((x) => x.strength >= 0 && x.strength <= 1));
      assert.deepEqual(c.map((x) => x.strength), [...c.map((x) => x.strength)].sort((x, y) => y - x), 'sorted by strength');
      assert.ok(c.filter((x) => x.relation === 'base').length <= 1);
      assert.equal(new Set(c.map((x) => String(x.bpm))).size, c.length, 'bpm values are distinct');
      for (const cand of c) {
        const d = a.tempo.downbeats[String(cand.bpm)];
        assert.ok(Array.isArray(d) && d.length >= 2 && d.length <= 4, `downbeats for ${cand.bpm}: ${JSON.stringify(d)}`);
        assert.ok(d.every((x) => x.offsetSec >= 0 && x.offsetSec <= duration && x.strength >= 0 && x.strength <= 1));
      }
      assert.equal(Object.keys(a.tempo.downbeats).length, c.length);
      // The whole result must survive JSON (it is sent to the browser and into prompts).
      assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    });
  }
});

describe('analyseMotion: tempo', () => {
  for (const [name, bpm, firstPulse] of PERIODIC) {
    test(`${name}: finds ${bpm} BPM (or its half/double) as the strongest or second strongest`, async () => {
      const a = await analysed(name);
      const top2 = a.tempo.candidates.slice(0, 2);
      const hit = top2.find((c) => octaveError(c.bpm, bpm) <= 3);
      assert.ok(hit, `top two were ${JSON.stringify(top2)}`);
      assert.ok(hit.relation !== 'other');
      assert.ok(a.tempo.candidates[0].strength >= 0.6, `strongest is only ${a.tempo.candidates[0].strength}`);
      // Everything that is not octave-related to the truth is clearly weaker.
      for (const c of a.tempo.candidates) {
        if (octaveError(c.bpm, bpm) > 3) assert.ok(c.strength <= 0.7 * a.tempo.candidates[0].strength, JSON.stringify(a.tempo.candidates));
      }
    });

    test(`${name}: reports the repeating period`, async () => {
      const a = await analysed(name);
      assert.ok(a.periodSec !== null);
      const beat = 60 / bpm;
      const ratio = a.periodSec / beat;
      const nearest = [0.5, 1, 2, 4].reduce((x, y) => (Math.abs(Math.log(ratio / y)) < Math.abs(Math.log(ratio / x)) ? y : x));
      assert.ok(Math.abs(ratio / nearest - 1) < 0.025, `period ${a.periodSec}s is ${ratio.toFixed(3)} beats`);
    });

    test(`${name}: downbeat offsets sit on the pulse`, async () => {
      const a = await analysed(name);
      const cand = a.tempo.candidates.find((c) => Math.min(Math.abs(c.bpm - bpm), Math.abs(c.bpm - bpm / 2)) <= 3);
      assert.ok(cand, JSON.stringify(a.tempo.candidates));
      const offsets = a.tempo.downbeats[String(cand.bpm)];
      const best = offsets[0];
      assert.ok(best.strength > 0.2, JSON.stringify(offsets));
      assert.ok(gridDistance(best.offsetSec, firstPulse, 60 / bpm) <= 0.08, `offset ${best.offsetSec}s vs pulses at ${firstPulse} + k*${(60 / bpm).toFixed(3)}`);
      assert.ok(best.offsetSec < (4 * 60) / cand.bpm + 1e-6, 'first downbeat lies within the first bar');
    });
  }

  test('a small subject on a static background registers: its pulses are the motion peaks', async () => {
    const a = await analysed('pulse120.mp4'); // the disc covers a few percent of the frame
    assert.ok(Math.max(...a.curve) >= 0.9);
    let matched = 0;
    for (let beat = 0.5; beat < 9.9; beat += 0.5) if (a.peaksSec.some((p) => Math.abs(p - beat) <= 0.07)) matched++;
    assert.ok(matched >= 15, `only ${matched} of 19 pulses are among the peaks ${JSON.stringify(a.peaksSec)}`);
    assert.ok(a.peaksSec.every((p) => gridDistance(p, 0, 0.5) <= 0.07), 'no peaks between pulses');
  });

  test('source frame rate decides the analysis rate (24 fps stays 24, 60 fps is halved)', async () => {
    const a24 = await analyseMotion(file('pulse120-24fps.mp4'));
    assert.equal(a24.sampleRate, 24);
    assert.ok(octaveError(a24.tempo.candidates[0].bpm, 120) <= 3, JSON.stringify(a24.tempo.candidates));
    const a60 = await analyseMotion(file('pulse100-60fps.mp4'));
    assert.equal(a60.sampleRate, 30);
    assert.ok(octaveError(a60.tempo.candidates[0].bpm, 100) <= 3, JSON.stringify(a60.tempo.candidates));
  });

  test('sampleRate option', async () => {
    const a = await analyseMotion(file('pulse120.mp4'), { sampleRate: 25 });
    assert.equal(a.sampleRate, 25);
    assert.equal(a.curve.length, 250);
    assert.ok(octaveError(a.tempo.candidates[0].bpm, 120) <= 3, JSON.stringify(a.tempo.candidates));
    await assert.rejects(analyseMotion(file('pulse120.mp4'), { sampleRate: 0 }));
  });

  test('vertical clip', async () => {
    const a = await analysed('vertical90.mp4');
    assert.ok(octaveError(a.tempo.candidates[0].bpm, 90) <= 3, JSON.stringify(a.tempo.candidates));
    assert.deepEqual(a.cuts, []);
  });

  for (const name of ['noise.mp4', 'chirp.mp4', 'late.mp4']) {
    test(`${name}: aperiodic motion gets no period and only low strengths`, async () => {
      const a = await analysed(name);
      assert.equal(a.periodSec, null);
      assert.ok(a.tempo.candidates.every((c) => c.strength < 0.2), JSON.stringify(a.tempo.candidates));
      assert.ok(a.tempo.candidates.filter((c) => c.relation === 'other').length >= 2, 'neutral fallbacks are offered');
      assert.ok(Math.max(...a.curve) > 0.5, 'there is motion');
    });
  }
});

describe('analyseMotion: cuts', () => {
  test('hard cuts between differently coloured scenes are found within 0.2 s, and nothing else', async () => {
    const a = await analysed('cuts.mp4');
    const expected = [2, 3.5, 6]; // red -> green has almost no brightness change
    assert.equal(a.cuts.length, expected.length, JSON.stringify(a.cuts));
    expected.forEach((t, i) => assert.ok(Math.abs(a.cuts[i] - t) <= 0.2, `cut ${i} at ${a.cuts[i]}, expected ${t}`));
    // Cut frames are not motion: no peak on a cut, and the curve is not saturated there.
    for (const t of expected) {
      assert.ok(a.peaksSec.every((p) => Math.abs(p - t) > 0.04), `peak on the cut at ${t}`);
      assert.ok(a.curve[Math.round(t * a.sampleRate)] < 0.9);
    }
  });

  for (const name of ['pulse120.mp4', 'pulse136.mp4', 'bounce90.mp4', 'sway75.mp4', 'busy.mp4', 'noise.mp4', 'chirp.mp4', 'late.mp4']) {
    test(`${name}: no false cuts`, async () => {
      assert.deepEqual((await analysed(name)).cuts, []);
    });
  }

  test('a full-frame flash that fades back is not a cut', async () => {
    const a = await analysed('flash.mp4');
    assert.deepEqual(a.cuts, []);
    for (const t of [1, 2.5, 4, 5.5]) assert.ok(a.peaksSec.some((p) => Math.abs(p - t) <= 0.1), `flash at ${t} missing from ${JSON.stringify(a.peaksSec)}`);
  });
});

describe('analyseMotion: cuts (strobe)', () => {
  test('a large panel switching on for a few frames and off again is not a pair of cuts', async () => {
    const a = await analysed('strobe.mp4');
    assert.deepEqual(a.cuts, []);
    assert.ok(a.peaksSec.length >= 4, JSON.stringify(a.peaksSec));
  });
});

describe('analyseMotion: energy', () => {
  test('black clip: near-zero motion, no cuts, no peaks, low tempo strengths', async () => {
    const a = await analysed('black.mp4');
    assert.equal(a.curve.length, 120);
    assert.ok(Math.max(...a.curve) <= 0.02);
    assert.deepEqual(a.perSecond, [0, 0, 0, 0]);
    assert.deepEqual(a.cuts, []);
    assert.deepEqual(a.peaksSec, []);
    assert.equal(a.periodSec, null);
    assert.ok(a.tempo.candidates.every((c) => c.strength <= 0.15 && c.relation === 'other'), JSON.stringify(a.tempo.candidates));
    // Calm footage -> slow neutral suggestions.
    assert.ok(a.tempo.candidates[0].bpm <= 80);
  });

  test('perSecond follows where the motion is', async () => {
    const a = await analysed('late.mp4'); // still for 3 s, then a box slides for 3 s
    assert.equal(a.perSecond.length, 6);
    assert.ok(a.perSecond.slice(0, 3).every((v) => v <= 0.02), JSON.stringify(a.perSecond));
    assert.ok(a.perSecond.slice(3).every((v) => v >= 0.3), JSON.stringify(a.perSecond));
  });

  test('livelier footage gets faster neutral fallbacks than calm footage', async () => {
    const calm = (await analysed('black.mp4')).tempo.candidates.find((c) => c.relation === 'other');
    const lively = (await analysed('noise.mp4')).tempo.candidates.find((c) => c.relation === 'other');
    assert.ok(calm && lively && lively.bpm > calm.bpm, `${calm?.bpm} vs ${lively?.bpm}`);
  });
});

// ---------------------------------------------------------------------------------------------
// Pure signal tests (no video)
// ---------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seriesFrom(global: Float32Array, rate = 30, regions?: Float32Array[]): MotionSeries {
  const n = global.length;
  return {
    rate,
    length: n,
    global,
    top: global.map((v) => Math.min(1, v * 3)),
    coverage: new Float32Array(n).fill(0.1),
    hist: new Float32Array(n).fill(0.01),
    persist: new Float32Array(0),
    novelty: new Float32Array(0),
    regions: regions ?? Array.from({ length: 16 }, () => Float32Array.from(global)),
    signed: [],
  };
}

/** Random motion energy; `red` in [0,1) makes it wander slowly instead of jumping. */
function noiseSeries(seed: number, seconds: number, red: number): MotionSeries {
  const r = rng(seed);
  const n = seconds * 30;
  const make = () => {
    const x = new Float32Array(n);
    let v = 0.5;
    for (let i = 1; i < n; i++) {
      v = red * v + (1 - red) * r();
      x[i] = 0.01 + 0.05 * Math.max(0, v + (1 - red) * (r() - 0.5));
    }
    return x;
  };
  return seriesFrom(make(), 30, Array.from({ length: 16 }, make));
}

describe('analyseMotionSeries', () => {
  test('random energy is almost never called periodic', () => {
    let falsePositives = 0;
    let runs = 0;
    for (const [seconds, red] of [[12, 0], [12, 0.8], [60, 0], [60, 0.8], [60, 0.95]] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const a = analyseMotionSeries(noiseSeries(seed * 31 + seconds, seconds, red));
        runs++;
        if (a.periodSec !== null) {
          falsePositives++;
          assert.ok(a.tempo.candidates[0].strength < 0.45, `a false positive must at least be weak: ${JSON.stringify(a.tempo.candidates[0])}`);
        }
      }
    }
    assert.ok(falsePositives <= 4, `${falsePositives} of ${runs} random series were called periodic`);
  });

  test('a clean pulse train is found to within 1 BPM', () => {
    for (const bpm of [72, 100, 128, 150, 174]) {
      const n = 30 * 30;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const phase = ((i / 30) * bpm) / 60;
        x[i] = 0.005 + 0.08 * Math.exp(-8 * (phase - Math.floor(phase)));
      }
      const a = analyseMotionSeries(seriesFrom(x));
      const best = a.tempo.candidates[0];
      assert.ok(octaveError(best.bpm, bpm) <= 1, `${bpm}: ${JSON.stringify(a.tempo.candidates)}`);
      assert.ok(best.strength >= 0.8);
    }
  });

  test('duplicated frames (exact zeros between motion) do not create a tempo of their own', () => {
    // 100 BPM motion sampled at 30 Hz from a 24 fps source: every fifth difference is exactly zero,
    // which on its own would be a 360/min pattern (and 180, 120, 90, 72 as sub-multiples).
    const n = 20 * 30;
    const x = new Float32Array(n);
    for (let i = 1; i < n; i++) x[i] = i % 5 === 0 ? 0 : 0.01 + 0.06 * Math.sin((Math.PI * (i / 30) * 100) / 60) ** 2;
    const a = analyseMotionSeries(seriesFrom(x));
    assert.ok(octaveError(a.tempo.candidates[0].bpm, 100) <= 3, JSON.stringify(a.tempo.candidates));
    assert.ok(Math.min(...a.curve.slice(5, 50)) > 0 || a.curve.slice(5, 50).filter((v) => v === 0).length <= 2, 'zeros are bridged');
  });

  test('detectCuts: an isolated whole-frame change is a cut; sustained fast motion is not', () => {
    const n = 300;
    const base = new Float32Array(n).fill(0.01);
    // Sustained fast motion from sample 100 to 140, as large as the cut itself.
    for (let i = 100; i < 140; i++) base[i] = 0.15;
    base[200] = 0.15; // the cut
    const s = seriesFrom(base);
    s.coverage = base.map((v) => (v > 0.1 ? 0.8 : 0.1));
    s.hist = base.map((v, i) => (i === 200 ? 0.6 : v > 0.1 ? 0.08 : 0.01));
    assert.deepEqual(detectCuts(s), [200]);
    const a = analyseMotionSeries(s);
    assert.deepEqual(a.cuts, [round3(200 / 30)]);
    assert.ok(a.curve[200] < 0.3, 'the cut frame is taken out of the motion curve');
    assert.ok(a.curve[120] > 0.9);
  });

  test('a one-sample series does not throw', () => {
    const a = analyseMotionSeries(seriesFrom(new Float32Array(1)));
    assert.equal(a.curve.length, 1);
    assert.equal(a.periodSec, null);
    assert.ok(a.tempo.candidates.length >= 3);
  });
});

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
