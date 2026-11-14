// The live session's pacing and hold loop, driven by a pretend browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerEvent } from '../../shared/types.ts';
import { Session } from '../session.ts';

process.env.STANDIN_LATENCY_MS = '0-0';
delete process.env.NACE_API_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms: number) {
  const t0 = Date.now();
  while (!check() && Date.now() - t0 < ms) await sleep(20);
  return check();
}

test('composing waits for the player, and a dry buffer gets an evolving hold', async () => {
  const events: ServerEvent[] = [];
  const session = new Session({ prompt: 'rain on a tin roof at 3am, missing someone', seed: 7, paced: true, send: (e) => events.push(e) });
  const run = session.run();
  const phrases = () => events.filter((e) => e.type === 'phrase').length;

  // The look-ahead buffer holds three phrases; nothing more is composed until playback moves on.
  assert.ok(await until(() => phrases() === 3, 5000), 'three phrases buffered');
  await sleep(250);
  assert.equal(phrases(), 3, 'composing pauses while the buffer is full');

  session.onClient({ type: 'phrase_started', index: 0 });
  assert.ok(await until(() => phrases() === 4, 5000), 'one phrase played, one more composed');

  // The browser reports that the buffer ran dry after phrase 1: Drex chooses how the sustain evolves.
  session.onClient({ type: 'hold_started', afterIndex: 0 });
  assert.ok(await until(() => events.some((e) => e.type === 'hold_update'), 6000), 'a hold update arrives');
  const update = events.find((e) => e.type === 'hold_update');
  assert.ok(update && update.type === 'hold_update');
  assert.ok(update.update.notes.length >= 2, 'the hold keeps a chord sounding');
  assert.ok(update.update.label.length > 0 && update.update.overSec > 0);
  assert.ok(events.some((e) => e.type === 'call' && e.call.callType === 'hold'), 'the hold was a Drex call');
  assert.ok(events.some((e) => e.type === 'status' && e.stage === 'holding'));

  session.onClient({ type: 'hold_ended' });
  session.stop();
  await run;
  assert.ok(!events.some((e) => e.type === 'error'), 'stopping is not an error');
});
