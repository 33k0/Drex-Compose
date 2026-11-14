// The panel's view of the audio engine. The real class lives in ./audio/engine.ts (owned by the
// audio work); it is loaded lazily so the panel renders before Tone.js and the samples arrive,
// and so a missing or failing engine degrades to a silent stand-in playhead instead of a blank page.

import type { InstrumentId, LayerRole, NoteEvent, PhraseScore, SoundWorld } from '../../shared/types';

export interface Playhead {
  index: number;
  beat: number;
  beats: number;
  playing: boolean;
}

export interface SyncClock {
  now(): number;
  playing(): boolean;
}

export interface EngineNudge {
  gainDb?: number;
  lowpassSteps?: number;
  reverbSteps?: number;
}

export interface EngineLike {
  unlock(): Promise<void>;
  loadInstruments(ids: InstrumentId[], onProgress?: (loaded: number, total: number) => void): Promise<void>;
  setSoundWorld(world: SoundWorld): void;
  /** Every phrase, each with startSec; follows play / pause / seek of the clock. */
  playSynced(scores: PhraseScore[], clock: SyncClock): void;
  /** Live-read accent on the video clock. Optional: called through ?. */
  scheduleAt?(clockSec: number, notes: NoteEvent[], bpm: number): void;
  /** Live-read lift / drop. Optional: called through ?. */
  nudge?(change: EngineNudge, overSec: number): void;
  stop(): void;
  playhead(): Playhead;
  levels(): Record<LayerRole, number>;
}

const CREATE_TIMEOUT_MS = 15000;

/** Resolves with the real engine, or rejects if it fails to load or takes too long to start. */
export async function loadRealEngine(): Promise<EngineLike> {
  // Lazy chunk: the panel renders before Tone.js and the engine code arrive.
  const { AudioEngine } = await import('./audio/engine');
  // Assigning to EngineLike makes the compiler check the real class against the surface the
  // panel relies on.
  const created: Promise<EngineLike> = AudioEngine.create();
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('audio engine took too long to start')), CREATE_TIMEOUT_MS);
  });
  return Promise.race([created, timeout]);
}

/** The engine the frame-driven views read from. Set by the controller once one exists. */
export const engineRef: { current: EngineLike | null } = { current: null };

export const LAYER_ROLES: LayerRole[] = [
  'melody', 'counter', 'inner', 'bass', 'pedal', 'figuration', 'texture', 'pulse', 'accents',
];

export function zeroLevels(): Record<LayerRole, number> {
  return {
    melody: 0, counter: 0, inner: 0, bass: 0, pedal: 0, figuration: 0, texture: 0, pulse: 0, accents: 0,
  };
}

// Development handle for checking levels from the console: __drexEngine.current.masterLevel()
if (import.meta.env.DEV) (window as unknown as { __drexEngine: typeof engineRef }).__drexEngine = engineRef;
