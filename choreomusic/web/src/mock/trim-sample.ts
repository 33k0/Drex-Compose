// Builds web/src/mock/sample-run.json, the event stream the ?mock=1 feed replays, from a real
// headless run (.cache/sample-run.json) plus the live reads of a second run made with --live.
//   npx tsx tools/score-cli.ts clips/firestarter-choreo.mp4 --seed 5 --json .cache/sample-run.json
//   npx tsx tools/score-cli.ts clips/firestarter-choreo.mp4 --seed 5 --json .cache/live-run.json --live
//   npx tsx web/src/mock/trim-sample.ts
//
// Trimming keeps the module small (under ~900 KB):
// - most routine calls are dropped (one voice-leading call in four is kept, and so on: KEEP_EVERY);
// - long option lists keep their top entries plus one "others" row carrying the rest;
// - every number is rounded (the dancers' landings to centiseconds);
// - questions are packed: everything a question shares with others of its kind (id, type, label,
//   options, picking, option keys) is stored once in `questionSets`, and each question becomes
//   [set index, probabilities in key order, picked];
// - notes are packed as tuples: [t, dur, midi, vel, inst, art, layer] with the three names as
//   indices into `names` for score and accent notes, [midi, t, dur] for draft and theme notes.
// mock/feed.ts unpacks all of it as it replays.
// A recorded run reuses the cached body tracking, so the "frame N of M" progress the server sends
// on a first run is put back in as a few status lines.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChoreoServerEvent, LiveCue } from '../../../shared/choreo.ts';
import type { CallType, CallView, NoteEvent, QuestionView } from '../../../shared/types.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const MAX_OPTIONS = 7;
/** Keep one call in N of these routine types. */
const KEEP_EVERY: Partial<Record<CallType, number>> = { voice_leading: 4, chord_path: 4, theme_note: 3, phrase_direction: 2 };
/** Long calls (orchestration asks about every layer) keep their first questions. */
const MAX_QUESTIONS = 18;
/** Status lines put back for the body-tracking progress. */
const TRACKING_STEPS = 12;

/** Probabilities are shown as whole percentages, so two decimals lose nothing on screen. */
function round(value: unknown, places = 3): unknown {
  const f = 10 ** places;
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.round(value * f) / f;
  if (Array.isArray(value)) return value.map((v) => round(v, places));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = round(v, k === 'probabilities' || k === 'questions' ? 2 : places);
    return out;
  }
  return value;
}

function trimQuestion(q: QuestionView): QuestionView {
  if (q.type !== 'choice') return q;
  const keys = Object.keys(q.probabilities);
  if (keys.length <= MAX_OPTIONS) return q;
  const sorted = keys.sort((a, b) => q.probabilities[b] - q.probabilities[a]);
  const keep = new Set(sorted.slice(0, MAX_OPTIONS));
  for (const k of q.picked) keep.add(k);
  const dropped = keys.filter((k) => !keep.has(k));
  const probabilities: Record<string, number> = {};
  for (const k of keep) probabilities[k] = q.probabilities[k];
  probabilities._rest = dropped.reduce((a, k) => a + q.probabilities[k], 0);
  const options = (q.options ?? []).filter((o) => keep.has(o.key));
  options.push({ key: '_rest', label: `${dropped.length} other options` });
  return { ...q, options, probabilities };
}

// ── packing ──

interface QuestionSet {
  id: string;
  type: QuestionView['type'];
  label: string;
  options?: QuestionView['options'];
  picking: QuestionView['picking'];
  keys: string[];
}

const questionSets: QuestionSet[] = [];
const questionIndex = new Map<string, number>();
const names: string[] = [];
const nameIndex = new Map<string, number>();

function nameId(name: string): number {
  let n = nameIndex.get(name);
  if (n === undefined) {
    n = names.length;
    names.push(name);
    nameIndex.set(name, n);
  }
  return n;
}

function packQuestion(q: QuestionView): [number, number[], string[]] {
  const keys = Object.keys(q.probabilities);
  const set: QuestionSet = { id: q.id, type: q.type, label: q.label, ...(q.options ? { options: q.options } : {}), picking: q.picking, keys };
  const key = JSON.stringify(set);
  let n = questionIndex.get(key);
  if (n === undefined) {
    n = questionSets.length;
    questionSets.push(set);
    questionIndex.set(key, n);
  }
  return [n, keys.map((k) => q.probabilities[k]), q.picked];
}

function packCall(call: CallView): unknown {
  return { ...call, questions: call.questions.slice(0, MAX_QUESTIONS).map(trimQuestion).map(packQuestion) };
}

const packNote = (n: NoteEvent): number[] => [n.t, n.dur, n.midi, n.vel, nameId(n.inst), nameId(n.art), nameId(n.layer)];
const packPitch = (n: { midi: number; t: number; dur: number }): number[] => [n.midi, n.t, n.dur];

function packCue(cue: LiveCue): unknown {
  return cue.accent ? { ...cue, accent: { ...cue.accent, notes: cue.accent.notes.map(packNote) } } : cue;
}

/** The beat's raw evidence is large: landings to centiseconds and two-place weights. */
function trimBeat(e: Extract<ChoreoServerEvent, { type: 'beat' }>): unknown {
  const b = e.beat;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    type: 'beat',
    beat: {
      ...b,
      landings: b.landings.filter((l) => l.weight >= 0.005).map((l) => ({ t: r2(l.t), weight: r2(l.weight) })),
      stretches: b.stretches.map((s) => ({ ...s, startSec: r2(s.startSec), endSec: r2(s.endSec) })),
    },
  };
}

function packEvent(e: ChoreoServerEvent): unknown {
  switch (e.type) {
    case 'call':
      return { type: 'call', call: packCall(e.call) };
    case 'beat':
      return trimBeat(e);
    case 'phrase':
      return { ...e, score: { ...e.score, notes: e.score.notes.map(packNote) } };
    case 'phrase_drafts':
    case 'theme_drafts':
      return { ...e, drafts: e.drafts.map((d) => ({ ...d, notes: d.notes.map(packPitch) })) };
    case 'theme':
      return { ...e, theme: { ...e.theme, notes: e.theme.notes.map(packPitch) } };
    case 'live':
      return { ...e, cue: packCue(e.cue) };
    default:
      return e;
  }
}

function trackingStatuses(total: number): ChoreoServerEvent[] {
  return Array.from({ length: TRACKING_STEPS }, (_, i) => ({
    type: 'status' as const,
    stage: 'loading' as const,
    message: `Tracking the dancers' bodies: frame ${Math.round(((i + 1) / TRACKING_STEPS) * total)} of ${total}`,
  }));
}

// ── build ──

const sample = JSON.parse(readFileSync(`${root}.cache/sample-run.json`, 'utf8')) as ChoreoServerEvent[];
const liveRun = JSON.parse(readFileSync(`${root}.cache/live-run.json`, 'utf8')) as ChoreoServerEvent[];

const frameCount = sample.flatMap((e) => (e.type === 'clip' ? [e.clip.frameCount] : []))[0] ?? 1000;
const hasTracking = sample.some((e) => e.type === 'status' && /bodies: frame \d+ of/.test(e.message));

const seen: Partial<Record<CallType, number>> = {};
const events: unknown[] = [];
for (const e of sample) {
  if (e.type === 'call') {
    const type = e.call.callType;
    const n = (seen[type] = (seen[type] ?? 0) + 1);
    const every = KEEP_EVERY[type];
    if (every && (n - 1) % every !== 0) continue;
  }
  events.push(packEvent(e));
  if (e.type === 'status' && !hasTracking && /^Tracking the dancers/.test(e.message)) {
    events.push(...trackingStatuses(frameCount));
  }
}

// Live reads come in pairs: the live_read call, then the cue it produced.
const live: { call: unknown; cue: unknown }[] = [];
let pendingCall: CallView | null = null;
for (const e of liveRun) {
  if (e.type === 'call' && e.call.callType === 'live_read') pendingCall = e.call;
  else if (e.type === 'live' && pendingCall) {
    live.push({ call: packCall(pendingCall), cue: packCue(e.cue) });
    pendingCall = null;
  }
}

const body = round({ events, live }) as object;
const out = JSON.stringify({ questionSets: round(questionSets, 2), names, ...body });
writeFileSync(fileURLToPath(new URL('./sample-run.json', import.meta.url)), out);

const kb = (v: unknown): string => `${(JSON.stringify(v).length / 1024).toFixed(0)} KB`;
const byType: Record<string, unknown[]> = {};
for (const e of (body as { events: { type: string; call?: { callType: string } }[] }).events) {
  (byType[e.type === 'call' ? `call:${e.call!.callType}` : e.type] ??= []).push(e);
}
const biggest = Object.entries(byType).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length).slice(0, 6);
console.log(`${events.length} events, ${live.length} live reads, ${questionSets.length} question sets, ${(out.length / 1024).toFixed(0)} KB`);
console.log(`biggest: ${biggest.map(([k, v]) => `${k} ${kb(v)}`).join(', ')}; live ${kb((body as { live: unknown }).live)}; question sets ${kb(questionSets)}`);
