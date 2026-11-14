// Display names and number formatting shared by the panel components.

import type {
  Articulation, CallType, EndingId, FormId, HarmonicLanguage, InstrumentId, KeyPlanId,
  LayerSummary, MeterId, ModeId, SoundWorld, Stage,
} from '../../shared/types';

const INSTRUMENT_NAMES: Record<InstrumentId, string> = {
  piano: 'Piano', violins: 'Violins', violins2: 'Violins II', violas: 'Violas', celli: 'Celli',
  basses: 'Basses', solo_violin: 'Solo violin', flute: 'Flute', oboe: 'Oboe', clarinet: 'Clarinet',
  horn: 'Horn', harp: 'Harp', timpani: 'Timpani', bass_drum: 'Bass drum', cymbal: 'Cymbal',
  drumkit: 'Drum kit', celesta: 'Celesta', glockenspiel: 'Glockenspiel', vibraphone: 'Vibraphone',
  tam_tam: 'Tam-tam', sub: 'Sub bass', pad: 'Pad', pluck: 'Pluck', kick808: '808 kick', noise: 'Noise',
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
  setup: 'rules', plan: 'plan', backdrop: 'backdrop', theme_shape: 'theme shape', theme_note: 'theme note',
  theme_judge: 'theme judge', theme_derive: 'derive', phrase_direction: 'direction', chord_path: 'chords',
  voice_leading: 'voices', phrase_judge: 'judge', orchestration: 'orchestration', hold: 'hold',
  ending: 'ending', plan_revision: 'revision',
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

/** Where the server's backdrop path lives. Data and absolute URLs (mock mode) pass through. */
export function backdropUrl(file: string): string {
  if (/^(data:|blob:|https?:)/.test(file)) return file;
  if (file.startsWith('/')) return file;
  if (file.startsWith('assets/')) return `/${file}`;
  return `/assets/backdrops/${file}`;
}
