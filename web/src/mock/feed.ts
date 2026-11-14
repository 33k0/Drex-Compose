// Scripted stand-in for the server, used when the URL has ?mock=1 (add &speed=3 to hurry it).
// It replays a trimmed, packed copy of a real headless run on the demo clip firestarter-choreo.mp4
// (sample-run.json, built by trim-sample.ts): body tracking, the beat found from the dancers, the
// pre-scan readings arriving out of order, tempo, rules, how each section change is marked, plan,
// the beat grid, themes, every judged phrase, the extra hits, ready; then, while the video plays,
// the live reads two seconds ahead of the playhead, as the server does. Every session reports
// standin: true and the header labels it as a scripted run, so it is never passed off as the real Drex.

import type { ChoreoClientEvent, ChoreoServerEvent, LiveCue } from '../../../shared/choreo';
import type { CallType, CallView, NoteEvent, QuestionView } from '../../../shared/types';

export interface MockFeed {
  start(event: Extract<ChoreoClientEvent, { type: 'start_clip' }>): void;
  stop(): void;
  /** Playback reports from the panel (video_time). */
  client(event: ChoreoClientEvent): void;
}

/** What questions of one kind share (see trim-sample.ts); each stored question is [set, probabilities, picked]. */
interface QuestionSet {
  id: string;
  type: QuestionView['type'];
  label: string;
  options?: QuestionView['options'];
  picking: QuestionView['picking'];
  keys: string[];
}
type StoredQuestion = [number, number[], string[]];
interface Sample {
  questionSets: QuestionSet[];
  /** Instrument, articulation and layer names that packed notes point into. */
  names: string[];
  /** Events with packed calls and notes; unpack() restores them. */
  events: ChoreoServerEvent[];
  live: { call: CallView; cue: LiveCue }[];
}

class Cancelled extends Error {}

/** Base delay before each kind of event, in ms at speed 1. */
const CALL_DELAY: Partial<Record<CallType, number>> = {
  frame_reading: 150, tempo: 900, setup: 750, plan: 800, fit: 400, theme_shape: 400, theme_note: 120,
  theme_judge: 800, theme_derive: 400, phrase_direction: 220, chord_path: 160, voice_leading: 110,
  phrase_judge: 380, orchestration: 260, plan_revision: 380, ending: 600,
};
const EVENT_DELAY: Partial<Record<ChoreoServerEvent['type'], number>> = {
  session: 0, status: 260, clip: 400, beat: 700, motion: 500, reading: 40, prescan_progress: 0, timeline: 700,
  tempo: 1500, rules: 1100, fit: 600, plan: 500, grid: 600, theme_drafts: 1600, theme: 350, phrase_drafts: 1150,
  phrase: 300, hits: 400, stats: 0, ready: 700, done: 0,
};
/** The live read looks this many seconds ahead of the playhead (server/choreo/live.ts). */
const LIVE_LEAD_SEC = 2;

let samplePromise: Promise<Sample> | null = null;
function loadSample(): Promise<Sample> {
  // A lazy chunk: only mock mode downloads it.
  samplePromise ??= import('./sample-run.json').then((m) => (m.default ?? m) as unknown as Sample);
  return samplePromise;
}

export function resolveCall(call: CallView, sets: QuestionSet[]): CallView {
  const questions = (call.questions as unknown as StoredQuestion[]).map(([n, p, picked]): QuestionView => {
    const set = sets[n];
    const probabilities: Record<string, number> = {};
    set.keys.forEach((k, i) => { probabilities[k] = p[i] ?? 0; });
    return {
      id: set.id, type: set.type, label: set.label, ...(set.options ? { options: set.options } : {}),
      probabilities, picked, picking: set.picking,
    };
  });
  return { ...call, questions };
}

type Packed = number[];

function unpackNotes(notes: unknown, names: string[]): NoteEvent[] {
  return (notes as Packed[]).map(([t, dur, midi, vel, inst, art, layer]) => ({
    t, dur, midi, vel, inst: names[inst], art: names[art], layer: names[layer],
  }) as NoteEvent);
}

function unpackPitches(notes: unknown): { midi: number; t: number; dur: number }[] {
  return (notes as Packed[]).map(([midi, t, dur]) => ({ midi, t, dur }));
}

function unpackCue(cue: LiveCue, names: string[]): LiveCue {
  return cue.accent ? { ...cue, accent: { ...cue.accent, notes: unpackNotes(cue.accent.notes, names) } } : cue;
}

/** Restore the packed notes of a recorded event (calls are restored separately, as they are stamped). */
export function unpack(e: ChoreoServerEvent, names: string[]): ChoreoServerEvent {
  switch (e.type) {
    case 'phrase':
      return { ...e, score: { ...e.score, notes: unpackNotes(e.score.notes, names) } };
    case 'phrase_drafts':
    case 'theme_drafts':
      return { ...e, drafts: e.drafts.map((d) => ({ ...d, notes: unpackPitches(d.notes) })) };
    case 'theme':
      return { ...e, theme: { ...e.theme, notes: unpackPitches(e.theme.notes) } };
    default:
      return e;
  }
}

/** Readings arrive in parallel on the server: shuffle them within small windows. */
function shufflePrescan(events: ChoreoServerEvent[]): ChoreoServerEvent[] {
  const first = events.findIndex((e) => e.type === 'call' && e.call.callType === 'frame_reading');
  const last = events.findIndex((e) => e.type === 'timeline');
  if (first < 0 || last < 0) return events;
  // Group each frame_reading call with the reading (and stats) that follow it.
  const groups: ChoreoServerEvent[][] = [];
  for (const e of events.slice(first, last)) {
    if (e.type === 'prescan_progress') continue;
    if (e.type === 'call') groups.push([e]);
    else groups[groups.length - 1]?.push(e);
  }
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const shuffled: ChoreoServerEvent[][] = [];
  for (let i = 0; i < groups.length; i += 6) {
    const win = groups.slice(i, i + 6);
    for (let j = win.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [win[j], win[k]] = [win[k], win[j]];
    }
    shuffled.push(...win);
  }
  const total = groups.length;
  const replay: ChoreoServerEvent[] = [];
  shuffled.forEach((g, i) => replay.push(...g, { type: 'prescan_progress', done: i + 1, total }));
  return [...events.slice(0, first), ...replay, ...events.slice(last)];
}

export function createMockFeed(emit: (event: ChoreoServerEvent) => void): MockFeed {
  let generation = 0;
  let t0 = 0;
  let nextCallId = 1;
  let ready = false;
  let liveDone = new Set<number>();
  let liveBySecond = new Map<number, { call: CallView; cue: LiveCue }>();
  let questionSets: QuestionSet[] = [];
  let names: string[] = [];
  const speedParam = Number(new URLSearchParams(location.search).get('speed'));
  const speed = Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 1;

  function stop(): void {
    generation += 1;
    ready = false;
  }

  const wait = (ms: number, mine: number): Promise<void> =>
    new Promise((resolve, reject) => {
      window.setTimeout(() => (mine === generation ? resolve() : reject(new Cancelled())), ms / speed);
    });

  function stamp(call: CallView): CallView {
    return { ...call, id: nextCallId++, at: Math.round(performance.now() - t0) };
  }

  function start(req: Extract<ChoreoClientEvent, { type: 'start_clip' }>): void {
    generation += 1;
    const mine = generation;
    ready = false;
    liveDone = new Set();
    nextCallId = 1;
    replay(req, mine).catch((err) => {
      if (!(err instanceof Cancelled)) console.error('[mock] replay failed:', err);
    });
  }

  async function replay(req: Extract<ChoreoClientEvent, { type: 'start_clip' }>, mine: number): Promise<void> {
    const sample = await loadSample();
    if (mine !== generation) return;
    t0 = performance.now();
    liveBySecond = new Map(sample.live.map((l) => [Math.floor(l.cue.atSec), l]));
    questionSets = sample.questionSets;
    names = sample.names;
    const prompt = (req.prompt ?? '').trim();
    for (const e of shufflePrescan(sample.events)) {
      const delay = e.type === 'call' ? CALL_DELAY[e.call.callType] ?? 300 : EVENT_DELAY[e.type] ?? 200;
      if (delay > 0) await wait(delay, mine);
      if (mine !== generation) return;
      switch (e.type) {
        case 'session':
          emit({ ...e, id: `mock-${mine}`, prompt, standin: true, model: 'scripted' });
          break;
        case 'clip':
          emit({ ...e, prompt });
          break;
        case 'call':
          emit({ type: 'call', call: stamp(resolveCall(e.call, sample.questionSets)) });
          break;
        case 'tempo':
          emit(req.tap
            ? { type: 'tempo', tempo: { ...e.tempo, bpm: Math.round(req.tap.bpm), offsetSec: req.tap.offsetSec, manual: true, drexBpm: e.tempo.bpm, source: 'tap' } }
            : e);
          break;
        case 'ready':
          ready = true;
          emit(e);
          break;
        default:
          emit(unpack(e, sample.names));
      }
    }
  }

  function client(event: ChoreoClientEvent): void {
    if (event.type !== 'video_time') return;
    if (event.sec < 0.6) liveDone.clear();
    if (!ready || !event.playing) return;
    const second = Math.floor(event.sec) + LIVE_LEAD_SEC;
    if (liveDone.has(second)) return;
    liveDone.add(second);
    const entry = liveBySecond.get(second);
    if (!entry) return;
    const mine = generation;
    window.setTimeout(() => {
      if (mine !== generation) return;
      emit({ type: 'call', call: stamp(resolveCall(entry.call, questionSets)) });
      emit({ type: 'live', cue: unpackCue(entry.cue, names) });
    }, 180);
  }

  return { start, stop, client };
}
