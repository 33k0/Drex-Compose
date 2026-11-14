// Run with: npx tsx --test web/src/state.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ChoreoServerEvent, LiveCue, VideoSection } from '../../shared/choreo';
import type { CallType, CallView, DraftView, PhraseScore, PlanView, RulesView } from '../../shared/types';
import { phraseSeconds } from '../../shared/types';
import { barTimes, beatAt, beatTimes, beatsPerBar, unclearSpans } from './beat';
import { fitGlyph, fitShort, instrumentName } from './format';
import {
  CALL_LOG_LIMIT, CONNECTION_LOST, beatUncertain, deskView, initialState, lineageChain, phraseAt, readingsInOrder, reduce,
  rejectedRoundCount, scoresInOrder, secondOfCall, shouldFeature, shownReading, trackingProgress, type Action, type PanelState,
} from './state';

function run(actions: Action[], from: PanelState = initialState()): PanelState {
  return actions.reduce(reduce, from);
}

const SAMPLE = fileURLToPath(new URL('../../.cache/sample-run.json', import.meta.url));
const hasSample = existsSync(SAMPLE);
const sample: ChoreoServerEvent[] = hasSample ? JSON.parse(readFileSync(SAMPLE, 'utf8')) : [];
const noSample = hasSample ? false : 'no .cache/sample-run.json (npx tsx tools/score-cli.ts clips/firestarter-choreo.mp4 --seed 5 --json .cache/sample-run.json)';
/** The section-change marks the server may send now that the music never leaves the grid. */
const FIT_CHOICES = ['fill', 'drop_bar', 'riser', 'crash', 'none'];

const session = (id = 's1', prompt = '', standin = true): ChoreoServerEvent => ({
  type: 'session', id, prompt, standin, model: standin ? 'stand-in' : 'drex-max', seed: 7,
});

const rules: RulesView = {
  style: 'playful', styleName: 'Playful', bpm: 99, meter: '4/4', keyName: 'F#',
  mode: 'major', harmonicLanguage: 'triads', palette: ['piano', 'flute'], soundWorld: 'close_dry',
  lengthSec: 68, form: 'arch', ending: 'resolved', keyPlan: 'relative',
};

const plan = (revised: boolean, departureTension: number, climax: number): PlanView => ({
  sections: [
    { index: 0, role: 'statement', tension: 2, departure: false, phrases: [0, 2], keyName: 'D dorian', startSec: 0, endSec: 12 },
    { index: 1, role: 'departure', tension: departureTension, departure: true, phrases: [3, 5], keyName: 'F major', startSec: 12, endSec: 30 },
    { index: 2, role: 'climax', tension: 7, departure: false, phrases: [6, 8], keyName: 'D dorian', startSec: 30, endSec: 50 },
  ],
  totalPhrases: 9, climaxPhrase: climax, phraseSec: 6, revised,
});

const draft = (id: string): DraftView => ({
  id, notation: 'D4q F4e A4e', lineage: `variant ${id}`, notes: [{ midi: 62, t: 0, dur: 1 }],
});

const phraseScore = (index: number, lineage: string, startSec = index * 6): PhraseScore => ({
  index, section: 0, role: 'statement', bars: 2, beatsPerBar: 4, beats: 8, bpm: 80, startSec,
  notes: [{ t: 0, dur: 1, midi: 62, vel: 0.6, inst: 'piano', art: 'sustain', layer: 'melody' }],
  pedal: [],
  mix: { dynamics: 2, lowpass: 5, reverb: 4, delay: 1, noise: 0, width: 3, saturation: 1, chorus: false, sidechain: false },
  holdChord: [],
  display: { key: 'D dorian', notation: 'D4q F4e A4e', lineage, chords: ['Dm7', 'G7'], layers: [], tension: 2 },
});

const call = (id: number, callType: CallType, at: number, questions = 1, title = `${callType} ${id}`): CallView => ({
  id, callType, title, at, model: 'drex-max', standin: false, ms: 300,
  questions: Array.from({ length: questions }, (_, i) => ({
    id: `q${i}`, type: 'noul' as const, label: 'q', probabilities: { yes: 0.7 }, picked: ['yes'], picking: 'top' as const,
  })),
});

const phraseDrafts = (phrase: number, round: number, picked: string | null): ChoreoServerEvent => ({
  type: 'phrase_drafts', phrase, round, drafts: [draft('a'), draft('b'), draft('c')],
  verdict: { picked, reason: picked ? 'b keeps the motif' : 'all three lose the motif', probabilities: { a: 0.2, b: 0.5, c: 0.1, none: 0.2 } },
});

const sections = (n: number): VideoSection[] => Array.from({ length: n }, (_, i) => ({
  index: i, startSec: i * 10, endSec: (i + 1) * 10, summary: `section ${i}`, keyFrame: i * 60, movement: 3, mood: 'playful' as const,
}));

/** Deterministic shuffle, so out-of-order arrival is tested the same way every time. */
function shuffled<T>(items: T[], seed = 11): T[] {
  const out = [...items];
  let a = seed;
  for (let i = out.length - 1; i > 0; i--) {
    a = (a * 1103515245 + 12345) >>> 0;
    const j = a % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ───────────────────────────── The real sample run ─────────────────────────────

test('the sample run: readings are stored by second, whatever order they arrive in', { skip: noSample }, () => {
  const readings = sample.filter((e) => e.type === 'reading');
  const others = sample.filter((e) => e.type !== 'reading');
  // Readings arrive in parallel on the real server: replay them shuffled, mid-prescan.
  const at = others.findIndex((e) => e.type === 'timeline');
  const events = [...others.slice(0, at), ...shuffled(readings), ...others.slice(at)];
  const s = run(events);
  // One reading per second of video, whatever the clip's length.
  const seconds = readings.length;
  assert.ok(seconds > 30);
  assert.equal(Object.keys(s.readings).length, seconds);
  const ordered = readingsInOrder(s.readings);
  assert.deepEqual(ordered.map((r) => r.second), Array.from({ length: seconds }, (_, i) => i));
  for (const e of readings) if (e.type === 'reading') assert.deepEqual(s.readings[e.reading.second], e.reading);
  assert.equal(s.prescan.total, seconds);
  assert.equal(s.prescan.done, seconds);
  assert.ok(s.clip && s.clip.durationSec > seconds - 2 && s.clip.frameUrl.includes('{i}'));
  assert.ok(Math.abs((s.motion?.perSecond.length ?? 0) - seconds) <= 1);
});

test('the sample run: tempo, fits per section, phrases by index in time order, then ready', { skip: noSample }, () => {
  const readyAt = sample.findIndex((e) => e.type === 'ready');
  const before = run(sample.slice(0, readyAt));
  assert.equal(deskView(before), 'composing');
  assert.equal(before.ready, null);

  const s = run([sample[readyAt]], before);
  assert.equal(deskView(s), 'playback');
  const phraseCount = sample.filter((e) => e.type === 'phrase').length;
  const readyEvent = sample.find((e) => e.type === 'ready');
  const tempoEvent = sample.find((e) => e.type === 'tempo');
  const timelineEvents = sample.filter((e) => e.type === 'timeline');
  assert.equal(s.ready?.phrases, phraseCount);
  assert.equal(s.ready?.totalSec, readyEvent && readyEvent.type === 'ready' ? readyEvent.totalSec : -1);

  assert.equal(s.tempo?.bpm, tempoEvent && tempoEvent.type === 'tempo' ? tempoEvent.tempo.bpm : -1);
  assert.equal(s.tempo?.manual, false);
  assert.ok((s.tempo?.candidates.length ?? 0) >= 2);

  const fits = sample.flatMap((e) => (e.type === 'fit' ? [e.fit] : []));
  assert.equal(Object.keys(s.fits).length, fits.length);
  for (const f of fits) assert.deepEqual(s.fits[f.section], f);
  assert.equal(s.fits[0].choice, fits[0].choice);

  const lastTimeline = timelineEvents[timelineEvents.length - 1];
  assert.equal(s.videoSections.length, lastTimeline && lastTimeline.type === 'timeline' ? lastTimeline.sections.length : -1);
  assert.deepEqual(Object.keys(s.phrases).map(Number), Array.from({ length: phraseCount }, (_, i) => i));
  assert.equal(s.composedThrough, phraseCount - 1);
  const ordered = scoresInOrder(s.phrases);
  assert.deepEqual(ordered.map((p) => p.index), Array.from({ length: phraseCount }, (_, i) => i));
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i].startSec! > ordered[i - 1].startSec!);
  // The plan's sections sit on the video clock.
  assert.ok(s.plan?.sections.every((sec) => typeof sec.startSec === 'number' && typeof sec.endSec === 'number'));
  assert.ok(s.planRevisions > 0);

  // The phrase under the playhead, from video time.
  // The music starts on the first downbeat of the grid, not at 0:00: nothing sounds before it.
  assert.ok(Math.abs(ordered[0].startSec! - (s.grid?.musicStartSec ?? 0)) < 0.01);
  if (ordered[0].startSec! > 0.2) assert.equal(phraseAt(ordered, ordered[0].startSec! - 0.1, phraseSeconds), null);
  assert.equal(phraseAt(ordered, ordered[0].startSec! + 0.1, phraseSeconds), 0);
  assert.equal(phraseAt(ordered, ordered[3].startSec! + 0.1, phraseSeconds), 3);

  // On ready, the last verdict returns to the big view until the live reads start.
  assert.equal(s.featured?.callType, 'phrase_judge');
  const done = run(sample.slice(readyAt + 1), s);
  assert.equal(done.serverDone, true);
  assert.equal(done.phase, 'running');
  assert.equal(deskView(done), 'playback');
});

test('the sample run: the beat from the dancers, the grid, the section marks and the extra hits', { skip: noSample }, () => {
  const beatEvent = sample.find((e) => e.type === 'beat');
  const gridEvent = sample.find((e) => e.type === 'grid');
  const hitsEvent = sample.find((e) => e.type === 'hits');
  assert.ok(beatEvent && beatEvent.type === 'beat' && gridEvent && gridEvent.type === 'grid' && hitsEvent && hitsEvent.type === 'hits');

  // The beat arrives before the readings, while the panel still shows the pre-scan.
  const beatAtIndex = sample.indexOf(beatEvent);
  const early = run(sample.slice(0, beatAtIndex + 1));
  assert.deepEqual(early.beat, beatEvent.beat);
  assert.equal(deskView(early), 'prescan');
  assert.equal(early.grid, null);

  const s = run(sample);
  const beat = s.beat!;
  assert.ok(beat.method === 'body' || beat.method === 'pixels');
  if (beat.method === 'pixels') assert.ok(beat.note);
  assert.ok(beat.candidates.length >= 2);
  for (const c of beat.candidates) {
    assert.ok(c.bpm > 30 && c.bpm < 300);
    assert.ok(c.agreement >= 0 && c.agreement <= 1);
    assert.ok(['base', 'half', 'double', 'other'].includes(c.relation));
  }
  assert.ok(beat.stretches.length > 0);
  for (const st of beat.stretches) assert.ok(st.endSec > st.startSec && typeof st.clear === 'boolean');
  assert.ok(beat.landings.length > 0 && beat.landings.every((l) => l.weight >= 0));
  assert.ok(beat.confidence >= 0 && beat.confidence <= 1);

  // The grid: Drex's pick, a bar on the beat, the first downbeat inside the clip.
  const grid = s.grid!;
  assert.deepEqual(grid, gridEvent.grid);
  assert.ok(Math.abs(grid.bpm - (s.tempo?.bpm ?? 0)) < 0.6);
  assert.equal(beatsPerBar(grid), 4);
  assert.ok(grid.musicStartSec >= 0 && grid.musicStartSec < (s.clip?.durationSec ?? 0));
  for (const b of grid.bridges) assert.ok(b.endSec > b.startSec);
  assert.equal(beatUncertain(s), !beat.clear || grid.noBeat);

  // Every tempo candidate names where it came from.
  assert.ok(s.tempo?.source);
  assert.ok(s.tempo!.candidates.every((c) => typeof c.source === 'string'));

  // How each section change is marked: the new choices only, with words for the panel.
  const fits = Object.values(s.fits);
  assert.ok(fits.length > 0);
  for (const f of fits) {
    assert.ok(FIT_CHOICES.includes(f.choice), f.choice);
    assert.ok(f.label.length > 0 && f.detail.length > 0);
    assert.ok(fitShort(f.choice).length > 0 && !fitShort(f.choice).includes('_'));
    assert.ok(fitGlyph(f.choice).length > 0);
  }
  // Sections start on bar lines.
  const bars = barTimes(grid, s.clip!.durationSec);
  for (const v of s.videoSections.slice(1)) {
    assert.ok(bars.some((t) => Math.abs(t - v.startSec) < 0.02), `section at ${v.startSec} is on a bar line`);
  }

  assert.deepEqual(s.hits, [...hitsEvent.times].sort((a, b) => a - b));
  assert.ok(s.hits.length > 0);

  // New instrument ids read as words.
  for (const inst of s.rules!.palette) assert.match(instrumentName(inst), /^[A-Z0-9]/, inst);
  assert.equal(instrumentName('ekit'), 'Electronic kit');
  assert.equal(instrumentName('synth_bass'), 'Synth bass');
  assert.ok(s.rules!.style !== 'beat_driven' || s.rules!.groove);
});

test('the sample run: a new session resets everything the old one showed', { skip: noSample }, () => {
  const full = run(sample);
  assert.ok(Object.keys(full.readings).length > 0 && full.tempo && full.ready);
  const next = run([session('s2')], full);
  assert.equal(next.session?.id, 's2');
  assert.deepEqual(next.readings, {});
  assert.equal(next.clip, null);
  assert.equal(next.motion, null);
  assert.equal(next.tempo, null);
  assert.deepEqual(next.fits, {});
  assert.equal(next.beat, null);
  assert.equal(next.grid, null);
  assert.deepEqual(next.hits, []);
  assert.deepEqual(next.videoSections, []);
  assert.deepEqual(next.phrases, {});
  assert.equal(next.ready, null);
  assert.deepEqual(next.liveCues, []);
  assert.equal(next.calls.length, 0);
  assert.equal(deskView(next), 'prescan');
});

// ───────────────────────────── Video events ─────────────────────────────

test('the timeline is replaced whole when the server sends it again', () => {
  const s = run([session(), { type: 'timeline', sections: sections(6) }, { type: 'timeline', sections: sections(4) }]);
  assert.equal(s.videoSections.length, 4);
  assert.equal(s.videoSections[3].endSec, 40);
});

test('a re-sent fit replaces the one for its section', () => {
  const s = run([
    session(),
    { type: 'fit', fit: { section: 0, choice: 'fill', label: 'drum fill', detail: 'into section 2 at 0:09, on the bar line' } },
    { type: 'fit', fit: { section: 1, choice: 'drop_bar', label: 'one-bar drop', detail: 'into section 3 at 0:16, on the bar line nearest the cut' } },
    { type: 'fit', fit: { section: 0, choice: 'riser', label: 'riser', detail: 'into section 2 at 0:09, on the bar line' } },
  ]);
  assert.equal(Object.keys(s.fits).length, 2);
  assert.equal(s.fits[0].choice, 'riser');
  assert.equal(fitShort('drop_bar'), 'drop');
  assert.equal(fitShort('crash'), 'crash');
});

test('beat, grid and hits are stored, replaced, and cleared on reset', () => {
  const beat = {
    method: 'pixels' as const, note: 'body tracking is not installed', people: 0, confidence: 0.1, clear: false,
    candidates: [{ bpm: 120, agreement: 0.05, firstBeatSec: 0.2, relation: 'base' }],
    stretches: [{ startSec: 0, endSec: 20, agreement: 0.05, clear: false }],
    landings: [{ t: 0.7, weight: 0.4 }],
  };
  const grid = { bpm: 120, barSec: 2, musicStartSec: 0.2, bridges: [{ startSec: 0.2, endSec: 30 }], noBeat: true };
  let s = run([session(), { type: 'beat', beat }, { type: 'grid', grid }, { type: 'hits', times: [9.5, 3.25] }]);
  assert.equal(s.beat?.method, 'pixels');
  assert.equal(s.grid?.noBeat, true);
  assert.deepEqual(s.hits, [3.25, 9.5]);
  assert.equal(beatUncertain(s), true);
  s = run([{ type: 'grid', grid: { ...grid, noBeat: false } }, { type: 'beat', beat: { ...beat, clear: true } }], s);
  assert.equal(beatUncertain(s), false);
  s = run([{ type: 'local/reset' }], s);
  assert.equal(s.beat, null);
  assert.equal(s.grid, null);
  assert.deepEqual(s.hits, []);
  // Before a session, none of it is taken.
  assert.equal(run([{ type: 'beat', beat }]).beat, null);
});

test('the body-tracking progress is read from the status line', () => {
  assert.deepEqual(trackingProgress("Tracking the dancers' bodies: frame 412 of 1176"), { done: 412, total: 1176 });
  assert.deepEqual(trackingProgress('Tracking the dancers\u2019 bodies: frame 9 of 10'), { done: 9, total: 10 });
  assert.equal(trackingProgress("Tracking the dancers' bodies to find the beat"), null);
  assert.equal(trackingProgress('Composing phrase 3 of 26'), null);
});

test('the beat grid: beats, bar lines and unclear stretches on the video clock', () => {
  const grid = { bpm: 120, barSec: 2, musicStartSec: 1.25 };
  assert.equal(beatsPerBar(grid), 4);
  // musicStartSec is a downbeat; beats exist before it too.
  assert.deepEqual(beatAt(grid, 1.25), { index: 0, beatInBar: 0, bar: 0, phase: 0 });
  assert.equal(beatAt(grid, 2.0).beatInBar, 1);
  assert.equal(beatAt(grid, 3.3).bar, 1);
  assert.equal(beatAt(grid, 3.3).beatInBar, 0);
  assert.deepEqual({ ...beatAt(grid, 0.8), phase: 0 }, { index: -1, beatInBar: 3, bar: -1, phase: 0 });
  assert.ok(Math.abs(beatAt(grid, 0.8).phase - 0.1) < 1e-9);
  assert.deepEqual(barTimes(grid, 8), [1.25, 3.25, 5.25, 7.25]);
  assert.deepEqual(beatTimes(grid, 2.3), [0.25, 0.75, 1.25, 1.75, 2.25]);
  // Overlapping 20 s windows every 10 s: an unclear window covers its own 10 s in the middle.
  const stretches = [0, 10, 20, 30, 40].map((startSec) => ({ startSec, endSec: startSec + 20, agreement: 0.2, clear: startSec !== 10 && startSec !== 20 }));
  assert.deepEqual(unclearSpans(stretches), [{ startSec: 15, endSec: 35 }]);
  assert.deepEqual(unclearSpans([{ startSec: 0, endSec: 20, agreement: 0, clear: false }]), [{ startSec: 0, endSec: 20 }]);
});

test('a tapped tempo is kept with what Drex had picked', () => {
  const s = run([session(), {
    type: 'tempo',
    tempo: { bpm: 136, offsetSec: 0.4, strength: 0.3, manual: true, drexBpm: 99, source: 'tap', candidates: [] },
  }]);
  assert.equal(s.tempo?.manual, true);
  assert.equal(s.tempo?.source, 'tap');
  assert.equal(s.tempo?.drexBpm, 99);
  assert.equal(deskView(s), 'composing');
});

test('live cues are appended in arrival order, after ready and after done', () => {
  const cue = (atSec: number, label: string): LiveCue => ({ atSec, label, nudge: { gainDb: 0, overSec: 1 } });
  const s = run([
    session(),
    { type: 'phrase', score: phraseScore(0, 'A') },
    { type: 'ready', totalSec: 6, phrases: 1 },
    { type: 'done' },
    { type: 'live', cue: cue(2.5, 'as composed') },
    { type: 'live', cue: { ...cue(3.5, 'accent: cymbal crash'), accent: { notes: [], bpm: 99 } } },
  ]);
  assert.deepEqual(s.liveCues.map((c) => c.atSec), [2.5, 3.5]);
  assert.equal(s.liveCues[1].label, 'accent: cymbal crash');
});

test('the pre-scan shows the reading whose call is on the big view', () => {
  const reading = (second: number, movement: number) => ({
    type: 'reading' as const,
    reading: {
      second, movement, change: 'steady' as const, quality: 'flowing' as const, bodyLevel: 'middle' as const,
      mood: 'playful' as const, people: 'one' as const, cut: false, peak: 2, repeat: false, boundary: 0.1,
    },
  });
  let s = run([
    session(),
    { type: 'call', call: call(1, 'frame_reading', 100, 3, 'Frames 1:07') },
    reading(67, 5),
    reading(3, 2),
  ]);
  assert.equal(secondOfCall(s.featured), 67);
  assert.equal(shownReading(s)?.second, 67);
  assert.equal(s.lastReading, 3);
  s = run([{ type: 'call', call: call(2, 'tempo', 200, 1, 'Tempo') }], s);
  assert.equal(shownReading(s)?.second, 3);
});

test('the desk view follows the run: clip stage, pre-scan, composing, playback', () => {
  let s = initialState();
  assert.equal(deskView(s), 'clip');
  s = run([{ type: 'local/start', clip: 'firestarter-choreo.mp4', prompt: '' }], s);
  assert.equal(deskView(s), 'prescan');
  assert.equal(s.pending?.clip, 'firestarter-choreo.mp4');
  s = run([session()], s);
  assert.equal(deskView(s), 'prescan');
  s = run([{ type: 'rules', rules }], s);
  assert.equal(deskView(s), 'composing');
  s = run([{ type: 'ready', totalSec: 10, phrases: 0 }], s);
  assert.equal(deskView(s), 'playback');
  s = run([{ type: 'local/reset' }], s);
  assert.equal(deskView(s), 'clip');
  assert.equal(s.rules, null);
});

test('playback state: playing, the phrase under the playhead, the end of the video', () => {
  let s = run([session(), { type: 'local/playing', playing: true }]);
  // Nothing to play before the piece is ready.
  assert.equal(s.playing, false);
  s = run([{ type: 'ready', totalSec: 12, phrases: 2 }, { type: 'local/playing', playing: true }, { type: 'local/now', index: 1 }], s);
  assert.equal(s.playing, true);
  assert.equal(s.playbackStarted, true);
  assert.equal(s.nowIndex, 1);
  s = run([{ type: 'local/ended' }], s);
  assert.equal(s.playing, false);
  assert.equal(s.videoEnded, true);
  s = run([{ type: 'local/playing', playing: true }], s);
  assert.equal(s.videoEnded, false);
});

// ───────────────────────────── Carried over from the Composer ─────────────────────────────

test('run events before a session are ignored', () => {
  const s = run([{ type: 'rules', rules }, { type: 'phrase', score: phraseScore(0, 'A') }, { type: 'reading', reading: {} as never }]);
  assert.equal(s.rules, null);
  assert.equal(s.composedThrough, -1);
  assert.deepEqual(s.readings, {});
});

test('a rejected round is recorded, then the accepted round follows it', () => {
  const s = run([session(), phraseDrafts(3, 1, null), phraseDrafts(3, 2, 'b'), phraseDrafts(4, 1, 'a')]);
  assert.equal(s.phraseRounds[3].length, 2);
  assert.equal(s.phraseRounds[3][0].rejected, true);
  assert.equal(s.phraseRounds[3][1].rejected, false);
  assert.equal(rejectedRoundCount(s), 1);
  assert.equal(s.focusRound?.phrase, 4);
  assert.equal(s.lastRejection?.phrase, 3);
});

test('theme rounds and accepted themes are kept separately', () => {
  const s = run([
    session(),
    { type: 'theme_drafts', themeId: 'A', round: 1, drafts: [draft('t1'), draft('t2')], verdict: { picked: null, reason: 'too plain', probabilities: {} } },
    { type: 'theme_drafts', themeId: 'A', round: 2, drafts: [draft('t1'), draft('t2')], verdict: { picked: 't2', reason: 'memorable', probabilities: {} } },
    { type: 'theme', theme: { id: 'A', kind: 'main', notation: 'D4q', contour: 'arch', notes: [] } },
    { type: 'theme', theme: { id: 'A', kind: 'main', notation: 'D4q F4q', contour: 'arch', notes: [] } },
  ]);
  assert.equal(s.themeRounds.length, 2);
  assert.equal(rejectedRoundCount(s), 1);
  assert.equal(s.themes.length, 1);
  assert.equal(s.themes[0].notation, 'D4q F4q');
});

test('a plan revision replaces the plan and keeps the old one for the ghost curve', () => {
  const first = plan(false, 5, 7);
  const second = plan(true, 3, 8);
  const s = run([session(), { type: 'plan', plan: first }, { type: 'plan', plan: second }]);
  assert.equal(s.plan, second);
  assert.equal(s.previousPlan, first);
  assert.equal(s.planRevisions, 1);
  const same = run([session(), { type: 'plan', plan: first }, { type: 'plan', plan: plan(false, 5, 7) }]);
  assert.equal(same.planRevisions, 0);
});

test('the lineage follows the playhead once playback starts', () => {
  let s = run([
    session(),
    { type: 'phrase', score: phraseScore(0, 'A') },
    { type: 'phrase', score: phraseScore(1, 'A, answered a step lower') },
    { type: 'phrase', score: phraseScore(2, 'A, sequenced up a third') },
  ]);
  assert.deepEqual(lineageChain(s).map((c) => c.index), [2, 1, 0]);
  s = run([{ type: 'local/now', index: 0 }], s);
  const chain = lineageChain(s);
  assert.equal(chain[2].sounding, true);
  assert.equal(chain[0].ahead, true);
});

test('the call log is capped and a judge call keeps the big view over quick note calls', () => {
  const events: Action[] = [session()];
  for (let i = 1; i <= CALL_LOG_LIMIT + 15; i++) events.push({ type: 'call', call: call(i, 'theme_note', i * 400) });
  let s = run(events);
  assert.equal(s.calls.length, CALL_LOG_LIMIT);
  const judge = call(500, 'phrase_judge', 100000);
  s = run([{ type: 'call', call: judge }], s);
  assert.equal(s.featured?.id, 500);
  assert.equal(s.lastJudge?.id, 500);
  s = run([{ type: 'call', call: call(501, 'voice_leading', 100400) }], s);
  assert.equal(s.featured?.id, 500);
  s = run([{ type: 'call', call: call(502, 'voice_leading', 103000) }], s);
  assert.equal(s.featured?.id, 502);
  // Live reads come once a second and each is shown.
  const live = call(700, 'live_read', 300000);
  assert.equal(shouldFeature(live, call(701, 'live_read', 300900)), true);
  // Frame readings take turns.
  const frames = call(800, 'frame_reading', 400000);
  assert.equal(shouldFeature(frames, call(801, 'frame_reading', 400300)), false);
  assert.equal(shouldFeature(frames, call(802, 'frame_reading', 401300)), true);
});

test('stop freezes the run and ignores what the server sends afterwards', () => {
  let s = run([session(), { type: 'phrase', score: phraseScore(0, 'A') }, { type: 'local/stopped' }]);
  assert.equal(s.phase, 'stopped');
  s = run([{ type: 'phrase', score: phraseScore(1, 'late') }, { type: 'live', cue: { atSec: 1, label: 'x' } }], s);
  assert.equal(s.composedThrough, 0);
  assert.deepEqual(s.liveCues, []);
});

test('a straggler from the old run cannot leak into the next one', () => {
  const old = run([{ type: 'local/conn', conn: 'open' }, { type: 'local/audio', mode: 'real' }, session('s1'), { type: 'rules', rules }]);
  const starting = run([{ type: 'local/start', clip: 'other.mp4', prompt: 'noir' }], old);
  assert.equal(starting.phase, 'starting');
  assert.equal(starting.rules, null);
  assert.equal(starting.conn, 'open');
  assert.equal(starting.audio.mode, 'real');
  const straggler = run([{ type: 'phrase', score: phraseScore(1, 'old run') }], starting);
  assert.deepEqual(straggler.phrases, {});
});

test('a clip the server refuses ends the start with its message', () => {
  const s = run([{ type: 'local/start', clip: 'missing.mp4', prompt: '' }, { type: 'error', message: 'No such clip: missing.mp4' }]);
  assert.equal(s.phase, 'error');
  assert.equal(s.error, 'No such clip: missing.mp4');
  // An error with no run at all is not shown.
  assert.equal(run([{ type: 'error', message: 'stray' }]).error, null);
});

test('losing the socket mid-run is reported, and the note clears on reconnect', () => {
  let s = run([{ type: 'local/conn', conn: 'open' }, session(), { type: 'local/conn', conn: 'reconnecting' }]);
  assert.equal(s.error, CONNECTION_LOST);
  s = run([{ type: 'local/conn', conn: 'open' }], s);
  assert.equal(s.error, null);
});

test('a fatal status ends the run and keeps its message; a non-fatal one clears', () => {
  const fatal = run([session(), { type: 'error', message: 'gateway refused the key' }, { type: 'status', stage: 'error', message: 'stopped' }]);
  assert.equal(fatal.phase, 'error');
  assert.equal(fatal.error, 'gateway refused the key');
  const soft = run([session(), { type: 'error', message: 'one call timed out' }, { type: 'status', stage: 'composing', message: 'Composing phrase 3' }]);
  assert.equal(soft.error, null);
});
