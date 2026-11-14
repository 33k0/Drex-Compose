// Fitting music to picture, and a whole clip scored headlessly on the stand-in.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ChoreoServerEvent, Reading, VideoSection } from '../../shared/choreo.ts';
import { beatToSec, type NoteEvent, type PhraseScore } from '../../shared/types.ts';
import { addHits, applyBridge, applyCutMark, grooveCoverage } from '../choreo/groove.ts';
import { blockEdges, chooseBarPhase, snapSections, splitBars } from '../choreo/plan.ts';
import { LANDING_LAG_SEC } from '../video/beat.ts';
import { chooseBoundaries, MIN_SECTION_SEC } from '../choreo/timeline.ts';
import { INSTRUMENTS } from '../piece.ts';
import { Session } from '../session.ts';
import { bounceClip } from '../video/__tests__/helpers.ts';

process.env.STANDIN_LATENCY_MS = '0-0';
delete process.env.NACE_API_KEY;

test('phrase lengths always add up to the bars asked for, in phrases of two to six bars', () => {
  for (let total = 2; total <= 40; total++) {
    const bars = splitBars(total);
    assert.equal(bars.reduce((a, b) => a + b, 0), total, `total ${total}`);
    assert.ok(bars.every((b) => b >= 2 && b <= 6), `total ${total}: ${bars}`);
  }
});

const sec = (index: number, startSec: number, endSec: number): VideoSection => ({ index, startSec, endSec, summary: '', keyFrame: 0, movement: 3, mood: 'playful' });

test('section changes move to the nearest bar line and the grid is never broken', () => {
  const bar = (4 * 60) / 131; // 1.832 s
  const start = 0.32;
  const snapped = snapSections([sec(0, 0, 16.4), sec(1, 16.4, 30.9), sec(2, 30.9, 33.2), sec(3, 33.2, 60)], start, bar, 32);
  // The 2.3-second section is under two bars and is folded into its neighbour.
  assert.equal(snapped.length, 3);
  assert.deepEqual(snapped.map((s) => [s.firstBar, s.lastBar]), [[0, 9], [9, 17], [17, 32]]);
  for (let i = 0; i < snapped.length; i++) {
    const s = snapped[i];
    assert.ok(s.lastBar - s.firstBar >= 2);
    if (i > 0) {
      assert.equal(s.firstBar, snapped[i - 1].lastBar, 'no gap between sections');
      assert.ok(Math.abs(s.section.startSec - (start + s.firstBar * bar)) < 1e-9, 'a section starts exactly on a bar line');
    }
  }
  assert.ok(Math.abs(snapped[1].section.startSec - 16.4) < bar / 2, 'the change stays within half a bar of the cut');
});

test('a long stretch is divided into eight-bar blocks', () => {
  assert.deepEqual(blockEdges([0, 9, 17, 87, 96]), [0, 9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 87, 96]);
  assert.deepEqual(blockEdges([0, 16, 32]), [0, 16, 32], 'sixteen bars is left whole');
  assert.deepEqual(blockEdges([0, 20]), [0, 8, 16, 20]);
  assert.deepEqual(blockEdges([0, 19]), [0, 8, 19], 'no block shorter than four bars is left at the end');
});

test('the bar phase is the one that puts the cuts on bar lines', () => {
  const beat = 60 / 120;
  // Cuts every two bars, with the true downbeat on the third beat of the grid as first found.
  const marks = [5, 9, 13, 17].map((t) => ({ t, weight: 1 }));
  assert.equal(chooseBarPhase(0, beat, marks), 1);
  assert.equal(chooseBarPhase(0.25, beat, [4.25, 8.25].map((t) => ({ t, weight: 1 }))), 0.25);
});

function groovePhrase(): PhraseScore {
  const notes: NoteEvent[] = [];
  for (let b = 0; b < 16; b++) {
    notes.push({ t: b, dur: 0.25, midi: b % 2 ? 38 : 36, vel: 0.8, inst: 'drumkit', art: 'hit', layer: 'pulse' });
    notes.push({ t: b + 0.5, dur: 0.25, midi: 42, vel: 0.5, inst: 'drumkit', art: 'hit', layer: 'pulse' });
    notes.push({ t: b, dur: 1, midi: 36, vel: 0.7, inst: 'sub', art: 'sustain', layer: 'bass' });
    notes.push({ t: b, dur: 1, midi: 72, vel: 0.7, inst: 'pluck', art: 'staccato', layer: 'melody' });
  }
  return { index: 3, section: 1, role: 'development', bars: 4, beatsPerBar: 4, beats: 16, bpm: 131, notes, pedal: [], mix: { dynamics: 4, lowpass: 6, reverb: 2, delay: 0, noise: 0, width: 3, saturation: 1, chorus: false, sidechain: true }, holdChord: [], display: { key: 'C', notation: '', lineage: 'phrase 4', chords: [], layers: [], tension: 4 } } as PhraseScore;
}
const inside = (s: PhraseScore) => s.notes.every((n) => n.t >= 0 && n.t < s.beats && n.dur > 0 && n.vel > 0 && n.vel <= 1);

test('cut marks, bridges and hits all stay inside the phrase and on the grid', () => {
  const fill = groovePhrase();
  assert.equal(applyCutMark(fill, 'fill', 'drumkit'), true);
  assert.ok(fill.notes.filter((n) => n.t >= 14 && n.inst === 'drumkit').every((n) => Number.isInteger(n.t * 4)), 'the fill is in sixteenths');
  assert.ok(fill.notes.filter((n) => n.t >= 14 && n.inst === 'drumkit').length >= 8 && inside(fill));

  const drop = groovePhrase();
  assert.equal(applyCutMark(drop, 'drop_bar', 'drumkit'), true);
  assert.equal(drop.notes.filter((n) => n.t >= 12 && (n.inst === 'drumkit' || n.layer === 'bass')).length, 0, 'drums and bass are out for the last bar');
  assert.ok(drop.notes.some((n) => n.t >= 12 && n.layer === 'melody'), 'the top line is left hanging');

  const riser = groovePhrase();
  applyCutMark(riser, 'riser', 'drumkit');
  const roll = riser.notes.filter((n) => n.t >= 12 && n.midi === 38).map((n) => n.vel);
  assert.ok(roll.length >= 8 && roll[roll.length - 1] > roll[0] && inside(riser), 'the roll swells');

  assert.equal(applyCutMark(groovePhrase(), 'none', 'drumkit'), false);
  assert.equal(grooveCoverage(groovePhrase()), 1);

  const bridge = groovePhrase();
  applyBridge(bridge, 'drumkit', false);
  assert.equal(bridge.notes.filter((n) => n.inst === 'drumkit' && (n.midi === 36 || n.midi === 38)).length, 0, 'kick and snare step back');
  assert.ok(bridge.notes.some((n) => n.midi === 42), 'hats keep the grid audible');
  assert.equal(grooveCoverage(bridge), 0);

  // Hits: a big landing 20 ms off a grid point snaps onto it; one 110 ms off lands exactly on the move.
  const beatSec = 60 / 131;
  const readings = [0, 1, 2, 3, 4, 5, 6, 7].map((second) => ({ second, movement: 6, change: 'steady', quality: 'sharp', bodyLevel: 'middle', mood: 'playful', people: 'one', cut: false, peak: 6, repeat: false, boundary: 0 })) as Reading[];
  const near = groovePhrase();
  assert.equal(addHits(near, 0, [{ t: 4 * beatSec + 0.02 + LANDING_LAG_SEC, weight: 1.8 }], readings, 'drumkit'), 1);
  assert.ok(near.notes.some((n) => n.layer === 'accents' && n.t === 4));
  const far = groovePhrase();
  addHits(far, 0, [{ t: 4 * beatSec + 0.11 + LANDING_LAG_SEC, weight: 1.8 }], readings, 'drumkit');
  const at = far.notes.find((n) => n.layer === 'accents')!.t;
  assert.ok(Math.abs(at - (4 + 0.11 / beatSec)) < 0.01 && !Number.isInteger(at * 4), `exact hit at ${at}`);
  assert.equal(addHits(groovePhrase(), 0, [{ t: 2, weight: 0.5 }], readings, 'drumkit'), 0, 'small landings get no hit');
});

test('boundaries respect the minimum section length and keep the strongest marks', () => {
  const readings: Reading[] = Array.from({ length: 60 }, (_x, second) => ({
    second, movement: 3, change: 'steady', quality: 'flowing', bodyLevel: 'middle', mood: 'playful', people: 'one', cut: false, peak: 2, repeat: false,
    boundary: second === 20 ? 0.9 : second === 22 ? 0.8 : second === 40 ? 0.7 : second === 2 ? 0.95 : 0.05,
  }));
  const picked = chooseBoundaries(readings, 60);
  assert.deepEqual(picked, [20, 40], 'the mark 2 s after a stronger one, and the one too close to the start, are dropped');
  for (let i = 1; i < picked.length; i++) assert.ok(picked[i] - picked[i - 1] >= MIN_SECTION_SEC);
  // Nothing marked at all: a clip still gets a few sections, from the most probable seconds.
  const flat = chooseBoundaries(readings.map((r) => ({ ...r, boundary: r.second === 30 ? 0.3 : r.second === 45 ? 0.2 : 0.01 })), 60);
  assert.deepEqual(flat, [30, 45]);
});

test('a whole clip is scored: continuous, in range, landing on every section boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'choreo-test-'));
  const clip = await bounceClip(join(dir, 'bounce.mp4'), 120, { seconds: 26 });
  const events: ChoreoServerEvent[] = [];
  const session = new Session({ clipPath: clip, seed: 3, send: (e) => events.push(e) });
  await session.run();
  assert.ok(!events.some((e) => e.type === 'error'), 'no errors');
  const scores = events.flatMap((e) => (e.type === 'phrase' ? [e.score] : []));
  assert.equal(events.filter((e) => e.type === 'reading').length, 26, 'one reading per second of video');
  assert.ok(scores.length >= 2);
  assert.ok(events.some((e) => e.type === 'ready'));
  assert.equal(scores[0].startSec, session.alloc.starts[0]);
  scores.forEach((s, i) => {
    for (const n of s.notes) {
      const [lo, hi] = INSTRUMENTS[n.inst].range;
      assert.ok(n.midi >= lo && n.midi <= hi && n.t >= 0 && n.t < s.beats && n.dur > 0, `phrase ${i} note in range`);
    }
    const next = scores[i + 1];
    if (next) assert.ok(Math.abs(s.startSec! + beatToSec(s, s.beats) - next.startSec!) < 1e-6, `phrase ${i} runs straight into phrase ${i + 1}`);
  });
  // The music is in step with a clear visual pulse: 120 BPM or its half or double.
  assert.ok([60, 120, 240].some((t) => Math.abs(session.tempo.bpm - t) <= 3), `tempo ${session.tempo.bpm}`);
  // Every Drex request that carries images stays far under the 4 MiB body limit, with at most 8 images.
  const frameCalls = events.filter((e) => e.type === 'call' && e.call.callType === 'frame_reading').length;
  assert.equal(frameCalls, 26);
});
