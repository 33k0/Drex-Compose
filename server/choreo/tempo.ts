// Tempo: code proposes, Drex picks.
//
// The candidates come from the dancers' bodies: one rigid beat grid fitted to the moments they
// land (server/video/beat.ts), offered at its own rate and at half and double time, because a
// body often moves at half or double the musical beat. Raw pixel motion is only a fallback for
// when body tracking cannot run or finds no one. A manual tap overrides everything.

import type { TempoView, VideoSection } from '../../shared/choreo.ts';
import type { Mood } from '../core/mood.ts';
import type { ChoiceOption, Gateway } from '../gateway/gateway.ts';
import { pack } from '../pack.ts';
import { CLEAR_CONFIDENCE, type BeatAnalysis } from '../video/beat.ts';
import type { MotionAnalysis } from '../video/motion.ts';

export interface TempoChoice {
  bpm: number;
  /** Time of the first beat. */
  offsetSec: number;
  /** 0..1: how sure the picture is about this pulse. */
  strength: number;
  source: 'body' | 'pixels' | 'neutral' | 'tap';
  view: TempoView;
}

interface Candidate {
  bpm: number;
  offsetSec: number;
  strength: number;
  relation: string;
  source: 'body' | 'pixels' | 'neutral';
  text: string;
}

function candidatesFrom(beat: BeatAnalysis | null, motion: MotionAnalysis): Candidate[] {
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    if (!out.some((o) => Math.abs(o.bpm - c.bpm) < 1.5)) out.push(c);
  };
  if (beat && beat.candidates.length) {
    const clear = beat.confidence >= CLEAR_CONFIDENCE;
    const top = beat.candidates[0];
    for (const c of beat.candidates.slice(0, 4)) {
      const how = c.relation === 'base' ? "the grid the dancers' landings agree on most"
        : c.relation === 'half' ? 'the same grid at half time (one beat for every two of the strongest grid)'
          : c.relation === 'double' ? 'the same grid at double time'
            : 'a different grid that some of the landings also fit';
      add({
        bpm: c.bpm, offsetSec: c.firstBeatSec, relation: c.relation, source: 'body',
        // Half and double time are the same pulse heard differently: they inherit the confidence of the grid they come from.
        strength: Math.round(beat.confidence * (c.relation === 'other' ? c.agreement / top.agreement : 1) * 100) / 100,
        text: `${c.bpm} BPM: ${how}. From body tracking: the moments the dancers' bodies land agree with this grid at ${c.agreement.toFixed(2)} of 1 (chance on this clip is about ${beat.noiseFloor.toFixed(2)})${clear ? '' : '; overall the movement gives only a weak beat'}. First beat at ${c.firstBeatSec.toFixed(2)} s.`,
      });
    }
  }
  if (!beat || beat.confidence < CLEAR_CONFIDENCE) {
    for (const c of motion.tempo.candidates.slice(0, 4)) {
      const down = motion.tempo.downbeats[String(c.bpm)]?.[0];
      const bpm = Math.round(c.bpm * 100) / 100;
      const neutral = c.relation === 'other';
      add({
        bpm, offsetSec: down?.offsetSec ?? 0, relation: c.relation, source: neutral ? 'neutral' : 'pixels', strength: Math.round(c.strength * 100) / 100,
        text: neutral
          ? `${bpm} BPM: a neutral suggestion from how energetic the clip is, not a measured pulse.`
          : `${bpm} BPM: from raw picture motion (${c.relation === 'base' ? 'its own repeating rate' : `${c.relation} that rate`}), pulse strength ${c.strength.toFixed(2)} of 1. First beat at ${(down?.offsetSec ?? 0).toFixed(2)} s.`,
      });
    }
  }
  return out;
}

export async function chooseTempo(
  gw: Gateway, beat: BeatAnalysis | null, motion: MotionAnalysis, sections: VideoSection[], state: string[], mood: Mood,
  tap?: { bpm: number; offsetSec: number },
): Promise<TempoChoice> {
  const candidates = candidatesFrom(beat, motion);
  const target = 84 + mood.energy * 60; // stand-in only: which reading of the pulse suits the clip's energy
  const options: (ChoiceOption & Candidate)[] = candidates.map((c, i) => ({
    ...c,
    key: `t${i + 1}`,
    label: `${Math.round(c.bpm)} BPM`,
    criteria: c.text,
    prior: c.strength * 6 + (c.source === 'body' ? 1.5 : 0) - ((c.bpm - target) / 30) ** 2,
  }));
  void sections;

  const ans = await gw.ask({
    callType: 'tempo', title: 'Tempo and beat',
    state: [
      ...state,
      beat && beat.candidates.length
        ? `BEAT    body tracking followed ${beat.people.toFixed(1)} people per frame and found ${beat.landings.length} landings; confidence in the best grid ${beat.confidence.toFixed(2)} of 1${beat.confidence < CLEAR_CONFIDENCE ? ' (too low to anchor on)' : ''}`
        : 'BEAT    body tracking found no one to follow; candidates come from raw picture motion',
      'TASK    Choose the tempo and beat the music is composed on. The beat matters most: the groove must sit on the dancers.',
      pack.theory('tempo'),
    ].filter(Boolean).join('\n'),
    questions: [{
      id: 'tempo', type: 'choice', label: 'Tempo and beat',
      instructions: 'Which candidate should the music use? Half and double time describe the same beat grid; choose the reading whose speed suits the energy of the dancing and the style of music it calls for.',
      options,
    }],
    picking: 'top',
  });
  const picked = options.find((o) => o.key === ans.picks[0].tempo)!;
  const view: TempoView = {
    bpm: picked.bpm, offsetSec: picked.offsetSec, strength: picked.strength, manual: false, source: picked.source,
    candidates: options.map((o) => ({ key: o.key, bpm: o.bpm, relation: o.relation, strength: o.strength, offsetSec: o.offsetSec, probability: ans.probabilities.tempo[o.key], source: o.source })),
  };
  if (tap && tap.bpm >= 40 && tap.bpm <= 220) {
    // The safety net: a tapped tempo wins. Drex's own pick stays on the panel for comparison.
    const bpm = Math.round(tap.bpm * 100) / 100;
    return { bpm, offsetSec: tap.offsetSec, strength: 1, source: 'tap', view: { ...view, bpm, offsetSec: tap.offsetSec, strength: 1, manual: true, drexBpm: picked.bpm, source: 'tap' } };
  }
  return { bpm: picked.bpm, offsetSec: picked.offsetSec, strength: picked.strength, source: picked.source, view };
}
