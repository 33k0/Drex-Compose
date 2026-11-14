// Pop / dance palette: ekit (sampled electronic kit), synth_bass, stab, lead, keys (Tone.js synths).
//   npx tsx --test web/src/audio/__tests__/*.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Articulation, NoteEvent, PhraseScore } from '../../../../shared/types.ts';
import {
  POP_IDS, SYNTH_IDS, instrumentFiles, isKickNote, isKit, isStruck, isSynthId, isUnpitched, normalizeManifest, sampleSourceId, standInFor,
} from '../manifest.ts';
import type { AnyInstrument } from '../manifest.ts';
import { DEFAULT_MIX } from '../mixmap.ts';
import { humanize, jitterMs, planPhrase } from '../plan.ts';
import {
  POP_SYNTH_RANGE, POP_SYNTH_VOICES, foldToRange, isShortArt, layerGains, notesToSteal, panFor, pickKeyInRange, popNoteSec, resolveArticulation, voiceMode,
} from '../selection.ts';
import type { PopSynth } from '../selection.ts';

/** The server will send these ids before shared/types.ts lists them. */
const pop = (inst: AnyInstrument): NoteEvent['inst'] => inst as NoteEvent['inst'];

function score(partial: Partial<PhraseScore> = {}): PhraseScore {
  return {
    index: 0, section: 0, role: 'statement', bars: 2, beatsPerBar: 4, beats: 8, bpm: 120,
    notes: [], pedal: [], mix: { ...DEFAULT_MIX, sidechain: true }, holdChord: [],
    display: { key: 'A minor', notation: '', lineage: '', chords: [], layers: [], tension: 3 },
    ...partial,
  };
}
function note(partial: Partial<NoteEvent> & { inst: AnyInstrument }): NoteEvent {
  return { t: 0, dur: 1, midi: 60, vel: 0.8, art: 'sustain', layer: 'melody', ...partial, inst: pop(partial.inst) };
}

const EKIT_NOTES = [36, 37, 38, 39, 42, 44, 45, 46, 47, 49, 50, 51, 56, 70];
const ARTS: Articulation[] = ['sustain', 'staccato', 'spiccato', 'tremolo', 'pizzicato', 'hit', 'roll'];

// ───────────────────────────── ids and routing ─────────────────────────────

test('ids: the four pop synths are Tone synths, ekit is a sampled, unpitched kit', () => {
  assert.deepEqual([...POP_IDS], ['ekit', 'synth_bass', 'stab', 'lead', 'keys']);
  for (const id of ['synth_bass', 'stab', 'lead', 'keys']) assert.ok(isSynthId(id), id);
  for (const id of ['sub', 'pad', 'pluck', 'kick808', 'noise']) assert.ok(isSynthId(id), `${id} is still a synth`);
  assert.equal(isSynthId('ekit'), false);
  assert.ok((SYNTH_IDS as readonly string[]).includes('keys'));
  assert.ok(isUnpitched('ekit') && isKit('ekit') && isKit('drumkit'));
  assert.equal(isKit('bass_drum'), false);
  assert.equal(sampleSourceId('ekit'), 'ekit');
  assert.equal(panFor('ekit'), 0, 'the groove kit sits in the centre');
});

test('sidechain: ekit 36 is a kick exactly like drumkit 36 and kick808; other ekit notes are not', () => {
  assert.ok(isKickNote('ekit', 36) && isKickNote('drumkit', 36) && isKickNote('kick808', 24));
  for (const m of EKIT_NOTES.filter((x) => x !== 36)) assert.equal(isKickNote('ekit', m), false, `ekit ${m}`);
  assert.equal(isKickNote('synth_bass', 36), false);
  assert.equal(isKickNote('bass_drum', 36), false, 'the orchestral bass drum never pumps the mix');
  const s = score({
    notes: [
      note({ inst: 'ekit', midi: 36, art: 'hit', layer: 'pulse', t: 0 }), note({ inst: 'ekit', midi: 39, art: 'hit', layer: 'pulse', t: 1 }),
      note({ inst: 'ekit', midi: 36, art: 'hit', layer: 'pulse', t: 2 }), note({ inst: 'drumkit', midi: 36, art: 'hit', layer: 'pulse', t: 3 }),
      note({ inst: 'kick808', midi: 36, layer: 'pulse', t: 4 }), note({ inst: 'synth_bass', midi: 36, layer: 'bass', t: 5 }),
    ],
  });
  const p = planPhrase(s, { humanize: false });
  assert.deepEqual(p.kickSecs.map((x) => +x.toFixed(6)), [0, 1, 1.5, 2]);
  assert.deepEqual(p.notes.filter((x) => x.kick).map((x) => x.note.inst), ['ekit', 'ekit', 'drumkit', 'kick808']);
  // humanised: the ekit kick (and so its duck) stays exactly on the grid
  const h = planPhrase(s, { seed: 9 });
  assert.equal(h.kickSecs[0], 0);
  assert.equal(h.kickSecs[1], 1);
});

test('humanise: no jitter on the ekit kick or the synth bass, little on the kit, a little more on keys / lead', () => {
  assert.equal(jitterMs(note({ inst: 'ekit', midi: 36 })), 0);
  assert.equal(jitterMs(note({ inst: 'synth_bass', midi: 36, layer: 'bass' })), 0);
  for (const m of EKIT_NOTES.filter((x) => x !== 36)) {
    const j = jitterMs(note({ inst: 'ekit', midi: m, layer: 'pulse' }));
    assert.ok(j > 0 && j <= jitterMs(note({ inst: 'drumkit', midi: 38 })), `ekit ${m}: ${j} ms`);
  }
  assert.ok(jitterMs(note({ inst: 'stab' })) <= jitterMs(note({ inst: 'lead' })));
  assert.ok(jitterMs(note({ inst: 'lead' })) <= jitterMs(note({ inst: 'keys' })));
  assert.ok(jitterMs(note({ inst: 'keys' })) < jitterMs(note({ inst: 'piano' })));
  for (let i = 0; i < 200; i++) {
    const k = humanize(note({ inst: 'ekit', midi: 36 }), 1, i, 3);
    assert.ok(k.dtSec === 0, 'the kick is on the grid');
    assert.ok(k.detuneCents === 0, 'a kit is not detuned');
    for (const inst of ['synth_bass', 'stab', 'lead', 'keys'] as const) assert.ok(humanize(note({ inst }), 1, i, 3).detuneCents === 0, `${inst} stays in tune`);
  }
});

// ───────────────────────────── stand-ins / fallbacks ─────────────────────────────

test('fallbacks: ekit without samples gets the synth kit; drumkit keeps its 808 kick; unknown ids stay pitched', () => {
  for (const m of EKIT_NOTES) assert.equal(standInFor('ekit', m, 'hit', 0.2), 'drum_synth');
  assert.equal(standInFor('drumkit', 36, 'hit', 0.2), 'kick808');
  assert.equal(standInFor('drumkit', 38, 'hit', 0.2), 'silent');
  assert.equal(standInFor('cymbal', 49, 'roll', 3), 'silent');
  assert.equal(standInFor('violins', 67, 'sustain', 2), 'pad');
  assert.equal(standInFor('violins', 67, 'staccato', 0.2), 'pluck');
  assert.equal(standInFor('violins', 67, 'sustain', 0.2), 'pluck', 'too short to swell a pad');
  assert.equal(standInFor('piano', 60, 'sustain', 3), 'pluck', 'struck instruments never become a pad');
  assert.ok(isStruck('harp') && !isStruck('ekit'));
  assert.equal(standInFor('theremin', 72, 'sustain', 2), 'pad', 'an unknown instrument still plays');
  assert.equal(standInFor('theremin', 72, 'hit', 0.1), 'pluck');
});

test('fallbacks: a manifest without ekit loads nothing for it; synth ids never fetch samples', () => {
  const m = normalizeManifest({ version: 1, baseUrl: '/assets/samples/', instruments: {} });
  assert.deepEqual(instrumentFiles(m, 'ekit'), []);
  for (const id of ['synth_bass', 'stab', 'lead', 'keys'] as const) assert.deepEqual(instrumentFiles(m, id), []);
});

test('ekit selection: unpitched one-shots, every articulation resolves to hit, nearest pseudo-note, never re-pitched', () => {
  const samples: Record<string, string[]> = {};
  for (const k of EKIT_NOTES) samples[String(k)] = [`ekit/${k}.mp3`];
  const m = normalizeManifest({ version: 1, baseUrl: '/assets/samples/', instruments: { ekit: { articulations: { hit: { oneShot: true, layers: [{ velMax: 1, samples }] } } } } });
  const def = m.instruments.ekit;
  for (const art of ARTS) assert.deepEqual(resolveArticulation(def, art), { name: 'hit', def: def.articulations.hit, mode: 'direct' }, art);
  assert.equal(voiceMode('ekit', { name: 'hit', mode: 'direct' }, true), 'oneshot', 'drum hits ring for their whole sample');
  // one layer: any velocity plays it, loudness comes from the velocity curve alone
  for (const v of [0.05, 0.5, 1]) assert.deepEqual(layerGains([1], v, false), [{ layer: 0, gain: 1 }]);
  for (const k of EKIT_NOTES) assert.deepEqual(pickKeyInRange(EKIT_NOTES, k, 0, { unpitched: true }), { key: k, semis: 0, rate: 1, octaves: 0 });
  const odd = pickKeyInRange(EKIT_NOTES, 40, 0, { unpitched: true });
  assert.equal(odd?.rate, 1, 'an unmapped pseudo-note borrows the nearest piece without pitching it');
  assert.deepEqual(instrumentFiles(m, 'ekit').length, EKIT_NOTES.length);
});

test('real manifest (when present): ekit has every pseudo-note the server may send, as one-shots, and its files exist', (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, '../../../../assets/samples/manifest.json');
  if (!fs.existsSync(file)) {
    t.skip('assets/samples/manifest.json has not been built yet');
    return;
  }
  const m = normalizeManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  const def = m.instruments.ekit;
  if (!def) {
    t.skip('ekit not built yet (tools/samples/build-ekit.mjs)');
    return;
  }
  const hit = def.articulations.hit;
  assert.ok(hit?.oneShot);
  for (const layer of hit.layers) assert.deepEqual(Object.keys(layer.samples).map(Number).sort((a, b) => a - b), EKIT_NOTES);
  for (const f of instrumentFiles(m, 'ekit')) assert.ok(fs.existsSync(path.resolve(here, '../../../../assets/samples', f)), f);
  // the synth stand-in covers the same pseudo-notes, so a groove is never silent while the samples load
  for (const k of EKIT_NOTES) assert.equal(standInFor('ekit', k, 'hit', 0.1), 'drum_synth');
});

// ───────────────────────────── pop synths: notes, ranges, voices ─────────────────────────────

test('pop synths: short articulations are plucked, held ones sustain; a stab is always a stab', () => {
  for (const a of ['staccato', 'spiccato', 'pizzicato', 'hit']) assert.ok(isShortArt(a), a);
  for (const a of ['sustain', 'tremolo', 'roll', undefined]) assert.equal(isShortArt(a), false, String(a));
  // held notes last as written
  for (const inst of ['synth_bass', 'lead', 'keys'] as PopSynth[]) {
    assert.equal(popNoteSec(inst, false, 2), 2);
    assert.ok(popNoteSec(inst, false, 0) >= 0.05);
  }
  // short notes are gated tight whatever was written
  assert.ok(popNoteSec('synth_bass', true, 1) <= 0.18 && popNoteSec('synth_bass', true, 0.01) >= 0.06);
  assert.ok(popNoteSec('keys', true, 2) <= 0.25);
  assert.ok(popNoteSec('lead', true, 2) <= 0.2);
  // the stab: staccato is short, sustain is a longer stab but never a pad
  assert.ok(popNoteSec('stab', true, 0.5) <= 0.22);
  assert.ok(popNoteSec('stab', false, 0.5) > popNoteSec('stab', true, 0.5));
  assert.ok(popNoteSec('stab', false, 8) <= 1.1);
  assert.ok(Number.isFinite(popNoteSec('lead', false, NaN)));
});

test('pop synths: the documented ranges play as written, far-out notes fold by octaves and keep their pitch class', () => {
  const documented: Record<PopSynth, [number, number]> = { synth_bass: [28, 60], stab: [48, 84], lead: [55, 96], keys: [36, 96] };
  for (const inst of Object.keys(documented) as PopSynth[]) {
    const [lo, hi] = POP_SYNTH_RANGE[inst];
    const [dlo, dhi] = documented[inst];
    assert.ok(lo <= dlo && hi >= dhi, `${inst}: [${lo}, ${hi}] covers [${dlo}, ${dhi}]`);
    for (let m = dlo; m <= dhi; m++) assert.equal(foldToRange(m, lo, hi), m);
    for (let m = 0; m <= 127; m++) {
      const f = foldToRange(m, lo, hi);
      assert.ok(f >= lo && f <= hi, `${inst} ${m} -> ${f}`);
      assert.equal((((f - m) % 12) + 12) % 12, 0, 'same pitch class');
    }
  }
});

test('pop synths: voice stealing caps held notes (the bass is near-mono, the stab holds a full chord)', () => {
  assert.equal(POP_SYNTH_VOICES.synth_bass, 2);
  assert.ok(POP_SYNTH_VOICES.stab >= 5 && POP_SYNTH_VOICES.keys >= 10);
  assert.equal(notesToSteal(0, 2), 0);
  assert.equal(notesToSteal(1, 2), 0);
  assert.equal(notesToSteal(2, 2), 1, 'a third bass note lets go of the oldest');
  assert.equal(notesToSteal(5, 2), 4);
  assert.equal(notesToSteal(3, Infinity), 0, 'the old synths keep Tone polyphony only');
  assert.equal(notesToSteal(3, 0), 3, 'a cap below one still allows one note');
});
