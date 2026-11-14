// The video reader: the pre-scan. One request per second of video, carrying that second's six
// frames plus two earlier frames for comparison. Frames are never captioned first: Drex reads the
// raw images.
//
// The local stand-in cannot see images. Its priors for these questions come from the motion
// analyser (frame-difference energy, cuts, peaks) and the optional prompt, and nothing else.

import type { BodyLevel, MovementChange, MovementQuality, People, PictureMood, Reading } from '../../shared/choreo.ts';
import type { Mood } from '../core/mood.ts';
import { clamp } from '../core/rng.ts';
import type { ChoiceOption, Gateway, Question } from '../gateway/gateway.ts';
import { pack } from '../pack.ts';
import { frameBase64, framesForSecond, type ExtractedClip } from '../video/extract.ts';
import type { MotionAnalysis, MotionSeries } from '../video/motion.ts';

const opt = (key: string, label: string, criteria: string, prior = 0): ChoiceOption => ({ key, label, criteria, prior });

export const MOVEMENT_LEVELS = [
  '1: still, nothing moves',
  '2: barely moving, small shifts',
  '3: gentle movement',
  '4: steady, clear movement',
  '5: energetic',
  '6: very energetic, big fast movement',
  '7: frantic, everything moving at once',
];
export const PEAK_LEVELS = [
  '1: nothing special, in between moments',
  '2: slight interest',
  '3: a small beat in the action',
  '4: a clear moment',
  '5: a strong moment',
  '6: a high point of the clip',
  '7: the peak: the moment everything is building to',
];

const QUALITY: Record<MovementQuality, string> = {
  flowing: 'flowing: smooth, continuous, connected',
  sharp: 'sharp: sudden stops and hits, angular',
  bouncing: 'bouncing: rhythmic, springy, repeating up and down',
  shaking: 'shaking: fast small trembling or vibrating',
  frozen: 'frozen: a held pose or a still picture',
};
const LEVEL: Record<BodyLevel, string> = {
  low: 'low: crouched, on the floor, or low in the frame',
  middle: 'middle: standing or at ordinary height',
  high: 'high: reaching up, raised arms, standing tall',
  airborne: 'airborne: jumping, off the ground',
};
const MOODS: Record<PictureMood, string> = {
  playful: 'playful: light, fun, teasing',
  tender: 'tender: gentle, close, affectionate',
  tense: 'tense: uneasy, threatening, held breath',
  triumphant: 'triumphant: victorious, proud, big',
  absurd: 'absurd: ridiculous, deadpan, comic nonsense',
  sad: 'sad: sorrowful, heavy, withdrawn',
};
const PEOPLE: Record<People, string> = {
  none: 'no people in frame',
  one: 'one person',
  two: 'two people',
  group: 'a group of three or more',
};

/** Per-second numbers the stand-in leans on, derived from the motion analysis alone. */
export interface MotionSecond {
  level: number; // 1..7
  change: MovementChange;
  spiky: number; // peak-to-mean inside the second
  peak: number; // 1..7
  cut: boolean;
  periodic: boolean;
}

/**
 * Absolute amount of motion in each second, 0..1: the median, over the second, of how much the
 * most-changed tenth of the picture changes between frames. Unlike the analyser's normalised curve
 * this can be compared between clips: a black clip is 0, a slow pulse about 0.01, hard dancing 0.1.
 */
export function absoluteMotion(series: MotionSeries, cuts: number[]): number[] {
  const out: number[] = [];
  for (let s = 0; s * series.rate < series.length; s++) {
    const a = Math.floor(s * series.rate);
    const b = Math.min(series.length, Math.floor((s + 1) * series.rate));
    const vals: number[] = [];
    for (let i = a; i < b; i++) if (!cuts.some((c) => Math.abs(c - i / series.rate) < 1.5 / series.rate)) vals.push(series.top[i]);
    vals.sort((x, y) => x - y);
    out.push(vals.length ? vals[Math.floor(vals.length / 2)] : 0);
  }
  return out;
}

export function motionSeconds(motion: MotionAnalysis, seconds: number, absolute: number[]): MotionSecond[] {
  const curveMax = Math.max(1e-6, ...motion.curve);
  const strongest = Math.max(0, ...motion.tempo.candidates.map((c) => c.strength));
  // Peaks are ranked within the clip: only the top few seconds of a clip can be its high points.
  const tops = Array.from({ length: seconds }, (_x, s) => Math.max(0, ...motion.curve.slice(Math.floor(s * motion.sampleRate), Math.floor((s + 1) * motion.sampleRate))));
  const rankOf = (v: number) => tops.filter((t) => t < v).length / Math.max(1, tops.length - 1);
  // A clip in which almost nothing moves has no high points, however its seconds rank against each other.
  const lively = Math.min(1, Math.max(0, ...absolute) / 0.03);
  void curveMax;
  const out: MotionSecond[] = [];
  for (let s = 0; s < seconds; s++) {
    const e = absolute[s] ?? 0;
    const before = ((absolute[s - 1] ?? e) + (absolute[s - 2] ?? e)) / 2;
    const slice = motion.curve.slice(Math.floor(s * motion.sampleRate), Math.floor((s + 1) * motion.sampleRate));
    const top = Math.max(0, ...slice);
    const mean = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
    out.push({
      level: clamp(1 + 6 * (e / 0.09) ** 0.6, 1, 7),
      change: e > before * 1.25 + 0.004 ? 'rising' : e < before * 0.75 - 0.004 ? 'falling' : 'steady',
      spiky: mean > 1e-6 ? top / mean : 1,
      peak: clamp(1 + 6 * lively * rankOf(top) ** 4 * (motion.peaksSec.some((p) => p >= s && p < s + 1) ? 1 : 0.75), 1, 7),
      cut: motion.cuts.some((c) => c >= s && c < s + 1),
      periodic: strongest >= 0.2,
    });
  }
  return out;
}

function questionsFor(second: number, total: number, ms: MotionSecond[], mood: Mood | null): Question[] {
  const m = ms[second];
  const prev = ms[Math.max(0, second - 3)];
  const next = ms[Math.min(total - 1, second + 3)];
  const calm = m.level <= 2.2;
  // A boundary is likelier where the level of movement changes and stays changed, or on a cut that does the same.
  const around = (from: number, to: number) => {
    const xs = ms.slice(Math.max(0, from), Math.max(0, Math.min(total, to))).map((x) => x.level);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : m.level;
  };
  const shift = Math.abs(around(second, second + 4) - around(second - 4, second));
  const boundaryPrior = clamp(0.04 + (m.cut ? 0.25 : 0) + shift * 0.22 + (m.cut && shift > 1 ? 0.2 : 0), 0.02, 0.95);
  const promptMood = mood
    ? { playful: mood.playful * 1.5 + Math.max(0, mood.valence) * 0.5, tender: (1 - mood.energy) * 0.8, tense: mood.darkness, triumphant: mood.size * 0.8, absurd: mood.playful, sad: Math.max(0, -mood.valence) }
    : { playful: 0, tender: 0, tense: 0, triumphant: 0, absurd: 0, sad: 0 };
  return [
    {
      id: 'movement_amount', type: 'score', label: 'Movement amount',
      instructions: 'Across Images 1 to 6 (this second, in order), how much movement is there?',
      levels: MOVEMENT_LEVELS, prior: m.level - 1, spread: 0.6,
    },
    {
      id: 'movement_change', type: 'choice', label: 'Movement change',
      instructions: 'Compared with the earlier reference frames (Images 7 and 8), is the movement rising, steady or falling?',
      options: (['rising', 'steady', 'falling'] as const).map((k) => opt(k, k, `${k}: the movement is ${k === 'rising' ? 'growing' : k === 'falling' ? 'dying down' : 'about the same'} compared with a few seconds ago`, m.change === k ? 1.6 : 0)),
    },
    {
      id: 'movement_quality', type: 'choice', label: 'Movement quality',
      instructions: 'What is the quality of the movement in this second?',
      options: (Object.keys(QUALITY) as MovementQuality[]).map((k) => opt(k, k, QUALITY[k],
        k === 'frozen' ? (calm ? 2.2 : -2)
          : k === 'bouncing' ? (m.periodic && m.level >= 3 ? 1.6 : 0)
            : k === 'sharp' ? (m.spiky > 2.6 ? 1.5 : 0.2)
              : k === 'shaking' ? (m.level >= 6 && m.spiky < 1.8 ? 1.2 : -0.5)
                : calm ? 0.2 : 1)),
    },
    {
      id: 'body_level', type: 'choice', label: 'Body level',
      instructions: 'Where is the body, or the main subject, in space?',
      options: (Object.keys(LEVEL) as BodyLevel[]).map((k) => opt(k, k, LEVEL[k], k === 'middle' ? 1.4 : k === 'high' ? (m.peak >= 5.5 ? 0.9 : 0) : k === 'airborne' ? (m.peak >= 6.5 && m.spiky > 3 ? 0.6 : -1) : -0.2)),
    },
    {
      id: 'mood', type: 'choice', label: 'Mood',
      instructions: 'What is the mood of this second of the picture?',
      options: (Object.keys(MOODS) as PictureMood[]).map((k) => opt(k, k, MOODS[k],
        promptMood[k] * 1.5 + (k === 'playful' ? (m.periodic && m.level >= 3.5 ? 1 : 0.2) : k === 'tender' ? (calm ? 1 : 0) : k === 'tense' ? (calm && next.level > m.level + 1.5 ? 0.8 : 0) : k === 'triumphant' ? (m.peak >= 6.5 ? 0.8 : -0.3) : k === 'absurd' ? (m.periodic && m.spiky > 2.6 ? 0.6 : 0) : calm && prev.level > m.level + 1.5 ? 0.5 : -0.2))),
    },
    {
      id: 'people', type: 'choice', label: 'People',
      instructions: 'How many people are in frame?',
      options: (Object.keys(PEOPLE) as People[]).map((k) => opt(k, k, PEOPLE[k], k === 'one' ? 1.2 : k === 'none' ? (m.level <= 1.2 ? 0.8 : -0.5) : 0)),
    },
    {
      id: 'scene_cut', type: 'noul', label: 'Scene cut',
      instructions: 'Did the shot change during this second (a cut to a different camera angle or scene between Images 1 and 6)?',
      yes: 'The framing or scene changes abruptly between two consecutive images.',
      no: 'One continuous shot; only the subject moves.',
      prior: m.cut ? 0.9 : 0.04,
    },
    {
      id: 'peak_moment', type: 'score', label: 'Peak moment',
      instructions: 'How much does this second feel like a high point of the clip?',
      levels: PEAK_LEVELS, prior: m.peak - 1, spread: 0.7,
    },
    {
      id: 'repeat', type: 'noul', label: 'Repeat',
      instructions: 'Is this a move already seen in the reference frames (Images 7 and 8): the same gesture or pose coming round again?',
      prior: m.periodic && Math.abs(m.level - prev.level) < 1 && !m.cut ? 0.62 : 0.15,
    },
    {
      id: 'section_boundary', type: 'noul', label: 'New section starts here',
      instructions: 'Does a new section of the clip start in this second: a lasting change of scene, activity or energy that music should mark with a new section?',
      yes: 'What follows is a different passage from what came before, and it stays different.',
      no: 'This second belongs with the seconds before it.',
      prior: second < 4 || second > total - 4 ? 0.02 : boundaryPrior,
    },
  ];
}

export async function readSecond(
  gw: Gateway, clip: ExtractedClip, second: number, total: number, ms: MotionSecond[], mood: Mood | null, prompt: string,
  /** Which second of the video supplies the frames; differs from `second` only in the shuffle control. */
  source = second,
): Promise<Reading> {
  const now = framesForSecond(clip, source);
  const mid = (s: number) => {
    const f = framesForSecond(clip, s);
    return f[Math.floor(f.length / 2)];
  };
  // Two of the eight image slots carry earlier frames for comparison.
  const refs = [second - 1, second - 3].filter((s) => s >= 0).map(mid).filter(Boolean);
  const images = await Promise.all([...now, ...refs].map(frameBase64));
  const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const state = [
    `CLIP    muted video, ${stamp(total)} long; reading second ${stamp(second)} (${second + 1} of ${total})`,
    `IMAGES  Images 1-${now.length} are this second in order, one sixth of a second apart.${refs.length ? ` Image ${now.length + 1} is from one second earlier${refs.length > 1 ? `, Image ${now.length + 2} from three seconds earlier` : ''}; they are only for comparison.` : ' There are no earlier frames to compare with.'}`,
    ...(prompt ? [`PROMPT  "${prompt}" (optional steer for style; the frames decide what is happening)`] : []),
    'TASK    Read what the picture is doing so that music can be composed to it. Judge only what the images show.',
    pack.theory('frame_reading'),
  ].filter(Boolean).join('\n');
  const questions = questionsFor(second, total, ms, mood);
  const ans = await gw.ask({ callType: 'frame_reading', title: `Frames ${stamp(second)}`, state, questions, images, picking: 'top' });
  const p = ans.picks[0];
  return {
    second,
    movement: Number(p.movement_amount) + 1,
    change: p.movement_change as MovementChange,
    quality: p.movement_quality as MovementQuality,
    bodyLevel: p.body_level as BodyLevel,
    mood: p.mood as PictureMood,
    people: p.people as People,
    cut: ans.values.scene_cut >= 0.5,
    peak: Number(p.peak_moment) + 1,
    repeat: ans.values.repeat >= 0.5,
    boundary: ans.values.section_boundary,
  };
}
