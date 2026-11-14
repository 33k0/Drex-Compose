// Setup, plan, backdrop and plan-revision calls: Drex sets the rules of the piece.
// Every `prior` below feeds the local stand-in only.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ArrivalId, EndingId, FormId, HarmonicLanguage, InstrumentId, KeyPlanId, MeterId, ModeId, PhraseRole, PlanView, RulesView,
  SoundWorld, StyleId,
} from '../../shared/types.ts';
import { TENSION_LEVELS, type Ctx } from '../context.ts';
import { promptJitter } from '../core/mood.ts';
import { clamp } from '../core/rng.ts';
import {
  HARMONIC_LANGUAGE_TEXT, keyName, METERS, MODE_FEEL, MODE_NAMES, MODES, pcName, relativeKey, transposeKey, type Key,
} from '../core/theory.ts';
import type { ChoiceOption, Question } from '../gateway/gateway.ts';
import { pack, ROOT } from '../pack.ts';
import { ARRIVAL_LABEL, ARRIVAL_TEXT, availableInstruments, INSTRUMENTS, PHRASE_BARS, ROLE_INSTRUMENTS, type Plan, type Section } from '../piece.ts';

const opt = (key: string, label: string, criteria: string, prior = 0): ChoiceOption => ({ key, label, criteria, prior });

function tempoFeel(bpm: number): string {
  if (bpm < 58) return 'very slow: grave, suspended, time almost stopped';
  if (bpm < 78) return 'slow: breathing, tender, room for long lines';
  if (bpm < 98) return 'walking pace: gentle motion, unhurried';
  if (bpm < 118) return 'moderate: moving, purposeful';
  if (bpm < 138) return 'lively: a dance pulse, bright energy';
  if (bpm < 163) return 'fast: driving, excited';
  return 'very fast: frantic, breathless';
}

export function rulesView(ctx: Ctx): RulesView {
  const r = ctx.piece.rules;
  return {
    style: r.style, styleName: pack.sheet(r.style).name, bpm: r.bpm, meter: r.meter.id, keyName: keyName(r.key), mode: r.key.mode,
    harmonicLanguage: r.harmonicLanguage, palette: r.palette, soundWorld: r.soundWorld, lengthSec: r.lengthSec, form: r.form,
    ending: r.ending, keyPlan: r.keyPlan,
  };
}

export function planView(ctx: Ctx, revised = false): PlanView {
  const { plan } = ctx.piece;
  return {
    sections: plan.sections.map((s) => ({
      index: s.index, role: s.role, tension: s.tension, departure: s.departure, phrases: [s.first, s.last], keyName: keyName(s.key),
      startSec: s.startSec, endSec: s.endSec,
    })),
    totalPhrases: plan.totalPhrases,
    climaxPhrase: plan.climaxPhrase,
    climaxArrival: plan.climaxArrival,
    phraseSec: ctx.piece.phraseSec,
    revised,
  };
}

// ───────────────────────────── Setup ─────────────────────────────

export interface SetupOptions {
  /** Rules that are already decided elsewhere and are not asked: tempo from the tempo call, length from the clip. */
  fixed?: { bpm?: number; lengthSec?: number; form?: FormId };
}

export async function runSetup(ctx: Ctx, opts: SetupOptions = {}): Promise<void> {
  const { piece, gw } = ctx;
  const fixed = opts.fixed ?? {};
  const m = piece.mood;

  // 1. Style sheet.
  const styleQ: Question = {
    id: 'style_sheet', type: 'choice', label: 'Style sheet',
    instructions: 'Which style sheet should this piece be written in, given the prompt?',
    options: pack.sheets.map((s) =>
      opt(s.id, s.name, `${s.summary} Traits: ${s.traits.join('; ')}.`,
        s.id === 'beat_driven' ? m.electronic * 4 + m.energy * 1.2 - 1.6
          : s.id === 'playful' ? m.playful * 4 + Math.max(0, m.valence) * 0.8 - 1.3
            : 0.6 + m.size * 1.2 + Math.max(0, -m.valence) * 1.2 + m.water * 0.8 - m.electronic * 1.5 - m.playful * 1.5)),
  };
  const styleAns = await gw.ask({ callType: 'setup', title: 'Setup: style', state: piece.preludeState('setup'), questions: [styleQ], picking: 'top' });
  const style = styleAns.picks[0].style_sheet as StyleId;
  const orch = style === 'bittersweet_orchestral';
  const beat = style === 'beat_driven';
  const play = style === 'playful';

  // 2. The rules.
  const targetBpm = orch ? 60 + m.energy * 34 : beat ? 96 + m.energy * 48 : 98 + m.energy * 44;
  // With the tempo already fixed, the stand-in leans toward meters that suit it.
  const fastFixed = fixed.bpm !== undefined && fixed.bpm >= 96;
  const tempo: Question = {
    id: 'tempo', type: 'choice', label: 'Tempo',
    instructions: 'Choose the tempo in beats per minute. In 6/8 and 12/8 the beat is the dotted quarter.',
    options: Array.from({ length: 33 }, (_x, i) => 40 + i * 5).map((bpm) =>
      opt(`bpm_${bpm}`, `${bpm} BPM`, `${bpm} BPM, ${tempoFeel(bpm)}`, -(((bpm - targetBpm) / 11) ** 2))),
  };
  const meterPrior: Record<MeterId, number> = {
    '4/4': orch ? 0.5 : beat ? 3 : 1.1,
    '3/4': orch ? 0.5 : beat ? -1 : 0.6,
    '6/8': orch ? 0.6 : beat ? -0.5 : 0.9 + m.playful * 0.4,
    '12/8': (orch ? 1.6 + (1 - m.energy) * 0.6 : beat ? -0.5 : -0.2) - (fastFixed ? 2.5 : 0),
    '5/4': orch ? -0.6 + m.darkness : -1,
    '7/8': play ? 0.1 + m.playful * 0.5 : -1.2,
  };
  const meter: Question = {
    id: 'meter', type: 'choice', label: 'Meter',
    instructions: 'Choose the meter.',
    options: Object.values(METERS).map((mt) => opt(mt.id, mt.id, `${mt.id}: ${mt.feel}`, meterPrior[mt.id] + promptJitter(m, `meter${mt.id}`) * 0.3)),
  };
  const keyCentre: Question = {
    id: 'key_centre', type: 'choice', label: 'Key centre',
    instructions: 'Choose the tonal centre. Sharper keys tend to sound brighter on strings; flat keys warmer and darker.',
    options: Array.from({ length: 12 }, (_x, pc) =>
      opt(`pc_${pc}`, pcName(pc), `tonic ${pcName(pc)}`, promptJitter(m, `key${pc}`) * 1.4)),
  };
  const modePrior: Record<ModeId, number> = {
    major: m.valence * 2 - m.darkness + (play ? 0.5 : 0),
    natural_minor: -m.valence * 1.5 + 0.3 + (orch ? 0.6 : 0),
    harmonic_minor: m.darkness * 1.5 - m.valence + m.energy * 0.5 - 0.4,
    melodic_minor: -m.valence * 0.5 - 0.6,
    dorian: -m.valence * 0.8 + m.electronic * 1.2 + 0.1,
    phrygian: m.darkness * 2.4 - 1.3,
    lydian: m.valence + m.playful + (1 - m.energy) * 0.6 - 0.6 + (play ? 0.5 : 0),
    mixolydian: m.playful * 1.5 + m.valence * 0.5 - 0.5 + (play ? 0.4 : 0),
  };
  const mode: Question = {
    id: 'mode', type: 'choice', label: 'Mode',
    instructions: 'Choose the scale the piece is built on.',
    options: (Object.keys(MODES) as ModeId[]).map((id) => opt(id, MODE_NAMES[id], `${MODE_NAMES[id]}: ${MODE_FEEL[id]}`, modePrior[id])),
  };
  const langPrior: Record<HarmonicLanguage, number> = {
    triads: orch ? -0.5 : beat ? 0.5 : 1,
    sevenths: orch ? 0.3 : beat ? 0.9 : 0.6,
    extended: orch ? 1.5 : beat ? 0.4 : 0,
    suspended: orch ? 0.5 + m.water * 0.5 : beat ? 0.8 : -0.2,
    chromatic: orch ? m.darkness * 2 - 0.2 : m.darkness - 1,
  };
  const language: Question = {
    id: 'harmonic_language', type: 'choice', label: 'Harmonic language',
    instructions: 'Choose the main harmonic language. Every chord family stays available later; this sets the home dialect.',
    options: (Object.keys(HARMONIC_LANGUAGE_TEXT) as HarmonicLanguage[]).map((id) => opt(id, id, HARMONIC_LANGUAGE_TEXT[id], langPrior[id])),
  };
  const worldText: Record<SoundWorld, string> = {
    close_dry: 'close and dry: a small room, every detail audible, intimate',
    large_hall: 'large hall: a concert hall around an orchestra, long warm tail',
    submerged: 'submerged: heard through water, soft-edged, highs veiled',
    electronic_hybrid: 'electronic hybrid: synths and samples together, tight low end',
  };
  const worldPrior: Record<SoundWorld, number> = {
    close_dry: orch ? (1 - m.size) * 1.2 - 0.3 : play ? 1.5 : 0,
    large_hall: orch ? 1.5 + m.size * 0.5 : play ? 0.4 : -0.5,
    submerged: m.water * 2.6 - 0.8 + (orch ? 0.2 : 0),
    electronic_hybrid: beat ? 2.6 : m.electronic * 2 - 1.2,
  };
  const world: Question = {
    id: 'sound_world', type: 'choice', label: 'Sound world',
    instructions: 'Choose the space the music is heard in.',
    options: (Object.keys(worldText) as SoundWorld[]).map((id) => opt(id, id.replace(/_/g, ' '), worldText[id], worldPrior[id])),
  };
  const targetLen = 165 + m.size * 30;
  // Pieces stay around three minutes (product decision); Drex chooses within that.
  const length: Question = {
    id: 'length', type: 'choice', label: 'Length',
    instructions: 'Choose how long the piece lasts. Bigger arcs need more time; a small idea should not outstay its welcome.',
    options: [150, 180, 210].map((s) =>
      opt(`s${s}`, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim(), -(((s - targetLen) / 35) ** 2))),
  };
  const formText: Record<FormId, string> = {
    arch: 'arch: grows to a peak in the middle and returns the way it came',
    slow_build: 'slow build: one long climb from almost nothing to a climax near the end',
    theme_development_return: 'theme and development with return: state the theme, travel away from it, bring it back changed',
    through_composed: 'through-composed: always moving on, sections do not come back',
    verse_like: 'verse-like: a recurring main section alternating with contrasting ones',
  };
  const formPrior: Record<FormId, number> = {
    arch: 0.6 + (1 - m.energy) * 0.4,
    slow_build: m.size * 1.6 + (orch ? 0.7 : 0),
    theme_development_return: 0.8,
    through_composed: m.darkness * 0.6 - 0.2,
    verse_like: beat ? 1.3 : play ? 1 : -0.3,
  };
  const form: Question = {
    id: 'form', type: 'choice', label: 'Form',
    instructions: 'Choose the overall form.',
    options: (Object.keys(formText) as FormId[]).map((id) => opt(id, id.replace(/_/g, ' '), formText[id], formPrior[id] + promptJitter(m, `form${id}`) * 0.3)),
  };
  const endText: Record<EndingId, string> = {
    resolved: 'resolved: comes home to rest on the tonic',
    suspended: 'suspended: stops on an unresolved chord, the question left open',
    fade: 'fade: thins out and recedes into silence',
    sudden_stop: 'sudden stop: cuts off abruptly, leaving the room ringing',
  };
  const endPrior: Record<EndingId, number> = {
    resolved: 0.4 + Math.max(0, m.valence) * 1.2,
    suspended: 0.3 + Math.max(0, -m.valence) * 1.4 + (orch ? 0.4 : 0),
    fade: (1 - m.energy) * 0.9 + m.water * 0.6 + (beat ? 0.4 : 0) - 0.2,
    sudden_stop: m.playful * 1.6 + Math.max(0, m.energy - 0.65) * 3 - 0.6,
  };
  const ending: Question = {
    id: 'ending', type: 'choice', label: 'Ending',
    instructions: 'Choose how the piece will end.',
    options: (Object.keys(endText) as EndingId[]).map((id) => opt(id, id.replace(/_/g, ' '), endText[id], endPrior[id])),
  };
  const kpText: Record<KeyPlanId, string> = {
    none: 'none: stay in the home key throughout',
    relative: 'relative key: visit the relative major or minor for contrast, then return',
    step_up_at_climax: 'up a step at the climax: lift the whole key for the peak',
    distant_dark_turn: 'distant key for a dark turn: move to a remote key late on, then come home',
  };
  const kpPrior: Record<KeyPlanId, number> = {
    none: 0.5,
    relative: 0.6,
    step_up_at_climax: m.size * 1.6 + Math.max(0, m.valence) * 0.5 - 0.2,
    distant_dark_turn: m.darkness * 2 + (orch ? 0.6 : 0) - 0.5,
  };
  const keyPlan: Question = {
    id: 'key_change_plan', type: 'choice', label: 'Key-change plan',
    instructions: 'Choose the plan for key changes.',
    options: (Object.keys(kpText) as KeyPlanId[]).map((id) => opt(id, id.replace(/_/g, ' '), kpText[id], kpPrior[id])),
  };

  const sheetLine = pack.styleText(style);
  const rulesAns = await gw.ask({
    callType: 'setup', title: 'Setup: rules of the piece',
    state: piece.preludeState('setup', [sheetLine]),
    questions: [
      ...(fixed.bpm === undefined ? [tempo] : []),
      meter, keyCentre, mode, language, world,
      ...(fixed.lengthSec === undefined ? [length] : []),
      ...(fixed.form === undefined ? [form] : []),
      keyPlan, ending,
    ],
    picking: 'top',
  });
  const p = rulesAns.picks[0];
  const key: Key = { tonic: Number(p.key_centre.slice(3)), mode: p.mode as ModeId };

  piece.rules = {
    style,
    bpm: fixed.bpm ?? Number(p.tempo.slice(4)),
    meter: METERS[p.meter as MeterId],
    key,
    harmonicLanguage: p.harmonic_language as HarmonicLanguage,
    palette: [],
    soundWorld: p.sound_world as SoundWorld,
    lengthSec: fixed.lengthSec ?? Number(p.length.slice(1)),
    form: fixed.form ?? (p.form as FormId),
    ending: p.ending as EndingId,
    keyPlan: p.key_change_plan as KeyPlanId,
  };

  // 3. Palette: one yes/no per instrument.
  const base: Record<string, number> = orch
    ? { piano: 0.95, violins: 0.9, violins2: 0.82, violas: 0.86, celli: 0.9, basses: 0.86, horn: 0.6, flute: 0.5, oboe: 0.45, clarinet: 0.35, harp: 0.62, timpani: 0.42 + m.size * 0.3, cymbal: 0.4 + m.size * 0.3, bass_drum: 0.35 + m.size * 0.3, solo_violin: 0.35 + (1 - m.size) * 0.3, noise: 0.25 + m.water * 0.6, pad: 0.12, celesta: 0.2, vibraphone: 0.15, tam_tam: 0.2 + m.darkness * 0.3 }
    : beat
      ? { drumkit: 0.95, kick808: 0.8, sub: 0.95, pad: 0.88, pluck: 0.9, piano: 0.5, violins: 0.35, violas: 0.2, celli: 0.3, noise: 0.5, vibraphone: 0.3, cymbal: 0.3 }
      : { flute: 0.82, clarinet: 0.8, oboe: 0.58, violins: 0.85, violins2: 0.6, violas: 0.62, celli: 0.66, basses: 0.55, piano: 0.6, harp: 0.5, pluck: 0.35, glockenspiel: 0.6, celesta: 0.55, drumkit: 0.42 + m.energy * 0.4, timpani: 0.3, horn: 0.3, cymbal: 0.25, vibraphone: 0.3 };
  const avail = [...availableInstruments()];
  const paletteQs: Question[] = avail.map((id) => ({
    id: `use_${id}`, type: 'noul', label: INSTRUMENTS[id].name,
    instructions: `Should the ${INSTRUMENTS[id].name} be part of this piece's palette? Character: ${INSTRUMENTS[id].character}.`,
    yes: 'It suits the style sheet and the prompt and will have a real job in the piece.',
    no: 'It would be out of place or redundant here.',
    prior: clamp((base[id] ?? 0.05) + promptJitter(m, `pal${id}`) * 0.06, 0.02, 0.98),
  }));
  const palAns = await gw.ask({
    callType: 'setup', title: 'Setup: palette',
    state: piece.preludeState('setup'),
    questions: paletteQs, picking: 'top',
  });
  const palette = avail.filter((id) => palAns.values[`use_${id}`] >= 0.5) as InstrumentId[];
  // A piece needs something that can carry a melody and something that can carry a bass. If Drex's
  // yes/no answers leave a role empty, take its most probable instrument for that role.
  for (const role of ['melody', 'bass'] as const) {
    if (!palette.some((id) => ROLE_INSTRUMENTS[role].includes(id))) {
      const best = ROLE_INSTRUMENTS[role]
        .filter((id) => avail.includes(id))
        .sort((a, b) => palAns.values[`use_${b}`] - palAns.values[`use_${a}`])[0];
      if (best) palette.push(best);
    }
  }
  piece.rules.palette = palette;
  ctx.emit({ type: 'rules', rules: rulesView(ctx) });
}

// ───────────────────────────── Plan ─────────────────────────────

export const ROLE_TEXT: Record<PhraseRole, string> = {
  statement: 'statement: present the theme plainly so it can be remembered',
  development: 'development: work the theme, vary it, keep it related and new',
  departure: 'departure: leave the theme on purpose for contrast',
  return: 'return: bring the theme back, intact but in a new light',
  climax: 'climax: the peak of the piece, everything at its fullest',
  coda: 'coda: wind down and close',
};

function template(form: FormId, n: number): { roles: PhraseRole[]; tension: number[] } {
  const roles: PhraseRole[] = [];
  const tension: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i / (n - 1);
    let role: PhraseRole = 'development';
    let t = 3;
    if (form === 'arch') {
      t = 1.5 + 5.2 * Math.sin(Math.PI * Math.min(1, x * 0.9 + 0.05)) ** 1.4;
      role = x < 0.01 ? 'statement' : Math.abs(x - 0.55) < 0.5 / n ? 'climax' : x > 0.7 && x < 0.99 ? 'return' : x >= 0.99 ? 'coda' : 'development';
    } else if (form === 'slow_build') {
      t = x >= 0.99 ? 3 : 1 + 6 * (x / 0.86) ** 1.1;
      role = x < 0.01 ? 'statement' : x >= 0.99 ? 'coda' : i === n - 2 ? 'climax' : 'development';
    } else if (form === 'theme_development_return') {
      t = x >= 0.99 ? 2.5 : 2 + 4.5 * Math.min(1, x / 0.8) ** 1.2;
      role = x < 0.01 ? 'statement' : x >= 0.99 ? 'coda' : i === n - 2 ? 'return' : i === Math.floor(n / 2) ? 'departure' : 'development';
    } else if (form === 'through_composed') {
      t = x >= 0.99 ? 3 : 2 + 4.6 * Math.abs(Math.sin(x * Math.PI * 1.3)) * (0.6 + 0.4 * x);
      role = x < 0.01 ? 'statement' : x >= 0.99 ? 'coda' : i === n - 2 ? 'climax' : i % 2 === 0 ? 'departure' : 'development';
    } else {
      t = x >= 0.99 ? 2.5 : i % 2 === 0 ? 3 + 2.5 * x : 4.5 + 2 * x;
      role = x < 0.01 ? 'statement' : x >= 0.99 ? 'coda' : i % 2 === 0 ? 'return' : i === 1 ? 'development' : 'departure';
    }
    roles.push(role);
    tension.push(clamp(t, 1, 7));
  }
  // The shape is what matters: stretch it so the peak of the form reaches the top of the scale.
  const lo = Math.min(...tension);
  const hi = Math.max(...tension);
  const floor = Math.min(lo, 2);
  const scaled = tension.map((t) => (hi > lo ? floor + ((t - lo) * (7 - floor)) / (hi - lo) : t));
  // The climax role sits on the highest point.
  const peakAt = scaled.indexOf(Math.max(...scaled));
  if (roles.includes('climax') && roles[peakAt] !== 'climax' && peakAt !== 0) {
    roles[roles.indexOf('climax')] = 'development';
    roles[peakAt] = 'climax';
  }
  return { roles, tension: scaled };
}

export function applyKeyPlan(sections: Section[], home: Key, plan: KeyPlanId, climaxSection: number) {
  const last = sections.length - 1;
  for (const s of sections) s.key = home;
  if (plan === 'relative') {
    const targets = sections.filter((s) => s.departure && s.index !== 0 && s.index !== last);
    const chosen = targets.length ? targets : sections.filter((s) => s.index === Math.floor(sections.length / 2));
    for (const s of chosen) s.key = relativeKey(home);
  } else if (plan === 'step_up_at_climax') {
    for (const s of sections) if (s.index >= climaxSection) s.key = transposeKey(home, 2);
  } else if (plan === 'distant_dark_turn') {
    const lateDeparture = sections.filter((s) => s.departure && s.index > sections.length / 2 && s.index !== last).pop();
    const target = lateDeparture ?? sections[Math.max(1, Math.min(last - 1, climaxSection + 1 === last ? climaxSection - 1 : climaxSection + 1))];
    if (target && target.index !== 0) target.key = transposeKey(home, 8);
  }
}

/** Tempo of the climax phrase when Drex chooses a broadened arrival, as a share of the base tempo (proposed; tune by ear). */
export const BROADEN = 0.85;

export async function runPlan(ctx: Ctx): Promise<void> {
  const { piece, gw } = ctx;
  const { rules, mood } = piece;
  const phraseSec = (PHRASE_BARS * rules.meter.beatsPerBar * 60) / rules.bpm;
  const total = Math.max(4, Math.round(rules.lengthSec / phraseSec));
  const n = clamp(Math.round(total / 3), 3, 8);
  const bounds = Array.from({ length: n + 1 }, (_x, i) => Math.round((i * total) / n));
  const tpl = template(rules.form, n);
  const peak = 4.6 + mood.size * 2.6 + mood.energy * 0.6;

  const questions: Question[] = [];
  for (let i = 0; i < n; i++) {
    const span = `section ${i + 1} of ${n} (phrases ${bounds[i] + 1}-${bounds[i + 1]}, about ${Math.round((bounds[i + 1] - bounds[i]) * phraseSec)} s)`;
    questions.push({
      id: `role_${i + 1}`, type: 'choice', label: `Section ${i + 1} role`,
      instructions: `What is the role of ${span}?`,
      options: (Object.keys(ROLE_TEXT) as PhraseRole[]).map((r) => opt(r, r, ROLE_TEXT[r], r === tpl.roles[i] ? 2.2 : r === 'development' ? 0.4 : i === 0 || r === 'coda' || r === 'statement' ? -2 : 0)),
    });
    questions.push({
      id: `tension_${i + 1}`, type: 'score', label: `Section ${i + 1} tension`,
      instructions: `How much tension should ${span} carry? Plan peaks and lulls deliberately across the piece.`,
      levels: TENSION_LEVELS,
      prior: clamp((tpl.tension[i] / 7) * peak, 1, 7) - 1,
      spread: 0.6,
    });
    questions.push({
      id: `departure_${i + 1}`, type: 'noul', label: `Section ${i + 1} leaves the theme`,
      instructions: `Should ${span} leave the theme on purpose, for contrast?`,
      yes: 'A planned departure: contrasting material that still fits the key and mood.',
      no: 'Stays with the theme: every phrase is related to it.',
      prior: tpl.roles[i] === 'departure' ? 0.86 : i === 0 || i === n - 1 ? 0.03 : 0.1,
    });
  }
  const tplClimax = tpl.tension.indexOf(Math.max(...tpl.tension));
  const climaxAt = (bounds[tplClimax] + bounds[tplClimax + 1]) / 2 / total;
  questions.push({
    id: 'climax_position', type: 'choice', label: 'Climax position',
    instructions: 'How far through the piece should the climax fall?',
    options: [50, 60, 70, 80, 90].map((pc) => opt(`at_${pc}`, `${pc}%`, `${pc}% of the way through`, -(((pc / 100 - climaxAt) / 0.09) ** 2))),
  });
  const orchStyle = rules.style === 'bittersweet_orchestral';
  const arrivalPrior: Record<ArrivalId, number> = {
    swell: (1 - mood.size) * 1.4 + (1 - mood.energy) * 0.6 - 0.9,
    hit: orchStyle ? 0.2 : 1.2,
    open_wall: (orchStyle ? 0.9 : 0) + mood.size * 1.2 + mood.water * 0.5,
    broaden: mood.size * 1.1 + mood.darkness * 0.8 - 0.6,
  };
  questions.push({
    id: 'climax_arrival', type: 'choice', label: 'How the climax arrives',
    // The prompt is quoted here because it is a tiny share of the state: measured live, that is what lets it steer this choice.
    instructions: `The piece is "${piece.prompt}". How should its climax arrive?`,
    options: (Object.keys(ARRIVAL_TEXT) as ArrivalId[]).map((a) => opt(a, ARRIVAL_LABEL[a], ARRIVAL_TEXT[a], arrivalPrior[a])),
  });
  questions.push({
    id: 'counter_theme', type: 'noul', label: 'Needs a counter-theme',
    instructions: 'Does this piece need a counter-theme derived from the main theme, to run against it in fuller sections?',
    prior: total >= 8 ? 0.78 : 0.3,
  });
  questions.push({
    id: 'contrast_theme', type: 'noul', label: 'Needs a contrast theme',
    instructions: 'Does this piece need a fresh contrasting theme for its departures?',
    prior: tpl.roles.includes('departure') ? 0.85 : 0.2,
  });

  const ans = await gw.ask({
    callType: 'plan', title: 'Plan: sections, tension curve, departures, climax',
    state: piece.preludeState('plan', [`FORM    ${rules.form.replace(/_/g, ' ')}; ${total} phrases of ${PHRASE_BARS} bars (${phraseSec.toFixed(1)} s each) in ${n} sections; key plan: ${rules.keyPlan.replace(/_/g, ' ')}; ending: ${rules.ending.replace(/_/g, ' ')}`]),
    questions, picking: 'top',
  });
  const p = ans.picks[0];

  const climaxPhrase = clamp(Math.round((Number(p.climax_position.slice(3)) / 100) * total) - 1, 1, total - 1);
  const sections: Section[] = [];
  for (let i = 0; i < n; i++) {
    let role = p[`role_${i + 1}`] as PhraseRole;
    const departure = (ans.values[`departure_${i + 1}`] >= 0.5 || role === 'departure') && i !== 0;
    // The theme has to be stated before it can be developed: the first section states it.
    if (i === 0) role = 'statement';
    else if (departure) role = 'departure';
    sections.push({ index: i, role, tension: Number(p[`tension_${i + 1}`]) + 1, departure, first: bounds[i], last: bounds[i + 1] - 1, key: rules.key });
  }
  const climaxSection = sections.find((s) => climaxPhrase >= s.first && climaxPhrase <= s.last)!;
  if (climaxSection.index !== 0 && !climaxSection.departure) climaxSection.role = 'climax';
  applyKeyPlan(sections, rules.key, rules.keyPlan, climaxSection.index);

  const plan: Plan = {
    sections, totalPhrases: total, climaxPhrase,
    climaxArrival: p.climax_arrival as ArrivalId,
    needsCounter: ans.values.counter_theme >= 0.5,
    needsContrast: ans.values.contrast_theme >= 0.5 || sections.some((s) => s.departure),
  };
  piece.plan = plan;
  // A broadened arrival: the climax phrase itself is played slower.
  if (plan.climaxArrival === 'broaden') piece.phraseBpm.set(climaxPhrase, Math.round(rules.bpm * BROADEN));
  ctx.emit({ type: 'plan', plan: planView(ctx) });
}

/** At a section end Drex looks at what has happened and revises the rest of its own plan. */
export async function revisePlan(ctx: Ctx, nextPhrase: number): Promise<void> {
  const { piece, gw } = ctx;
  const upcoming = piece.plan.sections.filter((s) => s.first >= nextPhrase);
  if (!upcoming.length) return;
  const done = piece.phrases.slice(-4).map((ph) => `phrase ${ph.index + 1} ${ph.role} (tension reached ${ph.score.display.tension})`).join('; ');
  const questions: Question[] = upcoming.map((s) => ({
    id: `tension_${s.index + 1}`, type: 'score', label: `Section ${s.index + 1} tension`,
    instructions: `Section ${s.index + 1} (${s.role}, phrases ${s.first + 1}-${s.last + 1}) was planned at tension ${s.tension}. Given how the piece has actually gone, what tension should it carry?`,
    levels: TENSION_LEVELS,
    prior: s.tension - 1,
    spread: 0.55,
  }));
  const ans = await gw.ask({
    callType: 'plan_revision', title: `Plan revision before section ${upcoming[0].index + 1}`,
    state: piece.state('plan_revision', nextPhrase, [`SO FAR  ${done}`]),
    questions, picking: 'top',
  });
  for (const s of upcoming) s.tension = Number(ans.picks[0][`tension_${s.index + 1}`]) + 1;
  ctx.emit({ type: 'plan', plan: planView(ctx, true) });
}

// ───────────────────────────── Backdrop ─────────────────────────────

interface Backdrop {
  id: string;
  file: string;
  mood: string;
  tags?: Partial<Record<'valence' | 'energy' | 'darkness' | 'water' | 'playful' | 'electronic', number>>;
}

/** Drex picks one pre-made Firefly backdrop for the piece. */
export async function runBackdrop(ctx: Ctx): Promise<void> {
  const file = join(ROOT, 'assets/backdrops/backdrops.json');
  if (!existsSync(file)) return;
  let list: Backdrop[] = [];
  try {
    list = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  // A finished Firefly image saved as <id>.jpg/.png/.webp replaces the placeholder with the same id.
  for (const b of list) {
    const real = ['jpg', 'jpeg', 'png', 'webp'].map((ext) => `${b.id}.${ext}`).find((f) => existsSync(join(ROOT, 'assets/backdrops', f)));
    if (real) b.file = real;
  }
  list = list.filter((b) => existsSync(join(ROOT, 'assets/backdrops', b.file)));
  if (!list.length) return;
  const m = ctx.piece.mood;
  const mv: Record<string, number> = { valence: m.valence, energy: m.energy, darkness: m.darkness, water: m.water, playful: m.playful, electronic: m.electronic };
  const ans = await ctx.gw.ask({
    callType: 'backdrop', title: 'Backdrop',
    state: ctx.piece.preludeState('backdrop'),
    questions: [{
      id: 'backdrop', type: 'choice', label: 'Backdrop image',
      instructions: 'Which backdrop image fits this piece best?',
      options: list.map((b) => {
        let d = 0;
        for (const [k, v] of Object.entries(b.tags ?? {})) d += (v - (mv[k] ?? 0)) ** 2;
        return opt(b.id, b.id.replace(/[-_]/g, ' '), b.mood, -d * 2.5);
      }),
    }],
    picking: 'top',
  });
  const chosen = list.find((b) => b.id === ans.picks[0].backdrop)!;
  ctx.emit({ type: 'backdrop', id: chosen.id, file: chosen.file, mood: chosen.mood });
}
