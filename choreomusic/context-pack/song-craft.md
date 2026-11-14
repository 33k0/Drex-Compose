# Song craft: how the measured pop tracks are built

Concept-level analysis only (tempo, sections, low end, drum families, loop lengths). No notes, melodies or lyrics were extracted or stored. Audio and scripts live outside the project in the session scratchpad (`songcraft/`).

## Tracks analysed (11)

| Track | Source | Duration |
|---|---|---|
| K/DA - FIRESTARTER (official MV audio) | https://www.youtube.com/watch?v=Mmw-PpWhKFg | 3:27 |
| Justin Bieber - Sorry | https://www.youtube.com/watch?v=8ELbX5CMomE | 3:19 |
| Justin Bieber - What Do You Mean? | https://www.youtube.com/watch?v=NywWB67Z7zQ | 3:26 |
| Katy Perry - Dark Horse (audio) | https://www.youtube.com/watch?v=ONb4aTtG6Ps | 3:36 |
| Katy Perry - Roar (audio) | https://www.youtube.com/watch?v=oT73UO5nQXM | 3:44 |
| Katy Perry - Firework (MV audio) | https://www.youtube.com/watch?v=QGJuMBdaqIw | 3:53 |
| Why Don't We - 8 Letters (MV audio) | https://www.youtube.com/watch?v=C3DlM19x4RQ | 3:11 |
| Why Don't We - Trust Fund Baby (audio) | https://www.youtube.com/watch?v=FQXJtm46pYI | 3:10 |
| Mark Ronson ft. Bruno Mars - Uptown Funk (audio) | https://www.youtube.com/watch?v=7Ya2U8XN_Zw | 4:31 |
| Bruno Mars - 24K Magic (audio) | https://www.youtube.com/watch?v=f9imDgsjxXc | 3:46 |
| Bruno Mars - Treasure | https://www.youtube.com/watch?v=jz7C2W4m26U | 2:56 |

FIRESTARTER, Firework and 8 Letters come from music-video uploads, which may add extra intro sound or effects. The other Roar and Dark Horse uploads were swapped for audio-only versions because the music videos have long intros.

## Per-track measurements

Bars are counted from the first beat-grid bar. 'Prepared arrivals' means the high-energy block came after a block with no bass, or after a dip in the last two beats.

| Track | BPM | Drum family (full sections) | Loop (bars) | Bass changes/bar | Kick+bass in (bar/s) | First loudest block (bar/s) | Thinnest block low end vs chorus | Chorus vs beat-verse (dB) | Chorus vs stripped (dB) | Prepared arrivals |
|---|---|---|---|---|---|---|---|---|---|---|
| FIRESTARTER | 131.0 | 2-kick verses; on every beat in late choruses; off-beat hats | 4 | 0.62 | 11 / 22 s | 14 / 28 s | 35% | 0.8 | - | 0 of 4 |
| Sorry | 100.0 | syncopated 3+3+2 kick and snare | 2 | 0.95 | 4 / 10 s | 22 / 53 s | 7% | 2.4 | 5.5 | 1 of 2 |
| What Do You Mean? | 125.0 | kick on every beat | 4 | 0.75 | 7 / 15 s | 7 / 15 s | 0.5% | 0.3 | 11.3 | 3 of 4 |
| Dark Horse | 132.0 | half-time, one clap per bar, 808 pedal | 4 | 0.51 | 8 / 15 s | 8 / 15 s | 10% | 3.3 | 10.0 | 3 of 4 |
| Roar | 90.0 | syncopated kick, backbeat | 4 | 0.52 | 5 / 14 s | 19 / 51 s | 27% | 2.8 | 7.8 | 2 of 5 |
| Firework | 124.0 | kick on every beat, backbeat | 4 | 0.83 | 7 / 14 s | 39 / 76 s | 10% | 5.6 | 4.2 | 3 of 3 |
| 8 Letters | 89.0 | syncopated kick, backbeat, 8th hats | 2 | 0.88 | 16 / 45 s | 23 / 64 s | 3% | 7.6 | 6.2 | 3 of 3 |
| Trust Fund Baby | 82.0 | syncopated kick, backbeat, straight 16ths | 2 | 0.94 | 1 / 3 s | 18 / 53 s | 1.5% | 5.0 | 5.5 | 4 of 5 |
| Uptown Funk | 115.0 | kick on every beat, backbeat | 2 | 0.57 | 7 / 16 s | 39 / 83 s | 6% | 2.1 | 14.0 | 2 of 4 |
| 24K Magic | 107.0 | syncopated busy kick, backbeat | 2 | 0.82 | 10 / 24 s | 14 / 33 s | 3.5% | 1.1 | 9.2 | 1 of 5 |
| Treasure | 116.0 | kick on every beat (disco) | 4 | 0.80 | 0 / 1 s | 13 / 28 s | 3.6% | 2.8 | 4.8 | 1 of 3 |

## Key findings

- Tempo is fixed in 11 of 11 tracks, within 0.05 BPM from start to end. Two methods agree: windowed beat-grid fits and onset autocorrelation.
- The drum family follows the tempo. The kick is on every beat in the 4 tracks at 115-125 BPM and turns four-on-the-floor late in the 131 BPM track. Slower tracks (82-107 BPM) use syncopated kicks under a backbeat. The 132 BPM track is half-time.
- Loops are 2 or 4 bars in 11 of 11 tracks: 2-bar riffs at 82-115 BPM, 4-bar chord loops in 5 of 6 tracks at 116+ BPM. Similarity 8 bars apart is almost the same as 4 bars apart, so the loop runs unchanged through whole sections. A 3-bar control lag scores much lower.
- Energy comes from the low end. In 9 of 11 tracks some block of 4+ bars drops the low end below 10% of its chorus share. A chorus is only 0.3-5.6 dB louder than a verse that already has the beat (median 2.8 dB). Rhythmic density barely changes: stripped blocks keep 77-135% of the chorus onset rate.
- 23 of 42 high-energy arrivals came after a bass-less block or a dip in the last 2 beats, against about 15% of ordinary bar lines.
- Eighth notes are straight in 11 of 11 tracks.

## Trusted vs dropped measures

- **Trusted:** tempo and steadiness (two methods); constant beat grid (offsets of 25 ms or less in 85% or more of windows); low-end (30-150 Hz) share per bar; level per bar; loop period from within-section chroma and bass similarity at lags of 1-8 bars, with lag 3 as a control; straight eighths.
- **Moderate:** kick/snare 16-step patterns (kick-click bleed blurs the snare band, so four-on-the-floor was cross-checked bar by bar); downbeat placement (snare-vs-kick parity, then bass changes, so beat 1 vs beat 3 can be wrong); bass-note counts (method agreement 0.62-0.98; pyin agreement 0.6-0.97); stop positions within the bar; the 4-bar block phase (42 of 66 largest changes fall on the first or last bar of a block).
- **Dropped:** 'pitched share' from pyin on full mixes; triad chord labels; stutter detection (no reliable detector); absolute pre-drop silence counts (the plain threshold fired at most ordinary bar lines, so it was replaced by a relative dip with controls); automatic verse/chorus labels (only energy tiers F/M/t are reported).
- **Tempo octave:** the default tracker locked to 4/3 of the true tempo on the 100 and 82 BPM tracks (3+3+2 rhythms). They were re-run with a forced tempo near the known value and confirmed by onset salience and 8-beat chroma repetition.

## Rules by theme

### Tempo and groove

- **fixed-tempo** (setup, plan, ending, live_read, fit): Lock one tempo for the whole piece and quantise every part to it: no rubato, no ritardando, no accelerando, not even at the end. *Evidence: measured on 11 of 11 tracks: tempo constant within 0.05 BPM end to end (82-132 BPM), two methods agree.*
- **groove-by-tempo** (setup, orchestration): Pick the kick family from the tempo: about 115-130 BPM put the kick on every beat; 80-110 BPM use a syncopated kick under a backbeat; above 130 keep four-on-the-floor or switch to half-time. *Evidence: measured on 11 of 11 tracks: kick on all four beats in the 4 tracks at 115-125 BPM; syncopated kicks at 82-107; one clap per bar at 132; the 131 track turns four-on-the-floor in late choruses.*
- **straight-eighths** (setup, orchestration): Keep eighth notes straight; if anything, swing only the sixteenths, and lightly. A shuffled or triplet feel is a different style. *Evidence: measured on 11 of 11 tracks: offbeat eighths at 0.50-0.54 of the beat; sixteenths straight in 2 tracks, slightly late in 1.*
- **backbeat** (orchestration, setup): Put the snare or clap on beats two and four in most sections; once per bar on beat three for half-time; a 3+3+2 placement for Latin or dancehall feels. *Evidence: measured on 10 of 11 tracks: backbeat in 8 tracks, once per bar in the 132 BPM track, 3+3+2 in the 100 BPM track.*
- **change-drums-at-lines** (orchestration, plan): Change the drum pattern only at section lines: lighter kick or half-time in verses, full pattern in the chorus, kick out in the breakdown. *Evidence: measured on 2 of 11 tracks: kicks per bar rose from about 2-3 in verses to 4 in later choruses.*
- **hats-set-density** (orchestration): Use hats to set density: eighths in verses, sixteenths or open off-beat hats in choruses, rolls only as end-of-bar punctuation. *Evidence: general practice.*
- **808-pedal** (orchestration, phrase_direction): In trap or half-time sections hold a sub or 808 on one or two notes for four or more bars and let the kick pattern carry the rhythm. *Evidence: measured on 2 of 11 tracks: one bass note held for 4+ bars across most of a section.*
- **kick-bass-lock** (orchestration, phrase_direction): Lock the bass to the kick: bass notes start with kick hits or just after them and rest where the snare lands; do not let a held bass smear the kick. *Evidence: general practice.*
- **bass-rests-octaves** (orchestration, phrase_direction): Write bass with rests, octave jumps and short slides into the next root; keep long held bass notes for breakdowns or 808 sections. *Evidence: general practice.*
- **sidechain** (orchestration, setup): Duck pads and bass under the kick with sidechain pumping in four-on-the-floor sections so each kick punches through. *Evidence: general practice.*

### Structure and energy

- **energy-by-low-end** (plan, orchestration): Shape energy mainly by taking kick and bass out and bringing them back; volume alone barely changes between a verse with the beat and a chorus. *Evidence: measured on 9 of 11 tracks: a 4+ bar block with low-end share under 10% of the chorus; chorus only 0.3-5.6 dB (median 2.8) louder than beat-verse.*
- **blocks-of-4-and-8** (plan, fit, phrase_direction): Plan sections as whole 4-bar multiples, usually 8 or 16 bars; links and breakdowns may be 4. Put every section change on a 4-bar line. *Evidence: measured on 11 of 11 tracks: section runs 4-24 bars; 42 of 66 largest changes on the first or last bar of a 4-bar block.*
- **beat-arrives-early** (plan, orchestration): Bring kick and bass in within the first four to eight bars and the first full chorus or drop by about bar 16-24; avoid a long quiet introduction. *Evidence: measured on 10 of 11 tracks: kick+bass in by bar 0-11 (median about bar 7, 15 s); first loudest block median bar 18.*
- **hook-returns** (plan, phrase_direction, theme_judge): Bring the chorus or drop back three or four times with the same hook; make each return different through arrangement, not new material. *Evidence: measured on 11 of 11 tracks: the top-energy block recurs 2-5 times (median 4).*
- **strip-before-drop** (plan, orchestration, fit): Before the biggest section, strip the low end for four to eight bars or cut it for the last one or two beats, so kick and bass return on the downbeat. *Evidence: measured on 10 of 11 tracks: 23 of 42 high-energy arrivals followed a bass-less block or a last-beats dip (ordinary bar lines ~15%).*
- **climax-late** (plan, ending): Put the biggest, longest full-energy block in the second half, usually the last chorus after a breakdown; do not peak in the first minute. *Evidence: measured on 7 of 11 tracks: the longest full-energy run sits in the second half.*
- **one-breakdown** (plan, orchestration): Plan one breakdown of four to eight bars about two-thirds through: kick and bass out, pad or the hook alone, then a fill into the final chorus. *Evidence: measured on 6 of 11 tracks: a 4-bar thinned block at roughly 50-75% of the track.*
- **partial-intro** (plan, orchestration): Open with a partial texture for four to eight bars, the hook riff, chords or filtered drums alone; start straight on the beat if the dance starts at once. *Evidence: measured on 10 of 11 tracks: a thinned intro of 1-11 bars before kick and bass.*
- **arrangement-not-chords** (plan, orchestration, phrase_direction): Make verse and chorus differ by arrangement (kick pattern, bass in or out, hats, an extra layer), not by new chords or a new tempo. *Evidence: general practice; loops held across sections in the measured tracks.*
- **keep-motion-in-breaks** (orchestration, plan, fit): In stripped sections take away weight, not motion: drop kick and bass but keep hats, claps or rhythmic chords running so the pulse never stops. *Evidence: measured on 11 of 11 tracks: onset density in stripped blocks 77-135% of the chorus.*
- **density-not-volume** (orchestration, phrase_direction): Raise intensity with density and layers: sixteenth hats, extra percussion, a doubled hook an octave up. Do not rely on getting louder. *Evidence: measured on 10 of 11 tracks: choruses had more onsets per beat than verses in 9 of 10 (+0.04 to +0.8).*
- **layer-order** (orchestration, plan): Add layers in this order as energy rises: chords, hats, kick, bass, clap or snare, lead hook, extra percussion and top effects; remove them in reverse. *Evidence: general practice.*
- **filter-riser** (orchestration, fit, plan): Build into a drop with a low-pass filter closing over four to eight bars plus a noise riser or snare roll, then open fully on the downbeat. *Evidence: general practice.*
- **crash-on-arrival** (orchestration, fit): Mark each new block's downbeat with a crash or impact and the return of whatever was taken out before it. *Evidence: general practice.*
- **dance-energy-map** (plan, live_read, orchestration): Map the dancers' energy to the layer plan: bigger movement gets kick, bass or hats added at the next block line; calmer movement gets them removed. *Evidence: general practice.*
- **no-hairpins** (orchestration, plan): Do not shape sections with long crescendos and diminuendos; energy steps up or down at block lines by adding or removing layers. *Evidence: general practice.*

### Loops, harmony and repetition

- **loop-exactly** (phrase_direction, phrase_judge, orchestration): Repeat the two- or four-bar loop exactly through a section; at each four- or eight-bar line change one thing only: a layer, the last bar, an answer. *Evidence: measured on 11 of 11 tracks: harmony repeats with a 2- or 4-bar period inside sections; similarity at 8-bar lag almost equals 4-bar lag.*
- **loop-length-by-style** (setup, phrase_direction): Use a riffy two-bar loop for funk, hip-hop and slower pop; use a four-chord, four-bar loop for dance-pop and house. *Evidence: measured on 11 of 11 tracks: 2-bar loops in all 5 tracks at 82-115 BPM; 4-bar loops in 5 of 6 tracks at 116-132 BPM.*
- **harmonic-rhythm** (phrase_direction, setup, phrase_judge): Change chords at most once per bar, often once every two bars; a one-chord vamp for a whole verse or drop is normal. *Evidence: measured on 11 of 11 tracks: bass root changes 0.5-0.95 times per bar; one bass note held 4+ bars in 2 tracks.*
- **change-last-bar** (phrase_direction, orchestration): Vary mostly the last bar of each four- or eight-bar phrase with a fill, stop or pickup; the first three bars repeat the loop. *Evidence: measured on 11 of 11 tracks: big bar-to-bar changes cluster on the last and first bar of 4-bar blocks.*
- **sameness-is-correct** (phrase_judge): Do not penalise exact repetition: a phrase identical to the previous one is correct unless the plan asks for a change at that block line. *Evidence: measured on 11 of 11 tracks: within-section loops repeat with high similarity.*
- **phrase-ending-open** (phrase_direction, phrase_judge): End each four-bar phrase by setting up the next downbeat with a fill, a held note, a drop-out or the loop's turnaround, never a final-sounding cadence. *Evidence: general practice.*
- **call-response** (phrase_direction, theme_draft, orchestration): Shape phrases as call and response: the hook in bars one and three, an answer from another sound, a fill or silence in bars two and four. *Evidence: general practice.*
- **no-busy-harmony** (phrase_judge, phrase_direction, setup): Do not change chords every beat, build cadences or modulate through keys; loops, vamps and pedal bass are normal here. *Evidence: measured on 11 of 11 tracks: 2- or 4-bar loops, about one bass change per bar or less.*
- **no-sequence-transposition** (phrase_direction, phrase_judge): Do not move the hook up by steps phrase after phrase; keep its pitch level and vary rhythm, register by octave, or the sound carrying it. *Evidence: general practice.*
- **no-developing-melody** (phrase_direction, theme_draft, phrase_judge, plan): Do not develop a long melody phrase by phrase; restate the short hook and change the arrangement around it instead. *Evidence: general practice.*

### Hooks

- **short-hook** (theme_draft, theme_judge): Make the hook one or two bars long, four to eight notes on a memorable rhythm cell, ending so it loops straight back into its own start. *Evidence: general practice.*
- **hook-rhythm** (theme_draft, theme_judge): Give the hook at least one syncopation, a note anticipating the beat by an eighth or sixteenth; a hook of even quarter notes sounds like a hymn. *Evidence: general practice.*
- **narrow-hook** (theme_draft, theme_judge): Keep the hook in a narrow range, about a fifth to an octave, using repeated notes and small steps with at most one leap for identity. *Evidence: general practice.*
- **hook-repeatable** (theme_judge): Judge a hook by whether it could loop 16 times without tiring and be recognised from its rhythm alone; prefer catchy over developed. *Evidence: general practice.*
- **hook-over-loop** (theme_draft, theme_judge): Write the hook so it fits every pass of the chord loop unchanged; a line that only works over one chord change is a melody, not a hook. *Evidence: general practice.*
- **hook-space** (theme_draft, theme_judge): Leave rests inside the hook: a beat or two of silence per bar gives the dancers an accent and leaves room for an answer. *Evidence: general practice.*
- **instrumental-hook** (theme_draft, setup, orchestration): With no singer, carry the hook on a lead synth, pluck, brass stab or chopped-vocal-like sound, and feature it in the drop or post-chorus. *Evidence: general practice.*
- **reject-drift** (phrase_judge, theme_judge): Reject a phrase that leaves the loop or hook for new melodic material; accept one that repeats it with a single clear change or none. *Evidence: general practice.*
- **groove-first-judge** (phrase_judge, theme_judge): Prefer the draft whose rhythm locks to kick and snare and leaves rests; reject drafts of continuous even notes with no space. *Evidence: general practice.*
- **register-clash** (phrase_judge, orchestration): Reject a phrase that puts melody in the bass register or long low notes over the kick and bass range. *Evidence: general practice.*

### Sound and palette

- **palette-jobs** (setup, orchestration): Choose the palette by job: kick, snare or clap, hats, one bass, one chord layer, one lead hook sound, plus effects. Leave out orchestral sections. *Evidence: general practice.*
- **low-end-two-sounds** (setup, orchestration): Give the range below about 150 Hz to kick and bass only; in full sections they should dominate the mix weight. Keep chords and leads above. *Evidence: measured on 11 of 11 tracks: 30-150 Hz held 41-83% of mix energy in full sections.*
- **chords-mid-register** (orchestration, setup): Keep chords in the middle register as short stabs or a sidechained pad; avoid thick low voicings and doubled lines. *Evidence: general practice.*
- **dry-produced-sound** (setup, orchestration): Make the sound produced, not hall-like: tight drums, short dry synths, reverb kept short except for single hanging notes in breakdowns. *Evidence: general practice.*
- **one-key** (setup): Stay in one key for the whole piece; choose minor or a minor-leaning mode for dark, driving moves and major for bright, celebratory ones. *Evidence: general practice.*
- **no-drumless-rubato** (orchestration, phrase_judge, plan): Never leave a passage with no pulse: outside a short stop, something rhythmic (hats, clap, chopped chords) must mark the beat. *Evidence: measured on 11 of 11 tracks: stripped blocks kept 1.7-4.6 onsets per beat.*

### Scene cuts, stops, live, endings

- **cut-on-grid** (fit): Mark a scene cut without stopping the beat: land the change on the nearest bar line with a crash, a fill into it, or a one-bar drum drop. *Evidence: general practice; tempo never broke in 11 of 11 measured tracks.*
- **small-cut-one-layer** (fit, orchestration): For a minor scene cut change just one layer at the bar line: hats in or out, a filter step, or a new percussion loop. *Evidence: general practice.*
- **big-cut-stop** (fit): For a big scene change, stop everything for one or two beats just before the bar line, then bring the full beat back on the downbeat. *Evidence: general practice; stops measured on 6 of 11 tracks.*
- **midbar-cut** (fit, live_read): If a cut falls mid-bar, hit it with a short stab or impact on the nearest beat and save the section change for the next four-bar line. *Evidence: general practice.*
- **riser-downlifter** (fit, orchestration): Use a riser over the last one or two bars when a cut leads to a bigger scene, and a downlifter or reverse sweep when it leads to a calmer one. *Evidence: general practice.*
- **stops** (orchestration, fit): Use short stops: mute everything, or just the drums, for one or two beats at the end of a bar, then re-enter on the downbeat. *Evidence: measured on 6 of 11 tracks: stops of 0.5-2.3 beats, mostly starting on beat 3 or 4 (downbeat inferred, moderate confidence).*
- **fills-at-block-ends** (orchestration, fit, phrase_direction): End every fourth or eighth bar with a fill in its last one or two beats: snare or tom run, hat roll, reverse cymbal or drum drop. *Evidence: general practice.*
- **live-at-block-lines** (live_read, plan): When following the dancers live, change sections only at the next four- or eight-bar line, and change layers, never the tempo. *Evidence: general practice.*
- **live-accent** (live_read, fit): If the dancers hit a sudden accent, answer it with a stab, a drop-out or a fill inside the current groove rather than a new section. *Evidence: general practice.*
- **end-on-downbeat** (ending): End on a downbeat at full tempo: after the last chorus either strip layers over four to eight bars or hit one final chord and kick and stop dead. *Evidence: measured on 11 of 11 tracks: no tempo change at the end of any track.*
- **outro-strip** (ending): For an outro, remove layers in reverse order every four bars, or loop the hook alone, ending on a bar line rather than fading out mid-phrase. *Evidence: general practice.*

