# Drex Choreomusic

Video to music. Drex Choreomusic scores a muted video with original music. Drex Max reads the whole
clip, plans a piece around what happens in it, then composes and performs that piece in sync,
making every musical decision. Code extracts frames, plays notes, measures facts, and enforces only
what Drex chose.

This project stands alone. Its composing engine is the same one as Drex Composer's, copied in.

## Run it

```bash
npm install
npm run dev          # server on :8788, panel on http://localhost:5174
```

Open http://localhost:5174, pick a clip (or drop a video file in), optionally type a prompt to
steer the style, and press Enter. When the piece is composed, press Space to play.

**Clips.** Input is video files only. Anything in `clips/` is listed. `clips/firestarter-choreo.mp4`
is the demo clip: the official K/DA "FIRESTARTER" choreography video with its audio removed. Drop any
other video into `clips/` or onto the page. `node tools/fetch-clip.mjs <url> <name>` downloads a clip
and strips its audio. The demo clip is third-party copyrighted material kept locally for the live
demo and is git-ignored; see `clips/README.md`.

**Body tracking needs `uv`.** The beat is found by following the dancers' bodies with MediaPipe Pose,
run as a small Python sidecar (`tools/pose/track.py`). [`uv`](https://docs.astral.sh/uv/) fetches
Python and the packages into its own cache on first use; nothing is installed system-wide. The model
file ships in `assets/models/`. Without `uv` the project still runs, falling back to raw pixel motion,
which finds a tempo on some clips but not where the beats are.

**Drex key.** Copy `.env.example` to `.env` and set `NACE_API_KEY=nace_sk_...`. Without a key a
local **stand-in** answers and the panel shows a `STAND-IN` badge. Two things to know about it:

- **The stand-in cannot see frames.** Its "readings" of the picture come from the motion analyser
  (how much the pixels change, where the cuts are) and the optional prompt. It cannot tell a person
  from a lamp, and its mood, body-level and people answers are guesses. It exists so the pipeline,
  the sync and the panel can be built and rehearsed.
- The real client is written to the published API, including the `images` array (six frames plus
  two reference frames per request, base64 JPEG, about 190 KB against the 4 MiB limit), and is tested
  with the network stubbed. **It has never made a live call**, because no key was available.

Whether Drex Max can read movement from bursts of frames is the first risk in the design. The test
for it (`npm run eval -- frames`) is written and should be the first thing run once there is a key.

Other commands:

| Command | What it does |
|---|---|
| `npm run score -- clips/firestarter-choreo.mp4 [--prompt "..."] [--tap 131] [--live] [--midi out.mid]` | Score a clip without the browser and print every stage, with a sync check. |
| `npm test` | Unit tests: the beat tracker, frame extractor and motion analyser, fitting to picture, the engine, the Drex client, the audio engine's scheduling, the panel's state. |
| `npm run eval` | The evaluation table below. |
| `npm run build && npm start` | Production build, served on :8788. |

`http://localhost:5174/?mock=1` replays a recorded run of the demo clip without the server
doing any work (add `&speed=2` to hurry it): useful for rehearsing the panel.

## How it works

```
video file ─▶ six frames a second ─▶ pre-scan: one Drex request per second of video
           └▶ motion analyser ──────▶ (six frames + two earlier frames; nine readings + "new section here?")
                    │                              │
                    ▼                              ▼
          tempo candidates              sections, timeline, one key frame per section
                    └──────────▶ tempo call ◀──────┘
                                     │
   setup (rules) ─▶ plan (roles, tension, departures, climax) ─▶ fit call at every boundary
        ─▶ themes ─▶ phrase loop for the whole piece (drafts, chord path, voice leading, judge, orchestration)
        ─▶ ready ─▶ video plays, music locked to the video clock ─▶ live read 2 s ahead: accents, lift, drop
```

| Part | Where | Owns |
|---|---|---|
| Frame extractor | `server/video/extract.ts` | Six frames a second, 512 px, JPEG; a muted browser-playable copy of the video |
| Motion analyser | `server/video/motion.ts` | Frame-difference curve, hard cuts, tempo and downbeat candidates |
| Video reader | `server/choreo/reading.ts`, `timeline.ts` | Per-second reading calls, sections, the text timeline, key frames, per-phrase picture cues |
| Tempo, plan, fit, live read | `server/choreo/` | The calls that exist only when scoring a picture |
| Composer core and calls | `server/core/`, `server/calls/`, `server/piece.ts` | Same engine as Drex Composer |
| Drex gateway | `server/gateway/` | Key, queue, rate limiting, retries, the stand-in |
| Context pack | `context-pack/` | The four-book theory digest, three style sheets, plus `scoring-to-picture.json` and video worked examples |
| Audio engine | `web/src/audio/` | Samplers, synths, effects; playback locked to the video clock |
| Live panel | `web/src/panel/` | Video, frames, readings, clip timeline, tempo choice, questions, drafts, verdicts, lineage |

**What Drex reads each second:** movement amount (1 to 7), movement change, movement quality, body
level, mood, people, scene cut, peak moment (1 to 7), repeat, and whether a new section starts.
Frames are never captioned first.

**The beat comes from the dancers' bodies, and from nothing else.** No audio is ever read. Body
tracking follows each dancer's joints; what carries the beat turned out to be the moments a whole
body drops and lands (head, shoulders and hips coming down together and stopping), not how fast the
limbs move. Those landings are collected over the whole clip and one rigid beat grid, a tempo and a
phase, is fitted to all of them at once (`server/video/beat.ts`). Fitting the whole clip is what
makes it work: dancers are only clearly on the beat in some stretches, and a single grid anchored on
those carries straight through the rest. Each 20-second stretch is marked clear or unclear.

Code offers the best grid at its own rate and at half and double time, and Drex picks. On the demo
clip, graded against beats measured from the clip's own soundtrack (used for grading only):

| | |
|---|---|
| Tempo found | 130.99 BPM (the track is 131.0) |
| True beats within 70 ms of the grid | 91% (90% within 35 ms) |
| Drift from first beat to last, over 3 minutes | 12 ms |
| Real Drex's pick among the candidates | 130.99 BPM at 89% |

A second, unrelated dance-practice video gave 113.98 BPM for a 114 BPM song. Bodies land about 70 ms
after the beat, which the grid corrects for (`LANDING_LAG_SEC`, proposed). When the movement gives
nothing to anchor on, the analysis says so (confidence below 0.35) and falls back to pixel-motion and
neutral candidates; the hidden manual tap (`T` on the clip stage, four or more taps, `Shift+T` clears)
overrides any pick.

**Fitting music to picture.** Sections last seconds, not bars. At each boundary Drex chooses among
the options code can make land exactly: nudge the tempo (up to 3%), extend or shorten a phrase, hold
a chord, or add a pickup bar. Every option is exact: the headless run lands every boundary with
0.0 ms of error. Accents are scheduled on peak-moment frames.

**Driven by the frames:** tension target, number of layers, register and dynamics, playing style,
accents and pauses. **Driven by the engine, with frames as context:** themes, harmony and voice
leading, development and the theme rule, judging, key plan.

**The whole piece is composed before playback.** That removes holds: a rejected round can no longer
make the music miss a synced moment. The cost is a wait before the video starts (the pre-scan is one
call per second of video, then roughly 25 calls per phrase), and the piece exists before anyone
presses play, so the panel shows the decisions as they were made rather than as they happen.

## Evaluation (`npm run eval`)

| Test | How it is run here | Result on the stand-in |
|---|---|---|
| Beat | The grid from movement alone against reference beats measured from the demo clip's soundtrack (`npm run eval -- beat`). | Pass: 91% of true beats within 70 ms. This test does not depend on Drex. |
| Frame separation | The three most and three least active seconds of the clip, one movement question. | Passes, but circular on the stand-in. **Needs a key to mean anything. Run it first.** |
| Different clips | Two synthetic clips (a fast bouncing box, a slow pulsing disc). | Pass: 7 of 7 rules differ. Should be rerun on the two real demo clips. |
| Shuffle control | The same clip with its seconds read in shuffled order. | Pass on the readings (jumpiness doubles). Whether the music loses its arc needs ears. |
| Blank control | Black frames. | Pass: tension 1 of 7, three layers, no pulse. |
| Tempo | Synthetic clips pulsing at 120 and 90 BPM (no bodies, so the pixel fallback); the real clip against `--tap <bpm>`. | Pass. |
| Sync | Climax against the clip's peak. | Pass on a synthetic burst and on the real clip; 0.0 ms between phrases. |
| Judge | Same judge as Drex Composer; see its evaluation. | Pass there. |
| Speed | Request size, round trips, calls per phrase. | Requests are small. Round-trip times are only meaningful with a key. |

## Values to tune

Proposed starting points: frames downscaled to 512 px (`server/video/extract.ts`); minimum section
length 6 s and at most eight sections (`server/choreo/timeline.ts`); tempo nudge limit 3%
(`MAX_NUDGE`, `server/choreo/plan.ts`); live read two seconds ahead (`LIVE_LEAD_SEC`,
`server/choreo/live.ts`); four phrase drafts and six theme drafts (`server/calls/`).

## Departures from the design doc

- **Frame reading and section boundary are one request per second**, not two. The doc lists them as
  two calls but budgets the pre-scan at one call per second of video; the boundary question rides
  along with the nine readings.
- **Clips need a few sections.** If Drex marks fewer than two boundaries on a clip of 20 s or more,
  the most probable seconds are used anyway, so the piece has a shape. Sections shorter than two bars
  are merged into a neighbour.
- **No Firefly art** in this project.

## Credits

**Piano.** Salamander Grand Piano V3 by Alexander Holm, licensed CC BY 3.0, obtained through the
sample set hosted for @tonejs/piano. Trimmed, level-adjusted and re-encoded.

**Body tracking.** MediaPipe Pose Landmarker (full) by Google, Apache License 2.0; the model file is
`assets/models/pose_landmarker_full.task`.

**Hall reverb.** Arthur Sykes Rymer Auditorium impulse response (University of York; measured by
Pierce Hening, Georgios Stamou and David Rivas Mendez), from OpenAIR (www.openairlib.net), licensed
CC BY 4.0. Decoded from B-format to stereo, trimmed and resampled. This short, dry room (about
0.4 s) is the one this project uses, so fast synced music stays clear. The Jack Lyons Concert Hall
recording (Alex Duffell, Aishwarya Sridhar and Zhong Li, Audiolab, University of York, CC BY 4.0)
is also in `assets/ir/`; whichever entry is first in `assets/ir/ir.json` is used.

**Orchestra.** VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon
Dalzell), CC0. Glockenspiel and vibraphone from VCSL by Versilian Studios, CC0.

**Drum kit.** Salamander Drumkit by Alexander Holm, CC BY-SA 3.0. The converted drum files stay
under CC BY-SA 3.0 wherever they are served.

**Theory books** (in `context-pack/books/`): Rimsky-Korsakov, *Principles of Orchestration*;
Goetschius, *Exercises in Melody-Writing*; Tchaikovsky, *Guide to the Practical Study of Harmony*;
Prout, *Musical Form*. The 21 scoring-to-picture rules are general practice written for this
project, not taken from those books, and are marked `own`.

Full detail is in `assets/CREDITS.md`.

## Known limits

- **Frames, not motion.** Drex Max has no temporal encoder; video is handled as sampled frames.
- **No tested skill on movement.** Nothing published covers dance or pose.
- **Drex can't hear, and only picks from the options it is given.**
- **Nothing here has been heard by the person who built it.** Sync is verified numerically; how the
  music sounds against the picture needs watching and listening.
- **Cut detection** was tuned on one real clip plus synthetic ones: dissolves and fades are not
  detected, and animated graphics are over-detected.
