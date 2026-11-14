// Tone.js synths: sub, pad, pluck, kick808, the water / wave noise texture, the pop / dance synths
// (synth_bass, stab, lead, keys) and a small synthesised drum kit that stands in for `ekit` until its
// samples are decoded. One instance per (synth, layer bus, variant), built on first use. Events are queued
// here and handed to Tone just inside its look-ahead, so a stop / seek can drop what has not sounded yet.

import * as Tone from 'tone';
import type { LayerRole } from '../../../shared/types.ts';
import { POP_SYNTH_RANGE, POP_SYNTH_VOICES, dbToGain, foldToRange, isShortArt, midiToHz, notesToSteal, popNoteSec, velocityGain } from './selection.ts';
import type { PopSynth } from './selection.ts';

export type TonalSynth = 'sub' | 'pad' | 'pluck' | 'kick808' | PopSynth;
/** Synths that can hold a note open-ended (hold chords). */
export type HoldSynth = 'sub' | 'pad' | 'synth_bass' | 'lead' | 'keys';
/**
 * note = written notes; fallback = standing in for a missing sampled instrument; hold = hold chord;
 * short = a pop synth playing a short articulation (plucky envelopes).
 */
export type Variant = 'note' | 'fallback' | 'hold' | 'short';

/** Tone runs PolySynth events at once only when they are within its look-ahead (0.1 s). */
const HANDOFF_SEC = 0.09;

// Set against the sampled instruments by bus-meter readings (not by ear): at -8 dB the sub read ~17 dB
// hotter than sampled basses at the same velocity, and the kick ~10 dB over the drum kit.
// The pop synths were set by offline renders through the real graph (see README.md, "Levels").
const LEVEL_DB: Record<TonalSynth, number> = {
  sub: -18, pad: -13, pluck: -7, kick808: -9,
  synth_bass: -13, stab: -7, lead: -10, keys: -4,
};
const NOISE_SWELL_DB = -13;
/** Stand-in electronic kit (only until the ekit samples are decoded). */
const DRUM_SYNTH_DB = -1;

const POP = new Set<string>(['synth_bass', 'stab', 'lead', 'keys']);

interface Instance {
  out: Tone.Gain;
  /** Returns a token for release(). */
  attack(hz: number, time: number, vel: number): number;
  /** Releases the note with this token, or (no token) the oldest held note at `hz`. */
  release(hz: number, time: number, token?: number): void;
  setEnvelope?(attack: number | null, release: number | null): void;
  releaseAll(time: number): void;
  dispose(): void;
}

interface Queued {
  time: number;
  seq: number;
  run: () => void;
}

interface Swell {
  gain: GainNode;
  end: number;
}

type AnySynth = Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.MonoSynth> | Tone.PolySynth<Tone.FMSynth>;

interface PolyOptions {
  /** Held-note cap: a new note beyond it releases the oldest (Infinity = Tone's own polyphony only). */
  cap?: number;
  /** Per synth: maps the note's (already curved) velocity to that synth's velocity. */
  velFor?: ((v: number) => number)[];
  /** Extra nodes to dispose with the instance (LFOs feeding the chain). */
  extras?: { dispose(): void }[];
}

function polyInstance(synths: AnySynth[], post: Tone.ToneAudioNode[], levelDb: number, opts: PolyOptions = {}): Instance {
  const out = new Tone.Gain(dbToGain(levelDb));
  if (post.length) {
    for (const s of synths) s.connect(post[0]);
    for (let i = 0; i < post.length - 1; i++) post[i].connect(post[i + 1]);
    post[post.length - 1].connect(out);
  } else {
    for (const s of synths) s.connect(out);
  }
  const cap = opts.cap ?? Infinity;
  let held: { id: number; hz: number }[] = [];
  let seq = 0;
  const off = (hz: number, time: number): void => {
    for (const s of synths) s.triggerRelease(hz, time);
  };
  return {
    out,
    attack: (hz, time, vel) => {
      // voice stealing: let go of the oldest held notes first (their releases still ring out)
      for (let n = notesToSteal(held.length, cap); n > 0 && held.length; n--) off((held.shift() as { hz: number }).hz, time);
      synths.forEach((s, i) => s.triggerAttack(hz, time, opts.velFor?.[i] ? opts.velFor[i](vel) : vel));
      held.push({ id: ++seq, hz });
      return seq;
    },
    release: (hz, time, token) => {
      const i = token !== undefined ? held.findIndex((h) => h.id === token) : held.findIndex((h) => h.hz === hz);
      if (i < 0) return; // already stolen or released
      held.splice(i, 1);
      off(hz, time);
    },
    setEnvelope: (attack, release) => {
      const envelope: { attack?: number; release?: number } = {};
      if (attack !== null) envelope.attack = attack;
      if (release !== null) envelope.release = release;
      for (const s of synths) s.set({ envelope });
    },
    releaseAll: (time) => {
      held = [];
      for (const s of synths) s.releaseAll(time);
    },
    dispose: () => {
      for (const s of synths) s.dispose();
      for (const p of post) p.dispose();
      for (const x of opts.extras ?? []) x.dispose();
      out.dispose();
    },
  };
}

/** tanh soft clip normalised to unity at full scale: low-order harmonics, gentle level control. */
function saturator(drive: number): Tone.WaveShaper {
  return new Tone.WaveShaper((x: number) => Math.tanh(drive * x) / Math.tanh(drive), 2048);
}

function makeSub(variant: Variant): Instance {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: variant === 'hold' ? 1.2 : 0.02, decay: 0.3, sustain: 0.88, release: variant === 'hold' ? 1.2 : 0.4 },
  });
  synth.maxPolyphony = 8;
  // gentle tanh: adds low odd harmonics so the sub still reads on small speakers
  return polyInstance([synth], [saturator(2.4)], LEVEL_DB.sub);
}

function makePad(variant: Variant): Instance {
  const attack = variant === 'hold' ? 1.5 : variant === 'fallback' ? 0.14 : 0.5;
  const release = variant === 'hold' ? 1.5 : variant === 'fallback' ? 0.7 : 1.9;
  const envelope = { attack, decay: 1.4, sustain: 0.82, release };
  const saw = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 22 }, envelope });
  const tri = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fattriangle', count: 2, spread: 12 }, envelope });
  saw.maxPolyphony = 16;
  tri.maxPolyphony = 16;
  saw.volume.value = -9;
  tri.volume.value = -3;
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 1500, rolloff: -24, Q: 0.6 });
  const lfo = new Tone.LFO({ frequency: 0.09, min: 1050, max: 2100 }).start();
  lfo.connect(filter.frequency);
  return polyInstance([saw, tri], [filter], LEVEL_DB.pad, { extras: [lfo] });
}

function makePluck(): Instance {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 7,
    oscillator: { type: 'sine' },
    modulation: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.3 },
    modulationEnvelope: { attack: 0.002, decay: 0.13, sustain: 0.04, release: 0.2 },
  });
  synth.maxPolyphony = 16;
  return polyInstance([synth], [], LEVEL_DB.pluck);
}

/**
 * Synth bass: a detuned saw pair through a resonant 24 dB low-pass whose envelope snaps open on every note
 * (the "quack" of funk / house basses), with a clean sine underneath for the fundamental, then tanh drive so
 * the line still reads on small speakers. Short articulations close the filter and the level within ~150 ms
 * (plucky); held notes settle on a warm, steady tone. Mono-ish: at most two notes held.
 */
function makeSynthBass(variant: Variant): Instance {
  const short = variant === 'short';
  const hold = variant === 'hold';
  const main = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
    filter: { type: 'lowpass', rolloff: -24, Q: short ? 2.6 : 1.8 },
    envelope: { attack: hold ? 0.8 : 0.003, decay: short ? 0.2 : 0.35, sustain: short ? 0.22 : 0.78, release: short ? 0.05 : 0.11 },
    filterEnvelope: {
      attack: 0.002, decay: short ? 0.13 : 0.24, sustain: short ? 0.06 : 0.32, release: 0.12,
      baseFrequency: 170, octaves: short ? 3.5 : 3.0, exponent: 2,
    },
  });
  const sub = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: hold ? 0.8 : 0.003, decay: short ? 0.24 : 0.4, sustain: short ? 0.3 : 0.9, release: short ? 0.05 : 0.11 },
  });
  main.maxPolyphony = 6;
  sub.maxPolyphony = 6;
  // a plucked note carries less energy than a held one: +3 dB keeps a staccato line as present
  main.volume.value = short ? -1 : -4;
  sub.volume.value = short ? 0 : -3;
  const hp = new Tone.Filter({ type: 'highpass', frequency: 30, rolloff: -12 });
  return polyInstance([main, sub], [saturator(1.8), hp], LEVEL_DB.synth_bass, { cap: POP_SYNTH_VOICES.synth_bass });
}

/**
 * Stab: three detuned saws per note, a fast filter envelope from ~400 Hz up four octaves and back (brass-like
 * "bwah"), soft drive, a high-pass that keeps it off the bass, and a stereo chorus for width.
 */
function makeStab(): Instance {
  const synth = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 26 },
    filter: { type: 'lowpass', rolloff: -24, Q: 1.1 },
    envelope: { attack: 0.004, decay: 0.32, sustain: 0.38, release: 0.14 },
    filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.28, release: 0.16, baseFrequency: 400, octaves: 3.7, exponent: 2 },
  });
  synth.maxPolyphony = 22;
  const hp = new Tone.Filter({ type: 'highpass', frequency: 150, rolloff: -12 });
  const chorus = new Tone.Chorus({ frequency: 1.1, delayTime: 3.2, depth: 0.45, spread: 140, wet: 0.35 }).start();
  return polyInstance([synth], [saturator(1.5), hp, chorus], LEVEL_DB.stab, { cap: POP_SYNTH_VOICES.stab });
}

/**
 * Lead: detuned saw pair through a 12 dB low-pass that opens on the attack and stays bright, light vibrato,
 * a little drive, high-passed above the mid range. Up to four notes (hook harmonies).
 */
function makeLead(variant: Variant): Instance {
  const short = variant === 'short';
  const hold = variant === 'hold';
  const synth = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 11 },
    filter: { type: 'lowpass', rolloff: -12, Q: 1.3 },
    envelope: { attack: hold ? 0.8 : 0.006, decay: short ? 0.16 : 0.3, sustain: short ? 0.45 : 0.82, release: short ? 0.07 : 0.22 },
    filterEnvelope: { attack: 0.004, decay: short ? 0.14 : 0.3, sustain: short ? 0.35 : 0.55, release: 0.22, baseFrequency: 850, octaves: 2.7, exponent: 2 },
  });
  synth.maxPolyphony = 10;
  const vibrato = new Tone.Vibrato({ frequency: 5.3, depth: 0.035 });
  const hp = new Tone.Filter({ type: 'highpass', frequency: 180, rolloff: -12 });
  return polyInstance([synth], [vibrato, saturator(1.3), hp], LEVEL_DB.lead, { cap: POP_SYNTH_VOICES.lead });
}

/**
 * Keys: an FM electric piano. A ratio-1 pair gives the warm body (its brightness decays over ~1 s); a ratio-5
 * pair gives the short tine / bell attack, and is mixed in more the harder the key is played (velocity changes
 * the timbre, not only the level). Gentle drive for the "bark", a slow auto-pan, a little chorus.
 */
function makeKeys(variant: Variant): Instance {
  const short = variant === 'short';
  const hold = variant === 'hold';
  const body = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1,
    modulationIndex: 2.4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: hold ? 0.6 : 0.002, decay: hold ? 3 : 2.4, sustain: hold ? 0.45 : 0.2, release: short ? 0.12 : 0.45 },
    modulationEnvelope: { attack: 0.002, decay: 0.9, sustain: 0.22, release: 0.4 },
  });
  const tine = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 5,
    modulationIndex: 1.3,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.15 },
    modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
  });
  body.maxPolyphony = 24;
  tine.maxPolyphony = 24;
  tine.volume.value = -9;
  const panner = new Tone.AutoPanner({ frequency: 3.1, depth: 0.22 }).start();
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 4, depth: 0.3, spread: 90, wet: 0.2 }).start();
  const hp = new Tone.Filter({ type: 'highpass', frequency: 55, rolloff: -12 });
  return polyInstance([body, tine], [saturator(1.4), hp, panner, chorus], LEVEL_DB.keys, {
    cap: POP_SYNTH_VOICES.keys,
    // `vel` here is already velocityGain(vel) (0.06..1): soft keys are nearly pure body, hard ones bark
    velFor: [(v) => v, (v) => Math.min(1, v * (0.25 + 0.75 * v))],
  });
}

function makeKick(): Instance {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 5.5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.55, sustain: 0, release: 0.35 },
  });
  const out = new Tone.Gain(dbToGain(LEVEL_DB.kick808));
  synth.connect(out);
  return {
    out,
    attack: (hz, time, vel) => {
      synth.triggerAttack(hz, time, vel);
      return 0;
    },
    release: (_hz, time) => synth.triggerRelease(time),
    releaseAll: (time) => synth.triggerRelease(time),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

/**
 * A small synthesised electronic kit with the ekit pseudo-notes. It only plays while the ekit samples are not
 * decoded yet (or failed to load), so a groove is never silent.
 */
class DrumSynth {
  readonly out: Tone.Gain;
  private readonly kick: Tone.MembraneSynth;
  private readonly tom: Tone.MembraneSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly snare: Tone.NoiseSynth;
  private readonly clap: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly cymbal: Tone.NoiseSynth;
  private readonly bell: Tone.PolySynth<Tone.Synth>;
  private readonly nodes: { dispose(): void }[] = [];

  constructor() {
    this.out = new Tone.Gain(dbToGain(DRUM_SYNTH_DB));
    const via = <T extends Tone.ToneAudioNode>(src: T, ...chain: Tone.ToneAudioNode[]): T => {
      src.chain(...chain, this.out);
      this.nodes.push(src, ...chain);
      return src;
    };
    this.kick = via(new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 5, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }));
    this.tom = via(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 1.2, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 }, volume: -4 }));
    this.snareBody = via(new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 1.5, envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.05 }, volume: -8 }));
    this.snare = via(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -4 }), new Tone.Filter({ type: 'bandpass', frequency: 2600, Q: 0.7 }));
    this.clap = via(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.012, sustain: 0 }, volume: -2 }), new Tone.Filter({ type: 'bandpass', frequency: 1300, Q: 1.1 }));
    this.hat = via(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: -14 }), new Tone.Filter({ type: 'highpass', frequency: 7500, rolloff: -24 }));
    this.cymbal = via(new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 1.1, sustain: 0 }, volume: -18 }), new Tone.Filter({ type: 'highpass', frequency: 5200, rolloff: -12 }));
    this.bell = via(new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.05 }, volume: -20 }), new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 1.4 }));
  }

  hit(midi: number, vel: number, time: number): void {
    const v = vel;
    switch (midi) {
      case 36:
        this.kick.triggerAttack(50, time, v);
        break;
      case 38:
        this.snareBody.triggerAttack(190, time, v);
        this.snare.triggerAttack(time, v);
        break;
      case 39:
        // 909-style clap: three quick bursts and a tail
        for (const [dt, decay] of [[0, 0.012], [0.011, 0.012], [0.022, 0.012], [0.033, 0.16]] as const) {
          this.clap.envelope.decay = decay;
          this.clap.triggerAttack(time + dt, v);
        }
        break;
      case 37:
        this.clap.triggerAttack(time, v * 0.7);
        break;
      case 42:
      case 44:
        this.hat.envelope.decay = midi === 42 ? 0.05 : 0.035;
        this.hat.triggerAttack(time, v * (midi === 42 ? 1 : 0.7));
        break;
      case 46:
        this.hat.envelope.decay = 0.35;
        this.hat.triggerAttack(time, v);
        break;
      case 70:
        this.hat.envelope.decay = 0.07;
        this.hat.triggerAttack(time, v * 0.6);
        break;
      case 45:
      case 47:
      case 50:
        this.tom.triggerAttack(midi === 45 ? 87 : midi === 47 ? 117 : 156, time, v);
        break;
      case 49:
      case 51:
        this.cymbal.envelope.decay = midi === 49 ? 1.4 : 0.6;
        this.cymbal.triggerAttack(time, v * (midi === 49 ? 1 : 0.6));
        break;
      case 56:
        this.bell.triggerAttackRelease([540, 800], 0.2, time, v);
        break;
      default:
        break; // a pseudo-note the kit does not have: nothing
    }
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.out.dispose();
  }
}

export class SynthBank {
  private readonly ctx: BaseAudioContext;
  private readonly busFor: (layer: LayerRole) => AudioNode;
  private readonly instances = new Map<string, Instance>();
  private readonly drums = new Map<LayerRole, DrumSynth>();
  private queue: Queued[] = [];
  private seq = 0;
  private swells: Swell[] = [];
  private noiseHolds = new Map<string, Swell>();
  private readonly noiseCore: Tone.Gain;
  private readonly noiseParts: { dispose(): void }[] = [];

  constructor(ctx: BaseAudioContext, busFor: (layer: LayerRole) => AudioNode, noiseBed: AudioNode) {
    this.ctx = ctx;
    this.busFor = busFor;

    // Water / wave texture: two decorrelated pink-noise streams, each through a band-pass whose
    // centre drifts on a slow LFO, under a slow amplitude swell.
    this.noiseCore = new Tone.Gain(1);
    const sides: [pan: number, sweepHz: number, swellHz: number, phase: number][] = [
      [-0.6, 0.071, 0.113, 0],
      [0.6, 0.053, 0.087, 140],
    ];
    for (const [pan, sweepHz, swellHz, phase] of sides) {
      const noise = new Tone.Noise('pink').start();
      const filter = new Tone.Filter({ type: 'bandpass', frequency: 700, Q: 0.9 });
      const sweep = new Tone.LFO({ frequency: sweepHz, min: 300, max: 1500, phase }).start();
      sweep.connect(filter.frequency);
      const amp = new Tone.Gain(0.7);
      const swell = new Tone.LFO({ frequency: swellHz, min: 0.4, max: 1, phase: phase / 2 }).start();
      swell.connect(amp.gain);
      const panner = new Tone.Panner(pan);
      noise.chain(filter, amp, panner, this.noiseCore);
      this.noiseParts.push(noise, filter, sweep, amp, swell, panner);
    }
    Tone.connect(this.noiseCore, noiseBed);
  }

  private instance(inst: TonalSynth, layer: LayerRole, variant: Variant): Instance {
    const key = `${inst}|${layer}|${variant}`;
    let it = this.instances.get(key);
    if (!it) {
      switch (inst) {
        case 'sub': it = makeSub(variant); break;
        case 'pad': it = makePad(variant); break;
        case 'pluck': it = makePluck(); break;
        case 'synth_bass': it = makeSynthBass(variant); break;
        case 'stab': it = makeStab(); break;
        case 'lead': it = makeLead(variant); break;
        case 'keys': it = makeKeys(variant); break;
        default: it = makeKick(); break;
      }
      Tone.connect(it.out, this.busFor(layer));
      this.instances.set(key, it);
    }
    return it;
  }

  private at(time: number, run: () => void): void {
    if (time <= this.ctx.currentTime + HANDOFF_SEC) {
      run();
      return;
    }
    const q: Queued = { time, seq: this.seq++, run };
    // insertion sort from the back: events mostly arrive in order
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].time > q.time || (this.queue[i - 1].time === q.time && this.queue[i - 1].seq > q.seq))) i--;
    this.queue.splice(i, 0, q);
  }

  /** A written note: attack at `time`, release after `durSec`. `art` shapes the pop synths (short vs held). */
  trigger(inst: TonalSynth, layer: LayerRole, midi: number, vel: number, time: number, durSec: number, variant: Variant = 'note', art?: string): void {
    const v = Math.min(1, Math.max(0.02, vel));
    if (inst === 'kick808') {
      // 808s live around 40–65 Hz whatever octave was written
      let m = midi;
      while (m > 38) m -= 12;
      while (m < 27) m += 12;
      const hz = midiToHz(m);
      const it = this.instance('kick808', layer, 'note');
      // the envelope has no sustain, so the hit decays by itself: no release event that could clip the next kick
      this.at(time, () => it.attack(hz, Math.max(time, this.ctx.currentTime), v));
      return;
    }
    if (POP.has(inst)) {
      this.triggerPop(inst as PopSynth, layer, midi, v, time, durSec, isShortArt(art));
      return;
    }
    const hz = midiToHz(midi);
    // only the pad has a distinct quick-speaking variant for standing in for missing samples
    const it = this.instance(inst, layer, inst === 'pad' && variant === 'fallback' ? 'fallback' : 'note');
    const len = inst === 'pluck' ? Math.min(0.5, Math.max(0.06, durSec)) : Math.max(0.05, durSec);
    let token: number | undefined;
    this.at(time, () => {
      token = it.attack(hz, Math.max(time, this.ctx.currentTime), v);
    });
    this.at(time + len, () => it.release(hz, Math.max(time + len, this.ctx.currentTime), token ?? -1));
  }

  private triggerPop(inst: PopSynth, layer: LayerRole, midi: number, vel: number, time: number, durSec: number, short: boolean): void {
    const [lo, hi] = POP_SYNTH_RANGE[inst];
    const hz = midiToHz(foldToRange(midi, lo, hi));
    // the stab has one (short) envelope; `sustain` only makes it a longer stab
    const it = this.instance(inst, layer, short && inst !== 'stab' ? 'short' : 'note');
    const len = popNoteSec(inst, short, durSec);
    // same velocity curve as the sampled instruments
    const g = velocityGain(vel);
    let token: number | undefined;
    this.at(time, () => {
      token = it.attack(hz, Math.max(time, this.ctx.currentTime), g);
    });
    this.at(time + len, () => it.release(hz, Math.max(time + len, this.ctx.currentTime), token ?? -1));
  }

  /** Stand-in electronic kit for `ekit` notes whose samples are not decoded yet. */
  drum(layer: LayerRole, midi: number, vel: number, time: number): void {
    let d = this.drums.get(layer);
    if (!d) {
      d = new DrumSynth();
      Tone.connect(d.out, this.busFor(layer));
      this.drums.set(layer, d);
    }
    const kit = d;
    const v = velocityGain(Math.min(1, Math.max(0.02, vel)));
    this.at(time, () => kit.hit(midi, v, Math.max(time, this.ctx.currentTime)));
  }

  /** Hold chord: an open-ended note fading in over `attackSec`. */
  holdOn(inst: HoldSynth, layer: LayerRole, midi: number, vel: number, time: number, attackSec: number): void {
    const it = this.instance(inst, layer, 'hold');
    const pop = POP.has(inst);
    const hz = midiToHz(pop ? foldToRange(midi, ...POP_SYNTH_RANGE[inst as PopSynth]) : midi);
    const v = Math.min(1, Math.max(0.02, vel));
    this.at(time, () => {
      it.setEnvelope?.(Math.max(0.05, attackSec), null);
      it.attack(hz, Math.max(time, this.ctx.currentTime), pop ? velocityGain(v) : v);
    });
  }

  holdOff(inst: HoldSynth, layer: LayerRole, midi: number, time: number, releaseSec: number): void {
    const it = this.instance(inst, layer, 'hold');
    const hz = midiToHz(POP.has(inst) ? foldToRange(midi, ...POP_SYNTH_RANGE[inst as PopSynth]) : midi);
    this.at(time, () => {
      it.setEnvelope?.(null, Math.max(0.05, releaseSec));
      it.release(hz, Math.max(time, this.ctx.currentTime));
    });
  }

  private tap(layer: LayerRole): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    Tone.connect(this.noiseCore, g);
    g.connect(this.busFor(layer));
    return g;
  }

  /** A noise note: a rise and fall shaped by its duration and velocity. */
  noiseSwell(layer: LayerRole, time: number, durSec: number, vel: number): void {
    const t = Math.max(time, this.ctx.currentTime);
    const dur = Math.max(0.3, durSec);
    const peak = dbToGain(NOISE_SWELL_DB) * Math.pow(Math.min(1, Math.max(0.02, vel)), 1.3);
    const g = this.tap(layer);
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(peak, t, dur * 0.16);
    g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.17);
    this.swells.push({ gain: g, end: t + dur * 1.7 });
  }

  /** Noise as a hold note: a sustained level until released. */
  noiseHoldOn(key: string, layer: LayerRole, vel: number, time: number, attackSec: number): void {
    const t = Math.max(time, this.ctx.currentTime);
    let s = this.noiseHolds.get(key);
    if (!s) {
      s = { gain: this.tap(layer), end: Infinity };
      this.noiseHolds.set(key, s);
    }
    const level = dbToGain(NOISE_SWELL_DB) * Math.pow(Math.min(1, Math.max(0.02, vel)), 1.3);
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setTargetAtTime(level, t, Math.max(0.05, attackSec / 3));
  }

  noiseHoldOff(key: string, time: number, releaseSec: number): void {
    const s = this.noiseHolds.get(key);
    if (!s) return;
    const t = Math.max(time, this.ctx.currentTime);
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setTargetAtTime(0, t, Math.max(0.02, releaseSec / 3));
    s.end = t + releaseSec * 2.5;
    this.swells.push(s);
    this.noiseHolds.delete(key);
  }

  /** Release everything sounding at `time` and drop every event after it. */
  releaseAll(time: number): void {
    const t = Math.max(time, this.ctx.currentTime);
    // notes due before `t` still sound (and are released at `t`); everything later is dropped
    this.queue = this.queue.filter((q) => q.time < t);
    this.at(t, () => {
      const when = Math.max(t, this.ctx.currentTime);
      for (const it of this.instances.values()) {
        try {
          it.releaseAll(when);
        } catch (err) {
          console.warn('[audio] synth release failed', err);
        }
      }
    });
    for (const s of this.swells) {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setTargetAtTime(0, t, 0.03);
      s.end = Math.min(s.end, t + 0.3);
    }
    for (const key of [...this.noiseHolds.keys()]) this.noiseHoldOff(key, t, 0.1);
  }

  /** Every scheduler tick: hand due events to Tone, drop finished swell taps. */
  service(now: number): void {
    const due = now + HANDOFF_SEC;
    let n = 0;
    while (n < this.queue.length && this.queue[n].time <= due) n++;
    if (n) {
      const batch = this.queue.splice(0, n);
      for (const q of batch) {
        try {
          q.run();
        } catch (err) {
          console.warn('[audio] synth event failed', err);
        }
      }
    }
    if (this.swells.length) {
      this.swells = this.swells.filter((s) => {
        if (s.end > now) return true;
        try {
          Tone.disconnect(this.noiseCore, s.gain);
          s.gain.disconnect();
        } catch {
          /* best effort */
        }
        return false;
      });
    }
  }

  dispose(): void {
    this.queue = [];
    for (const it of this.instances.values()) it.dispose();
    this.instances.clear();
    for (const d of this.drums.values()) d.dispose();
    this.drums.clear();
    for (const p of this.noiseParts) p.dispose();
    this.noiseCore.dispose();
  }
}
