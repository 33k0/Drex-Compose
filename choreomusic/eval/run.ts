// Evaluation harness for the tests in the design doc (section 21).
//
//   npm run eval                 run everything
//   npm run eval -- frames       frame separation: an energetic and a calm burst, one movement question
//   npm run eval -- clips        two contrasting clips give different rules, plans and pieces
//   npm run eval -- shuffle      same clip with its seconds shuffled: the music should lose its arc
//   npm run eval -- blank        black frames give minimal, static music
//   npm run eval -- tempo        Drex's tempo pick against the true tempo of synthetic clips (and a tap, with --tap <bpm>)
//   npm run eval -- sync         the climax against the clip's peak: within one bar
//   npm run eval -- speed        six-image request size and round trip; calls per phrase
//   npm run eval -- beat         the movement-only beat grid against reference beats measured from the clip's soundtrack
//   --clip <file>                the real clip to use (default clips/firestarter-choreo.mp4)
//
// Without NACE_API_KEY these run against the local stand-in, which CANNOT SEE FRAMES: its readings
// come from the motion analyser. On the stand-in these tests check the pipeline, not Drex's eyes.
// "Run the frame separation test first" (the design doc's first risk) only means something with a key.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChoreoServerEvent, Reading } from '../shared/choreo.ts';
import type { PhraseScore, PlanView, RulesView } from '../shared/types.ts';
import { beatToSec } from '../shared/types.ts';
import { motionSeconds, readSecond } from '../server/choreo/reading.ts';
import { mulberry32, shuffled } from '../server/core/rng.ts';
import { apiKey, Gateway } from '../server/gateway/gateway.ts';
import { modelFor } from '../server/gateway/models.ts';
import { ROOT } from '../server/pack.ts';
import { Session } from '../server/session.ts';
import { analyseBeat, gridAccuracy, gridBeats, type PoseData } from '../server/video/beat.ts';
import { DEFAULT_CACHE_DIR, extractClip, frameBase64, framesForSecond } from '../server/video/extract.ts';
import { trackPose } from '../server/video/pose.ts';
import { analyseMotionSeries, collectMotionSeries } from '../server/video/motion.ts';
import { absoluteMotion } from '../server/choreo/reading.ts';
import { bounceClip, colorClip, ffmpeg, pulseClip } from '../server/video/__tests__/helpers.ts';

process.env.STANDIN_LATENCY_MS ??= '0-0';
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const realClip = resolve(ROOT, flag('clip') ?? 'clips/firestarter-choreo.mp4');
const tapBpm = flag('tap');
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const live = !!apiKey();
const answeredBy = live ? `Drex (${modelFor('frame_reading', true)})` : 'the local STAND-IN, which reads motion analysis, not frames';
const results: { test: string; pass: boolean | null; detail: string }[] = [];
const record = (test: string, pass: boolean | null, detail: string) => {
  results.push({ test, pass, detail });
  console.log(`${pass === null ? '–' : pass ? '✔' : '✖'} ${test}: ${detail}`);
};

const synthDir = join(ROOT, '.cache/eval-clips');
mkdirSync(synthDir, { recursive: true });
async function synth(name: string, make: (out: string) => Promise<string>): Promise<string> {
  const out = join(synthDir, name);
  if (!existsSync(out)) await make(out);
  return out;
}

interface Run {
  events: ChoreoServerEvent[];
  session: Session;
  scores: PhraseScore[];
  rules: RulesView;
  plan: PlanView;
  readings: Reading[];
  ms: number;
}

async function score(clipPath: string, extra: { order?: number[]; tap?: { bpm: number; offsetSec: number }; seed?: number } = {}): Promise<Run> {
  const events: ChoreoServerEvent[] = [];
  const session = new Session({ clipPath, seed: extra.seed ?? 5, order: extra.order, tap: extra.tap, send: (e) => events.push(e) });
  const t0 = Date.now();
  await session.run();
  const error = events.find((e) => e.type === 'error');
  if (error && error.type === 'error') throw new Error(error.message);
  const rules = events.find((e) => e.type === 'rules');
  const plans = events.filter((e) => e.type === 'plan');
  return {
    events, session, ms: Date.now() - t0,
    scores: events.flatMap((e) => (e.type === 'phrase' ? [e.score] : [])),
    rules: (rules as { rules: RulesView }).rules,
    plan: (plans[plans.length - 1] as { plan: PlanView }).plan,
    readings: session.readings,
  };
}

const tensions = (run: Run) => run.scores.map((s) => s.display.tension);
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
/** How jagged a curve is: mean absolute step between neighbours, relative to its range. */
const jagged = (xs: number[]) => (xs.length > 1 && range(xs) > 0 ? xs.slice(1).reduce((s, x, i) => s + Math.abs(x - xs[i]), 0) / (xs.length - 1) / range(xs) : 0);
const layersOf = (s: PhraseScore) => s.display.layers.filter((l) => l.inst).length;

// ───────────────────────────── Frame separation ─────────────────────────────

async function frames() {
  if (!existsSync(realClip)) return record('Frame separation', null, `no clip at ${realClip}`);
  const clip = await extractClip(realClip);
  const series = await collectMotionSeries(realClip);
  const motion = analyseMotionSeries(series);
  const total = Math.floor(clip.durationSec);
  const ms = motionSeconds(motion, total, absoluteMotion(series, motion.cuts));
  const order = Array.from({ length: total }, (_x, i) => i).filter((s) => s >= 3 && framesForSecond(clip, s).length === 6);
  const byMotion = order.slice().sort((a, b) => (motion.perSecond[a] ?? 0) - (motion.perSecond[b] ?? 0));
  const calm = byMotion.slice(0, 3);
  const busy = byMotion.slice(-3);
  const gw = new Gateway({ seed: 1 });
  const read = (s: number) => readSecond(gw, clip, s, total, ms, null, '');
  const calmR = await Promise.all(calm.map(read));
  const busyR = await Promise.all(busy.map(read));
  const mean = (rs: Reading[]) => rs.reduce((s, r) => s + r.movement, 0) / rs.length;
  const gap = mean(busyR) - mean(calmR);
  record('Frame separation: energetic and calm bursts, one movement question', gap >= 2,
    `energetic seconds ${busy.join(', ')} scored ${busyR.map((r) => r.movement).join(', ')}; calm seconds ${calm.join(', ')} scored ${calmR.map((r) => r.movement).join(', ')}; gap ${gap.toFixed(1)} of 6 [${answeredBy}]` +
    (live ? '' : '. On the stand-in this is circular (the bursts were chosen by the same motion measure it reads); it only shows the plumbing works.'));
}

// ───────────────────────────── Different clips ─────────────────────────────

async function clips() {
  const energetic = await synth('energetic.mp4', (out) => bounceClip(out, 126, { seconds: 32 }));
  const calm = await synth('calm.mp4', (out) => pulseClip(out, 54, 0, { seconds: 32 }));
  const a = await score(energetic);
  const b = await score(calm);
  const keys = ['style', 'bpm', 'meter', 'keyName', 'harmonicLanguage', 'soundWorld', 'ending'] as const;
  const differ = keys.filter((k) => a.rules[k] !== b.rules[k]);
  const planDiff = JSON.stringify(a.plan.sections.map((s) => [s.role, s.tension])) !== JSON.stringify(b.plan.sections.map((s) => [s.role, s.tension]));
  const pieceDiff = a.scores[0].display.notation !== b.scores[0].display.notation;
  record('Different clips: two contrasting clips', differ.length >= 2 && pieceDiff,
    `${differ.length} of ${keys.length} rules differ (${differ.join(', ')}); energetic = ${a.rules.styleName}, ${Math.round(a.rules.bpm)} BPM; calm = ${b.rules.styleName}, ${Math.round(b.rules.bpm)} BPM; plans ${planDiff ? 'differ' : 'match'}; themes ${pieceDiff ? 'differ' : 'match'} [${answeredBy}]. These are synthetic clips (a bouncing box and a slow pulsing disc); the second real demo clip is not chosen yet.`);
}

// ───────────────────────────── Shuffle and blank controls ─────────────────────────────

async function shuffle() {
  if (!existsSync(realClip)) return record('Shuffle control', null, `no clip at ${realClip}`);
  const base = await score(realClip);
  const order = shuffled(Array.from({ length: base.readings.length }, (_x, i) => i), mulberry32(99));
  const mixed = await score(realClip, { order });
  const perSecond = (run: Run) => run.readings.map((r) => r.movement);
  const jb = jagged(perSecond(base));
  const jm = jagged(perSecond(mixed));
  record('Shuffle control: same clip, seconds shuffled', jm > jb * 1.15,
    `second-to-second jumps in the movement readings: ${jb.toFixed(2)} in order, ${jm.toFixed(2)} shuffled (higher = no arc); tension by phrase in order ${tensions(base).join(' ')}, shuffled ${tensions(mixed).join(' ')}; sections ${base.plan.sections.length} vs ${mixed.plan.sections.length} [${answeredBy}]. Whether the music itself loses its arc needs ears: score both and listen.`);
}

async function blank() {
  const black = await synth('black.mp4', (out) => colorClip(out, 'black', { seconds: 24 }));
  const run = await score(black);
  const maxT = Math.max(...tensions(run));
  const maxLayers = Math.max(...run.scores.map(layersOf));
  // With nobody to follow there is no beat to lock to: no kick or snare may be committed anywhere.
  const drums = run.scores.some((s) => s.notes.some((n) => (n.inst === 'drumkit' || (n.inst as string) === 'ekit' || n.inst === 'kick808') && (n.midi === 36 || n.midi === 38 || n.midi === 39)));
  record('Blank control: black frames', maxT <= 3 && !drums,
    `highest tension ${maxT} of 7; at most ${maxLayers} of 9 layers; ${drums ? 'a kick or snare played' : 'no kick or snare anywhere (the whole score is a bridge)'}; movement readings all ${[...new Set(run.readings.map((r) => r.movement))].join('/')}; ${Math.round(run.rules.bpm)} BPM ${run.rules.styleName} [${answeredBy}]`);
}

// ───────────────────────────── Tempo ─────────────────────────────

function near(bpm: number, truth: number): boolean {
  return [truth, truth / 2, truth * 2].some((t) => Math.abs(bpm - t) <= 3);
}

async function tempo() {
  for (const truth of [120, 90]) {
    const clip = await synth(`pulse-${truth}.mp4`, (out) => pulseClip(out, truth, 0, { seconds: 30 }));
    const run = await score(clip);
    record(`Tempo: synthetic clip pulsing at ${truth} BPM`, near(run.session.tempo.bpm, truth),
      `picked ${run.session.tempo.bpm} BPM (pulse strength ${run.session.tempo.strength.toFixed(2)}) [${answeredBy}]`);
  }
  if (existsSync(realClip)) {
    const run = await score(realClip, tapBpm ? { tap: { bpm: Number(tapBpm), offsetSec: 0 } } : {});
    const view = run.session.tempo.view;
    const drex = view.drexBpm ?? view.bpm;
    record('Tempo: the real clip', tapBpm ? near(drex, Number(tapBpm)) : null,
      `Drex picked ${drex} BPM (pulse strength ${Math.max(...view.candidates.map((c) => c.strength)).toFixed(2)}; below 0.2 the motion has no convincing pulse)` +
      (tapBpm ? `; tapped ${tapBpm}` : '; pass --tap <bpm> to compare with a tapped tempo') + ` [${answeredBy}]`);
  }
}

// ───────────────────────────── Sync ─────────────────────────────

async function sync() {
  // A clip with one obvious peak: a box that barely moves, bounces hard around 0:30, and settles again.
  const clip = await synth('one-burst-48.mp4', async (out) => {
    const graph = "color=c=0x202830:s=320x180:r=30:d=48[bg];color=c=white:s=24x24:r=30:d=48[box];[bg][box]overlay=x=148:y='140-110*abs(sin(PI*t*2))*exp(-pow((t-30)/4\\,2))'";
    await ffmpeg(['-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
    return out;
  });
  for (const [name, path] of [['synthetic clip with one event', clip], ['the real clip', realClip]] as const) {
    if (!existsSync(path)) continue;
    const run = await score(path);
    const top = run.readings.slice().sort((a, b) => b.peak - a.peak || b.movement - a.movement)[0];
    const climax = run.scores[run.plan.climaxPhrase];
    const barSec = (climax.beatsPerBar * 60) / climax.bpm;
    const start = climax.startSec!;
    const end = start + beatToSec(climax, climax.beats);
    const peakSec = top.second + 0.5;
    const distance = peakSec < start ? start - peakSec : peakSec > end ? peakSec - end : 0;
    // Continuity is a hard requirement of sync: every phrase starts where the last one ends.
    const gap = Math.max(0, ...run.scores.slice(1).map((s, i) => Math.abs(run.scores[i].startSec! + beatToSec(run.scores[i], run.scores[i].beats) - s.startSec!)));
    record(`Sync: climax against the clip's peak (${name})`, distance <= barSec && gap < 0.005,
      `strongest peak reading at ${peakSec.toFixed(1)} s; climax phrase ${climax.index + 1} spans ${start.toFixed(1)}-${end.toFixed(1)} s; ${distance === 0 ? 'the peak falls inside it' : `${distance.toFixed(2)} s away (one bar is ${barSec.toFixed(2)} s)`}; largest gap between phrases ${(gap * 1000).toFixed(1)} ms [${answeredBy}]`);
  }
}

// ───────────────────────────── Speed ─────────────────────────────

async function speed() {
  if (!existsSync(realClip)) return record('Speed', null, `no clip at ${realClip}`);
  const clip = await extractClip(realClip);
  const total = Math.floor(clip.durationSec);
  let biggest = 0;
  for (let s = 3; s < total; s += 7) {
    const imgs = await Promise.all([...framesForSecond(clip, s), framesForSecond(clip, s - 1)[3], framesForSecond(clip, s - 3)[3]].filter(Boolean).map(frameBase64));
    biggest = Math.max(biggest, imgs.reduce((n, x) => n + x.length, 0));
  }
  const run = await score(realClip);
  const frameCalls = run.events.flatMap((e) => (e.type === 'call' && e.call.callType === 'frame_reading' ? [e.call.ms] : [])).sort((a, b) => a - b);
  const composing = run.session.gw.calls - frameCalls.length;
  record('Speed', null,
    `eight-image requests are at most ${(biggest / 1024).toFixed(0)} KB of base64 (the limit is 4 MiB); pre-scan ${frameCalls.length} calls, round trip p50 ${frameCalls[Math.floor(frameCalls.length / 2)]} ms, p95 ${frameCalls[Math.floor(frameCalls.length * 0.95)]} ms; ` +
    `composing ${composing} calls for ${run.scores.length} phrases (${(composing / run.scores.length).toFixed(1)} per phrase); whole run ${(run.ms / 1000).toFixed(1)} s before playback; live read adds 60 calls a minute during playback [${answeredBy}]` +
    (live ? '' : '. Round-trip times here are the stand-in\'s; measure again with a key.'));
}

// ───────────────────────────── Beat ─────────────────────────────

/**
 * The central test of this project: does a beat grid found from movement alone land on the real
 * beats? The reference beats were measured from the clip's own soundtrack by an audio beat tracker;
 * that soundtrack is used only for this grading and is not stored in the project.
 */
async function beat() {
  const dir = join(ROOT, 'eval/ground-truth/firestarter-choreo');
  if (!existsSync(join(dir, 'beats.json'))) return record('Beat', null, 'no ground truth in eval/ground-truth');
  const truth = JSON.parse(readFileSync(join(dir, 'beats.json'), 'utf8')) as { aspect: number; beatTimes: number[] };
  // Track the clip afresh when it is here; otherwise grade the stored tracking.
  let pose: PoseData;
  let how = 'stored body tracking';
  if (existsSync(realClip) && /firestarter/.test(realClip)) {
    const clip = await extractClip(realClip);
    pose = await trackPose(realClip, join(DEFAULT_CACHE_DIR, clip.id, 'pose.json'));
    how = 'body tracking run on the muted clip';
  } else pose = JSON.parse(readFileSync(join(dir, 'pose.json'), 'utf8')) as PoseData;
  const found = analyseBeat(pose, truth.aspect);
  const top = found.candidates[0];
  const reference = truth.beatTimes.filter((t) => t > 8 && t < 180);
  const duration = pose.frames.length / pose.fps;
  const wide = gridAccuracy(gridBeats(top.bpm, top.firstBeatSec, duration), reference, 0.07);
  const tight = gridAccuracy(gridBeats(top.bpm, top.firstBeatSec, duration), reference, 0.035);
  record('Beat: the grid from movement alone against the true beats', wide.within >= 0.8 && Math.abs(top.bpm - 131) < 0.3,
    `${how}: tempo ${top.bpm} BPM (the track is 131.0), confidence ${found.confidence}; ${Math.round(wide.within * 100)}% of ${reference.length} true beats within 70 ms of the grid, ${Math.round(tight.within * 100)}% within 35 ms; ` +
    `the grid sits ${wide.meanOffsetMs} ms from the beat on average and drifts ${wide.driftMs} ms from the first beat to the last; ${found.stretches.filter((s) => !s.clear).length} of ${found.stretches.length} stretches unclear and carried through. ` +
    'The reference beats come from an audio beat tracker, which itself misses some beats in the intro and outro.');
}

const all: Record<string, () => Promise<void>> = { beat, frames, clips, shuffle, blank, tempo, sync, speed };
console.log(`Drex Choreomusic evaluation; answers come from ${answeredBy}\n`);
for (const [name, run] of Object.entries(all)) {
  if (which !== 'all' && which !== name) continue;
  try {
    await run();
  } catch (err) {
    record(name, false, `crashed: ${(err as Error).message}`);
  }
}
const failed = results.filter((r) => r.pass === false).length;
console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed} failed, ${results.filter((r) => r.pass === null).length} informational`);
mkdirSync(join(ROOT, 'eval/results'), { recursive: true });
writeFileSync(join(ROOT, 'eval/results/latest.json'), JSON.stringify({ at: new Date().toISOString(), answeredBy, results }, null, 2));
process.exit(failed ? 1 : 0);
