# Drex Composer

Prompt to music. You type a prompt; Drex sets the rules of a piece, writes a theme, and develops it
phrase by phrase so nothing repeats exactly. Drex makes every musical decision by answering
multiple-choice, yes/no and score questions. Code plays the notes, measures facts for Drex, and
enforces only what Drex chose.

## Run it

```bash
npm install
npm run dev          # server on :8787, panel on http://localhost:5173
```

Open http://localhost:5173, type a prompt, press Enter.

**Drex key.** Copy `.env.example` to `.env` and set `NACE_API_KEY=nace_sk_...`. Without a key the
project still runs: a local **stand-in** answers instead, the panel shows a `STAND-IN` badge, and no
request leaves the machine. The stand-in is a set of hand-written heuristics (one prior per option,
in the same files that build the questions). It exists so the engine, the sound and the panel can
be built and rehearsed; it is not Drex and proves nothing about Drex's taste. The real client is
written to the published API and tested against the documented response shapes with the network
stubbed, but **it has never made a live call**, because no key was available when this was built.

Other commands:

| Command | What it does |
|---|---|
| `npm run compose -- "a prompt" [--seed 7] [--midi out.mid] [--verbose]` | Compose a whole piece without the browser and print every choice. `--midi` writes a file you can audition in any player. |
| `npm test` | Unit tests: transformations, facts, chord options, the Drex client, whole-piece invariants. |
| `npm run eval` | The evaluation table below. |
| `npm run build && npm start` | Production build, served by the server on :8787. |
| `node tools/ndi/ingest.mjs --all` | Rebuild the theory digest with NDI (needs a key). |
| `node tools/make-backdrops.mjs` | Regenerate the placeholder backdrops. |

`DREX_PICKER=random` swaps Drex for a random picker (the control for the blind listening test).
`DREX_DUMP_DIR=some/dir` saves the first three request bodies of each call type exactly as Drex
would receive them.

## How it works

```
prompt ─▶ setup ─▶ plan ─▶ backdrop ─▶ theme drafts ─▶ theme judge
                                                        │
          ┌─────────────────────────────────────────────┘
          ▼
   for each phrase:  direction ─▶ 4 sampled drafts ─▶ chord path ─▶ voice leading
                     ─▶ facts (code) ─▶ judge ─┬─ accept ─▶ orchestration and mix ─▶ buffer ─▶ browser
                                               └─ reject all ─▶ reason into the state ─▶ redraft (no cap)
```

| Part | Where | Owns |
|---|---|---|
| Composer core | `server/core/`, `server/piece.ts` | Notation, scales and chords, the 20 transformations, lineage, the fact measurer, the state builder |
| Calls | `server/calls/` | Every question Drex is asked: setup, plan, themes, phrase direction, chord path, voice leading, judge, orchestration, hold, ending |
| Drex gateway | `server/gateway/` | API key, queue, rate limiting (120/min and 8 in flight on free, 1,200 and 16 on paid), retries, the stand-in |
| Context pack | `context-pack/`, `server/pack.ts` | Theory digest from four books, style sheets, worked examples, sliced per call type |
| NDI ingester | `tools/ndi/` | Parses the books into the pack (offline) |
| Audio engine | `web/src/audio/` | Tone.js: samplers, synths, convolution reverb, effects, look-ahead scheduling, holds |
| Live panel | `web/src/panel/` | Rules, tension curve with a now marker, current question and probabilities, drafts and verdicts, lineage, layers, hold marker, backdrop |

**Picking.** Draft calls (theme shape and notes, phrase direction, chord path, voice leading) are
sampled from Drex's probabilities. Decisions (setup, plan, judges, orchestration, hold, ending) take
the top pick. Drafts are shuffled before judging.

**Playback and holds.** The server composes two to three phrases ahead of the browser. If the buffer
runs dry the last chord sustains and a Hold call chooses how it evolves; nothing loops.

**One phrase costs about 23 to 33 Drex calls.** In the slow style that is roughly 110 calls
a minute, right at the free tier's 120. Faster styles need more (about 235 a minute at 124 BPM), so
real-time playback of anything but the slow style needs the raised limit or a top-up.

## What Drex decides

Setup: style sheet, tempo, meter, key centre, mode, harmonic language, palette (a yes/no per
instrument), sound world, length, form, key-change plan, ending. Plan: each section's role, tension
(1 to 7) and whether it leaves the theme, the climax position, and whether the piece needs a
counter-theme and a contrast theme; revised by Drex at every section end. Theme: length, contour,
rhythm cell, start and end degrees, where the one leap sits, then each note in turn; six drafts and
a judge. Every phrase: material and transformations for each half, counter-melody, seven texture
transformations, harmonic rhythm, ending, modulation; every chord and bass move; every inner voice
at every chord change; the verdict; then about fifty orchestration and mix answers (which layers
play, on what, how loud, how they enter, patterns, accents, a pause before a hit, six effect amounts,
chorus, sidechain).

## Evaluation (`npm run eval`)

| Test | How it is run here | Result on the stand-in |
|---|---|---|
| Drex follows theory | 200 hand-written cases, 20 per call type, in `eval/cases/`. Pass is 16 of 20. `--compare drex-v2.0` runs two models side by side to choose the model per call type. | **Not run: needs a key.** |
| Not random | `npm run eval -- listening` writes `A.mid` (Drex) and `B.mid` (random picker) for blind listening. | Needs ears. |
| Theme survives | Same command writes `theme.mid` and `late-phrase.mid`. | Needs ears. |
| No repetition | Similarity across all phrase pairs of three pieces. | Pass: 521 pairs, none above the copy level, closest 71%. |
| Judge works | Two planted copies and an off-theme draft must all be rejected; honest drafts must get through. | Pass. |
| Prompt matters | Two opposite prompts. | Pass: 8 of 8 rules differ. |
| Style choice | Nine prompts, three aimed at each style. | Pass: 9 of 9. |
| Speed | Calls per phrase and calls per minute needed. | 26 per phrase. Round-trip times are only meaningful with a key. |

Results on the stand-in check the engine and the facts it measures. They say nothing about Drex.

**Rehearsing rejections and holds without a key.** The stand-in drafts and judges with the same
heuristics, so it almost never rejects its own drafts (0 rejected rounds in 8 test pieces). To see
the rejected-draft and hold states: open `http://localhost:5173/?mock=1` for a scripted run that
includes both, or set `STANDIN_RPM=120` in `.env` to rehearse free-tier pacing, which runs the
buffer dry in the faster styles and triggers real holds.

## Values to tune by ear

Proposed starting points, all in one place each: six theme drafts (`THEME_DRAFTS`,
`server/calls/themes.ts`); four phrase drafts, copy level 80%, drift level 40% (`PHRASE_DRAFTS`,
`COPY_LEVEL`, `DRIFT_LEVEL`, `server/calls/phrase.ts`); a look-ahead of three phrases
(`BUFFER_AHEAD`, `server/session.ts`).

## Backdrops

Drex picks one backdrop per piece from `assets/backdrops/backdrops.json`. The eight images there are
**placeholders** drawn by a script. The plan is Adobe Firefly images made in advance: generate each
from the prompt in `assets/backdrops/FIREFLY.md`, save it as `<id>.jpg` in that folder, and it
replaces the placeholder automatically.

## Theory sources

All four books were found and are in `context-pack/books/` with their sources.

| Book | Source |
|---|---|
| Rimsky-Korsakov, *Principles of Orchestration* | Project Gutenberg ebook 33900 |
| Goetschius, *Exercises in Melody-Writing* (Schirmer, 1900) | archive.org scan, OCR |
| Tchaikovsky, *Guide to the Practical Study of Harmony* (tr. Krall and Liebling) | archive.org, OCR |
| Prout, *Musical Form* (Augener, 1893) | archive.org scan, OCR |

`context-pack/digest.json` holds 178 rules, each with a page reference and a supporting quote in
`digest.evidence.json`; 28 are marked `own` (general knowledge the 1890s books do not cover, such as
where a climax goes). **The digest shipped here was curated by reading the texts, not produced by
NDI:** the NDI pipeline in `tools/ndi/ingest.mjs` (parse, split by chapter, classify by topic,
extract rules, keep page references) is written to the documented API and dry-run tested, but has
not run against the live service. Nine places where the NDI docs were silent are marked
`DOCS-UNVERIFIED` in that file.

## Credits

**Piano.** Salamander Grand Piano V3 by Alexander Holm, licensed CC BY 3.0, obtained through the
sample set hosted for @tonejs/piano. Five of its sixteen velocity layers are used; files were
trimmed, level-adjusted and re-encoded.

**Hall reverb.** Jack Lyons Concert Hall impulse response (listening position 2) by Alex Duffell,
Aishwarya Sridhar and Zhong Li, Audiolab, University of York, from OpenAIR (www.openairlib.net),
licensed CC BY 4.0. Decoded from B-format to stereo, trimmed and resampled. This is the hall the
Composer uses. A second OpenAIR recording, the Arthur Sykes Rymer Auditorium (University of York,
CC BY 4.0), is also in `assets/ir/`.

**Orchestra.** VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon
Dalzell), CC0. Glockenspiel and vibraphone from VCSL by Versilian Studios, CC0.

**Drum kit.** Salamander Drumkit by Alexander Holm, CC BY-SA 3.0. The converted drum files in
`assets/samples/drumkit/` are modified samples and stay under CC BY-SA 3.0 wherever they are served.

Full detail, including every modification, is in `assets/CREDITS.md`.

## Known limits

- **Drex can't hear.** It judges notation and measured facts.
- **Drex only picks from options it is given.** Its range is the option lists and the transformation library.
- **Nothing here has been heard by the person who built it.** The sample library was verified
  numerically (every file decodes, every pitch checked) and the engine is confirmed to produce signal
  in a browser, but balance, realism and taste all still need tuning by ear.
- **No celesta** (none exists in the free libraries used); **the double basses are a solo
  contrabass** (VSCO 2 CE has no bass section).
- The OpenAIR site's certificate had expired when the hall recordings were fetched, so their licence
  and attribution text were read from archived copies of the OpenAIR pages.
