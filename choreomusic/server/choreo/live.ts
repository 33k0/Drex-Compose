// Live read: while the video plays, Drex looks at the frames two to three seconds ahead, together
// with what the music is doing at that moment, and refines layers, dynamics and accents.
// The piece itself is already composed; these are small adjustments on top of it.

import type { LiveCue, Reading } from '../../shared/choreo.ts';
import type { InstrumentId, NoteEvent } from '../../shared/types.ts';
import { beatToSec, DYNAMIC_NAMES } from '../../shared/types.ts';
import { AMOUNT_LEVELS } from '../context.ts';
import { mod } from '../core/rng.ts';
import type { ChoiceOption, Gateway, Question } from '../gateway/gateway.ts';
import { pack } from '../pack.ts';
import { INSTRUMENTS, type Piece } from '../piece.ts';
import { frameBase64, framesForSecond, type ExtractedClip } from '../video/extract.ts';
import type { MotionAnalysis } from '../video/motion.ts';
import { stamp } from './timeline.ts';

const opt = (key: string, label: string, criteria: string, prior = 0): ChoiceOption => ({ key, label, criteria, prior });

export const LIVE_LEAD_SEC = 2; // the live read looks two to three seconds ahead

export async function liveRead(
  gw: Gateway, piece: Piece, clip: ExtractedClip, readings: Reading[], motion: MotionAnalysis,
  starts: number[], ends: number[], second: number, nowSec: number,
): Promise<LiveCue | null> {
  const index = starts.findIndex((s, i) => second + 0.5 >= s && second + 0.5 < ends[i]);
  const record = piece.phrases[index];
  const reading = readings[second];
  if (!record || !reading) return null;
  const score = record.score;
  const atSec = motion.peaksSec.find((p) => p >= second && p < second + 1) ?? second + 0.5;

  // Is there already a composed accent near this moment?
  const composed = score.notes.some((n) => n.layer === 'accents' && Math.abs(starts[index] + beatToSec(score, n.t) - atSec) < 0.8);
  const has = (id: InstrumentId) => piece.rules.palette.includes(id);
  const kinds: [string, string, string, boolean][] = [
    ['bass_drum', 'bass drum', 'one deep impact', has('bass_drum')],
    ['cymbal', 'cymbal crash', 'a bright crash', has('cymbal')],
    ['timpani', 'timpani stroke', 'pitched thunder on the root', has('timpani')],
    ['low_piano', 'low piano octave', 'a dark bell under everything', has('piano')],
    ['kit', 'kit crash and kick', 'a drop landing', has('drumkit')],
    ['kick', 'soft kick', 'a round low thump', has('kick808')],
  ];
  const available = kinds.filter((k) => k[3]);

  const now = framesForSecond(clip, second);
  const ref = framesForSecond(clip, Math.max(0, Math.floor(nowSec)));
  const images = await Promise.all([...now, ...[ref[1], ref[4]].filter(Boolean)].map(frameBase64));
  const layers = record.layers.filter((l) => l.inst).map((l) => `${l.role}: ${INSTRUMENTS[l.inst!]?.name ?? l.inst} ${DYNAMIC_NAMES[l.dynamics]}`).join(', ');
  const state = [
    `CLIP    live read at ${stamp(nowSec)}; Images 1-${now.length} show ${stamp(second)}, ${(second - nowSec).toFixed(0)} s ahead of what is on screen; the last ${images.length - now.length} image(s) show the picture now`,
    `MUSIC   at ${stamp(second)} phrase ${index + 1} of ${piece.plan.totalPhrases} will be sounding (${record.role}, tension ${score.display.tension}, overall ${DYNAMIC_NAMES[record.mix.dynamics]}); ${layers}`,
    `READING pre-scan of that second: movement ${reading.movement}, ${reading.change}, ${reading.quality}; peak ${reading.peak}${reading.cut ? '; scene cut' : ''}`,
    `ACCENTS ${composed ? 'the composed score already has an accent within a second of this moment' : 'no composed accent near this moment'}`,
    'TASK    Refine the performance of the already-composed music for this second. Small adjustments only.',
    pack.theory('live_read'),
  ].filter(Boolean).join('\n');

  const questions: Question[] = [
    {
      id: 'dynamics', type: 'choice', label: 'Dynamics',
      instructions: 'Should the music lift, stay, or drop for this second?',
      options: [
        opt('lift', 'lift', 'lift: push the level up a little to meet the picture', reading.change === 'rising' && reading.movement >= 5 ? 1.2 : -0.4),
        opt('keep', 'keep', 'keep: the composed level already fits', 1),
        opt('drop', 'drop', 'drop: pull back a little', reading.change === 'falling' && reading.movement <= 2 ? 1.2 : -0.5),
      ],
    },
    {
      id: 'brightness', type: 'choice', label: 'Brightness',
      instructions: 'Should the sound open up, stay, or close in for this second?',
      options: [
        opt('open', 'open', 'open: brighter, the filter opens', reading.bodyLevel === 'airborne' || reading.peak >= 6 ? 0.9 : -0.5),
        opt('keep', 'keep', 'keep: as composed', 1),
        opt('close', 'close', 'close: darker, more covered', reading.quality === 'frozen' ? 0.7 : -0.6),
      ],
    },
  ];
  if (available.length) {
    questions.push(
      {
        id: 'accent', type: 'noul', label: 'Extra accent',
        instructions: 'Should an extra accent land on this second, on top of the composed score?',
        yes: 'The picture has a hit, landing or high point here that the composed music does not already mark.',
        no: 'Nothing here needs marking, or the score already marks it.',
        prior: composed ? 0.03 : reading.peak >= 6 ? 0.78 : reading.cut && reading.peak >= 4 ? 0.4 : 0.04,
      },
      {
        id: 'accent_kind', type: 'choice', label: 'Accent kind',
        instructions: 'If an accent lands here, which kind?',
        options: available.map(([key, label, text], i) => opt(key, label, `${label}: ${text}`, 1 - i * 0.25)),
      },
      {
        id: 'accent_strength', type: 'score', label: 'Accent strength',
        instructions: 'How hard should it hit?',
        levels: AMOUNT_LEVELS, prior: Math.min(6, reading.peak - 1), spread: 0.7,
      },
    );
  }

  // The picture is two seconds away: this goes ahead of anything else queued.
  const ans = await gw.ask({ callType: 'live_read', title: `Live read ${stamp(second)}`, state, questions, images, picking: 'top', priority: true });
  const p = ans.picks[0];
  const cue: LiveCue = { atSec, label: '' };
  const parts: string[] = [];
  if (p.dynamics !== 'keep' || p.brightness !== 'keep') {
    cue.nudge = {
      gainDb: p.dynamics === 'lift' ? 1.5 : p.dynamics === 'drop' ? -2 : 0,
      lowpassSteps: p.brightness === 'open' ? 1 : p.brightness === 'close' ? -1 : 0,
      overSec: 0.6,
    };
    if (p.dynamics !== 'keep') parts.push(p.dynamics);
    if (p.brightness !== 'keep') parts.push(p.brightness === 'open' ? 'brighter' : 'darker');
  } else {
    // Back to the composed mix.
    cue.nudge = { gainDb: 0, lowpassSteps: 0, overSec: 1 };
  }
  if (available.length && ans.values.accent >= 0.5) {
    const vel = 0.3 + Number(p.accent_strength) * 0.1;
    const beat = ((atSec - starts[index]) * score.bpm) / 60;
    const slot = record.slots.find((s) => beat >= s.t && beat < s.t + s.dur) ?? record.slots[record.slots.length - 1];
    const root = mod(record.key.tonic + slot.chord.root, 12);
    const at = (lo: number) => lo + mod(root - lo, 12);
    const n = (inst: InstrumentId, midi: number, dur: number, v = vel, art: NoteEvent['art'] = 'hit'): NoteEvent => ({ t: 0, dur, midi, vel: Math.min(1, v), inst, art, layer: 'accents' });
    const notes: NoteEvent[] =
      p.accent_kind === 'bass_drum' ? [n('bass_drum', 36, 2)]
        : p.accent_kind === 'cymbal' ? [n('cymbal', 49, 3)]
          : p.accent_kind === 'timpani' ? [n('timpani', at(41), 2)]
            : p.accent_kind === 'low_piano' ? [n('piano', at(24), 3, vel, 'sustain'), n('piano', at(24) + 12, 3, vel * 0.9, 'sustain')]
              : p.accent_kind === 'kit' ? [n('drumkit', 49, 1), n('drumkit', 36, 1)]
                : [n('kick808', 36, 0.5)];
    cue.accent = { notes, bpm: score.bpm };
    parts.push(`accent: ${available.find((k) => k[0] === p.accent_kind)?.[1] ?? p.accent_kind}`);
  }
  cue.label = parts.length ? parts.join(', ') : 'as composed';
  return cue;
}
