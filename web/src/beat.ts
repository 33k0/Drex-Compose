// Pure helpers for the one rigid beat grid the score sits on (GridView): where the beats and bar
// lines fall on the video clock, which beat is under a given time, and which stretches of the clip
// the dancers leave unclear. No DOM, no React: the timeline, the beat pulse and the tests share them.

import type { BeatView, GridView } from '../../shared/choreo';

type Grid = Pick<GridView, 'bpm' | 'barSec' | 'musicStartSec'>;

export function beatSec(grid: Pick<GridView, 'bpm'>): number {
  return 60 / Math.max(1, grid.bpm);
}

/** Beats in one bar (4 for 4/4; 2 in 6/8, where the beat is the dotted quarter). */
export function beatsPerBar(grid: Grid): number {
  return Math.max(1, Math.round(grid.barSec / beatSec(grid)));
}

export interface BeatPos {
  /** Beat number counted from the first downbeat (negative before it: the grid runs back to 0:00 too). */
  index: number;
  /** 0 on a downbeat. */
  beatInBar: number;
  /** Bar number from the first downbeat (0-based, negative before it). */
  bar: number;
  /** 0..1 through the current beat. */
  phase: number;
}

/** The beat under video time `t`: beat k falls at musicStartSec + k * 60 / bpm. */
export function beatAt(grid: Grid, t: number): BeatPos {
  const x = (t - grid.musicStartSec) / beatSec(grid);
  const index = Math.floor(x + 1e-9);
  const bpb = beatsPerBar(grid);
  return {
    index,
    beatInBar: ((index % bpb) + bpb) % bpb,
    bar: Math.floor(index / bpb),
    phase: Math.max(0, x - index),
  };
}

/** Bar-line times from the first downbeat to the end of the clip. */
export function barTimes(grid: Grid, durSec: number): number[] {
  const out: number[] = [];
  if (!(grid.barSec > 0.2)) return out;
  for (let k = 0; ; k++) {
    const t = grid.musicStartSec + k * grid.barSec;
    if (t > durSec + 1e-6) break;
    out.push(t);
  }
  return out;
}

/** Every beat of the grid across the clip, including the ones before the first downbeat. */
export function beatTimes(grid: Grid, durSec: number): number[] {
  const step = beatSec(grid);
  const out: number[] = [];
  const first = -Math.floor(grid.musicStartSec / step + 1e-9);
  for (let k = first; ; k++) {
    const t = grid.musicStartSec + k * step;
    if (t > durSec + 1e-6) break;
    if (t >= -1e-6) out.push(t);
  }
  return out;
}

export function inSpans(spans: { startSec: number; endSec: number }[], t: number): boolean {
  return spans.some((s) => t >= s.startSec && t < s.endSec);
}

/**
 * The unclear part of the clip. Stretches are overlapping analysis windows (20 s every 10 s, say),
 * so each unclear window is drawn over its own share of the clip (its centre, one step wide) and
 * neighbouring ones are merged. A clip analysed in non-overlapping windows keeps them whole.
 */
export function unclearSpans(stretches: BeatView['stretches']): { startSec: number; endSec: number }[] {
  if (stretches.length === 0) return [];
  const sorted = [...stretches].sort((a, b) => a.startSec - b.startSec);
  const steps = sorted.slice(1).map((s, i) => s.startSec - sorted[i].startSec).filter((d) => d > 0).sort((a, b) => a - b);
  const step = steps.length ? steps[steps.length >> 1] : Infinity;
  const spans: { startSec: number; endSec: number }[] = [];
  for (const s of sorted) {
    if (s.clear) continue;
    const half = Math.min((s.endSec - s.startSec) / 2, step / 2);
    const mid = (s.startSec + s.endSec) / 2;
    const span = { startSec: Math.max(s.startSec, mid - half), endSec: Math.min(s.endSec, mid + half) };
    const last = spans[spans.length - 1];
    if (last && span.startSec <= last.endSec + 1e-6) last.endSec = Math.max(last.endSec, span.endSec);
    else spans.push(span);
  }
  return spans;
}
