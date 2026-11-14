// Score a clip headlessly and print what Drex chose. No audio: this is for checking the engine.
//   npm run score -- clips/firestarter-choreo.mp4 [--prompt "..."] [--tap 131] [--seed 7] [--live] [--json out.json] [--midi out.mid]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ChoreoServerEvent } from '../shared/choreo.ts';
import { phraseSeconds } from '../shared/types.ts';
import { Session } from '../server/session.ts';
import { scoresToMidi } from './midi.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const prompt = flag('prompt');
const tap = flag('tap');
const seed = flag('seed');
const json = flag('json');
const midi = flag('midi');
const clipPath = resolve(args[0] ?? 'clips/firestarter-choreo.mp4');
process.env.STANDIN_LATENCY_MS ??= '0-0';

const events: ChoreoServerEvent[] = [];
const callTypes: Record<string, number> = {};
const t0 = Date.now();
const session = new Session({
  clipPath, prompt, seed: seed ? Number(seed) : undefined, tap: tap ? { bpm: Number(tap), offsetSec: 0 } : undefined,
  send: (e) => {
    events.push(e);
    if (e.type === 'call') callTypes[e.call.callType] = (callTypes[e.call.callType] ?? 0) + 1;
    if (e.type === 'clip') console.log(`CLIP    ${e.clip.name}  ${e.clip.durationSec.toFixed(1)} s  ${e.clip.frameCount} frames  ${e.clip.width}x${e.clip.height}`);
    if (e.type === 'beat') {
      console.log(`BEAT    ${e.beat.method === 'body' ? `body tracking, ${e.beat.people} people per frame, ${e.beat.landings.length} landings` : `pixel motion only (${e.beat.note})`}; confidence ${e.beat.confidence}${e.beat.clear ? '' : ' (no clear beat)'}; candidates ${e.beat.candidates.map((c) => `${c.bpm}/${c.relation}/${c.agreement}`).join('  ')}`);
      const unclear = e.beat.stretches.filter((s) => !s.clear);
      if (e.beat.stretches.length) console.log(`        unclear stretches: ${unclear.length ? unclear.map((s) => `${Math.round(s.startSec)}-${Math.round(s.endSec)} s`).join(', ') : 'none'}`);
    }
    if (e.type === 'timeline') for (const s of e.sections) console.log(`SECTION ${s.index + 1}  ${s.summary}`);
    if (e.type === 'tempo') console.log(`TEMPO   ${e.tempo.bpm} BPM (from ${e.tempo.source}), first beat ${e.tempo.offsetSec.toFixed(2)} s, strength ${e.tempo.strength.toFixed(2)}${e.tempo.manual ? ` (manual tap; Drex picked ${e.tempo.drexBpm})` : ''}   candidates: ${e.tempo.candidates.map((c) => `${c.bpm}/${c.relation}/${c.strength.toFixed(2)} p=${c.probability.toFixed(2)}`).join('  ')}`);
    if (e.type === 'rules') console.log('RULES  ', JSON.stringify(e.rules));
    if (e.type === 'plan' && !e.plan.revised) console.log('PLAN   ', e.plan.sections.map((s) => `${s.role}:${s.tension}${s.departure ? '*' : ''}[${s.phrases[0] + 1}-${s.phrases[1] + 1} ${s.startSec?.toFixed(1)}-${s.endSec?.toFixed(1)}s]`).join('  '), `climax=${e.plan.climaxPhrase + 1}`);
    if (e.type === 'fit') console.log(`FIT     section ${e.fit.section + 1}: ${e.fit.label} (${e.fit.detail})`);
    if (e.type === 'theme') console.log(`THEME ${e.theme.id}`, e.theme.notation, `(${e.theme.contour}, ${e.theme.kind})`);
    if (e.type === 'phrase_drafts' && !e.verdict.picked) console.log(`  phrase ${e.phrase + 1} round ${e.round}: REJECTED: ${e.verdict.reason}`);
    if (e.type === 'phrase') {
      const s = e.score;
      const layers = s.display.layers.filter((l) => l.inst).map((l) => `${l.role}=${l.inst}`).join(' ');
      console.log(`P${String(s.index + 1).padStart(2)} @${s.startSec!.toFixed(2).padStart(6)}s ${s.bars} bars ${s.bpm.toFixed(1)} BPM ${s.role.padEnd(11)} t=${s.display.tension}  ${s.display.chords.join(' ')}  | ${layers}`);
    }
    if (e.type === 'error') console.error('ERROR', e.message);
  },
});
await session.run();
const scores = events.flatMap((e) => (e.type === 'phrase' ? [e.score] : []));
if (process.argv.includes('--live')) {
  // Walk the clip second by second as playback would, and collect the live-read refinements.
  for (let sec = 0; sec < session.clip.durationSec; sec++) await (session as any).live(sec);
  const cues = events.flatMap((e) => (e.type === 'live' ? [e.cue] : []));
  console.log(`LIVE    ${cues.length} live reads; ${cues.filter((c) => c.accent).length} extra accents (${cues.filter((c) => c.accent).map((c) => c.atSec.toFixed(1)).join(', ')}); ${cues.filter((c) => c.label !== 'as composed').length} changed something`);
}

// Sync check: every phrase must start exactly where the previous one ends, and section ends must land on the picture.
let worst = 0;
scores.forEach((s, i) => {
  const next = scores[i + 1];
  if (next) worst = Math.max(worst, Math.abs(s.startSec! + phraseSeconds(s) - next.startSec!));
});
const sectionErr = Math.max(0, ...session.piece.plan.sections.slice(0, -1).map((sec) => {
  const lastPhrase = scores[sec.last];
  return Math.abs(lastPhrase.startSec! + phraseSeconds(lastPhrase) - sec.endSec!);
}));
const readings = events.filter((e) => e.type === 'reading').length;
console.log(`\n${scores.length} phrases over ${session.clip.durationSec.toFixed(1)} s; ${readings} seconds read; ${session.gw.calls} calls; ${session.rejects} rejected rounds; ${Date.now() - t0} ms; seed ${session.seed}`);
const bridges = session.alloc.bridge.filter(Boolean).length;
const cov = session.coverage;
console.log(`grid: ${session.tempo.bpm} BPM from ${session.tempo.source}, bars of ${session.alloc.barSec.toFixed(3)} s from ${session.alloc.musicStartSec.toFixed(2)} s; ${bridges} bridge phrase${bridges === 1 ? '' : 's'}; ${session.hits} hits on big landings; cut marks: ${[...session.alloc.cutMarks.values()].join(', ') || 'none'}`);
console.log(`groove: kick or snare on ${cov.length ? Math.round((cov.reduce((a, b) => a + b, 0) / cov.length) * 100) : 0}% of beats outside bridges; phrases with no groove at all: ${cov.filter((c) => c === 0).length} of ${cov.length}`);
console.log(`sync: largest gap or overlap between consecutive phrases ${(worst * 1000).toFixed(1)} ms; ` +
  `every phrase starts on a bar line of the grid (largest deviation ${(sectionErr * 1000).toFixed(1)} ms)`);
console.log('calls by type:', callTypes);
if (midi) {
  mkdirSync(dirname(midi), { recursive: true });
  writeFileSync(midi, scoresToMidi(scores));
}
if (json) {
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify(events));
}
