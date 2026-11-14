// The piece as it stands: the rules Drex set, its plan, the themes, every accepted phrase.
// Also the state builder: the text every request carries.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ArrivalId, Articulation, EndingId, FormId, HarmonicLanguage, InstrumentId, KeyPlanId, LayerRole, LayerSummary,
  MixState, PhraseRole, PhraseScore, SoundWorld, StyleId,
} from '../shared/types.ts';
import { DYNAMIC_NAMES } from '../shared/types.ts';
import { notation, type Line } from './core/line.ts';
import type { Mood } from './core/mood.ts';
import { HARMONIC_LANGUAGE_TEXT, keyName, type Chord, type Key, type Meter } from './core/theory.ts';
import { pack, ROOT } from './pack.ts';

// ───────────────────────────── Instruments ─────────────────────────────

export interface InstrumentInfo {
  id: InstrumentId;
  name: string;
  /** Playable MIDI range. Notes are folded into it by octaves. */
  range: [number, number];
  character: string;
  synth?: boolean;
  arts: Articulation[];
}

const I = (id: InstrumentId, name: string, range: [number, number], character: string, arts: Articulation[], synth = false): InstrumentInfo =>
  ({ id, name, range, character, arts, synth });

export const INSTRUMENTS: Record<string, InstrumentInfo> = Object.fromEntries(
  [
    I('piano', 'Grand piano', [21, 108], 'clear, intimate, percussive attack that decays; carries melody or arpeggios', ['sustain']),
    I('violins', 'First violins', [55, 98], 'singing, bright on top, the natural melody section', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('violins2', 'Second violins', [55, 91], 'warm inner support below the firsts', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('violas', 'Violas', [48, 84], 'dusky, veiled middle voice', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('celli', 'Celli', [36, 74], 'rich tenor voice, ardent when it sings high', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('basses', 'Double basses', [28, 55], 'deep foundation, weight', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('solo_violin', 'Solo violin', [55, 98], 'a single fragile, personal voice', ['sustain', 'staccato', 'tremolo', 'pizzicato']),
    I('flute', 'Flute', [60, 96], 'pure and airy, cool low, brilliant high', ['sustain', 'staccato']),
    I('oboe', 'Oboe', [58, 88], 'plaintive, reedy, penetrating', ['sustain', 'staccato']),
    I('clarinet', 'Clarinet', [50, 89], 'smooth and mellow, playful when staccato', ['sustain', 'staccato']),
    I('horn', 'French horn', [41, 74], 'noble, round, distant warmth', ['sustain', 'staccato']),
    I('harp', 'Harp', [31, 100], 'plucked shimmer, arpeggios and glints', ['sustain']),
    I('timpani', 'Timpani', [40, 57], 'pitched thunder, rolls and strokes', ['hit', 'roll']),
    I('bass_drum', 'Orchestral bass drum', [36, 36], 'a deep impact', ['hit']),
    I('cymbal', 'Cymbals', [49, 49], 'crash or swelling roll', ['hit', 'roll']),
    I('tam_tam', 'Tam-tam', [52, 52], 'dark metallic wash', ['hit']),
    I('drumkit', 'Drum kit', [36, 51], 'kick, snare and hats; a groove', ['hit']),
    I('celesta', 'Celesta', [60, 108], 'small bells, childlike sparkle', ['sustain']),
    I('glockenspiel', 'Glockenspiel', [72, 108], 'bright metal sparkle on top', ['sustain']),
    I('vibraphone', 'Vibraphone', [53, 89], 'soft glowing metal, cool', ['sustain']),
    I('sub', 'Sub bass (sine)', [24, 48], 'pure low weight, felt more than heard', ['sustain'], true),
    I('pad', 'Synth pad', [36, 84], 'slow, smooth electronic bed', ['sustain'], true),
    I('pluck', 'Pluck synth', [36, 96], 'short bright electronic pluck', ['staccato'], true),
    I('kick808', 'Soft electronic kick', [36, 36], 'round low thump', ['hit'], true),
    I('noise', 'Water and wave texture', [60, 60], 'filtered noise with a slow swell: water, air', ['sustain'], true),
  ].map((i) => [i.id, i]),
);

/** Which instruments can take each layer role (the layering table). */
export const ROLE_INSTRUMENTS: Record<LayerRole, InstrumentId[]> = {
  melody: ['piano', 'solo_violin', 'violins', 'flute', 'oboe', 'clarinet', 'pluck', 'celesta', 'glockenspiel', 'vibraphone'],
  counter: ['celli', 'violas', 'horn', 'clarinet', 'violins2', 'oboe', 'flute', 'vibraphone'],
  inner: ['violas', 'violins2', 'pad', 'piano', 'horn'],
  bass: ['basses', 'celli', 'piano', 'sub'],
  pedal: ['basses', 'celli', 'piano', 'horn', 'sub'],
  figuration: ['piano', 'harp', 'violins2', 'violas', 'pluck', 'celesta'],
  texture: ['noise', 'violins', 'pad', 'cymbal'],
  pulse: ['drumkit', 'kick808', 'timpani'],
  accents: ['bass_drum', 'cymbal', 'timpani', 'piano', 'tam_tam', 'drumkit'],
};

let availableCache: Set<string> | null = null;

/** Instruments that can actually sound: sampled ones present in the manifest, plus the synths. */
export function availableInstruments(): Set<string> {
  if (availableCache) return availableCache;
  const out = new Set<string>(Object.values(INSTRUMENTS).filter((i) => i.synth).map((i) => i.id));
  const file = join(ROOT, 'assets/samples/manifest.json');
  if (existsSync(file)) {
    try {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      for (const id of Object.keys(manifest.instruments ?? {})) {
        if (INSTRUMENTS[id]) out.add(id);
        const inst = INSTRUMENTS[id];
        // Keep lines inside what was actually sampled (a couple of semitones of pitch-shift either side is fine).
        const sampled = manifest.instruments[id].range;
        if (inst && Array.isArray(sampled) && sampled.length === 2 && sampled[1] > sampled[0]) {
          const lo = Math.max(inst.range[0], sampled[0] - 2);
          const hi = Math.min(inst.range[1], sampled[1] + 3);
          if (hi - lo >= 12) inst.range = [lo, hi];
        }
        const arts = Object.keys(manifest.instruments[id].articulations ?? {});
        if (inst && arts.length) {
          // Keep only articulations that exist, plus the ones the audio engine can fake from them.
          const has = (a: string) => arts.includes(a);
          inst.arts = inst.arts.filter((a) => has(a) || (a === 'staccato' && has('spiccato')) || (a === 'tremolo' && has('sustain')) || (a === 'pizzicato' && (has('staccato') || has('spiccato'))) || (a === 'sustain' && arts.length > 0));
          if (id === 'violins' && INSTRUMENTS.violins2) {
            INSTRUMENTS.violins2.arts = inst.arts.slice();
            INSTRUMENTS.violins2.range = [inst.range[0], Math.min(INSTRUMENTS.violins2.range[1], inst.range[1])];
          }
          if (!inst.arts.length) inst.arts = arts as Articulation[];
        }
      }
      if (out.has('violins')) out.add('violins2');
      availableCache = out;
      return out;
    } catch {
      /* fall through */
    }
  }
  // No manifest yet: assume the standard set.
  for (const i of Object.values(INSTRUMENTS)) if (!['celesta', 'glockenspiel', 'vibraphone', 'tam_tam'].includes(i.id)) out.add(i.id);
  return out;
}

// ───────────────────────────── Rules, plan, themes ─────────────────────────────

export interface Rules {
  style: StyleId;
  bpm: number;
  meter: Meter;
  key: Key;
  harmonicLanguage: HarmonicLanguage;
  palette: InstrumentId[];
  soundWorld: SoundWorld;
  lengthSec: number;
  form: FormId;
  ending: EndingId;
  keyPlan: KeyPlanId;
}

export interface Section {
  index: number;
  role: PhraseRole;
  /** 1..7 */
  tension: number;
  departure: boolean;
  first: number;
  last: number;
  key: Key;
  /** Set when sections come from a video. */
  startSec?: number;
  endSec?: number;
}

export interface Plan {
  sections: Section[];
  totalPhrases: number;
  climaxPhrase: number;
  /** How the climax arrives; Drex's choice in the plan call. */
  climaxArrival: ArrivalId;
  needsCounter: boolean;
  needsContrast: boolean;
}

export interface Theme {
  id: string;
  kind: 'main' | 'counter' | 'contrast';
  line: Line;
  contour: string;
  /** How a derived theme came about. */
  derivation?: string;
}

export interface SegmentChoice {
  source: string;
  ops: string[];
}

export interface Direction {
  seg1: SegmentChoice;
  seg2: SegmentChoice;
  counter: string;
  flags: Record<string, boolean>;
  harmonicRhythm: string;
  ending: string;
  modulation?: string;
}

export interface Slot {
  /** Start beat and length within the phrase. */
  t: number;
  dur: number;
  chord: Chord;
  bass: string;
  /** Inner voices sounding during the slot (MIDI). */
  voices: number[];
}

export interface PhraseRecord {
  index: number;
  section: number;
  role: PhraseRole;
  key: Key;
  direction: Direction;
  /** Melody in scale degrees across the whole phrase. */
  line: Line;
  lineage: string;
  /** Number of derivation steps away from a stated theme. */
  depth: number;
  slots: Slot[];
  themeIntact: boolean;
  /** Share of the main theme kept, 0..1. */
  related: number;
  layers: LayerSummary[];
  mix: MixState;
  score: PhraseScore;
}

export const PHRASE_BARS = 4;

/** The ways a climax can arrive, as Drex reads them. */
export const ARRIVAL_TEXT: Record<ArrivalId, string> = {
  swell: 'no break: the peak simply arrives at the top of a long crescendo, with the pulse carrying straight through. Continuous and gentle; for pieces that should never shock',
  hit: 'a hit: one accented blow lands on top of the same texture, which then carries on as before. A landmark, not a change of state',
  open_wall: 'a held breath, then the wall: everything stops for an instant, then the pulse and figuration fall away and the whole ensemble opens into one sustained wall of sound, at full volume with the filter fully open. Awe, release, breaking the surface',
  broaden: 'the same held breath and wall of sound, and the tempo also broadens at the arrival, so the peak feels vast and slowed, time stretching',
};
export const ARRIVAL_LABEL: Record<ArrivalId, string> = {
  swell: 'swell, no break', hit: 'a hit', open_wall: 'held breath, then the wall', broaden: 'held breath, wall, tempo broadens',
};
/** The climax arrives as a wall of sound (with or without broadening). */
export const isWall = (a: ArrivalId | undefined): boolean => a === 'open_wall' || a === 'broaden';

/** What the picture is doing under one phrase. Only set when the engine is scoring a video. */
export interface PictureCue {
  /** Lines added to the state (VIDEO, AHEAD). */
  lines: string[];
  /** 1 still … 7 frantic, averaged over the phrase's span. */
  movement: number;
  quality: string;
  bodyLevel: string;
  mood: string;
  change: string;
  /** A high point inside the phrase, as a beat position. */
  peak?: { beat: number; strength: number };
  /** A scene cut inside the phrase, as a beat position. */
  cut?: { beat: number };
}

export class Piece {
  rules!: Rules;
  plan!: Plan;
  themes: Theme[] = [];
  phrases: PhraseRecord[] = [];
  /** Inner voices at the end of the last accepted phrase. */
  voices: number[] = [];
  lastChord: Chord | null = null;
  lastReject = '';
  endingPlan: Record<string, string> | null = null;
  /** Per-phrase overrides: the broadened climax sets the tempo of one phrase; fitting music to picture sets all three. */
  phraseBars = new Map<number, number>();
  phraseBpm = new Map<number, number>();
  /** Seconds of held chord appended to a phrase so the music lands on a cut. */
  phraseHoldSec = new Map<number, number>();
  picture: ((phrase: number) => PictureCue | null) | null = null;
  /** Lines added to every state before any music exists (the clip timeline, when scoring a video). */
  preludeLines: string[] = [];

  constructor(public prompt: string, public mood: Mood) {}

  /** A theme fills two bars. */
  get unitBeats(): number {
    return 2 * this.rules.meter.beatsPerBar;
  }
  /** Nominal phrase length in seconds at the base tempo. */
  get phraseSec(): number {
    return (PHRASE_BARS * this.rules.meter.beatsPerBar * 60) / this.rules.bpm;
  }
  barsOf(phrase: number): number {
    return this.phraseBars.get(phrase) ?? PHRASE_BARS;
  }
  bpmOf(phrase: number): number {
    return this.phraseBpm.get(phrase) ?? this.rules.bpm;
  }
  beatsOf(phrase: number): number {
    return this.barsOf(phrase) * this.rules.meter.beatsPerBar;
  }
  /** Half a phrase: where its second half begins. */
  halfOf(phrase: number): number {
    return Math.ceil(this.barsOf(phrase) / 2) * this.rules.meter.beatsPerBar;
  }
  get grid(): number {
    return this.rules.meter.sub === 3 ? 1 / 3 : 0.5;
  }
  theme(id: string): Theme | undefined {
    return this.themes.find((t) => t.id === id);
  }
  get mainTheme(): Theme {
    return this.themes[0];
  }
  sectionOf(phrase: number): Section {
    return this.plan.sections.find((s) => phrase >= s.first && phrase <= s.last) ?? this.plan.sections[this.plan.sections.length - 1];
  }

  /** The role of one phrase: the section's role, refined by position. */
  roleOf(phrase: number): PhraseRole {
    const s = this.sectionOf(phrase);
    if (phrase === this.plan.climaxPhrase) return 'climax';
    if (phrase === this.plan.totalPhrases - 1 && s.role !== 'departure') return 'coda';
    if (s.role === 'statement' || s.role === 'return') return phrase === s.first ? s.role : 'development';
    if (s.role === 'climax') return 'development';
    return s.role;
  }

  /** Target tension for a phrase, easing toward the next section across the section. */
  tensionOf(phrase: number): number {
    const s = this.sectionOf(phrase);
    const cue = this.picture?.(phrase);
    // Scoring to picture: the frames drive the tension target inside the section's planned level.
    const lift = cue ? (cue.movement - 4) * 0.35 + (cue.peak ? (cue.peak.strength - 4) * 0.2 : 0) : 0;
    const bound = (t: number) => Math.round(Math.min(7, Math.max(1, t + lift)) * 10) / 10;
    // Without a picture the climax is always a peak; with one, a still picture keeps even its climax quiet.
    if (phrase === this.plan.climaxPhrase) return bound(cue ? s.tension + 0.5 : Math.max(s.tension, 6));
    const next = this.plan.sections[s.index + 1];
    const span = s.last - s.first + 1;
    if (!next || span <= 1) return bound(s.tension);
    const x = (phrase - s.first) / span;
    return bound(s.tension + (next.tension - s.tension) * x * 0.5);
  }

  phrasesSinceThemeIntact(): number {
    for (let i = this.phrases.length - 1; i >= 0; i--) {
      if (this.phrases[i].themeIntact) return this.phrases.length - i;
    }
    return this.phrases.length;
  }

  // ───────────────────────────── State text ─────────────────────────────

  private pieceLine(): string {
    const r = this.rules;
    const mins = Math.floor(r.lengthSec / 60);
    const secs = String(Math.round(r.lengthSec % 60)).padStart(2, '0');
    return `PIECE   style: ${pack.sheet(r.style).name}; ${r.meter.id}, ${r.bpm} BPM, ${keyName(r.key)}, ${r.soundWorld.replace(/_/g, ' ')}, ${mins}:${secs}; harmony: ${HARMONIC_LANGUAGE_TEXT[r.harmonicLanguage]}`;
  }

  private planLine(): string {
    const p = this.plan;
    const deps = p.sections.filter((s) => s.departure).map((s) => s.index + 1);
    return (
      `PLAN    ${p.sections.length} sections, roles ${p.sections.map((s) => s.role).join(' / ')}; tension ${p.sections.map((s) => s.tension).join(' ')} (1 calm … 7 overwhelming); ` +
      `departure = ${deps.length ? deps.join(', ') : 'none'}; climax = phrase ${p.climaxPhrase + 1} (section ${this.sectionOf(p.climaxPhrase).index + 1}), arriving as ${ARRIVAL_LABEL[p.climaxArrival ?? 'hit']}; ending: ${this.rules.ending.replace(/_/g, ' ')}`
    );
  }

  themeLines(): string {
    return this.themes
      .map((t) => `THEME ${t.id} ${notation(t.line)}   contour: ${t.contour}${t.kind !== 'main' ? `   (${t.kind}${t.derivation ? `: ${t.derivation}` : ''})` : ''}`)
      .join('\n');
  }

  private lastFour(): string {
    const last = this.phrases.slice(-4);
    if (!last.length) return 'LAST 4  (none yet: this is the first phrase)';
    return (
      'LAST 4  ' +
      last
        .map((p) => `phrase ${p.index + 1} [${p.role}] ${notation(p.line)} | chords ${p.score.display.chords.join(' ')} | = ${p.lineage}`)
        .join('\n        ')
    );
  }

  mixLine(): string {
    const last = this.phrases[this.phrases.length - 1];
    if (!last) return 'MIX     (silence: nothing has played yet)';
    const layers = last.layers.filter((l) => l.inst).map((l) => `${l.role}: ${INSTRUMENTS[l.inst!]?.name ?? l.inst} ${DYNAMIC_NAMES[l.dynamics]}${l.art && l.art !== 'sustain' ? ` ${l.art}` : ''}`);
    const pitches = last.score.notes.filter((n) => n.inst !== 'noise' && n.layer !== 'pulse' && n.layer !== 'accents').map((n) => n.midi);
    const lo = pitches.length ? Math.floor(Math.min(...pitches) / 12) - 1 : 0;
    const hi = pitches.length ? Math.floor(Math.max(...pitches) / 12) - 1 : 0;
    return `MIX     ${layers.join(', ') || 'nothing'}; registers ${lo}-${hi} occupied; overall ${DYNAMIC_NAMES[last.mix.dynamics]}`;
  }

  /** State for the setup and plan calls, before any music exists. */
  preludeState(callType: Parameters<typeof pack.theory>[0], extra: string[] = []): string {
    const lines = [`PROMPT  "${this.prompt}"`];
    if (this.rules) lines.push(this.pieceLine(), pack.styleText(this.rules.style));
    lines.push(...this.preludeLines, ...extra);
    const theory = pack.theory(callType);
    if (theory) lines.push(theory);
    return lines.join('\n');
  }

  /** The full state block for calls made while composing phrase `phrase`. */
  state(callType: Parameters<typeof pack.theory>[0], phrase: number, extra: string[] = []): string {
    const s = this.sectionOf(phrase);
    const lines = [
      `PROMPT  "${this.prompt}"`,
      this.pieceLine(),
      pack.styleText(this.rules.style),
      this.planLine(),
      `NOW     section ${s.index + 1}, phrase ${phrase + 1} of ${this.plan.totalPhrases}, role: ${this.roleOf(phrase)}, target tension ${this.tensionOf(phrase)}, key ${keyName(s.key)}`,
      this.themeLines(),
      this.lastFour(),
    ];
    const last = this.phrases[this.phrases.length - 1];
    if (last) lines.push(`LINEAGE phrase ${last.index + 1} = ${last.lineage}`);
    lines.push(`SINCE   theme intact: ${this.phrases.length ? `${this.phrasesSinceThemeIntact()} phrases ago` : 'not yet stated'}`);
    lines.push(this.mixLine());
    if (this.lastReject) lines.push(`REJECTS last round: "${this.lastReject}"`);
    const cue = this.picture?.(phrase);
    if (cue) lines.push(...cue.lines);
    lines.push(...extra);
    const theory = pack.theory(callType);
    if (theory) lines.push(theory);
    return lines.filter(Boolean).join('\n');
  }
}
