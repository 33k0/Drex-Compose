// What happens to a composed phrase so that it serves the dance: the marks at cuts, bridges where
// the dancers give no clear beat, and extra hits on the biggest moves. All of it stays on the grid.

import type { Reading } from '../../shared/choreo.ts';
import type { InstrumentId, NoteEvent, PhraseScore } from '../../shared/types.ts';
import { LANDING_LAG_SEC, type Landing } from '../video/beat.ts';
import type { CutMark } from './plan.ts';

const KICK = 36;
const SNARE = 38;
const CRASH = 49;
const TOMS = [50, 47, 45];
/** A hit within this many seconds of a grid point snaps onto it; further away it lands exactly on the move (proposed). */
export const SNAP_SEC = 0.06;

const isKit = (inst: string) => inst === 'drumkit' || inst === 'ekit';
const isDrum = (n: NoteEvent) => isKit(n.inst) || n.inst === 'kick808';

/** The kit this piece grooves on: the electronic kit when the palette has one, else the acoustic kit. */
export function kitOf(palette: InstrumentId[]): InstrumentId {
  return (palette.find((i) => (i as string) === 'ekit') ?? 'drumkit') as InstrumentId;
}

const hit = (inst: InstrumentId, t: number, midi: number, vel: number, layer: NoteEvent['layer'] = 'pulse'): NoteEvent =>
  ({ t: Math.round(t * 1000) / 1000, dur: 0.25, midi, vel: Math.min(1, Math.max(0.05, vel)), inst, art: 'hit', layer });

/** A crash and kick on the first beat: the landing of a fill, drop or riser from the phrase before. */
export function addArrival(score: PhraseScore, kit: InstrumentId): void {
  score.notes.push(hit(kit, 0, CRASH, 0.85, 'accents'), hit(kit, 0, KICK, 0.95, 'accents'));
}

/**
 * Mark the change that follows this phrase. Returns true when the next phrase should open with a
 * crash on its first beat.
 */
export function applyCutMark(score: PhraseScore, mark: CutMark, kit: InstrumentId): boolean {
  if (mark === 'none') return false;
  const bar = score.beatsPerBar;
  const lastBar = score.beats - bar;
  if (mark === 'crash') return true;
  if (mark === 'fill') {
    // The last half bar breaks into sixteenths that climb in level and fall through the toms.
    const from = score.beats - bar / 2;
    score.notes = score.notes.filter((n) => !(isDrum(n) && n.t >= from - 1e-6));
    const steps = Math.round((bar / 2) * 4);
    for (let i = 0; i < steps; i++) {
      const t = from + i * 0.25;
      const midi = i < steps / 2 ? SNARE : TOMS[Math.min(TOMS.length - 1, Math.floor(((i - steps / 2) / (steps / 2)) * TOMS.length))];
      score.notes.push(hit(kit, t, midi, 0.55 + (0.4 * i) / steps));
    }
    return true;
  }
  if (mark === 'drop_bar') {
    // Drums and bass fall out for the last bar; whatever carries the tune is left hanging.
    score.notes = score.notes.filter((n) => !(n.t >= lastBar - 1e-6 && (isDrum(n) || n.layer === 'bass' || n.layer === 'pedal' || n.layer === 'figuration')));
    for (const n of score.notes) if ((isDrum(n) || n.layer === 'bass') && n.t < lastBar && n.t + n.dur > lastBar) n.dur = lastBar - n.t;
    return true;
  }
  // riser: a snare roll that speeds up and swells through the last bar.
  score.notes = score.notes.filter((n) => !(isDrum(n) && n.midi === SNARE && n.t >= lastBar - 1e-6));
  let t = lastBar;
  let k = 0;
  while (t < score.beats - 1e-6) {
    const progress = (t - lastBar) / bar;
    score.notes.push(hit(kit, t, SNARE, 0.35 + 0.6 * progress));
    t += progress < 0.5 ? 0.5 : progress < 0.75 ? 0.25 : 0.125;
    k++;
    if (k > 64) break;
  }
  return true;
}

/**
 * A bridge: the dancers give no clear beat here, so the grid is carried through underneath but the
 * kick and snare step back, leaving hats and whatever floats on top. Any small error in the
 * carried grid is then inaudible. `rejoin` adds a fill when the clear beat returns after it.
 */
export function applyBridge(score: PhraseScore, kit: InstrumentId, rejoin: boolean): boolean {
  score.notes = score.notes.filter((n) => !(isDrum(n) && (n.midi === KICK || n.midi === SNARE || n.midi === 39)));
  for (const n of score.notes) {
    if (n.layer === 'bass') n.vel *= 0.7;
    if (isDrum(n)) n.vel *= 0.8;
  }
  score.display.lineage += '; bridge (no clear beat in the dancing)';
  return rejoin ? applyCutMark(score, 'fill', kit) : false;
}

/**
 * Extra hits on the biggest moves. Drex's readings say which seconds are high points; the body
 * tracking says exactly when the bodies land inside them. A landing close to a grid point snaps
 * onto it; one further away is hit exactly where it falls.
 */
export function addHits(score: PhraseScore, startSec: number, landings: Landing[], readings: Reading[], kit: InstrumentId, max = 2): number {
  const endSec = startSec + (score.beats * 60) / score.bpm;
  const high = new Map(readings.filter((r) => r.peak >= 5).map((r) => [r.second, r.peak]));
  const candidates = landings
    .filter((l) => l.t - LANDING_LAG_SEC >= startSec + 0.05 && l.t - LANDING_LAG_SEC < endSec - 0.05 && l.weight >= 1.2 && high.has(Math.floor(l.t)))
    .sort((a, b) => b.weight * (high.get(Math.floor(b.t)) ?? 0) - a.weight * (high.get(Math.floor(a.t)) ?? 0));
  const taken: number[] = [];
  for (const l of candidates) {
    if (taken.length >= max) break;
    const exact = ((l.t - LANDING_LAG_SEC - startSec) * score.bpm) / 60;
    // Eighth notes are the grid for hits: at dance tempos sixteenths are closer together than the snap window itself.
    const grid = Math.round(exact * 2) / 2;
    const beat = (Math.abs(exact - grid) * 60) / score.bpm <= SNAP_SEC ? grid : exact;
    if (taken.some((b) => Math.abs(b - beat) < 2)) continue; // not two hits on top of each other
    taken.push(beat);
    const peak = high.get(Math.floor(l.t)) ?? 5;
    const vel = 0.7 + 0.1 * Math.min(2, l.weight);
    score.notes.push(hit(kit, beat, SNARE, vel, 'accents'), hit(kit, beat, KICK, vel, 'accents'));
    if (peak >= 6) score.notes.push(hit(kit, beat, CRASH, vel * 0.9, 'accents'));
  }
  if (taken.length) score.notes.sort((a, b) => a.t - b.t);
  return taken.length;
}

/** How many beats of a phrase carry a kick or snare: the check that the groove is actually running. */
export function grooveCoverage(score: PhraseScore): number {
  const beats = new Set<number>();
  for (const n of score.notes) if (isDrum(n) && (n.midi === KICK || n.midi === SNARE || n.midi === 39)) beats.add(Math.floor(n.t + 1e-6));
  return beats.size / Math.max(1, Math.floor(score.beats));
}
