// Display names and number formatting shared by the panel components.

import type {
  Articulation, CallType, EndingId, FormId, GrooveId, HarmonicLanguage, InstrumentId, KeyPlanId,
  LayerSummary, MeterId, ModeId, SoundWorld, Stage,
} from '../../shared/types';

const INSTRUMENT_NAMES: Record<InstrumentId, string> = {
  piano: 'Piano', violins: 'Violins', violins2: 'Violins II', violas: 'Violas', celli: 'Celli',
  basses: 'Basses', solo_violin: 'Solo violin', flute: 'Flute', oboe: 'Oboe', clarinet: 'Clarinet',
  horn: 'Horn', harp: 'Harp', timpani: 'Timpani', bass_drum: 'Bass drum', cymbal: 'Cymbal',
  drumkit: 'Drum kit', celesta: 'Celesta', glockenspiel: 'Glockenspiel', vibraphone: 'Vibraphone',
  tam_tam: 'Tam-tam', sub: 'Sub bass', pad: 'Pad', pluck: 'Pluck', kick808: '808 kick', noise: 'Noise',
  ekit: 'Electronic kit', synth_bass: 'Synth bass', stab: 'Stab', lead: 'Lead', keys: 'Keys',
};

export function instrumentName(id: InstrumentId | string): string {
  return INSTRUMENT_NAMES[id as InstrumentId] ?? humanize(id);
}

export function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

export const MODE_NAMES: Record<ModeId, string> = {
  major: 'major', natural_minor: 'minor', harmonic_minor: 'harmonic minor', melodic_minor: 'melodic minor',
  dorian: 'dorian', phrygian: 'phrygian', lydian: 'lydian', mixolydian: 'mixolydian',
};

export const GROOVE_NAMES: Record<GrooveId, string> = {
  house: 'house', boom_bap: 'boom bap', trap: 'trap', funk: 'funk', pop: 'pop',
};

export function grooveName(groove: GrooveId | string): string {
  return GROOVE_NAMES[groove as GrooveId] ?? humanize(groove);
}

export const HARMONY_NAMES: Record<HarmonicLanguage, string> = {
  triads: 'Triads', sevenths: 'Sevenths', extended: 'Extended', suspended: 'Suspended', chromatic: 'Chromatic',
};

export const WORLD_NAMES: Record<SoundWorld, string> = {
  close_dry: 'Close and dry', large_hall: 'Large hall', submerged: 'Submerged', electronic_hybrid: 'Electronic hybrid',
};

export const FORM_NAMES: Record<FormId, string> = {
  arch: 'Arch', slow_build: 'Slow build', theme_development_return: 'Theme, development, return',
  through_composed: 'Through-composed', verse_like: 'Verse-like',
};

export const ENDING_NAMES: Record<EndingId, string> = {
  resolved: 'Resolved', suspended: 'Suspended', fade: 'Fade', sudden_stop: 'Sudden stop',
};

export const KEYPLAN_NAMES: Record<KeyPlanId, string> = {
  none: 'Stays home', relative: 'Visits the relative key', step_up_at_climax: 'Steps up at the climax',
  distant_dark_turn: 'Distant dark turn',
};

const CALL_LABELS: Partial<Record<CallType, string>> = {
  setup: 'rules', plan: 'plan', theme_shape: 'theme shape', theme_note: 'theme note',
  theme_judge: 'theme judge', theme_derive: 'derive', phrase_direction: 'direction', chord_path: 'chords',
  voice_leading: 'voices', phrase_judge: 'judge', orchestration: 'orchestration',
  ending: 'ending', plan_revision: 'revision',
  frame_reading: 'frames', section_boundary: 'boundary', tempo: 'tempo', fit: 'fit', live_read: 'live read',
};

export function callLabel(type: CallType): string {
  return CALL_LABELS[type] ?? humanize(type);
}

export function isJudgeCall(type: CallType): boolean {
  return type === 'phrase_judge' || type === 'theme_judge';
}

const STAGE_LABELS: Record<Stage, string> = {
  idle: 'Idle', loading: 'Loading', prescan: 'Prescan', setup: 'Rules', plan: 'Plan', themes: 'Themes',
  composing: 'Composing', buffering: 'Buffering', playing: 'Playing', holding: 'Holding', ending: 'Ending',
  done: 'Done', error: 'Error',
};

export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage] ?? humanize(stage);
}

const ART_NAMES: Record<Articulation, string> = {
  sustain: 'sustained', staccato: 'staccato', spiccato: 'spiccato', tremolo: 'tremolo',
  pizzicato: 'pizzicato', hit: 'hit', roll: 'roll',
};

export function articulationName(art: Articulation | null): string {
  return art ? ART_NAMES[art] ?? art : '';
}

const ENTRY_NAMES: Record<LayerSummary['entry'], string> = {
  continues: 'continues', immediate: 'enters', fade_in: 'fades in', delayed: 'enters late',
};

export function entryName(entry: LayerSummary['entry']): string {
  return ENTRY_NAMES[entry] ?? entry;
}

/** 0.618 -> "62%". Values under half a percent show as "<1%" so a live option never reads as zero. */
export function pct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0%';
  const v = Math.round(p * 100);
  if (v === 0) return '<1%';
  return `${v}%`;
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Milliseconds since session start as m:ss. */
export function atClock(ms: number): string {
  return clock(ms / 1000);
}

export function meterParts(meter: MeterId): [string, string] {
  const [top, bottom] = meter.split('/');
  return [top, bottom];
}

export function modelBadge(model: string): string {
  return model.replace(/[-_]+/g, ' ').trim().toUpperCase();
}

/** Seconds on the video clock as m:ss, or m:ss.s with `tenths`. */
export function timecode(sec: number, tenths = false): string {
  const v = Math.max(0, sec);
  if (!tenths) return clock(Math.floor(v));
  const whole = Math.floor(v);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((v - whole) * 10)}`;
}

/** How a tempo candidate relates to the strongest beat grid found in the dancers' movement. */
const RELATION_NAMES: Record<string, string> = { base: 'the beat', half: 'half time', double: 'double time', other: 'other' };

export function relationName(relation: string): string {
  return RELATION_NAMES[relation] ?? humanize(relation);
}

const SOURCE_NAMES: Record<string, string> = { body: 'body', pixels: 'pixels', neutral: 'neutral', tap: 'tap' };

/** Where a tempo (or a tempo candidate) came from: body tracking, raw pixel motion, a neutral default, or a tap. */
export function sourceName(source: string | undefined): string {
  return source ? SOURCE_NAMES[source] ?? humanize(source) : '';
}

/**
 * How a section change is marked inside the unbroken beat: a short tag and a glyph for the
 * timeline. The music never leaves the grid, so every mark is something played on a bar line.
 */
const FIT_SHORT: Record<string, string> = { fill: 'fill', drop_bar: 'drop', riser: 'riser', crash: 'crash', none: 'no mark' };
const FIT_GLYPH: Record<string, string> = { fill: '≋', drop_bar: '○', riser: '↗', crash: '✶', none: '·' };

export function fitShort(choice: string): string {
  return FIT_SHORT[choice] ?? humanize(choice);
}

export function fitGlyph(choice: string): string {
  return FIT_GLYPH[choice] ?? '·';
}

const PEOPLE_NAMES: Record<string, string> = { none: 'no people', one: 'one person', two: 'two people', group: 'a group' };

export function peopleName(people: string): string {
  return PEOPLE_NAMES[people] ?? humanize(people);
}
