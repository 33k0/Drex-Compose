// Plan for a video, on an unbreakable beat grid.
//
// The beat found in the dancers' bodies is one rigid grid for the whole clip, and the music never
// leaves it: every phrase is a whole number of bars on that grid, at one tempo, with no held chords
// and no tempo nudges. Section changes move to the bar line nearest the cut. What Drex decides here
// is each section's role, tension and whether it leaves the hook; which section holds the climax
// and how it arrives; and how each cut is marked inside the unbroken beat (a fill, a one-bar drop,
// a riser, a crash).

import type { FitView, Reading, VideoSection } from '../../shared/choreo.ts';
import type { ArrivalId, PhraseRole } from '../../shared/types.ts';
import { applyKeyPlan, planView, ROLE_TEXT } from '../calls/setup.ts';
import { TENSION_LEVELS, type Ctx } from '../context.ts';
import { clamp } from '../core/rng.ts';
import type { ChoiceOption, Question } from '../gateway/gateway.ts';
import { ARRIVAL_LABEL, ARRIVAL_TEXT, arrivalsFor, CLIMAX_THEME_TEXT, PHRASE_BARS, type ClimaxTheme, type Plan, type Section } from '../piece.ts';
import type { BeatStretch } from '../video/beat.ts';
import { stamp } from './timeline.ts';
import type { TempoChoice } from './tempo.ts';

const opt = (key: string, label: string, criteria: string, prior = 0): ChoiceOption => ({ key, label, criteria, prior });

export type CutMark = 'fill' | 'drop_bar' | 'riser' | 'crash' | 'none';

export const CUT_MARKS: Record<CutMark, { label: string; text: string }> = {
  fill: { label: 'drum fill', text: 'drum fill: the last half bar breaks into a fill that lands on a crash at the change. The classic signpost; energy carries straight through.' },
  drop_bar: { label: 'one-bar drop', text: 'one-bar drop: drums and bass fall out for the last bar, leaving the top line hanging, then everything slams back in on the change. Makes the arrival hit hardest.' },
  riser: { label: 'riser', text: 'riser: a snare roll that speeds up and swells through the last bar into the change. Builds anticipation; suits a move to higher energy.' },
  crash: { label: 'crash only', text: 'crash only: the groove runs straight through and a crash marks the first beat of the new section. Light touch; suits a small change.' },
  none: { label: 'nothing', text: 'nothing: the groove runs through unmarked. Only for a cut that changes nothing about the dancing.' },
};

export interface Allocation {
  /** Where each phrase starts and ends on the video clock. Phrases tile the grid with no gaps. */
  starts: number[];
  ends: number[];
  /** Sections after snapping to bar lines. */
  sections: VideoSection[];
  barSec: number;
  /** Time of the first downbeat: the music starts here. */
  musicStartSec: number;
  /** How the change after a phrase is marked (set on the last phrase of each section). */
  cutMarks: Map<number, CutMark>;
  /** Phrases that sit on a stretch with no clear beat: played as a bridge. */
  bridge: boolean[];
  /** True when no beat was found anywhere in the clip: nothing is committed to the grid. */
  noBeat: boolean;
}

/** Split a run of bars into phrases of four where possible (two to six otherwise). */
export function splitBars(total: number): number[] {
  if (total <= 5) return [Math.max(2, total)];
  if (total === 6) return [3, 3];
  const n = Math.floor(total / PHRASE_BARS);
  const rem = total % PHRASE_BARS;
  const out = Array.from({ length: n }, () => PHRASE_BARS);
  if (rem === 1) out[out.length - 1] = PHRASE_BARS + 1;
  else if (rem > 1) out.push(rem);
  return out;
}

/**
 * Which beat is "one": of the four possible bar phases, take the one that puts the most cuts and
 * section changes nearest a bar line. (Movement gives the beat; cuts are the best evidence of bars.)
 */
export function chooseBarPhase(firstBeatSec: number, beatSec: number, marks: { t: number; weight: number }[]): number {
  const barSec = 4 * beatSec;
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k < 4; k++) {
    const start = firstBeatSec + k * beatSec;
    let cost = 0;
    for (const m of marks) {
      const pos = (((m.t - start) % barSec) + barSec) % barSec;
      cost += Math.min(pos, barSec - pos) * m.weight;
    }
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = k;
    }
  }
  return firstBeatSec + best * beatSec;
}

/** Snap section boundaries to bar lines, keeping every section at least two bars long. */
export function snapSections(sections: VideoSection[], musicStartSec: number, barSec: number, totalBars: number): { section: VideoSection; firstBar: number; lastBar: number }[] {
  const edges: number[] = [0];
  const kept: VideoSection[] = [{ ...sections[0] }];
  for (let i = 1; i < sections.length; i++) {
    const bar = clamp(Math.round((sections[i].startSec - musicStartSec) / barSec), 0, totalBars);
    if (bar - edges[edges.length - 1] >= 2 && totalBars - bar >= 2) {
      edges.push(bar);
      kept.push({ ...sections[i] });
    } else kept[kept.length - 1].endSec = sections[i].endSec; // too short on the grid: folded into its neighbour
  }
  edges.push(totalBars);
  return kept.map((s, i) => ({
    section: { ...s, index: i, startSec: i === 0 ? 0 : musicStartSec + edges[i] * barSec, endSec: musicStartSec + edges[i + 1] * barSec },
    firstBar: edges[i], lastBar: edges[i + 1],
  }));
}

function unclearShare(stretches: BeatStretch[], from: number, to: number): number {
  if (!stretches.length) return 0;
  let unclear = 0;
  const step = 0.5;
  let n = 0;
  for (let t = from; t < to; t += step) {
    const covering = stretches.filter((s) => t >= s.startSec && t < s.endSec);
    if (covering.length && covering.every((s) => !s.clear)) unclear++;
    n++;
  }
  return n ? unclear / n : 0;
}

/** Dance tracks move in blocks of eight bars. A stretch longer than this many bars is divided into such blocks (proposed). */
export const LONGEST_SECTION_BARS = 16;
export const BLOCK_BARS = 8;

/** Bar numbers where sections start, with any over-long section divided into eight-bar blocks. */
export function blockEdges(edges: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    out.push(from);
    if (to - from > LONGEST_SECTION_BARS) {
      for (let b = from + BLOCK_BARS; to - b >= BLOCK_BARS / 2; b += BLOCK_BARS) out.push(b);
    }
  }
  out.push(edges[edges.length - 1]);
  return out;
}

export async function runVideoPlan(
  ctx: Ctx, input: VideoSection[], readings: Reading[], tempo: TempoChoice, durationSec: number, cuts: number[], stretches: BeatStretch[],
  /** Describe sections again once their boundaries are final (bar lines on the grid). */
  describe: (boundariesSec: number[]) => VideoSection[],
  emitFit: (fit: FitView) => void,
): Promise<Allocation> {
  const { piece, gw } = ctx;
  const { rules } = piece;
  const beatSec = 60 / tempo.bpm;
  const barSec = rules.meter.beatsPerBar * beatSec;

  // ── The grid ──
  const marks = [...input.slice(1).map((s) => ({ t: s.startSec, weight: 3 })), ...cuts.map((t) => ({ t, weight: 1 }))];
  const musicStartSec = chooseBarPhase(tempo.offsetSec, beatSec, marks);
  const totalBars = Math.max(2, Math.floor((durationSec - musicStartSec) / barSec + 1e-6));
  // Boundaries Drex marked, moved to bar lines; then long stretches divided into eight-bar blocks,
  // because a dance track changes something every eight bars even when the picture does not cut.
  const marked = snapSections(input, musicStartSec, barSec, totalBars);
  const edges = blockEdges([...marked.map((s) => s.firstBar), totalBars]);
  const described = describe(edges.slice(1, -1).map((b) => musicStartSec + b * barSec));
  const snapped = described.map((section, i) => ({ section, firstBar: edges[i], lastBar: edges[i + 1] }));
  const sections = snapped.map((s) => s.section);
  const n = sections.length;
  const inSection = (s: VideoSection) => readings.filter((r) => r.second >= Math.floor(s.startSec) && r.second < Math.ceil(s.endSec));
  const peakOf = (s: VideoSection) => Math.max(1, ...inSection(s).map((r) => r.peak));
  const movementOf = (s: VideoSection) => {
    const rs = inSection(s);
    return rs.length ? rs.reduce((sum, r) => sum + r.movement, 0) / rs.length : s.movement;
  };

  // ── Plan: roles, tension, departures, climax ──
  const heat = sections.map((s) => movementOf(s) + peakOf(s) * 0.5);
  const lo = Math.min(...heat);
  const hi = Math.max(...heat);
  // Stand-in only: the biggest moment goes where the strongest peak reading is.
  const topReading = readings.slice().sort((a, b) => b.peak - a.peak || b.movement - a.movement)[0];
  const holding = sections.findIndex((s) => topReading && topReading.second >= Math.floor(s.startSec) && topReading.second < Math.ceil(s.endSec));
  const climaxGuess = holding > 0 ? holding : heat.reduce((best, h, i) => (i > 0 && h > heat[best] ? i : best), n > 1 ? 1 : 0);
  const questions: Question[] = [];
  sections.forEach((s, i) => {
    const prev = sections[i - 1];
    const changed = !!prev && (prev.mood !== s.mood || Math.abs(movementOf(prev) - movementOf(s)) > 1.5);
    const back = i > 1 && s.mood === sections[0].mood && sections[i - 1].mood !== s.mood;
    const guess: PhraseRole = i === 0 ? 'statement' : i === climaxGuess ? 'climax' : i === n - 1 && heat[i] < hi - 0.5 ? 'coda' : back ? 'return' : changed && i !== n - 1 && heat[i] < heat[i - 1] ? 'departure' : 'development';
    // Stand-in only: where the dancing is steadily energetic for many blocks, shape them like a track
    // (hold back, build, release) instead of leaving every block at the top.
    const shape = [-1.6, -0.6, 0.6, 0.2][i % 4] * (i === 0 || i === n - 1 ? 0 : 1);
    const absolute = 1 + (movementOf(s) - 1) * 0.8 + (peakOf(s) - 4) * 0.25 + shape;
    const relative = (hi > lo ? 1.5 + (5.5 * (heat[i] - lo)) / (hi - lo) : absolute) + shape;
    const bars = snapped[i].lastBar - snapped[i].firstBar;
    const span = `video section ${i + 1} of ${n} (${bars} bars; ${s.summary})`;
    questions.push({
      id: `role_${i + 1}`, type: 'choice', label: `Section ${i + 1} role`,
      instructions: `What is the musical role of ${span}?`,
      options: (Object.keys(ROLE_TEXT) as PhraseRole[]).map((r) => opt(r, r, ROLE_TEXT[r], r === guess ? 2.2 : r === 'development' ? 0.4 : i === 0 || r === 'statement' ? -2 : 0)),
    });
    questions.push({
      id: `tension_${i + 1}`, type: 'score', label: `Section ${i + 1} tension`,
      instructions: `How much energy should the music carry under ${span}? Let the amount of movement guide it: the arrangement gets fuller as the dancing gets bigger and strips back when it eases. A track cannot sit at full energy throughout: even under steadily energetic dancing, shape the blocks (hold back, build, release, break down) so the biggest moments have something to rise from.`,
      levels: TENSION_LEVELS, prior: clamp(0.5 * absolute + 0.5 * relative, 1, 7) - 1, spread: 0.6,
    });
    questions.push({
      id: `departure_${i + 1}`, type: 'noul', label: `Section ${i + 1} leaves the hook`,
      instructions: `Should the music leave its main hook under ${span}, for contrast (a breakdown or a different idea)?`,
      prior: guess === 'departure' ? 0.82 : i === 0 || i === n - 1 ? 0.03 : 0.1,
    });
  });
  questions.push({
    id: 'climax', type: 'choice', label: 'Climax section',
    instructions: 'Which video section should hold the biggest moment of the track?',
    options: sections.map((s, i) => opt(`s${i + 1}`, `section ${i + 1}`, s.summary, (heat[i] - lo) * 1.2 + (i === 0 ? -3 : 0) + (i === climaxGuess ? 2.5 : 0))),
  });
  questions.push({
    id: 'climax_arrival', type: 'choice', label: 'How the climax arrives',
    instructions: 'How should the biggest moment arrive?',
    options: arrivalsFor(rules.style).map((a) => opt(a, ARRIVAL_LABEL[a], ARRIVAL_TEXT[a], a === 'drop' ? 1.8 : a === 'hit' ? 1 : 0)),
  });
  questions.push({
    id: 'climax_theme', type: 'choice', label: 'The hook at the climax',
    instructions: 'A climax means something when the listener recognises what has arrived. What should the hook be at the biggest moment?',
    options: (Object.keys(CLIMAX_THEME_TEXT) as ClimaxTheme[]).map((k) => opt(k, k, CLIMAX_THEME_TEXT[k], k === 'returns' ? 1.6 : 0.3)),
  });
  questions.push({
    id: 'restate_theme', type: 'noul', label: 'State the hook twice',
    instructions: 'Should the hook be stated a second time straight after the first, so it is familiar before anything changes?',
    prior: 0.7,
  });
  questions.push({
    id: 'counter_theme', type: 'noul', label: 'Needs a second line',
    instructions: 'Does this track need a second, derived line to run against the hook in its fuller sections?',
    prior: n >= 3 ? 0.5 : 0.25,
  });
  questions.push({
    id: 'contrast_theme', type: 'noul', label: 'Needs a second hook',
    instructions: 'Does this track need a fresh second hook for the sections that leave the main one?',
    prior: 0.5,
  });

  const ans = await gw.ask({
    callType: 'plan', title: 'Plan: roles, energy, departures, climax',
    state: piece.preludeState('plan', [`GRID    ${tempo.bpm.toFixed(2)} BPM, ${rules.meter.id}, locked to the dancers and never broken; one bar lasts ${barSec.toFixed(2)} s; ${totalBars} bars in all, from ${stamp(musicStartSec)}`]),
    questions, picking: 'top',
  });
  const p = ans.picks[0];
  const climaxIndex = Number(p.climax.slice(1)) - 1;
  const planSections: Section[] = sections.map((s, i) => {
    let role = p[`role_${i + 1}`] as PhraseRole;
    const departure = (ans.values[`departure_${i + 1}`] >= 0.5 || role === 'departure') && i !== 0 && i !== climaxIndex;
    if (i === 0) role = 'statement';
    else if (i === climaxIndex) role = 'climax';
    else if (departure) role = 'departure';
    else if (role === 'climax' || role === 'departure') role = 'development';
    return { index: i, role, tension: Number(p[`tension_${i + 1}`]) + 1, departure, first: 0, last: 0, key: rules.key, startSec: s.startSec, endSec: s.endSec };
  });
  applyKeyPlan(planSections, rules.key, rules.keyPlan, climaxIndex);

  // ── Phrases on the grid ──
  const starts: number[] = [];
  const ends: number[] = [];
  snapped.forEach((s, i) => {
    planSections[i].first = starts.length;
    let bar = s.firstBar;
    for (const bars of splitBars(s.lastBar - s.firstBar)) {
      const index = starts.length;
      if (bars !== PHRASE_BARS) piece.phraseBars.set(index, bars);
      starts.push(musicStartSec + bar * barSec);
      ends.push(musicStartSec + (bar + bars) * barSec);
      bar += bars;
    }
    planSections[i].last = starts.length - 1;
  });
  // With no beat found anywhere (and none tapped), there is no grid worth committing a kick to:
  // the whole score is played as a bridge, and the panel says the beat is uncertain.
  const nothingToAnchor = tempo.strength < 0.2;
  const bridge = starts.map((t, i) => nothingToAnchor || unclearShare(stretches, t, ends[i]) > 0.6);

  // ── How each cut is marked inside the unbroken beat: one call per boundary ──
  const cutMarks = new Map<number, CutMark>();
  for (let i = 0; i < n - 1; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    const rising = planSections[i + 1].tension - planSections[i].tension;
    const onCut = cuts.some((c) => Math.abs(c - s.endSec) < barSec / 2);
    const intoClimax = i + 1 === climaxIndex;
    const prior: Record<CutMark, number> = {
      fill: 1.1 + (rising >= 0 ? 0.3 : 0),
      drop_bar: (intoClimax ? 2 : 0) + (rising >= 2 ? 1 : -0.4),
      riser: rising >= 1 ? 1 + (intoClimax ? 0.4 : 0) : -0.8,
      crash: rising < 0 ? 1.2 : 0.3,
      none: onCut ? -1.5 : -0.3,
    };
    const fit = await gw.ask({
      callType: 'fit', title: `Cut at ${stamp(s.endSec)}: how to mark it`,
      state: piece.preludeState('fit', [
        `GRID    ${tempo.bpm.toFixed(2)} BPM, locked to the dancers; the beat never breaks and the tempo never moves`,
        `LEAVING section ${i + 1} (${planSections[i].role}, energy ${planSections[i].tension} of 7): ${s.summary}`,
        `ENTERING section ${i + 2} (${planSections[i + 1].role}, energy ${planSections[i + 1].tension} of 7)${intoClimax ? ', the biggest moment of the track' : ''}: ${next.summary}`,
        `CHANGE  at ${stamp(s.endSec)}, on a bar line${onCut ? '; the picture cuts here' : '; no hard cut in the picture, the dancing changes'}`,
      ]),
      questions: [{
        id: 'mark', type: 'choice', label: `Change into section ${i + 2}`,
        instructions: 'The music changes section here without leaving the beat. How should the change be marked?',
        options: (Object.keys(CUT_MARKS) as CutMark[]).map((k) => opt(k, CUT_MARKS[k].label, CUT_MARKS[k].text, prior[k])),
      }],
      picking: 'top',
    });
    const mark = fit.picks[0].mark as CutMark;
    cutMarks.set(planSections[i].last, mark);
    emitFit({ section: i, choice: mark, label: CUT_MARKS[mark].label, detail: `into section ${i + 2} at ${stamp(s.endSec)}, on the bar line${onCut ? ' nearest the cut' : ''}` });
  }

  // The climax phrase is the one under the strongest peak of the climax section.
  const cs = planSections[climaxIndex];
  const topSecond = inSection(sections[climaxIndex]).slice().sort((a, b) => b.peak - a.peak || b.movement - a.movement)[0]?.second ?? sections[climaxIndex].startSec;
  let climaxPhrase = cs.first;
  for (let i = cs.first; i <= cs.last; i++) if (starts[i] <= topSecond + 0.5) climaxPhrase = i;
  if (climaxPhrase === 0 && starts.length > 1) climaxPhrase = 1;

  const plan: Plan = {
    sections: planSections, totalPhrases: starts.length, climaxPhrase,
    needsCounter: ans.values.counter_theme >= 0.5,
    needsContrast: ans.values.contrast_theme >= 0.5 || planSections.some((s) => s.departure),
    climaxArrival: p.climax_arrival as ArrivalId,
    climaxTheme: p.climax_theme as ClimaxTheme,
    restate: ans.values.restate_theme >= 0.5,
  };
  piece.plan = plan;
  ctx.emit({ type: 'plan', plan: planView(ctx) });
  return { starts, ends, sections, barSec, musicStartSec, cutMarks, bridge, noBeat: nothingToAnchor };
}
