// Choreomusic's additions to the shared contract: everything about the video.

import type { NoteEvent, ServerEvent } from './types.ts';

export type MovementChange = 'rising' | 'steady' | 'falling';
export type MovementQuality = 'flowing' | 'sharp' | 'bouncing' | 'shaking' | 'frozen';
export type BodyLevel = 'low' | 'middle' | 'high' | 'airborne';
export type PictureMood = 'playful' | 'tender' | 'tense' | 'triumphant' | 'absurd' | 'sad';
export type People = 'none' | 'one' | 'two' | 'group';

/** What Drex read from one second of video (six frames plus two earlier frames for comparison). */
export interface Reading {
  second: number;
  /** 1 still … 7 frantic */
  movement: number;
  change: MovementChange;
  quality: MovementQuality;
  bodyLevel: BodyLevel;
  mood: PictureMood;
  people: People;
  cut: boolean;
  /** 1..7: how much this second feels like a high point */
  peak: number;
  repeat: boolean;
  /** Probability that a new section starts at this second. */
  boundary: number;
}

export interface ClipInfo {
  id: string;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  /** Muted, browser-playable video. */
  videoUrl: string;
  /** Frame image URL with "{i}" for the frame index; frame i shows time (i + 0.5) / 6 s. */
  frameUrl: string;
  frameCount: number;
  fps: 6;
}

export interface VideoSection {
  index: number;
  startSec: number;
  endSec: number;
  /** One line of text built from the readings. */
  summary: string;
  /** Frame index of the section's key frame. */
  keyFrame: number;
  movement: number;
  mood: PictureMood;
}

/** The beat found in the dancers' movement (body tracking), before any tempo is chosen. */
export interface BeatView {
  /** 'body' when body tracking ran; 'pixels' when it could not and only raw motion was analysed. */
  method: 'body' | 'pixels';
  /** Why body tracking was not used, when it was not. */
  note?: string;
  /** Mean number of people tracked per frame. */
  people: number;
  /** 0..1: how far the best beat grid stands above chance. */
  confidence: number;
  /** False when the movement gives nothing to anchor a beat on. */
  clear: boolean;
  candidates: { bpm: number; agreement: number; firstBeatSec: number; relation: string }[];
  /** How the best grid holds up through the clip; unclear stretches are carried through from their neighbours. */
  stretches: { startSec: number; endSec: number; agreement: number; clear: boolean }[];
  /** Times the dancers' bodies land, with relative weight (for drawing). */
  landings: { t: number; weight: number }[];
}

export interface TempoView {
  bpm: number;
  /** Time of the first downbeat-like pulse. */
  offsetSec: number;
  /** How steady the picture's pulse is at this tempo, 0..1. */
  strength: number;
  candidates: { key: string; bpm: number; relation: string; strength: number; offsetSec: number; probability: number; source?: 'body' | 'pixels' | 'neutral' }[];
  /** Where the chosen tempo came from. */
  source?: 'body' | 'pixels' | 'neutral' | 'tap';
  /** True when a tapped tempo overrode Drex's pick. */
  manual: boolean;
  /** What Drex picked, when a manual tap overrode it. */
  drexBpm?: number;
}

/** The beat grid the whole score sits on. It never breaks and its tempo never moves. */
export interface GridView {
  bpm: number;
  /** One bar, in seconds. */
  barSec: number;
  /** Time of the first downbeat: the music starts here. */
  musicStartSec: number;
  /** Stretches played as a bridge because the dancers give no clear beat there. */
  bridges: { startSec: number; endSec: number }[];
  /** True when no beat was found anywhere: the whole score is a bridge and the panel should say the beat is uncertain. */
  noBeat: boolean;
}

/** How the change at the end of a section is marked inside the unbroken beat. */
export interface FitView {
  section: number;
  /** fill | drop_bar | riser | crash | none */
  choice: string;
  label: string;
  detail: string;
}

/** A refinement from the live read, two to three seconds ahead of the picture. */
export interface LiveCue {
  /** Video time the cue applies at. */
  atSec: number;
  label: string;
  accent?: { notes: NoteEvent[]; bpm: number };
  nudge?: { gainDb?: number; lowpassSteps?: number; reverbSteps?: number; overSec: number };
}

export type ChoreoServerEvent =
  | ServerEvent
  | { type: 'clip'; clip: ClipInfo; prompt: string }
  | { type: 'motion'; perSecond: number[]; cuts: number[]; peaksSec: number[] }
  | { type: 'beat'; beat: BeatView }
  | { type: 'prescan_progress'; done: number; total: number }
  | { type: 'reading'; reading: Reading }
  | { type: 'timeline'; sections: VideoSection[] }
  | { type: 'tempo'; tempo: TempoView }
  | { type: 'fit'; fit: FitView }
  | { type: 'grid'; grid: GridView }
  /** Video times of the extra hits placed on the dancers' biggest landings. */
  | { type: 'hits'; times: number[] }
  /** The whole piece is composed; playback can start. */
  | { type: 'ready'; totalSec: number; phrases: number }
  | { type: 'live'; cue: LiveCue };

export type ChoreoClientEvent =
  | { type: 'start_clip'; clip: string; prompt?: string; seed?: number; tap?: { bpm: number; offsetSec: number } }
  /** Sent about once a second while the video plays, so the live read can look ahead. */
  | { type: 'video_time'; sec: number; playing: boolean }
  | { type: 'stop' };

export interface ClipListing {
  name: string;
  file: string;
  sizeMb: number;
}
