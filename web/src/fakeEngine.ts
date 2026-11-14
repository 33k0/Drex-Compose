// A silent stand-in for the audio engine: same surface, no sound. Its playhead follows the video
// clock from each phrase's startSec, so the now marker and the layer meters still move when the
// real engine cannot start (samples missing, no audio device). The panel labels this state clearly.

import {
  beatToSec,
  type InstrumentId, type LayerRole, type NoteEvent, type PhraseScore, type SoundWorld,
} from '../../shared/types';
import { zeroLevels, type EngineLike, type Playhead, type SyncClock } from './engineBridge';

interface Extra { atSec: number; notes: NoteEvent[]; bpm: number }

export class FakeEngine implements EngineLike {
  private scores: PhraseScore[] = [];
  private clock: SyncClock | null = null;
  private extras: Extra[] = [];

  async unlock(): Promise<void> { /* nothing to unlock */ }

  async loadInstruments(ids: InstrumentId[], onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const total = ids.length;
    for (let i = 1; i <= total; i++) {
      await new Promise((r) => window.setTimeout(r, 60));
      onProgress?.(i, total);
    }
  }

  setSoundWorld(_world: SoundWorld): void { /* silent */ }

  playSynced(scores: PhraseScore[], clock: SyncClock): void {
    this.scores = scores
      .filter((s) => typeof s.startSec === 'number')
      .sort((a, b) => (a.startSec as number) - (b.startSec as number));
    this.clock = clock;
    this.extras = [];
  }

  scheduleAt(clockSec: number, notes: NoteEvent[], bpm: number): void {
    if (!this.clock) return;
    this.extras.push({ atSec: clockSec, notes, bpm });
    if (this.extras.length > 40) this.extras.shift();
  }

  nudge(): void { /* silent */ }

  stop(): void {
    this.scores = [];
    this.clock = null;
    this.extras = [];
  }

  private current(): { score: PhraseScore; sec: number } | null {
    if (!this.clock) return null;
    const t = this.clock.now();
    let cur: PhraseScore | null = null;
    for (const s of this.scores) {
      if ((s.startSec as number) <= t) cur = s;
      else break;
    }
    return cur ? { score: cur, sec: t - (cur.startSec as number) } : null;
  }

  playhead(): Playhead {
    const playing = this.clock?.playing() ?? false;
    const c = this.current();
    if (!c) return { index: -1, beat: 0, beats: 1, playing };
    return { index: c.score.index, beat: Math.min(c.score.beats, secToBeat(c.score, c.sec)), beats: c.score.beats, playing };
  }

  levels(): Record<LayerRole, number> {
    const out = zeroLevels();
    const c = this.current();
    if (!c || !this.clock?.playing()) return out;
    const beat = secToBeat(c.score, c.sec);
    for (const n of c.score.notes) {
      if (beat < n.t) continue;
      const level = noteLevel(n, beat - n.t);
      if (level > out[n.layer]) out[n.layer] = level;
    }
    const t = this.clock.now();
    for (const x of this.extras) {
      for (const n of x.notes) {
        const age = ((t - x.atSec) * x.bpm) / 60 - n.t;
        if (age < 0) continue;
        const level = noteLevel(n, age);
        if (level > out[n.layer]) out[n.layer] = level;
      }
    }
    return out;
  }
}

function noteLevel(n: NoteEvent, age: number): number {
  const sustained = n.art === 'sustain' || n.art === 'tremolo' || n.art === 'roll';
  if (sustained && n.inst !== 'piano' && n.inst !== 'harp') {
    if (age <= n.dur) return n.vel * Math.min(1, 0.35 + age * 1.6);
    return n.vel * Math.max(0, 1 - (age - n.dur) * 2.5);
  }
  // struck or plucked: sharp onset, decays over the note
  return age <= Math.max(n.dur, 0.5) + 0.6 ? n.vel * Math.exp(-age * 1.6) : 0;
}

/** Inverse of beatToSec by bisection (the ritardando makes it non-linear). */
function secToBeat(score: PhraseScore, sec: number): number {
  if (!score.ritardando) return Math.max(0, (sec * score.bpm) / 60);
  let lo = 0;
  let hi = score.beats;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (beatToSec(score, mid) < sec) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
