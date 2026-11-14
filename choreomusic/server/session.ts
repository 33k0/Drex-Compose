// One scoring run: a video file in; readings, a timeline, a plan and a complete synced score out.
// The whole piece is composed before playback, so nothing can hold up a synced moment.

import { basename, join } from 'node:path';
import type { ChoreoClientEvent, ChoreoServerEvent, ClipInfo, Reading, VideoSection } from '../shared/choreo.ts';
import type { CallType, ServerEvent } from '../shared/types.ts';
import { composePhrase } from './calls/compose.ts';
import { chooseEnding } from './calls/ending.ts';
import { revisePlan, rulesView, runSetup } from './calls/setup.ts';
import { deriveCounterTheme, writeTheme } from './calls/themes.ts';
import { liveRead, LIVE_LEAD_SEC } from './choreo/live.ts';
import { addArrival, addHits, applyBridge, applyCutMark, grooveCoverage, kitOf } from './choreo/groove.ts';
import { runVideoPlan, type Allocation } from './choreo/plan.ts';
import { absoluteMotion, motionSeconds, readSecond } from './choreo/reading.ts';
import { chooseTempo, type TempoChoice } from './choreo/tempo.ts';
import { buildSections, chooseBoundaries, cueFor, keyFrames, moodFromReadings, timelineLines } from './choreo/timeline.ts';
import type { Ctx } from './context.ts';
import { readMood } from './core/mood.ts';
import { hashString, mulberry32 } from './core/rng.ts';
import { DrexError, Gateway } from './gateway/gateway.ts';
import { availableInstruments, Piece, type PictureCue } from './piece.ts';
import { analyseBeat, CLEAR_CONFIDENCE, type BeatAnalysis } from './video/beat.ts';
import { DEFAULT_CACHE_DIR, extractClip, frameBase64, framesForSecond, type ExtractedClip } from './video/extract.ts';
import { PoseUnavailable, trackPose } from './video/pose.ts';
import { analyseMotionSeries, collectMotionSeries, type MotionAnalysis } from './video/motion.ts';

/** Clips that have been extracted, so the HTTP routes can serve their frames and video. */
export const CLIPS = new Map<string, ExtractedClip>();

export interface SessionOptions {
  clipPath: string;
  prompt?: string;
  seed?: number;
  tap?: { bpm: number; offsetSec: number };
  /**
   * Evaluation only (the shuffle control): read the clip's seconds in this order instead of in
   * sequence, so second s of the reading comes from second order[s] of the video.
   */
  order?: number[];
  send: (event: ChoreoServerEvent) => void;
}

export class Session {
  readonly piece: Piece;
  readonly gw: Gateway;
  readonly seed: number;
  rejects = 0;
  /** Extra hits placed on big landings. */
  hits = 0;
  /** Share of beats carrying a kick or snare, per non-bridge phrase. */
  coverage: number[] = [];
  private hitTimes = new Set<number>();
  clip!: ExtractedClip;
  motion!: MotionAnalysis;
  /** The beat found in the dancers' bodies; null when body tracking could not run. */
  beat: BeatAnalysis | null = null;
  readings: Reading[] = [];
  sections: VideoSection[] = [];
  tempo!: TempoChoice;
  alloc!: Allocation;
  private ctx: Ctx;
  private stopped = false;
  private ready = false;
  private keyImages: string[] = [];
  private liveDone = new Set<number>();
  private lastStats = 0;

  constructor(private opts: SessionOptions) {
    const prompt = (opts.prompt ?? '').trim();
    this.seed = opts.seed ?? (hashString(opts.clipPath + prompt) ^ (Date.now() & 0xffff)) >>> 0;
    this.piece = new Piece(prompt || '(no prompt: score what the picture does)', readMood(prompt));
    const withKeyFrames: CallType[] = ['tempo', 'setup', 'plan', 'theme_judge', 'fit'];
    this.gw = new Gateway({
      seed: this.seed,
      imagesFor: (callType) => (withKeyFrames.includes(callType) && this.keyImages.length ? this.keyImages : undefined),
      onCall: (call) => {
        this.send({ type: 'call', call });
        if (Date.now() - this.lastStats > 400) this.stats();
      },
    });
    this.ctx = { gw: this.gw, piece: this.piece, rng: mulberry32(this.seed), emit: (e: ServerEvent) => this.send(e) };
  }

  private send(event: ChoreoServerEvent) {
    if (!this.stopped) this.opts.send(event);
  }

  private stats() {
    this.lastStats = Date.now();
    this.send({ type: 'stats', calls: this.gw.calls, callsLastMinute: this.gw.callsLastMinute(), rejects: this.rejects, holds: 0, composed: this.piece.phrases.length });
  }

  stop() {
    this.stopped = true;
    this.gw.abort();
  }

  onClient(event: ChoreoClientEvent) {
    if (event.type === 'stop') this.stop();
    else if (event.type === 'video_time' && event.playing) void this.live(event.sec);
  }

  /** Each second of playback, read the frames two to three seconds ahead and refine. */
  private async live(nowSec: number) {
    if (!this.ready || this.stopped) return;
    const second = Math.floor(nowSec) + LIVE_LEAD_SEC;
    if (second >= this.readings.length || this.liveDone.has(second)) return;
    this.liveDone.add(second);
    try {
      const cue = await liveRead(this.gw, this.piece, this.clip, this.readings, this.motion, this.alloc.starts, this.alloc.ends, second, nowSec);
      if (cue) this.send({ type: 'live', cue });
    } catch (err) {
      if (!(err instanceof DrexError && err.kind === 'aborted')) console.error('[live]', err);
    }
  }

  /** Forget which seconds were live-read (the video was restarted). */
  resetLive() {
    this.liveDone.clear();
  }

  private async setKeyFrames() {
    this.keyImages = await Promise.all(keyFrames(this.clip, this.sections).map(frameBase64));
  }

  async run(): Promise<void> {
    const { piece, ctx } = this;
    const name = basename(this.opts.clipPath);
    const prompt = (this.opts.prompt ?? '').trim();
    try {
      this.send({ type: 'session', id: `c${this.seed.toString(36)}`, prompt, standin: this.gw.standin, model: this.gw.model, seed: this.seed });

      // Frames and motion.
      this.send({ type: 'status', stage: 'loading', message: 'Extracting six frames a second' });
      this.clip = await extractClip(this.opts.clipPath);
      CLIPS.set(this.clip.id, this.clip);
      const info: ClipInfo = {
        id: this.clip.id, name, durationSec: this.clip.durationSec, width: this.clip.width, height: this.clip.height,
        videoUrl: `/media/${this.clip.id}/video`, frameUrl: `/media/${this.clip.id}/frame/{i}.jpg`, frameCount: this.clip.frames.length, fps: 6,
      };
      this.send({ type: 'clip', clip: info, prompt });
      const series = await collectMotionSeries(this.opts.clipPath);
      this.motion = analyseMotionSeries(series);
      const absolute = absoluteMotion(series, this.motion.cuts);

      // The beat, from the dancers' bodies alone.
      this.send({ type: 'status', stage: 'loading', message: "Tracking the dancers' bodies to find the beat" });
      let note: string | undefined;
      try {
        const pose = await trackPose(this.opts.clipPath, join(DEFAULT_CACHE_DIR, this.clip.id, 'pose.json'), (done, total) =>
          this.send({ type: 'status', stage: 'loading', message: `Tracking the dancers' bodies: frame ${done} of ${total}` }));
        this.beat = analyseBeat(pose, this.clip.width / this.clip.height);
      } catch (err) {
        if (!(err instanceof PoseUnavailable)) throw err;
        note = err.message;
        console.warn('[beat]', err.message);
      }
      const beat = this.beat;
      this.send({
        type: 'beat',
        beat: {
          method: beat && beat.candidates.length ? 'body' : 'pixels', note: note ?? (beat && !beat.candidates.length ? 'no one could be followed in this clip' : undefined),
          people: beat ? Math.round(beat.people * 10) / 10 : 0, confidence: beat?.confidence ?? 0, clear: !!beat && beat.confidence >= CLEAR_CONFIDENCE,
          candidates: beat?.candidates ?? [], stretches: (beat?.stretches ?? []).map((s) => ({ startSec: s.startSec, endSec: s.endSec, agreement: s.agreement, clear: s.clear })),
          landings: (beat?.landings ?? []).map((l) => ({ t: Math.round(l.t * 100) / 100, weight: Math.round(l.weight * 100) / 100 })),
        },
      });
      this.send({ type: 'motion', perSecond: this.motion.perSecond, cuts: this.motion.cuts, peaksSec: this.motion.peaksSec });

      // Pre-scan: Drex reads the whole clip, one request per second of video.
      let total = Math.ceil(this.clip.durationSec);
      while (total > 1 && framesForSecond(this.clip, total - 1).length < 3) total--;
      this.send({ type: 'status', stage: 'prescan', message: `Drex is reading the clip: ${total} seconds, six frames each` });
      let ms = motionSeconds(this.motion, total, absolute);
      const order = this.opts.order?.length === total ? this.opts.order : null;
      if (order) {
        ms = order.map((from) => ms[from]);
        this.motion = { ...this.motion, perSecond: order.map((from) => this.motion.perSecond[from] ?? 0), cuts: [], peaksSec: [] };
      }
      const promptMood = prompt ? readMood(prompt) : null;
      let done = 0;
      this.readings = await Promise.all(
        Array.from({ length: total }, async (_x, second) => {
          const reading = await readSecond(this.gw, this.clip, second, total, ms, promptMood, prompt, order ? order[second] : second);
          this.send({ type: 'reading', reading });
          this.send({ type: 'prescan_progress', done: ++done, total });
          return reading;
        }),
      );

      // Sections, timeline, key frames.
      const boundaries = chooseBoundaries(this.readings, this.clip.durationSec);
      this.sections = buildSections(this.readings, boundaries, this.clip.durationSec, this.motion);
      this.send({ type: 'timeline', sections: this.sections });
      piece.mood = moodFromReadings(this.readings, promptMood, name);
      piece.preludeLines = timelineLines(this.sections, this.clip.durationSec, name);
      await this.setKeyFrames();

      // Tempo: code proposes, Drex picks; a manual tap overrides.
      this.send({ type: 'status', stage: 'setup', message: 'Drex is choosing the tempo and the rules of the piece' });
      this.tempo = await chooseTempo(this.gw, this.beat, this.motion, this.sections, [`PROMPT  "${piece.prompt}"`, ...piece.preludeLines], piece.mood, this.opts.tap);
      this.send({ type: 'tempo', tempo: this.tempo.view });

      // Choreography is scored beat-driven, in four, at the dancers' tempo: those are not Drex's to change.
      piece.preludeLines.push(`BEAT    the dancers move at ${this.tempo.bpm.toFixed(2)} BPM; the music is locked to that beat for the whole clip`);
      await runSetup(ctx, { styles: ['beat_driven'], fixed: { bpm: this.tempo.bpm, lengthSec: this.clip.durationSec, form: 'through_composed', meter: '4/4' } });
      // The groove is the centre of the score, so the palette always has a kit, a kick and a bass.
      const must = (['ekit', 'drumkit', 'kick808', 'synth_bass', 'sub'] as string[]).filter((id) => availableInstruments().has(id));
      const kitHere = must.find((id) => id === 'ekit' || id === 'drumkit');
      const bassHere = must.find((id) => id === 'synth_bass' || id === 'sub');
      for (const id of [kitHere, 'kick808', bassHere]) if (id && !piece.rules.palette.includes(id as never)) piece.rules.palette.push(id as never);
      this.send({ type: 'rules', rules: rulesView(ctx) });

      this.send({ type: 'status', stage: 'plan', message: 'Drex is planning the piece around the clip' });
      this.alloc = await runVideoPlan(ctx, this.sections, this.readings, this.tempo, this.clip.durationSec, this.motion.cuts, this.beat?.stretches ?? [],
        (boundaries) => buildSections(this.readings, boundaries, this.clip.durationSec, this.motion, true), (fit) => this.send({ type: 'fit', fit }));
      {
        const bridges: { startSec: number; endSec: number }[] = [];
        this.alloc.bridge.forEach((b, i) => {
          if (!b) return;
          const last = bridges[bridges.length - 1];
          if (last && Math.abs(last.endSec - this.alloc.starts[i]) < 1e-6) last.endSec = this.alloc.ends[i];
          else bridges.push({ startSec: this.alloc.starts[i], endSec: this.alloc.ends[i] });
        });
        this.send({ type: 'grid', grid: { bpm: this.tempo.bpm, barSec: this.alloc.barSec, musicStartSec: this.alloc.musicStartSec, bridges, noBeat: this.alloc.noBeat } });
        // Sections now sit on bar lines of the grid.
        this.sections = this.alloc.sections;
        this.send({ type: 'timeline', sections: this.sections });
        piece.preludeLines = timelineLines(this.sections, this.clip.durationSec, name);
        await this.setKeyFrames();
      }
      const { starts, ends } = this.alloc;
      const cues = new Map<number, PictureCue>();
      piece.picture = (index) => {
        if (index < 0 || index >= starts.length) return null;
        if (!cues.has(index)) {
          const cue = cueFor(this.readings, this.motion, starts[index], ends[index], piece.bpmOf(index), ends[index + 1] ?? null);
          const mark = this.alloc.cutMarks.get(index);
          if (this.alloc.bridge[index]) cue.lines.push('BEAT    the dancers give no clear beat under this phrase: play it as a bridge (kick and snare step back, hats and the top line carry it), ready to bring the full groove back');
          else cue.lines.push('BEAT    the dancers are on the beat here: the groove (kick, snare or clap, hats, bass) keeps running under everything');
          if (mark && mark !== 'none') cue.lines.push(`CHANGE  this phrase ends a section; the change is marked with a ${mark.replace('_', ' ')}`);
          cues.set(index, cue);
        }
        return cues.get(index)!;
      };

      this.send({ type: 'status', stage: 'themes', message: 'Drafting and judging the theme' });
      await writeTheme(ctx, 'A', 'main');
      if (piece.plan.needsCounter) await deriveCounterTheme(ctx, 'B');
      this.stats();

      // The whole piece is composed before playback.
      const totalPhrases = piece.plan.totalPhrases;
      let arrival = false;
      for (let index = 0; index < totalPhrases && !this.stopped; index++) {
        const section = piece.sectionOf(index);
        if (index === section.first && index > 0) await revisePlan(ctx, index);
        const lastSection = piece.plan.sections[piece.plan.sections.length - 1];
        if (!piece.endingPlan && (index === lastSection.first || index === totalPhrases - 1)) await chooseEnding(ctx, index);
        if (piece.roleOf(index) === 'departure' && piece.plan.needsContrast && !piece.theme('C')) await writeTheme(ctx, 'C', 'contrast', piece.mainTheme);
        this.send({ type: 'status', stage: 'composing', message: `Composing phrase ${index + 1} of ${totalPhrases} (${piece.roleOf(index)}, tension ${piece.tensionOf(index)})` });
        const record = await composePhrase(ctx, index, () => {
          this.rejects++;
          this.stats();
        }, () => !this.stopped);
        if (!record) break;
        record.score.startSec = starts[index];
        // Serve the dance: arrivals, cut marks, bridges, and hits on the biggest landings. All on the grid.
        const kit = kitOf(piece.rules.palette);
        if (arrival) addArrival(record.score, kit);
        arrival = false;
        const isBridge = this.alloc.bridge[index];
        if (isBridge) arrival = applyBridge(record.score, kit, this.alloc.bridge[index + 1] === false);
        else {
          const before = record.score.notes.length;
          const added = addHits(record.score, starts[index], this.beat?.landings ?? [], this.readings, kit);
          this.hits += added;
          if (added) for (const n of record.score.notes) if (n.layer === 'accents' && n.midi === 38 && n.vel >= 0.7) this.hitTimes.add(Math.round((starts[index] + (n.t * 60) / record.score.bpm) * 100) / 100);
          void before;
        }
        const mark = this.alloc.cutMarks.get(index);
        if (mark && !this.alloc.noBeat) arrival = applyCutMark(record.score, mark, kit) || arrival;
        if (!isBridge) this.coverage.push(grooveCoverage(record.score));
        this.send({ type: 'phrase', score: record.score });
        this.stats();
      }
      if (this.stopped) return;
      this.send({ type: 'hits', times: [...this.hitTimes].sort((a, b) => a - b) });
      this.ready = true;
      this.send({ type: 'ready', totalSec: this.clip.durationSec, phrases: piece.phrases.length });
      this.send({ type: 'status', stage: 'done', message: `Scored ${piece.phrases.length} phrases in ${this.gw.calls} Drex calls. Press play.` });
      this.send({ type: 'done' });
    } catch (err) {
      if (err instanceof DrexError && err.kind === 'aborted') return;
      console.error('[session]', err);
      const message = err instanceof Error ? err.message : String(err);
      this.send({ type: 'error', message });
      this.send({ type: 'status', stage: 'error', message });
    }
  }
}
