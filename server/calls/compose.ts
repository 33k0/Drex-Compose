// The phrase loop's outer shell, shared by every way of running the engine.

import type { Ctx } from '../context.ts';
import type { PhraseRecord } from '../piece.ts';
import { applyEnding } from './ending.ts';
import { orchestrate } from './orchestrate.ts';
import { draftRound } from './phrase.ts';

/**
 * Compose one phrase: redraft until the judge accepts (no cap), orchestrate, and add it to the piece.
 * `onReject` is called after each rejected round; return false from `keepGoing` to abandon.
 */
export async function composePhrase(ctx: Ctx, index: number, onReject?: () => void, keepGoing: () => boolean = () => true): Promise<PhraseRecord | null> {
  const { piece } = ctx;
  let accepted = null;
  for (let round = 1; !accepted && keepGoing(); round++) {
    accepted = await draftRound(ctx, index, round);
    if (!accepted) onReject?.();
  }
  if (!accepted) return null;
  const record = await orchestrate(ctx, index, accepted);
  if (index === piece.plan.totalPhrases - 1) applyEnding(ctx, record);
  piece.phrases.push(record);
  piece.voices = record.slots[record.slots.length - 1].voices.slice();
  piece.lastChord = record.slots[record.slots.length - 1].chord;
  piece.lastReject = '';
  return record;
}

