// Timeline builder: turns the per-second readings into sections, a text timeline for the state,
// one key frame per section, and the per-phrase picture cues the composer reads.

import type { PictureMood, Reading, VideoSection } from '../../shared/choreo.ts';
import type { Mood } from '../core/mood.ts';
import { clamp, hashString } from '../core/rng.ts';
import type { PictureCue } from '../piece.ts';
import type { ExtractedClip } from '../video/extract.ts';
import type { MotionAnalysis } from '../video/motion.ts';

export const MIN_SECTION_SEC = 6; // proposed
export const MAX_SECTIONS = 8;

export const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function mode<T extends string>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Drex marks section boundaries (a yes/no per second). Code keeps the marked seconds that leave
 * every section at least MIN_SECTION_SEC long, strongest first. A clip needs a few sections for a
 * piece to have a shape, so if fewer than two boundaries were marked the most probable seconds are
 * used anyway.
 */
export function chooseBoundaries(readings: Reading[], durationSec: number): number[] {
  // Dance tracks change every eight bars or so: a clip gets roughly one section per twenty seconds,
  // taken from the seconds Drex found most likely to start one, even when none crossed 50%.
  const want = durationSec < 20 ? 1 : Math.max(2, Math.min(MAX_SECTIONS - 1, Math.round(durationSec / 20) - 1));
  const ranked = readings
    .filter((r) => r.second >= MIN_SECTION_SEC && r.second <= durationSec - MIN_SECTION_SEC)
    .sort((a, b) => b.boundary - a.boundary);
  const picked: number[] = [];
  const take = (threshold: number, limit: number) => {
    for (const r of ranked) {
      if (picked.length >= limit) break;
      if (r.boundary < threshold) break;
      if (picked.every((s) => Math.abs(s - r.second) >= MIN_SECTION_SEC)) picked.push(r.second);
    }
  };
  take(0.5, MAX_SECTIONS - 1);
  if (picked.length < want) take(0, want);
  return picked.sort((a, b) => a - b);
}

export function buildSections(readings: Reading[], boundaries: number[], durationSec: number, motion: MotionAnalysis, exact = false): VideoSection[] {
  const edges = [0, ...boundaries, durationSec];
  const sections: VideoSection[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    // A boundary second that contains a hard cut starts exactly on the cut.
    // With `exact`, the boundaries are already final (bar lines of the beat grid) and are kept as given.
    const cutIn = (s: number) => (exact ? undefined : motion.cuts.find((c) => c >= s - 0.5 && c < s + 1));
    const startSec = i === 0 ? 0 : cutIn(edges[i]) ?? edges[i];
    const endSec = i === edges.length - 2 ? durationSec : cutIn(edges[i + 1]) ?? edges[i + 1];
    const inside = readings.filter((r) => r.second >= Math.floor(startSec) && r.second < Math.ceil(endSec));
    const span = inside.length ? inside : readings.slice(-1);
    const top = span.slice().sort((a, b) => b.peak - a.peak || b.movement - a.movement)[0];
    const movement = Math.round(mean(span.map((r) => r.movement)) * 10) / 10;
    const first = mean(span.slice(0, Math.ceil(span.length / 2)).map((r) => r.movement));
    const second = mean(span.slice(Math.floor(span.length / 2)).map((r) => r.movement));
    const trend = second > first + 0.7 ? 'rising' : second < first - 0.7 ? 'falling' : 'steady';
    const cuts = span.filter((r) => r.cut && r.second > Math.floor(startSec)).length;
    const repeats = span.filter((r) => r.repeat).length;
    const summary =
      `${stamp(startSec)}-${stamp(endSec)}: movement ${movement} (${trend}), ${mode(span.map((r) => r.quality))}, ${mode(span.map((r) => r.bodyLevel))}; ` +
      `mood ${mode(span.map((r) => r.mood))}; ${mode(span.map((r) => r.people)).replace('none', 'no people').replace('one', 'one person').replace('two', 'two people')}; ` +
      `peak ${top.peak} at ${stamp(top.second)}${cuts ? `; ${cuts} cut${cuts === 1 ? '' : 's'} inside` : ''}${repeats >= span.length / 2 ? '; repeating moves' : ''}`;
    sections.push({ index: i, startSec, endSec, summary, keyFrame: top.second * 6 + 3, movement, mood: mode(span.map((r) => r.mood)) });
  }
  return sections;
}

export function timelineLines(sections: VideoSection[], durationSec: number, name: string): string[] {
  return [
    `VIDEO   "${name}", ${stamp(durationSec)} long, ${sections.length} sections (movement 1 still … 7 frantic; peak 1 … 7):`,
    ...sections.map((s, i) => `        section ${i + 1}  ${s.summary}${i < 8 ? `  [key frame: Image ${i + 1}]` : ''}`),
  ];
}

/** Stand-in only: a mood for the heuristic priors, from the readings blended with the optional prompt. */
export function moodFromReadings(readings: Reading[], prompt: Mood | null, name: string): Mood {
  const share = (m: PictureMood) => readings.filter((r) => r.mood === m).length / Math.max(1, readings.length);
  const energy = clamp((mean(readings.map((r) => r.movement)) - 1) / 5.2, 0, 1);
  const fromVideo: Mood = {
    valence: clamp(share('playful') + share('triumphant') + 0.6 * share('absurd') + 0.3 * share('tender') - share('sad') - 0.6 * share('tense'), -1, 1),
    energy,
    darkness: clamp(share('tense') + share('sad') * 0.7, 0, 1),
    playful: clamp(share('playful') + share('absurd'), 0, 1),
    electronic: clamp((readings.filter((r) => r.quality === 'bouncing' || r.quality === 'sharp').length / Math.max(1, readings.length)) * energy * 1.2, 0, 1),
    size: clamp(share('triumphant') + mean(readings.map((r) => r.peak)) / 14, 0, 1),
    water: 0,
    hash: hashString(name),
  };
  if (!prompt) return fromVideo;
  const mix = (a: number, b: number) => a * 0.5 + b * 0.5;
  return {
    valence: mix(fromVideo.valence, prompt.valence), energy: mix(fromVideo.energy, prompt.energy), darkness: mix(fromVideo.darkness, prompt.darkness),
    // A prompt can steer the style outright ("make it orchestral"): take the stronger signal for these.
    playful: Math.max(fromVideo.playful * 0.6, prompt.playful), electronic: Math.max(fromVideo.electronic * 0.6, prompt.electronic),
    size: mix(fromVideo.size, prompt.size), water: prompt.water, hash: prompt.hash ^ fromVideo.hash,
  };
}

/** Picture cue for one phrase: what the frames do between `startSec` and `endSec`. */
export function cueFor(
  readings: Reading[], motion: MotionAnalysis, startSec: number, endSec: number, bpm: number, nextEndSec: number | null,
): PictureCue {
  const span = readings.filter((r) => r.second + 1 > startSec && r.second < endSec);
  const use = span.length ? span : readings.slice(-1);
  const toBeat = (sec: number) => ((sec - startSec) * bpm) / 60;
  // The exact instant inside a second comes from the motion curve: the reading says which second, the curve says when.
  const instant = (second: number, list: number[]) => list.find((p) => p >= second && p < second + 1) ?? second + 0.5;
  const top = use.slice().sort((a, b) => b.peak - a.peak)[0];
  const peakSec = instant(top.second, motion.peaksSec);
  const cutReading = use.find((r) => r.cut && r.second + 1 > startSec + 0.75);
  const cutSec = cutReading ? instant(cutReading.second, motion.cuts) : null;
  const movement = Math.round(mean(use.map((r) => r.movement)) * 10) / 10;
  const lines = [
    `VIDEO   ${stamp(startSec)}-${stamp(endSec)} under this phrase: movement ${movement}, ${mode(use.map((r) => r.change))}, ${mode(use.map((r) => r.quality))}; body ${mode(use.map((r) => r.bodyLevel))}; mood ${mode(use.map((r) => r.mood))}${top.peak >= 5 ? `; peak ${top.peak} at ${stamp(peakSec)}` : ''}${cutSec !== null ? `; scene cut at ${stamp(cutSec)}` : ''}`,
  ];
  if (nextEndSec !== null) {
    const ahead = readings.filter((r) => r.second + 1 > endSec && r.second < nextEndSec);
    if (ahead.length) {
      const aTop = ahead.slice().sort((a, b) => b.peak - a.peak)[0];
      const aCut = ahead.find((r) => r.cut);
      lines.push(`AHEAD   movement ${Math.round(mean(ahead.map((r) => r.movement)) * 10) / 10}; peak ${aTop.peak} at ${stamp(aTop.second)}${aCut ? `; scene cut at ${stamp(aCut.second)}` : ''}`);
    }
  }
  const inside = (sec: number) => sec > startSec + 0.05 && sec < endSec - 0.05;
  return {
    lines,
    movement,
    quality: mode(use.map((r) => r.quality)),
    bodyLevel: mode(use.map((r) => r.bodyLevel)),
    mood: mode(use.map((r) => r.mood)),
    change: mode(use.map((r) => r.change)),
    peak: top.peak >= 5 && inside(peakSec) ? { beat: toBeat(peakSec), strength: top.peak } : undefined,
    cut: cutSec !== null && inside(cutSec) ? { beat: toBeat(cutSec) } : undefined,
  };
}

export function keyFrames(clip: ExtractedClip, sections: VideoSection[]) {
  return sections.slice(0, 8).map((s) => clip.frames[Math.min(clip.frames.length - 1, s.keyFrame)]);
}
