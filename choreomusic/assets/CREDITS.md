# Sound credits and licences

Everything under `assets/samples/` and `assets/ir/` is derived from the free libraries below.
All files were converted by the scripts in `tools/samples/` (nothing was edited by hand).
`assets/samples/manifest.extra.json` lists, for every output file, the exact source file, the trim
point, the cap, the gain and any resampling that was applied.

Licences were read from each project's own licence/readme file (quoted or linked below), not assumed.

| Instrument ids | Library | Author | Licence | Attribution required |
|---|---|---|---|---|
| `piano` (+ `extras.piano*`) | Salamander Grand Piano V3 | Alexander Holm | CC BY 3.0 | **yes** |
| `violins` `violas` `celli` `basses` `solo_violin` `flute` `oboe` `clarinet` `horn` `harp` `timpani` `bass_drum` `cymbal` `tam_tam` (+ `extras.cymbalSwell*`) | VSCO 2 Community Edition | Versilian Studios (Sam Gossner) & Ivy Audio (Simon Dalzell) | CC0 1.0 | no (credit requested) |
| `glockenspiel` `vibraphone` | VCSL | Versilian Studios LLC | CC0 1.0 | no |
| `drumkit` | Salamander Drumkit | Alexander Holm | **CC BY-SA 3.0** | **yes, and share-alike** |
| `ekit` | Sonic Pi sample set (freesound.org one-shots) + VCSL claps / shaker + generated toms | see section 6 | CC0 1.0 | no (credit given below) |
| `ir/jack_lyons_lp2_stereo.wav` | OpenAIR - Jack Lyons Concert Hall | Alex Duffell, Aishwarya Sridhar, Zhong Li (Audiolab, University of York) | CC BY 4.0 | **yes** |
| `ir/rymer_s1r2_stereo.wav` | OpenAIR - Arthur Sykes Rymer Auditorium | University of York (Pierce Hening, Georgios Stamou, David Rivas Mendez) | CC BY 4.0 | **yes** |

## Suggested attribution text (for an About / credits screen)

> Piano: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), via @tonejs/piano.
> Drum kit: Salamander Drumkit by Alexander Holm (CC BY-SA 3.0).
> Electronic kit: CC0 one-shots from the Sonic Pi sample set (freesound.org contributors) and VCSL.
> Orchestra: VSCO 2 Community Edition by Versilian Studios / Sam Gossner and Ivy Audio / Simon Dalzell (CC0);
> tuned percussion from VCSL by Versilian Studios (CC0).
> Reverb impulse responses from OpenAIR (www.openairlib.net), Audiolab, University of York:
> Jack Lyons Concert Hall by Alex Duffell, Aishwarya Sridhar and Zhong Li, and Arthur Sykes Rymer Auditorium
> (University of York), both CC BY 4.0.
> All samples were trimmed, level-adjusted and converted to mp3; the impulse responses were decoded from
> B-format to stereo.

---

## 1. Salamander Grand Piano V3 - `assets/samples/piano/`

- **Author:** Alexander Holm (Yamaha C5 grand, 48 kHz / 24 bit, 16 velocity layers, sampled in minor thirds)
- **Licence:** Creative Commons Attribution 3.0 Unported (CC BY 3.0) - https://creativecommons.org/licenses/by/3.0/
  - stated on the original upload https://archive.org/details/SalamanderGrandPianoV3 (`licenseurl` = by/3.0, creator Alexander Holm)
  - and in the `LICENSE` file of https://github.com/sfzinstruments/SalamanderGrandPiano (same samples, FLAC)
- **Obtained from:** https://tambien.github.io/Piano/audio/ - the mp3 set hosted for
  [@tonejs/piano](https://github.com/tambien/Piano) by Yotam Mann (the package code is MIT; the audio is the
  Salamander piano). Files: `<Note>v<1|4|8|12|16>.mp3` for 30 keys (every minor third A0...C8), `harmS<Note>.mp3`
  (23 release harmonics, A0...D#6 - none exist above that on the host), `rel1...rel88.mp3` (key-release noises),
  `pedalD1/2.mp3`, `pedalU1/2.mp3`.
- **Modified:** 5 of the 16 velocity layers kept (1, 4, 8, 12, 16); leading silence trimmed; notes capped at
  14 s (below C3) / 10 s (C3-C5) / 6 s (above) with a 0.3 s fade-out; one fixed gain of -1.5 dB on every piano
  file (notes and extras); re-encoded mp3 -> mp3 (the hosted source is already ~105 kbps mp3, so this is a
  second lossy generation). Tuning untouched (the instrument is stretch-tuned as recorded).

## 2. VSCO 2 Community Edition - strings, winds, horn, harp, timpani, orchestral percussion

- **Authors:** Versilian Studios LLC (Sam Gossner) and Ivy Audio (Simon Dalzell); sample cutting by Elan
  Hickler / Soundemote.
- **Licence:** CC0 1.0 Universal (`LICENSE` in the repository) - https://creativecommons.org/publicdomain/zero/1.0/
  The readme adds a request (not a condition): *"Please provide credit to Versilian Studios/Sam Gossner, and/or
  Ivy Audio/Simon Dalzell where applicable, and link to the VSCO: CE homepage"* and asks that the samples not
  be sold on their own.
- **Source:** https://github.com/sgossner/VSCO-2-CE - wav files from branch `master`
  (commit `440300901dfe9275fd84e0b7763af1f8443ae62e`), key maps from branch `SFZ`
  (commit `6dd651d55dde97fd4028699be9d4481f26917891`). Homepage: https://versilian-studios.com/vsco-community/
  (the readme's link http://vis.versilstudios.net/vsco-community.html redirects there)
- **Folders used:** `Strings/Violin Section`, `Viola Section`, `Cello Section` (susvib, spic, trem, pizz),
  `Strings/Solo Contrabass` (SusVib, Spic, Trem, Pizz), `Strings/Solo Violin` (Arco Vib, spic, Trem, Pizz),
  `Strings/Harp`, `Woodwinds/Flute` (susvib, stac), `Woodwinds/Oboe` (Vib, Stacc), `Woodwinds/Clarinet`
  (susLong, stac), `Brass/F Horn` (sus, stac), `Percussion/Timpani` (+ `Rolls`), and from `Percussion/`:
  `BDrumNewhit_*` (bass drum), `cymbal-crash1_*` (clash cymbals), `susCymb1-cresc-*` (suspended cymbal swells),
  `gongHit_*` (tam-tam).
- **Modified:** leading silence trimmed; sustains / tremolo / timpani rolls capped at 9 s with a 0.3 s fade;
  short articulations capped at 4 s; ringing instruments capped (harp 9 s, timpani 8 s, cymbals 8 s, swells
  and tam-tam 12 s, bass drum 6 s) with a longer fade; **one fixed gain per instrument+articulation** (the
  `gainDb` in `manifest.json`), no per-sample normalisation; converted wav -> mp3; mono files written as
  2-channel. Up to 3 dynamic layers and all (2) round-robin takes kept.
  - **Timpani are re-tuned:** the five drums are 0.2-0.6 semitone away from equal-tempered pitches (and the
    rolls are tuned differently from the hits), so each file is resampled by less than +/-0.6 semitone to the
    nearest semitone; the manifest keys are those corrected pitches (hits F2 B2 C#3 E3 G3, rolls F#2 C3 C#3 E3 G3).
  - `basses` uses the **solo** contrabass: VSCO 2 CE contains no double-bass section.
  - One mapping error of the library's SFZ was corrected: `Cello Section/trem/trem_B2_v2_1.wav` is B2 (MIDI 47),
    not B3.

## 3. VCSL (Versilian Community Sample Library) - `glockenspiel`, `vibraphone`

- **Author:** Versilian Studios LLC and contributors
- **Licence:** CC0 1.0 Universal (`LICENSE`; readme: *"This collection is under a Creative Commons 0 license ...
  no royalties, no credit, no special terms"*).
- **Source:** https://github.com/sgossner/VCSL (commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`),
  folders `Idiophones/Struck Idiophones/Glockenspiel` and `.../Vibraphone` (`Soft Mallets` v1+v2, `Hard Mallets` v3).
- **Modified:** trimmed, capped (glockenspiel 6 s, vibraphone 9 s, 1 s fade), one fixed gain per instrument
  (glockenspiel +20.5 dB, vibraphone -0.5 dB), wav -> mp3. No celesta exists in VCSL, so there is none here.

## 4. Salamander Drumkit - `assets/samples/drumkit/`  (CC BY-SA 3.0)

- **Author:** Alexander Holm
- **Licence:** Creative Commons Attribution-ShareAlike 3.0 - http://creativecommons.org/licenses/by-sa/3.0/
  (original `REAMDE` inside the archive: *"Licence: CC-by-sa"*; archive.org `licenseurl` = by-sa/3.0).
  The readme kept in the GitHub mirror adds the author's clarification: *"The 'share-alike' condition in the
  license only applies if you modify the samples themselves or create new sample libraries with them. Produced
  Music and other non-sample-library works can be licensed at will."*
  **Consequence:** the mp3 files in `assets/samples/drumkit/` are modified samples, so those files themselves
  stay under CC BY-SA 3.0 (with attribution) wherever they are redistributed, e.g. when served by the web app.
  Music made with them is not affected.
- **Source:** samples from https://archive.org/details/SalamanderDrumkit (`salamanderDrumkit.tar.bz2`,
  md5 `af8e2067668a7f438e7d981877fb771f`); the GitHub repository named in the brief,
  https://github.com/endolith/Salamander-Drumkit (commit `9e9c9fca9f26e1763435beca4170505d0fa32fb0`), only
  contains the `.sfz` maps and readme and points to that archive.
- **Used:** overhead-mic (`OH`) samples, the only ones in the archive: `kick`, `snare` (Ghost/MP/F/FF),
  `hihatClosed`, `hihatFoot`, `hihatOpen`, `loTom`, `hiTom`, `ride2`, `crash1`; first 3 takes of each dynamic.
- **Modified:** leading silence trimmed tightly; cymbals capped at 7 s, open hat 5 s, others 4 s; wav -> mp3.
  Every wav in the library is peak-normalised, so the library's own `volume=` values from `ALL.sfz` were
  applied per kit piece / dynamic group (kick -7, snare 0, closed hat -15, pedal hat -19, open hat -5/-7/-12,
  toms -3, ride -12, crash -19/-12 dB) plus a common -3 dB. **The mid tom (pseudo-note 47) does not exist in
  the kit: it is the high tom resampled 5 semitones down.**

## 5. OpenAIR impulse responses - `assets/ir/`

Open Acoustic Impulse Response Library, Audiolab, University of York - https://www.openair.hosted.york.ac.uk/
(www.openairlib.net).

| File | Space | Licence | Attribute to | Page |
|---|---|---|---|---|
| `jack_lyons_lp2_stereo.wav` | Jack Lyons Concert Hall, University of York (listening position 2, seat D22, 10 m from the source) | CC BY 4.0 | www.openairlib.net; Audiolab, University of York; Alex Duffell, Aishwarya Sridhar, Zhong Li | https://www.openair.hosted.york.ac.uk/?page_id=571 |
| `rymer_s1r2_stereo.wav` | Arthur Sykes Rymer Auditorium, University of York (source 1 / receiver 2: centre seat of the middle row, 7.6 m) | CC BY 4.0 | www.openairlib.net; University of York (measured by Pierce Hening, Georgios Stamou, David Rivas Mendez) | https://www.openair.hosted.york.ac.uk/?page_id=425 |

- **Licence check:** both pages state *"This work is licensed under a Creative Commons Attribution 4.0
  International License"* and give the "Attribute this work to" names above. The OpenAIR web site could not be
  opened directly when this was prepared (its TLS certificate expired on 2026-09-30), so the pages were read
  from the Internet Archive snapshots
  https://web.archive.org/web/20260125111616/https://www.openair.hosted.york.ac.uk/?page_id=571 and
  https://web.archive.org/web/20250427102628/https://www.openair.hosted.york.ac.uk/?page_id=425 .
  The audio was downloaded from the University's own file server, as linked from those pages:
  `https://webfiles.york.ac.uk/OPENAIR/IRs/<space>/<space>.zip`.
- **Modified:** the originals are 4-channel B-format (W, X, Y, Z; 96 kHz). They were decoded to stereo with
  two virtual cardioid microphones aimed +/-55 degrees from the front (W, X and Y only), the silence before the
  direct sound was removed (1 ms kept), resampled to 48 kHz / 24 bit, given one fixed gain (peak at -1 dBFS;
  -1.07 dB and -1.86 dB) and a 60 ms fade-out at the very end.

## 6. Electronic drum kit `ekit` - `assets/samples/ekit/`  (CC0)

Built by `tools/samples/build-ekit.mjs` (raw downloads in `.cache/raw/sonic-pi-samples/` and `.cache/raw/vcsl-ekit/`).

- **Sonic Pi `etc/samples`** - https://github.com/sonic-pi-net/sonic-pi (branch `stable`, commit
  `25baaed3c28003bf141f591081217136194b0d69`). Licence read from the project's `LICENSE.md`: *"All the bundled
  samples are individually licensed under a CC0 1.0 Universal Public Domain Dedication. They have been obtained
  from freesound.org"*; `etc/samples/README.md` repeats it and links each original. Used (original freesound authors):
  `bd_klub` (zgump, freesound 83262) and the first 35 ms of `bd_tek` (DWSD, 171104) -> kick; `sn_dub` (Adriak909, 173142)
  -> snare; `perc_snap` (SoundCollectah, 109400), `perc_snap2` (Peram, 158615) -> snap; `hat_gem` (IanStarGem, 273186),
  `hat_yosh` (JapanYoshiTheGamer, 361267) -> closed hat; `hat_tap` (TheEndOfACycle, 674296) -> pedal hat; `hat_gump`
  (zgump, 96144) -> open hat; `drum_cymbal_hard` (menegass, 100056) -> crash; `ride_tri` (trivialAccapella, 425449) -> ride;
  `drum_cowbell` (Neotone, 75338) -> cowbell.
- **VCSL** (CC0 1.0, see section 3; same commit) - `Idiophones/Struck Idiophones/Claps/Clap_rr6.wav`, `Clap_rr1.wav`
  -> clap; `Shaker, Small/Mid_ShakerHighFaster_Up_rr1.wav`, `_rr2.wav` -> shaker.
- **Toms** (45 / 47 / 50) are generated by the script (808-style sine with a pitch drop and a click); no third-party audio.
- **Modified:** downmixed to mono, trimmed to the transient, high-passed, the kick layered (high-passed click on top)
  and given a shorter decay, transient peaks of claps / snaps / snare / shaker soft-clipped, capped with fades,
  one kit balance + one common gain (-7.87 dB), mp3 (stereo, identical channels).

## Build-time tool (not part of the assets)

`ffmpeg-static` (npm) supplies the ffmpeg 6.0 binary (GPL build, includes libmp3lame) used for all conversions.
It lives only in `tools/samples/node_modules/` and is not redistributed with the app.
