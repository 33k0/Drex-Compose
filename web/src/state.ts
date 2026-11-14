// One pure reducer that folds server events (plus a few local events from the socket, the audio
// engine and the video clock) into everything the panel shows. No timers, no DOM, no engine calls
// in here: per-frame values (video time, layer levels) are read straight from the clock and the
// engine by the components that need them.

import type {
  BeatView, ChoreoServerEvent, ClipInfo, FitView, GridView, LiveCue, Reading, TempoView, VideoSection,
} from '../../shared/choreo';
import type {
  CallType, CallView, DraftView, PhraseScore, PlanView, RulesView, Stage, ThemeView, VerdictView,
} from '../../shared/types';

export type Conn = 'connecting' | 'open' | 'reconnecting' | 'mock';
export type RunPhase = 'idle' | 'starting' | 'running' | 'stopped' | 'error';
/** pending: engine still loading. real: sound comes out. silent: engine unavailable, a timer stands in. */
export type AudioMode = 'pending' | 'real' | 'silent';
/** Which desk the panel shows. */
export type DeskView = 'clip' | 'prescan' | 'composing' | 'playback';

export interface Health {
  ok: boolean;
  standin: boolean;
  model: string;
}

export type LocalEvent =
  | { type: 'local/conn'; conn: Conn }
  | { type: 'local/health'; health: Health }
  | { type: 'local/start'; clip: string; prompt: string }
  | { type: 'local/stopped' }
  /** Back to the clip stage: forget the run. */
  | { type: 'local/reset' }
  | { type: 'local/audio'; mode: AudioMode }
  | { type: 'local/instruments'; loaded: number; total: number; ready: boolean }
  /** The phrase under the video playhead changed (null before the first phrase). */
  | { type: 'local/now'; index: number | null }
  | { type: 'local/playing'; playing: boolean }
  | { type: 'local/ended' };

export type Action = ChoreoServerEvent | LocalEvent;

export interface DraftRound {
  /** Arrival order across the whole run. */
  seq: number;
  kind: 'theme' | 'phrase';
  themeId: string | null;
  phrase: number | null;
  round: number;
  drafts: DraftView[];
  verdict: VerdictView;
  /** The judge turned every draft down. */
  rejected: boolean;
}

export interface SessionInfo {
  id: string;
  prompt: string;
  standin: boolean;
  model: string;
  seed: number;
}

export interface Stats {
  calls: number;
  callsLastMinute: number;
  rejects: number;
  composed: number;
}

export interface Motion {
  perSecond: number[];
  cuts: number[];
  peaksSec: number[];
}

export interface PanelState {
  conn: Conn;
  health: Health | null;
  phase: RunPhase;
  /** The clip file and prompt the user sent for this run (named before the server's clip event). */
  pending: { clip: string; prompt: string } | null;
  session: SessionInfo | null;
  stage: Stage;
  message: string;

  // ── what Drex read from the clip ──
  clip: ClipInfo | null;
  motion: Motion | null;
  prescan: { done: number; total: number };
  /** Readings keyed by second. They arrive in parallel, out of order. */
  readings: Record<number, Reading>;
  /** Second of the most recently arrived reading. */
  lastReading: number | null;
  /** The beat found in the dancers' bodies (or, failing that, the pixels): candidates, stretches, landings. */
  beat: BeatView | null;
  /** The sections the picture divides into; replaced whole when re-sent. */
  videoSections: VideoSection[];
  tempo: TempoView | null;
  /** The one rigid beat grid the whole score sits on: tempo, first downbeat, bridges. */
  grid: GridView | null;
  /** How each section change is marked inside the beat (fill, drop bar, riser, crash), keyed by section index. */
  fits: Record<number, FitView>;
  /** Video times of the extra drum hits placed on the dancers' biggest landings. */
  hits: number[];

  // ── the piece ──
  rules: RulesView | null;
  plan: PlanView | null;
  /** The plan before the latest revision, for the ghost curve. */
  previousPlan: PlanView | null;
  planRevisions: number;
  themeRounds: DraftRound[];
  themes: ThemeView[];
  /** Judge rounds per phrase index, in arrival order. */
  phraseRounds: Record<number, DraftRound[]>;
  /** The most recent judge round of either kind: what the drafts view shows. */
  focusRound: DraftRound | null;
  /** The most recent all-rejected round, kept so it can still be pointed at after the redraft. */
  lastRejection: DraftRound | null;
  roundSeq: number;
  /** Accepted phrases keyed by phrase index; each carries its startSec on the video clock. */
  phrases: Record<number, PhraseScore>;
  /** Highest phrase index composed so far, -1 before the first. */
  composedThrough: number;
  /** The whole piece is composed: playback can start. */
  ready: { totalSec: number; phrases: number } | null;

  // ── calls ──
  /** Recent calls, oldest first, capped. */
  calls: CallView[];
  /** The call shown at full size. */
  featured: CallView | null;
  /** The latest judge call, shown again when playback starts and before the live reads arrive. */
  lastJudge: CallView | null;
  stats: Stats;

  // ── playback ──
  /** Live-read refinements, in arrival order. */
  liveCues: LiveCue[];
  /** Phrase under the video playhead. null before playback or before the first phrase. */
  nowIndex: number | null;
  playing: boolean;
  playbackStarted: boolean;
  videoEnded: boolean;

  error: string | null;
  serverDone: boolean;
  audio: { mode: AudioMode; loaded: number; total: number; instrumentsReady: boolean };
}

export const CALL_LOG_LIMIT = 60;
export const LIVE_CUE_LIMIT = 600;
export const CONNECTION_LOST = 'Connection to the server lost. Reconnecting.';

const EMPTY_STATS: Stats = { calls: 0, callsLastMinute: 0, rejects: 0, composed: 0 };

/** Fields that belong to one run; cleared on every new clip and every new session. */
function freshRun() {
  return {
    session: null as SessionInfo | null,
    stage: 'idle' as Stage,
    message: '',
    clip: null as ClipInfo | null,
    motion: null as Motion | null,
    prescan: { done: 0, total: 0 },
    readings: {} as Record<number, Reading>,
    lastReading: null as number | null,
    beat: null as BeatView | null,
    videoSections: [] as VideoSection[],
    tempo: null as TempoView | null,
    grid: null as GridView | null,
    fits: {} as Record<number, FitView>,
    hits: [] as number[],
    rules: null as RulesView | null,
    plan: null as PlanView | null,
    previousPlan: null as PlanView | null,
    planRevisions: 0,
    themeRounds: [] as DraftRound[],
    themes: [] as ThemeView[],
    phraseRounds: {} as Record<number, DraftRound[]>,
    focusRound: null as DraftRound | null,
    lastRejection: null as DraftRound | null,
    roundSeq: 0,
    phrases: {} as Record<number, PhraseScore>,
    composedThrough: -1,
    ready: null as PanelState['ready'],
    calls: [] as CallView[],
    featured: null as CallView | null,
    lastJudge: null as CallView | null,
    stats: EMPTY_STATS,
    liveCues: [] as LiveCue[],
    nowIndex: null as number | null,
    playing: false,
    playbackStarted: false,
    videoEnded: false,
    error: null as string | null,
    serverDone: false,
  };
}

export function initialState(): PanelState {
  return {
    conn: 'connecting',
    health: null,
    phase: 'idle',
    pending: null,
    ...freshRun(),
    audio: { mode: 'pending', loaded: 0, total: 0, instrumentsReady: false },
  };
}

// ───────────────────────────── Which call gets the big view ─────────────────────────────

const INTEREST: Partial<Record<CallType, number>> = {
  setup: 3, plan: 3, plan_revision: 3, theme_judge: 3, phrase_judge: 3, ending: 3,
  tempo: 3, fit: 3, live_read: 3,
  theme_note: 1, voice_leading: 1,
};

export function callInterest(type: CallType): number {
  return INTEREST[type] ?? 2;
}

/** How long a featured call keeps the big view before a routine call may replace it (ms). */
export function callDwell(type: CallType): number {
  const rank = callInterest(type);
  return rank >= 3 ? 2400 : rank === 2 ? 1200 : 600;
}

/**
 * Calls arrive faster than a room can read. Every call goes to the log; the big view changes
 * only when the one on screen has had its moment, or something more important arrives.
 * Verdicts, rules, tempo and live reads are never skipped.
 */
export function shouldFeature(current: CallView | null, incoming: CallView): boolean {
  if (!current) return true;
  if (incoming.questions.length === 0) return false;
  const now = callInterest(current.callType);
  const next = callInterest(incoming.callType);
  if (next > now) return true;
  if (next === now && next >= 3) return true;
  return incoming.at - current.at >= callDwell(current.callType);
}

// ───────────────────────────── Reducer ─────────────────────────────

function planChanged(a: PlanView, b: PlanView): boolean {
  if (a.totalPhrases !== b.totalPhrases || a.climaxPhrase !== b.climaxPhrase) return true;
  if (a.sections.length !== b.sections.length) return true;
  return a.sections.some((s, i) => {
    const t = b.sections[i];
    return s.role !== t.role || s.tension !== t.tension || s.departure !== t.departure
      || s.phrases[0] !== t.phrases[0] || s.phrases[1] !== t.phrases[1] || s.keyName !== t.keyName;
  });
}

const silentAudio = (s: PanelState) => ({ ...s.audio, loaded: 0, total: 0, instrumentsReady: false });

export function reduce(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    // ── local, any time ──
    case 'local/conn': {
      if (state.conn === action.conn) return state;
      const live = state.phase === 'running' || state.phase === 'starting';
      // Losing the socket mid-run is worth saying out loud; the note clears when it returns.
      if (action.conn === 'reconnecting' && live && !state.error) {
        return { ...state, conn: action.conn, error: CONNECTION_LOST };
      }
      if (action.conn === 'open' && state.error === CONNECTION_LOST) {
        return { ...state, conn: action.conn, error: null };
      }
      return { ...state, conn: action.conn };
    }

    case 'local/health':
      return { ...state, health: action.health };

    case 'local/audio':
      return { ...state, audio: { ...state.audio, mode: action.mode } };

    case 'local/start':
      return {
        ...state,
        ...freshRun(),
        phase: 'starting',
        pending: { clip: action.clip, prompt: action.prompt },
        audio: silentAudio(state),
      };

    case 'local/stopped':
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'stopped' };

    case 'local/reset':
      return { ...state, ...freshRun(), phase: 'idle', pending: null, audio: silentAudio(state) };

    // Playback of a composed piece keeps working after a stop, so these are not run-gated.
    case 'local/now':
      return state.nowIndex === action.index ? state : { ...state, nowIndex: action.index };

    case 'local/playing':
      if (!state.ready) return state;
      if (state.playing === action.playing) return state;
      return {
        ...state,
        playing: action.playing,
        playbackStarted: state.playbackStarted || action.playing,
        videoEnded: action.playing ? false : state.videoEnded,
      };

    case 'local/ended':
      return { ...state, playing: false, videoEnded: true };

    case 'error':
      // Refused before a session started (e.g. "No such clip"): the run ends here.
      if (state.phase === 'starting') return { ...state, phase: 'error', error: action.message };
      break;

    case 'session':
      return {
        ...state,
        ...freshRun(),
        phase: 'running',
        session: {
          id: action.id, prompt: action.prompt, standin: action.standin,
          model: action.model, seed: action.seed,
        },
        audio: silentAudio(state),
      };

    default:
      break;
  }

  // Everything below belongs to a live run. Late events from a stopped or superseded run
  // (the server may still be flushing) must not leak into the next one. A finished run stays
  // 'running' so the live reads that arrive during playback are still taken.
  if (state.phase !== 'running') return state;

  switch (action.type) {
    case 'local/instruments':
      return {
        ...state,
        audio: { ...state.audio, loaded: action.loaded, total: action.total, instrumentsReady: action.ready },
      };

    case 'status': {
      const next = { ...state, stage: action.stage, message: action.message };
      if (action.stage === 'error') return { ...next, phase: 'error', error: state.error ?? action.message };
      // A non-fatal error stays on the status line until the server reports what it did next.
      return state.error && state.error !== CONNECTION_LOST ? { ...next, error: null } : next;
    }

    case 'call': {
      const c = action.call;
      const calls = state.calls.length >= CALL_LOG_LIMIT
        ? [...state.calls.slice(state.calls.length - CALL_LOG_LIMIT + 1), c]
        : [...state.calls, c];
      const featured = shouldFeature(state.featured, c) ? c : state.featured;
      const judge = c.callType === 'phrase_judge' || c.callType === 'theme_judge';
      return { ...state, calls, featured, lastJudge: judge ? c : state.lastJudge };
    }

    case 'clip':
      return { ...state, clip: action.clip };

    case 'motion':
      return { ...state, motion: { perSecond: action.perSecond, cuts: action.cuts, peaksSec: action.peaksSec } };

    case 'prescan_progress':
      return { ...state, prescan: { done: Math.max(state.prescan.done, action.done), total: action.total } };

    case 'reading': {
      const r = action.reading;
      return { ...state, readings: { ...state.readings, [r.second]: r }, lastReading: r.second };
    }

    case 'beat':
      return { ...state, beat: action.beat };

    case 'timeline':
      return { ...state, videoSections: action.sections };

    case 'tempo':
      return { ...state, tempo: action.tempo };

    case 'fit':
      return { ...state, fits: { ...state.fits, [action.fit.section]: action.fit } };

    case 'grid':
      return { ...state, grid: action.grid };

    case 'hits':
      return { ...state, hits: [...action.times].sort((a, b) => a - b) };

    case 'rules':
      return { ...state, rules: action.rules };

    case 'plan': {
      const prev = state.plan;
      if (prev && (action.plan.revised || planChanged(prev, action.plan))) {
        return { ...state, plan: action.plan, previousPlan: prev, planRevisions: state.planRevisions + 1 };
      }
      return { ...state, plan: action.plan };
    }

    case 'theme_drafts': {
      const round: DraftRound = {
        seq: state.roundSeq + 1, kind: 'theme', themeId: action.themeId, phrase: null,
        round: action.round, drafts: action.drafts, verdict: action.verdict,
        rejected: action.verdict.picked === null,
      };
      return {
        ...state,
        roundSeq: round.seq,
        themeRounds: [...state.themeRounds, round],
        focusRound: round,
        lastRejection: round.rejected ? round : state.lastRejection,
      };
    }

    case 'theme': {
      const others = state.themes.filter((t) => t.id !== action.theme.id);
      return { ...state, themes: [...others, action.theme] };
    }

    case 'phrase_drafts': {
      const round: DraftRound = {
        seq: state.roundSeq + 1, kind: 'phrase', themeId: null, phrase: action.phrase,
        round: action.round, drafts: action.drafts, verdict: action.verdict,
        rejected: action.verdict.picked === null,
      };
      const existing = state.phraseRounds[action.phrase] ?? [];
      return {
        ...state,
        roundSeq: round.seq,
        phraseRounds: { ...state.phraseRounds, [action.phrase]: [...existing, round] },
        focusRound: round,
        lastRejection: round.rejected ? round : state.lastRejection,
      };
    }

    case 'phrase': {
      const score = action.score;
      return {
        ...state,
        phrases: { ...state.phrases, [score.index]: score },
        composedThrough: Math.max(state.composedThrough, score.index),
      };
    }

    case 'ready':
      // Bring the last verdict back to the big view until the first live read arrives.
      return {
        ...state,
        ready: { totalSec: action.totalSec, phrases: action.phrases },
        featured: state.lastJudge ?? state.featured,
      };

    case 'live': {
      const cues = state.liveCues.length >= LIVE_CUE_LIMIT ? state.liveCues.slice(1) : state.liveCues;
      return { ...state, liveCues: [...cues, action.cue] };
    }

    case 'stats':
      return {
        ...state,
        stats: { calls: action.calls, callsLastMinute: action.callsLastMinute, rejects: action.rejects, composed: action.composed },
      };

    case 'error':
      return { ...state, error: action.message };

    case 'done':
      return { ...state, serverDone: true };

    default:
      return state;
  }
}

// ───────────────────────────── Derived views (pure) ─────────────────────────────

/** Which desk to show: the clip stage, the pre-scan, the composing desk, or playback. */
export function deskView(s: Pick<PanelState, 'phase' | 'session' | 'pending' | 'ready' | 'tempo' | 'rules' | 'plan'>): DeskView {
  if (s.phase === 'idle' || (!s.session && !s.pending)) return 'clip';
  if (s.ready) return 'playback';
  if (s.tempo || s.rules || s.plan) return 'composing';
  return 'prescan';
}

/** "Tracking the dancers' bodies: frame 412 of 1176" to { done: 412, total: 1176 }; null for any other message. */
export function trackingProgress(message: string): { done: number; total: number } | null {
  const m = /tracking the dancers.? bodies:\s*frame\s+(\d+)\s+of\s+(\d+)/i.exec(message);
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? { done: Math.min(Number(m[1]), total), total } : null;
}

/** The beat is in doubt: nothing to anchor it on, or no beat anywhere in the clip. */
export function beatUncertain(s: Pick<PanelState, 'beat' | 'grid'>): boolean {
  return Boolean((s.beat && !s.beat.clear) || s.grid?.noBeat);
}

/** Composed phrases in playing order (by startSec, then index). */
export function scoresInOrder(phrases: Record<number, PhraseScore>): PhraseScore[] {
  return Object.values(phrases).sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0) || a.index - b.index);
}

/** Readings that have arrived, by second ascending. */
export function readingsInOrder(readings: Record<number, Reading>): Reading[] {
  return Object.values(readings).sort((a, b) => a.second - b.second);
}

/** "Frames 1:07" (the frame_reading call title) to 67. */
export function secondOfCall(call: CallView | null): number | null {
  if (!call || call.callType !== 'frame_reading') return null;
  const m = /(\d+):(\d{2})/.exec(call.title);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The reading the pre-scan view shows: the one whose call is on the big view, else the newest. */
export function shownReading(s: Pick<PanelState, 'featured' | 'readings' | 'lastReading'>): Reading | null {
  const sec = secondOfCall(s.featured);
  if (sec !== null && s.readings[sec]) return s.readings[sec];
  return s.lastReading === null ? null : s.readings[s.lastReading] ?? null;
}

/** Total all-rejected rounds seen this run (themes and phrases). */
export function rejectedRoundCount(state: Pick<PanelState, 'phraseRounds' | 'themeRounds'>): number {
  let n = state.themeRounds.filter((r) => r.rejected).length;
  for (const rounds of Object.values(state.phraseRounds)) n += rounds.filter((r) => r.rejected).length;
  return n;
}

export interface LineageEntry {
  index: number;
  lineage: string;
  role: string;
  key: string;
  sounding: boolean;
  /** Composed but not yet heard. */
  ahead: boolean;
}

/**
 * The derivation chain the lineage view shows: the phrase now sounding, the ones leading up to
 * it, and what comes next, newest first. Before playback it follows composition.
 */
export function lineageChain(
  state: Pick<PanelState, 'phrases' | 'nowIndex' | 'composedThrough'>,
  limit = 6,
): LineageEntry[] {
  const now = state.nowIndex;
  const top = state.composedThrough;
  if (top < 0) return [];
  const anchor = now ?? top;
  // Show up to two phrases ahead of the playhead, then walk back.
  const start = Math.min(top, anchor + 2);
  const out: LineageEntry[] = [];
  for (let i = start; i >= 0 && out.length < limit; i--) {
    const p = state.phrases[i];
    if (!p) continue;
    out.push({
      index: i,
      lineage: p.display.lineage,
      role: p.role,
      key: p.display.key,
      sounding: now === i,
      ahead: now === null ? false : i > now,
    });
  }
  return out;
}

/** The phrase index sounding at video time `sec`, given phrases in playing order. */
export function phraseAt(ordered: PhraseScore[], sec: number, secondsOf: (p: PhraseScore) => number): number | null {
  let found: number | null = null;
  for (const p of ordered) {
    const start = p.startSec ?? 0;
    if (start > sec) break;
    if (sec < start + secondsOf(p)) found = p.index;
  }
  return found;
}
