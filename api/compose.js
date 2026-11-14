// server/core/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function sampleFrom(probabilities, rng) {
  const keys = Object.keys(probabilities);
  let total = 0;
  for (const k of keys) total += Math.max(0, probabilities[k]);
  if (total <= 0) return keys[Math.floor(rng() * keys.length)];
  let x = rng() * total;
  for (const k of keys) {
    x -= Math.max(0, probabilities[k]);
    if (x <= 0) return k;
  }
  return keys[keys.length - 1];
}
function topOf(probabilities) {
  let best = "";
  let bestP = -Infinity;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      best = k;
      bestP = p;
    }
  }
  return best;
}
function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
var clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
var mod = (n, m) => (n % m + m) % m;

// server/core/theory.ts
var MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10]
};
var MODE_NAMES = {
  major: "major",
  natural_minor: "minor",
  harmonic_minor: "harmonic minor",
  melodic_minor: "melodic minor",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian"
};
var MODE_FEEL = {
  major: "bright, settled, open",
  natural_minor: "sad, grounded, plain",
  harmonic_minor: "dramatic minor with a pulling leading tone",
  melodic_minor: "minor that lifts and yearns upward",
  dorian: "minor with a hopeful raised sixth; cool, bittersweet",
  phrygian: "dark, tense, lowered second; ominous",
  lydian: "floating, wondrous, raised fourth; bright and dreamy",
  mixolydian: "major with a relaxed lowered seventh; playful, folk-like"
};
var isMinorish = (mode) => MODES[mode][2] === 3;
var SHARP_NAMES = ["C", "C\u266F", "D", "D\u266F", "E", "F", "F\u266F", "G", "G\u266F", "A", "A\u266F", "B"];
var FLAT_NAMES = ["C", "D\u266D", "D", "E\u266D", "E", "F", "G\u266D", "G", "A\u266D", "A", "B\u266D", "B"];
function usesFlats(key) {
  if (key.spell) return key.spell === "flat";
  const offsetToMajor = {
    major: 0,
    natural_minor: 3,
    harmonic_minor: 3,
    melodic_minor: 3,
    dorian: 10,
    phrygian: 8,
    lydian: 7,
    mixolydian: 5
  };
  const rel = mod(key.tonic + offsetToMajor[key.mode], 12);
  return [5, 10, 3, 8, 1].includes(rel);
}
function pcName(pc, key) {
  const names = key && usesFlats(key) ? FLAT_NAMES : SHARP_NAMES;
  return names[mod(pc, 12)];
}
function keyName(key) {
  return `${pcName(key.tonic, key)} ${MODE_NAMES[key.mode]}`;
}
function midiName(midi, key) {
  return `${pcName(midi, key)}${Math.floor(midi / 12) - 1}`;
}
function tonicMidi(key) {
  return key.tonic <= 6 ? 60 + key.tonic : 48 + key.tonic;
}
function degreeToMidi(key, deg, alt = 0) {
  const scale = MODES[key.mode];
  const octave = Math.floor(deg / 7);
  return tonicMidi(key) + 12 * octave + scale[mod(deg, 7)] + alt;
}
function transposeKey(key, semitones) {
  return { tonic: mod(key.tonic + semitones, 12), mode: key.mode };
}
function relativeKey(key) {
  return isMinorish(key.mode) ? { tonic: mod(key.tonic + 3, 12), mode: "major" } : { tonic: mod(key.tonic + 9, 12), mode: "natural_minor" };
}
var METERS = {
  "4/4": { id: "4/4", beatsPerBar: 4, sub: 2, feel: "even, walking or driving; the default pulse", strong: [0, 2] },
  "3/4": { id: "3/4", beatsPerBar: 3, sub: 2, feel: "waltz-like, turning, graceful", strong: [0] },
  "6/8": { id: "6/8", beatsPerBar: 2, sub: 3, feel: "lilting two-in-a-bar, rocking", strong: [0] },
  "12/8": { id: "12/8", beatsPerBar: 4, sub: 3, feel: "slow compound pulse, rolling and wave-like", strong: [0, 2] },
  "5/4": { id: "5/4", beatsPerBar: 5, sub: 2, feel: "uneven and restless, limping forward", strong: [0, 3] },
  "7/8": { id: "7/8", beatsPerBar: 3.5, sub: 2, feel: "asymmetric, nimble, off-balance", strong: [0, 2] }
};
var FAMILY_EFFECT = {
  diatonic: "plain and stable; belongs to the key",
  diatonic_extended: "warm, open, tender",
  suspended: "unresolved, floating",
  borrowed: "sudden shadow (or sudden light) from the parallel key",
  chromatic_mediant: "cold, cinematic shift; a third away with one shared tone",
  late_romantic: "a chill under the sweetness"
};
var QUALITY_SUFFIX = {
  "0,4,7": "",
  "0,3,7": "m",
  "0,3,6": "dim",
  "0,4,8": "aug",
  "0,4,7,11": "maj7",
  "0,4,7,10": "7",
  "0,3,7,10": "m7",
  "0,3,6,10": "m7\u266D5",
  "0,3,6,9": "dim7",
  "0,3,7,11": "m(maj7)",
  "0,4,8,11": "maj7\u266F5",
  "0,4,7,11,14": "maj9",
  "0,4,7,10,14": "9",
  "0,3,7,10,14": "m9",
  "0,4,7,14": "add9",
  "0,3,7,14": "m(add9)",
  "0,3,7,11,14": "m(maj9)",
  "0,4,6": "(\u266D5)",
  "0,4,6,10": "7\u266D5",
  "0,4,6,11": "maj7\u266D5",
  "0,4,8,10": "7\u266F5",
  "0,3,8": "m\u266F5",
  "0,2,7": "sus2",
  "0,5,7": "sus4",
  "0,2,7,9": "6sus2",
  "0,5,7,10": "7sus4"
};
function chordSuffix(intervals) {
  return QUALITY_SUFFIX[intervals.join(",")] ?? `(${intervals.join(" ")})`;
}
function chordName(chord, key) {
  return pcName(key.tonic + chord.root, key) + chordSuffix(chord.intervals);
}
function chordPcs(chord, key) {
  return chord.intervals.map((iv) => mod(key.tonic + chord.root + iv, 12));
}
var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
var ROOT_ROMAN = {
  0: "I",
  1: "\u266DII",
  2: "II",
  3: "\u266DIII",
  4: "III",
  5: "IV",
  6: "\u266FIV",
  7: "V",
  8: "\u266DVI",
  9: "VI",
  10: "\u266DVII",
  11: "VII"
};
function romanFor(root, intervals, scaleDegree) {
  const base = scaleDegree !== void 0 ? ROMAN[scaleDegree] : ROOT_ROMAN[root];
  const minor = intervals[1] === 3;
  const body = minor ? base.toLowerCase() : base;
  const suffix = chordSuffix(intervals).replace(/^m(?!aj)/, "");
  return body + suffix;
}
function functionOf(root) {
  if (root === 0 || root === 9 || root === 8 || root === 4 || root === 3) return "tonic";
  if (root === 5 || root === 2 || root === 1) return "predominant";
  if (root === 7 || root === 11 || root === 10) return "dominant";
  return "colour";
}
function make(id, root, intervals, family, effect, scaleDegree) {
  const r = mod(root, 12);
  return {
    id,
    root: r,
    intervals,
    family,
    roman: romanFor(r, intervals, scaleDegree),
    fn: functionOf(r),
    effect: effect ?? FAMILY_EFFECT[family]
  };
}
function chordCandidates(key, previous) {
  const scale = MODES[key.mode];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (c) => {
    const sig = `${c.root}:${c.intervals.join(",")}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(c);
  };
  for (let d = 0; d < 7; d++) {
    const root = scale[d];
    const at = (steps) => {
      const idx = d + steps;
      return mod(scale[mod(idx, 7)] + 12 * Math.floor(idx / 7) - root, 12);
    };
    const third = at(2);
    const fifth = at(4);
    const seventh = at(6);
    const ninth = at(1) + 12;
    const dim = fifth === 6 ? "tense and unstable: a diminished chord that wants to resolve" : void 0;
    push(make(`d${d + 1}`, root, [0, third, fifth], "diatonic", dim, d));
    push(make(`d${d + 1}_7`, root, [0, third, fifth, seventh], "diatonic_extended", dim, d));
    if (ninth === 14 && fifth === 7) {
      push(make(`d${d + 1}_9`, root, [0, third, fifth, seventh, 14], "diatonic_extended", void 0, d));
      push(make(`d${d + 1}_add9`, root, [0, third, fifth, 14], "diatonic_extended", "warm and open, a triad with a glow on top", d));
    }
  }
  for (const d of [0, 3, 4]) {
    const root = scale[d];
    push(make(`d${d + 1}_sus2`, root, [0, 2, 7], "suspended", void 0, d));
    push(make(`d${d + 1}_sus4`, root, [0, 5, 7], "suspended", void 0, d));
  }
  push(make("d1_6sus2", scale[0], [0, 2, 7, 9], "suspended", "floating and hazy, neither major nor minor", 0));
  push(make("d5_7sus4", scale[4], [0, 5, 7, 10], "suspended", "a dominant that refuses to lean; unresolved, floating", 4));
  if (isMinorish(key.mode)) {
    push(make("bor_IV", 5, [0, 4, 7], "borrowed", "sudden light: the major IV in a minor key"));
    push(make("bor_I", 0, [0, 4, 7], "borrowed", "sudden light: the tonic turned major"));
    push(make("bor_V", 7, [0, 4, 7], "borrowed", "a strong pull home: the major dominant"));
    push(make("bor_V7", 7, [0, 4, 7, 10], "borrowed", "the strongest pull home: dominant seventh"));
  } else {
    push(make("bor_iv", 5, [0, 3, 7], "borrowed", "sudden shadow: the minor iv in a major key"));
    push(make("bor_bVI", 8, [0, 4, 7], "borrowed", "sudden shadow, broad and grave: flat VI"));
    push(make("bor_bVII", 10, [0, 4, 7], "borrowed", "sudden shadow with lift: flat VII"));
    push(make("bor_i", 0, [0, 3, 7], "borrowed", "sudden shadow: the tonic turned minor"));
  }
  const fromRoot = previous ? previous.root : 0;
  const fromMinor = previous ? previous.intervals[1] === 3 : isMinorish(key.mode);
  for (const step of [3, 4, 8, 9]) {
    const q2 = fromMinor ? [0, 3, 7] : [0, 4, 7];
    push(make(
      `med_${step}`,
      fromRoot + step,
      q2,
      "chromatic_mediant",
      `cold, cinematic shift: a ${step === 3 || step === 9 ? "minor" : "major"} third ${step <= 4 ? "up" : "down"} from the ${previous ? "last" : "tonic"} chord, one shared tone`
    ));
  }
  push(make("lr_aug", isMinorish(key.mode) ? 3 : 0, [0, 4, 8], "late_romantic", "a chill under the sweetness: augmented, unstable and glowing"));
  push(make("lr_dim7", 11, [0, 3, 6, 9], "late_romantic", "a chill: diminished seventh on the leading note, pulling hard to the tonic"));
  push(make("lr_mM7", isMinorish(key.mode) ? 0 : 5, [0, 3, 7, 11], "late_romantic", "a chill under the sweetness: minor with a major seventh, aching"));
  push(make("lr_neapolitan", 1, [0, 4, 7], "late_romantic", "Neapolitan flat II: grave, tragic, leans to the dominant"));
  return out;
}
function tonicChord(key) {
  return chordCandidates(key)[0];
}
function fitOf(pc, chord, key) {
  const pcs = chordPcs(chord, key);
  const p = mod(pc, 12);
  if (pcs.includes(p)) return "chord_tone";
  if (pcs.some((c) => mod(p - c, 12) === 1)) return "clash";
  return "colour";
}
function intervalName(semitones) {
  const names = ["unison", "minor 2nd", "major 2nd", "minor 3rd", "major 3rd", "4th", "tritone", "5th", "minor 6th", "major 6th", "minor 7th", "major 7th"];
  const s = Math.abs(semitones);
  if (s === 12) return "octave";
  return s > 12 ? `${names[s % 12]} + octave` : names[s];
}
function chordToneName(pc, chord, key) {
  const iv = mod(pc - key.tonic - chord.root, 12);
  const idx = chord.intervals.map((x2) => mod(x2, 12)).indexOf(iv);
  if (idx < 0) return null;
  if (idx === 0) return "root";
  const x = chord.intervals[idx];
  if (x === 3 || x === 4) return "3rd";
  if (x === 2) return "2nd";
  if (x === 5) return "4th";
  if (x === 6 || x === 7 || x === 8) return "5th";
  if (x === 9) return chord.intervals.length === 4 && chord.intervals[2] === 6 ? "7th" : "6th";
  if (x === 10 || x === 11) return "7th";
  if (x === 14) return "9th";
  return "tone";
}
var HARMONIC_LANGUAGE_TEXT = {
  triads: "plain triads; direct and simple",
  sevenths: "seventh chords; fuller, a little jazzy or wistful",
  extended: "ninths and extended chords; warm, open, tender",
  suspended: "suspended chords; unresolved and floating",
  chromatic: "chromatic late-Romantic harmony; dark turns and rich colour"
};

// server/core/line.ts
var q = (x) => Math.round(x * 12) / 12;
var lineLength = (line) => q(line.reduce((s, n) => s + n.dur, 0));
var pitched = (line) => line.filter((n) => n.deg !== null);
function fmtDur(d) {
  const r = Math.round(d * 100) / 100;
  const s = String(r);
  return s.startsWith("0.") ? s.slice(1) : s;
}
function notation(line) {
  return line.map((n) => {
    if (n.deg === null) return `r(${fmtDur(n.dur)})`;
    const oct = Math.floor(n.deg / 7);
    const mark = oct > 0 ? "'".repeat(oct) : ",".repeat(-oct);
    const acc = n.alt ? n.alt > 0 ? "\u266F".repeat(n.alt) : "\u266D".repeat(-n.alt) : "";
    return `${acc}${mod(n.deg, 7) + 1}${mark}(${fmtDur(n.dur)})`;
  }).join(" ");
}
function contourOf(line) {
  const p = pitched(line).map((n) => n.deg);
  if (p.length < 3) return "flat";
  const hi = p.indexOf(Math.max(...p));
  const lo = p.indexOf(Math.min(...p));
  const last = p.length - 1;
  let turns = 0;
  let prev = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.sign(p[i] - p[i - 1]);
    if (d !== 0) {
      if (prev !== 0 && d !== prev) turns++;
      prev = d;
    }
  }
  if (prev === 0) return "flat";
  if (turns >= 3) return "wave";
  if (hi > 0 && hi < last && p[hi] > p[0] && p[hi] > p[last]) return "arch";
  if (lo > 0 && lo < last && p[lo] < p[0] && p[lo] < p[last]) return "valley";
  if (p[last] > p[0]) return "rising";
  if (p[last] < p[0]) return "falling";
  return "wave";
}
function timed(line, key, octaveShift = 0) {
  const out = [];
  let t = 0;
  for (const n of line) {
    if (n.deg !== null) out.push({ midi: degreeToMidi(key, n.deg, n.alt ?? 0) + 12 * octaveShift, t: q(t), dur: n.dur });
    t += n.dur;
  }
  return out;
}
function truncate(line, beats, minDur = 0.25) {
  const out = [];
  let t = 0;
  for (const n of line) {
    if (t >= beats - 1e-9) break;
    const room = q(beats - t);
    if (n.dur <= room + 1e-9) {
      out.push({ ...n });
      t += n.dur;
    } else {
      if (room >= minDur) out.push({ ...n, dur: room });
      t = beats;
    }
  }
  return out;
}
function padTo(line, beats, maxRing = 2) {
  const out = line.map((n) => ({ ...n }));
  let gap = q(beats - lineLength(out));
  if (gap <= 0) return out;
  const last = out[out.length - 1];
  if (last && last.deg !== null) {
    const ring = Math.min(gap, maxRing);
    last.dur = q(last.dur + ring);
    gap = q(gap - ring);
  }
  if (gap > 0) out.push({ deg: null, dur: gap });
  return out;
}
function mergeRests(line) {
  const out = [];
  for (const n of line) {
    const last = out[out.length - 1];
    if (n.deg === null && last && last.deg === null) last.dur = q(last.dur + n.dur);
    else if (n.dur > 0) out.push({ ...n });
  }
  return out;
}

// server/context.ts
var TENSION_LEVELS = [
  "1: still and bare, almost nothing",
  "2: quiet, intimate",
  "3: gently moving",
  "4: warm and full",
  "5: urgent, building",
  "6: intense, near the peak",
  "7: overwhelming, the top of the piece"
];
var AMOUNT_LEVELS = ["none", "a trace", "a little", "moderate", "clear", "strong", "maximum"];
var DYNAMIC_LEVELS = [
  "pp: barely there",
  "p: soft",
  "mp: gentle",
  "mf: full but relaxed",
  "f: strong",
  "ff: very strong",
  "fff: everything"
];
var sigmoid = (x) => 1 / (1 + Math.exp(-x));

// server/piece.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// shared/types.ts
var DYNAMIC_NAMES = ["pp", "p", "mp", "mf", "f", "ff", "fff"];

// server/pack.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
var PACK = join(ROOT, "context-pack");
function readJson(file, fallback) {
  const path = join(PACK, file);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.warn(`[pack] could not read ${file}: ${err.message}`);
    return fallback;
  }
}
var FALLBACK_SHEETS = [
  {
    id: "bittersweet_orchestral",
    name: "Bittersweet orchestral",
    summary: "A slow orchestral cue for piano and strings that starts delicately and builds to one earned arrival, more often still and bright than loud.",
    traits: ["slow compound pulse (12/8 near 70 BPM)", "minor tonal centre with key changes", "warm two-chord opening on major-seventh and ninth chords", "piano and strings at scale", "quiet start to one earned arrival", "dark late turn with chromatic chords", "planned peaks and lulls", "constant development, little exact repetition", "pedal tones", "unresolved phrase endings", "a pause before the arrival"]
  },
  {
    id: "beat_driven",
    name: "Beat-driven",
    summary: "Steady electronic pulse with short motif cells, builds and drops.",
    traits: ["steady 4/4 pulse", "sub bass", "syncopated hats", "short motif cells", "filter builds and drops", "sidechain pump"]
  },
  {
    id: "playful",
    name: "Playful",
    summary: "Light, bright and nimble, with woodwinds and plucked strings.",
    traits: ["bright modes", "pizzicato and staccato", "woodwinds", "bouncing rhythms", "sudden stops", "quick register jumps"]
  }
];
var SLICE = {
  setup: { calls: ["setup"], max: 14 },
  // Every plan-tagged rule fits: at 16 the round robin cut the peak-shaping rules (one main peak, pull back before it).
  plan: { calls: ["plan"], max: 28 },
  plan_revision: { calls: ["plan"], topics: ["scoring_to_picture", "dynamics_pacing", "form", "tension_release", "departure_return"], max: 10 },
  theme_shape: { calls: ["theme_draft"], topics: ["melody", "phrase_structure"], max: 14 },
  theme_note: { calls: ["theme_draft"], topics: ["melody"], max: 12 },
  theme_derive: { calls: ["theme_draft", "phrase_direction"], topics: ["developing_variation", "melody"], max: 10 },
  theme_judge: { calls: ["theme_judge"], max: 16 },
  phrase_direction: { calls: ["phrase_direction"], topics: ["developing_variation", "departure_return", "phrase_structure", "melody", "tension_release", "dynamics_pacing", "harmony", "cadences", "form", "scoring_to_picture"], max: 32 },
  chord_path: { calls: ["phrase_direction", "voice_leading"], topics: ["harmony", "cadences", "tension_release"], max: 22 },
  voice_leading: { calls: ["voice_leading"], topics: ["voice_leading", "harmony"], max: 12 },
  phrase_judge: { calls: ["phrase_judge"], max: 16 },
  orchestration: { calls: ["orchestration"], max: 40 },
  hold: { calls: ["hold"], max: 8 },
  ending: { calls: ["ending"], max: 10 },
  // Scoring a video. These slices are empty unless the pack has scoring-to-picture rules.
  frame_reading: { calls: ["frame_reading"], max: 4 },
  tempo: { calls: ["tempo"], max: 6 },
  fit: { calls: ["fit"], max: 8 },
  live_read: { calls: ["live_read"], max: 6 }
};
var BOOK_SHORT = {};
var Pack = class {
  rules = [];
  sheets = FALLBACK_SHEETS;
  examples = [];
  cache = /* @__PURE__ */ new Map();
  constructor() {
    this.reload();
  }
  reload() {
    this.cache.clear();
    this.rules = readJson("digest.json", { rules: [] }).rules ?? [];
    const picture = readJson("scoring-to-picture.json", { rules: [] }).rules ?? [];
    const modern = readJson("modern.json", { rules: [] }).rules ?? [];
    this.rules = [...picture, ...modern, ...this.rules];
    const sheets = readJson("style-sheets.json", FALLBACK_SHEETS);
    const list = Array.isArray(sheets) ? sheets : sheets.sheets;
    if (list?.length === 3) this.sheets = list;
    this.examples = readJson("worked-examples.json", { examples: [] }).examples ?? [];
    const sources = readJson("books/sources.json", null);
    const books = Array.isArray(sources) ? sources : sources?.books ?? [];
    for (const b of books) {
      const slug = b.slug ?? b.id;
      if (slug && b.author) BOOK_SHORT[slug] = String(b.author).split(",")[0].trim().split(/\s+/).pop();
    }
  }
  sheet(id) {
    return this.sheets.find((s) => s.id === id) ?? FALLBACK_SHEETS.find((s) => s.id === id);
  }
  styleText(id) {
    const s = this.sheet(id);
    return `STYLE   ${s.name}: ${s.summary}
        traits: ${s.traits.join("; ")}${s.avoid?.length ? `
        avoid: ${s.avoid.join("; ")}` : ""}`;
  }
  /** The theory rules one call type is given, in the order they are sent. */
  slice(callType, style) {
    const spec = SLICE[callType];
    if (!spec || !this.rules.length) return [];
    let rules = this.rules.filter((r) => r.calls.some((c) => spec.calls.includes(c)) && (!r.styles || !!style && r.styles.includes(style)));
    if (spec.topics) {
      const order = spec.topics;
      const rank = (r) => r.styles ? -1 : order.indexOf(r.topic);
      rules = rules.filter((r) => !!r.styles || order.includes(r.topic)).sort((a, b) => rank(a) - rank(b));
    }
    const byTopic = /* @__PURE__ */ new Map();
    for (const r of rules) byTopic.set(r.topic, [...byTopic.get(r.topic) ?? [], r]);
    const picked = [];
    for (let i = 0; picked.length < spec.max; i++) {
      let any = false;
      for (const list of byTopic.values()) {
        if (list[i] && picked.length < spec.max) {
          picked.push(list[i]);
          any = true;
        }
      }
      if (!any) break;
    }
    return picked;
  }
  /** Call types that are given theory rules. */
  sliceTypes() {
    return Object.keys(SLICE);
  }
  /** The theory slice for one call type, as a text block for the state. */
  theory(callType, style) {
    const cacheKey = `${callType}:${style ?? ""}`;
    const hit = this.cache.get(cacheKey);
    if (hit !== void 0) return hit;
    let text = "";
    {
      const picked = this.slice(callType, style);
      if (picked.length) {
        text = "THEORY  (from the context pack; follow these when choosing)\n" + picked.map((r) => `        - ${r.text}${r.source ? ` [${BOOK_SHORT[r.source.book] ?? r.source.book}, ${r.source.ref}]` : ""}`).join("\n");
      }
    }
    const ex = this.examples.filter((e) => e.call === callType).slice(0, 3);
    if (ex.length) {
      text += (text ? "\n" : "") + "WORKED EXAMPLES\n" + ex.map((e) => `        - Given: ${e.state} Good choice: ${e.choice}. Why: ${e.reason}`).join("\n");
    }
    this.cache.set(cacheKey, text);
    return text;
  }
};
var pack = new Pack();

// server/piece.ts
var I = (id, name, range, character, arts, synth = false) => ({ id, name, range, character, arts, synth });
var INSTRUMENTS = Object.fromEntries(
  [
    I("piano", "Grand piano", [21, 108], "clear, intimate, percussive attack that decays; carries melody or arpeggios", ["sustain"]),
    I("violins", "First violins", [55, 98], "singing, bright on top, the natural melody section", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("violins2", "Second violins", [55, 91], "warm inner support below the firsts", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("violas", "Violas", [48, 84], "dusky, veiled middle voice", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("celli", "Celli", [36, 74], "rich tenor voice, ardent when it sings high", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("basses", "Double basses", [28, 55], "deep foundation, weight", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("solo_violin", "Solo violin", [55, 98], "a single fragile, personal voice", ["sustain", "staccato", "tremolo", "pizzicato"]),
    I("flute", "Flute", [60, 96], "pure and airy, cool low, brilliant high", ["sustain", "staccato"]),
    I("oboe", "Oboe", [58, 88], "plaintive, reedy, penetrating", ["sustain", "staccato"]),
    I("clarinet", "Clarinet", [50, 89], "smooth and mellow, playful when staccato", ["sustain", "staccato"]),
    I("horn", "French horn", [41, 74], "noble, round, distant warmth", ["sustain", "staccato"]),
    I("harp", "Harp", [31, 100], "plucked shimmer, arpeggios and glints", ["sustain"]),
    I("timpani", "Timpani", [40, 57], "pitched thunder, rolls and strokes", ["hit", "roll"]),
    I("bass_drum", "Orchestral bass drum", [36, 36], "a deep impact", ["hit"]),
    I("cymbal", "Cymbals", [49, 49], "crash or swelling roll", ["hit", "roll"]),
    I("tam_tam", "Tam-tam", [52, 52], "dark metallic wash", ["hit"]),
    I("drumkit", "Drum kit", [36, 51], "kick, snare, hi-hats, toms and cymbals: the beat itself in pop, hip-hop, funk and dance music", ["hit"]),
    I("celesta", "Celesta", [60, 108], "small bells, childlike sparkle", ["sustain"]),
    I("glockenspiel", "Glockenspiel", [72, 108], "bright metal sparkle on top", ["sustain"]),
    I("vibraphone", "Vibraphone", [53, 89], "soft glowing metal, cool", ["sustain"]),
    I("sub", "Sub bass (sine)", [24, 48], "pure low weight, felt more than heard", ["sustain"], true),
    I("pad", "Synth pad", [36, 84], "slow, smooth electronic bed", ["sustain"], true),
    I("pluck", "Pluck synth", [36, 96], "short bright electronic pluck", ["staccato"], true),
    I("kick808", "Electronic kick (808)", [36, 36], "round low electronic thump; with a drum kit in the palette, the kit plays snare and hats around it", ["hit"], true),
    I("noise", "Water and wave texture", [60, 60], "filtered noise with a slow swell: water, air", ["sustain"], true),
    // The sounds of pop, dance and hip-hop production. Offered to beat-driven pieces only.
    I("keys", "Electric piano", [36, 96], "warm, glassy electric piano: the chords and fills of pop, R&B and neo-soul", ["sustain", "staccato"], true),
    I("lead", "Synth lead", [48, 96], "a bright, cutting synth lead: the voice that carries a hook in pop and dance music", ["sustain", "staccato"], true),
    I("supersaw", "Supersaw stack", [36, 91], "a wide wall of detuned saw waves: the huge chords of a dance-pop chorus", ["sustain", "staccato"], true),
    I("synth_bass", "Synth bass", [24, 60], "a punchy, buzzy synth bass with bite: funk, electro and pop bass lines that move", ["sustain", "staccato"], true),
    I("bell", "Bell synth", [60, 108], "a glassy digital bell: sparkling hooks and answers on top, as in trap and pop", ["sustain"], true),
    I("brass", "Synth brass", [43, 86], "punchy synth brass: stabs and riffs, the horn section of funk and eighties pop", ["sustain", "staccato"], true)
  ].map((i) => [i.id, i])
);
var MODERN_SOUNDS = ["keys", "lead", "supersaw", "synth_bass", "bell", "brass"];
var BEAT_SOUNDS = [...MODERN_SOUNDS, "sub", "pad", "pluck", "kick808", "noise", "drumkit", "piano"];
var offeredTo = (style, id) => style === "beat_driven" ? BEAT_SOUNDS.includes(id) : !MODERN_SOUNDS.includes(id);
var ROLE_INSTRUMENTS = {
  melody: ["piano", "solo_violin", "violins", "flute", "oboe", "clarinet", "pluck", "celesta", "glockenspiel", "vibraphone", "lead", "keys", "bell", "brass"],
  counter: ["celli", "violas", "horn", "clarinet", "violins2", "oboe", "flute", "vibraphone", "keys", "brass", "bell", "lead"],
  inner: ["violas", "violins2", "pad", "piano", "horn", "keys", "supersaw", "brass"],
  bass: ["basses", "celli", "piano", "sub", "synth_bass"],
  pedal: ["basses", "celli", "piano", "horn", "sub", "synth_bass"],
  figuration: ["piano", "harp", "violins2", "violas", "pluck", "celesta", "keys", "bell"],
  texture: ["noise", "violins", "pad", "cymbal", "supersaw"],
  pulse: ["drumkit", "kick808", "timpani"],
  accents: ["bass_drum", "cymbal", "timpani", "piano", "tam_tam", "drumkit"]
};
var availableCache = null;
function availableInstruments() {
  if (availableCache) return availableCache;
  const out = new Set(Object.values(INSTRUMENTS).filter((i) => i.synth).map((i) => i.id));
  const file = join2(ROOT, "assets/samples/manifest.json");
  if (existsSync2(file)) {
    try {
      const manifest = JSON.parse(readFileSync2(file, "utf8"));
      for (const id of Object.keys(manifest.instruments ?? {})) {
        if (INSTRUMENTS[id]) out.add(id);
        const inst = INSTRUMENTS[id];
        const sampled = manifest.instruments[id].range;
        if (inst && Array.isArray(sampled) && sampled.length === 2 && sampled[1] > sampled[0]) {
          const lo = Math.max(inst.range[0], sampled[0] - 2);
          const hi = Math.min(inst.range[1], sampled[1] + 3);
          if (hi - lo >= 12) inst.range = [lo, hi];
        }
        const arts = Object.keys(manifest.instruments[id].articulations ?? {});
        if (inst && arts.length) {
          const has = (a) => arts.includes(a);
          inst.arts = inst.arts.filter((a) => has(a) || a === "staccato" && has("spiccato") || a === "tremolo" && has("sustain") || a === "pizzicato" && (has("staccato") || has("spiccato")) || a === "sustain" && arts.length > 0);
          if (id === "violins" && INSTRUMENTS.violins2) {
            INSTRUMENTS.violins2.arts = inst.arts.slice();
            INSTRUMENTS.violins2.range = [inst.range[0], Math.min(INSTRUMENTS.violins2.range[1], inst.range[1])];
          }
          if (!inst.arts.length) inst.arts = arts;
        }
      }
      if (out.has("violins")) out.add("violins2");
      availableCache = out;
      return out;
    } catch {
    }
  }
  for (const i of Object.values(INSTRUMENTS)) if (!["celesta", "glockenspiel", "vibraphone", "tam_tam"].includes(i.id)) out.add(i.id);
  return out;
}
var GROOVES = {
  house: {
    label: "house",
    bpm: 124,
    patterns: ["four_on_floor", "half_time", "syncopated"],
    text: "house and dance: a four-on-the-floor kick at 118 to 128 BPM, open hats off the beat, long filter builds and drops"
  },
  boom_bap: {
    label: "boom-bap",
    bpm: 90,
    patterns: ["boom_bap", "half_time", "backbeat"],
    text: "boom-bap hip-hop: 82 to 96 BPM, heavy swung drums, kick and snare trading blows with space between, a short looped motif"
  },
  trap: {
    label: "trap",
    bpm: 140,
    patterns: ["trap", "half_time", "syncopated"],
    text: "trap and modern rap: 130 to 150 BPM felt in half time, the snare on beat three, fast hi-hats with rolls, long 808 bass notes that hit with the kick"
  },
  funk: {
    label: "funk",
    bpm: 104,
    patterns: ["funk", "backbeat", "syncopated"],
    text: "funk: 95 to 115 BPM, sixteenth-note hats, kick and bass locked in a syncopated figure, ghost notes on the snare, everything pointing at beat one"
  },
  // Smooth beats are the centre of this style. Chart pop was tried and dropped: its sound needs vocals and production we do not have.
  lofi: {
    label: "lo-fi",
    bpm: 80,
    patterns: ["boom_bap", "half_time", "backbeat"],
    text: "lo-fi and chill beats: 70 to 90 BPM, soft swung drums that sit back, mellow electric-piano chords with sevenths and ninths, a warm round bass, a short unhurried motif, everything gentle and a little hazy"
  }
};
var PHRASE_BARS = 4;
var ARRIVAL_TEXT = {
  swell: "no break: the peak simply arrives at the top of a long crescendo, with the pulse carrying straight through. Continuous and gentle; for pieces that should never shock",
  hit: "a hit: one accented blow lands on top of the same texture, which then carries on as before. A landmark, not a change of state",
  open_wall: "a held breath, then the wall: everything stops for an instant, then the pulse and figuration fall away and the whole ensemble opens into one sustained wall of sound, at full volume with the filter fully open. Overwhelming force: for pieces that are vast, triumphant or tragic",
  broaden: "the same held breath and wall of sound, and the tempo also broadens at the arrival, so the peak feels vast and slowed, time stretching",
  bloom: "a held breath, then a clearing: the motion stops and the music opens out, bright and still. Pulse, figuration and counter-lines fall away; the melody sings slow and high on one or two instruments over long held chords, the filter fully open, only a little louder than before. Awe through stillness and light, not through force: gentle, serene, the feeling of the piece settling in",
  drop: "the drop: the beat thins to almost nothing for a bar, a breath of silence, then kick, bass and every layer slam back in together at full weight with the filter wide open"
};
var arrivalsFor = (style, groove) => groove === "lofi" ? ["swell", "hit"] : style === "beat_driven" ? ["swell", "hit", "drop"] : ["swell", "hit", "bloom", "open_wall", "broaden"];
var arrivesAfterBreath = (a) => a === "open_wall" || a === "broaden" || a === "drop" || a === "bloom";
var CLIMAX_THEME_TEXT = {
  returns: "the main theme returns whole and plainly recognisable: the moment everything before was leading to, a homecoming",
  broadened: "the main theme returns at half speed, in long notes over the whole phrase: the same tune made vast and grave",
  continues: "no return: the climax is the furthest point of the development, the theme still in pieces"
};
var ARRIVAL_LABEL = {
  swell: "swell, no break",
  hit: "a hit",
  open_wall: "held breath, then the wall",
  broaden: "held breath, wall, tempo broadens",
  bloom: "held breath, then a still, bright clearing",
  drop: "the drop"
};
var isWall = (a) => a === "open_wall" || a === "broaden";
var PART_TEXT = {
  intro: "intro: sets up the groove and teases the hook, thin, before the song proper begins",
  verse: "verse: the groove settles and the texture stays lean; the hook is held back or only hinted at",
  prechorus: "pre-chorus: a short lift that builds toward the chorus, energy rising, something held back",
  chorus: "chorus: the hook, whole, in the fullest texture so far. The same music every time it comes back; what the listener waits for",
  bridge: "bridge or breakdown: a contrast: the beat thins or drops away and new material appears, so the last chorus lands fresh",
  outro: "outro: the groove winds down, layers leaving one by one"
};
var PART_ROLE = { intro: "statement", verse: "development", prechorus: "development", chorus: "return", bridge: "departure", outro: "coda" };
var Piece = class {
  constructor(prompt, mood) {
    this.prompt = prompt;
    this.mood = mood;
  }
  prompt;
  mood;
  rules;
  plan;
  themes = [];
  phrases = [];
  /** Inner voices at the end of the last accepted phrase. */
  voices = [];
  lastChord = null;
  lastReject = "";
  endingPlan = null;
  /** Per-phrase overrides: the broadened climax sets the tempo of one phrase; fitting music to picture sets all three. */
  phraseBars = /* @__PURE__ */ new Map();
  phraseBpm = /* @__PURE__ */ new Map();
  /** Seconds of held chord appended to a phrase so the music lands on a cut. */
  phraseHoldSec = /* @__PURE__ */ new Map();
  picture = null;
  /** Lines added to every state before any music exists (the clip timeline, when scoring a video). */
  preludeLines = [];
  /** How many bars the theme fills: Drex's choice when the theme is shaped. */
  themeBars = 2;
  /** The beats one theme fills. */
  get unitBeats() {
    return this.themeBars * this.rules.meter.beatsPerBar;
  }
  /** Where the second half of a phrase's melody begins. A five-bar phrase is four bars with its close prolonged; a six-bar phrase says its first idea twice. */
  segStart(phrase) {
    const bars = this.barsOf(phrase);
    return (bars === 6 ? 4 : bars === 5 ? 2 : Math.ceil(bars / 2)) * this.rules.meter.beatsPerBar;
  }
  /** The chorus this phrase belongs to (beat-driven pieces): which chorus it is, and the phrase of the first chorus it repeats. */
  chorusAt(phrase) {
    if (!this.plan || phrase < 0 || phrase >= this.plan.totalPhrases) return null;
    const runs = [];
    this.plan.sections.forEach((s, i, all) => {
      if (s.part !== "chorus") return;
      if (i > 0 && all[i - 1].part === "chorus") runs[runs.length - 1].last = s.last;
      else runs.push({ first: s.first, last: s.last });
    });
    const n = runs.findIndex((r) => phrase >= r.first && phrase <= r.last);
    if (n < 0) return null;
    const span = runs[0].last - runs[0].first + 1;
    return { n: n + 1, of: runs.length, first: n === 0, source: n === 0 ? null : runs[0].first + (phrase - runs[n].first) % span, starts: phrase === runs[n].first };
  }
  /** Nominal phrase length in seconds at the base tempo. */
  get phraseSec() {
    return PHRASE_BARS * this.rules.meter.beatsPerBar * 60 / this.rules.bpm;
  }
  barsOf(phrase) {
    return this.phraseBars.get(phrase) ?? PHRASE_BARS;
  }
  bpmOf(phrase) {
    return this.phraseBpm.get(phrase) ?? this.rules.bpm;
  }
  beatsOf(phrase) {
    return this.barsOf(phrase) * this.rules.meter.beatsPerBar;
  }
  /** Half a phrase: where its second half begins. */
  halfOf(phrase) {
    return Math.ceil(this.barsOf(phrase) / 2) * this.rules.meter.beatsPerBar;
  }
  get grid() {
    return this.rules.meter.sub === 3 ? 1 / 3 : 0.5;
  }
  theme(id) {
    return this.themes.find((t) => t.id === id);
  }
  get mainTheme() {
    return this.themes[0];
  }
  sectionOf(phrase) {
    return this.plan.sections.find((s) => phrase >= s.first && phrase <= s.last) ?? this.plan.sections[this.plan.sections.length - 1];
  }
  /** The role of one phrase: the section's role, refined by position. */
  roleOf(phrase) {
    const s = this.sectionOf(phrase);
    if (phrase === this.plan.climaxPhrase) return "climax";
    if (s.part === "chorus") return "return";
    if (this.plan.restate && phrase === 1 && s.index === 0 && s.last >= 1) return "return";
    if (phrase === this.plan.totalPhrases - 1 && s.role !== "departure") return "coda";
    if (s.role === "statement" || s.role === "return") return phrase === s.first ? s.role : "development";
    if (s.role === "climax") return "development";
    return s.role;
  }
  /** Target tension for a phrase, easing toward the next section across the section. */
  tensionOf(phrase) {
    const s = this.sectionOf(phrase);
    const cue = this.picture?.(phrase);
    const lift = cue ? (cue.movement - 4) * 0.35 + (cue.peak ? (cue.peak.strength - 4) * 0.2 : 0) : 0;
    const bound = (t) => Math.round(Math.min(7, Math.max(1, t + lift)) * 10) / 10;
    if (phrase === this.plan.climaxPhrase) return bound(cue ? s.tension + 0.5 : Math.max(s.tension, 6));
    const next = this.plan.sections[s.index + 1];
    const span = s.last - s.first + 1;
    if (!next || span <= 1) return bound(s.tension);
    const x = (phrase - s.first) / span;
    return bound(s.tension + (next.tension - s.tension) * x * 0.5);
  }
  phrasesSinceThemeIntact() {
    for (let i = this.phrases.length - 1; i >= 0; i--) {
      if (this.phrases[i].themeIntact) return this.phrases.length - i;
    }
    return this.phrases.length;
  }
  // ───────────────────────────── State text ─────────────────────────────
  pieceLine() {
    const r = this.rules;
    const mins = Math.floor(r.lengthSec / 60);
    const secs = String(Math.round(r.lengthSec % 60)).padStart(2, "0");
    return `PIECE   style: ${pack.sheet(r.style).name}; ${r.meter.id}, ${r.bpm} BPM, ${keyName(r.key)}, ${r.soundWorld.replace(/_/g, " ")}, ${mins}:${secs}; harmony: ${HARMONIC_LANGUAGE_TEXT[r.harmonicLanguage]}${r.groove ? `; groove: ${GROOVES[r.groove].text}` : ""}`;
  }
  planLine() {
    const p = this.plan;
    const deps = p.sections.filter((s) => s.departure).map((s) => s.index + 1);
    return `PLAN    ${p.sections.length} sections, ${p.sections.some((s) => s.part) ? `parts ${p.sections.map((s) => s.part ?? s.role).join(" / ")}` : `roles ${p.sections.map((s) => s.role).join(" / ")}`}; tension ${p.sections.map((s) => s.tension).join(" ")} (1 calm \u2026 7 overwhelming); departure = ${deps.length ? deps.join(", ") : "none"}; climax = phrase ${p.climaxPhrase + 1} (section ${this.sectionOf(p.climaxPhrase).index + 1}), arriving as ${ARRIVAL_LABEL[p.climaxArrival ?? "hit"]}${p.climaxTheme === "returns" ? ", with the main theme returning whole" : p.climaxTheme === "broadened" ? ", with the main theme returning at half speed" : ""}; ending: ${this.rules.ending.replace(/_/g, " ")}`;
  }
  themeLines() {
    return this.themes.map((t) => `THEME ${t.id} ${notation(t.line)}   contour: ${t.contour}${t.kind !== "main" ? `   (${t.kind}${t.derivation ? `: ${t.derivation}` : ""})` : ""}`).join("\n");
  }
  lastFour() {
    const last = this.phrases.slice(-4);
    if (!last.length) return "LAST 4  (none yet: this is the first phrase)";
    return "LAST 4  " + last.map((p) => `phrase ${p.index + 1} [${p.role}] ${notation(p.line)} | chords ${p.score.display.chords.join(" ")} | = ${p.lineage}`).join("\n        ");
  }
  mixLine() {
    const last = this.phrases[this.phrases.length - 1];
    if (!last) return "MIX     (silence: nothing has played yet)";
    const layers = last.layers.filter((l) => l.inst).map((l) => `${l.role}: ${INSTRUMENTS[l.inst]?.name ?? l.inst} ${DYNAMIC_NAMES[l.dynamics]}${l.art && l.art !== "sustain" ? ` ${l.art}` : ""}`);
    const pitches = last.score.notes.filter((n) => n.inst !== "noise" && n.layer !== "pulse" && n.layer !== "accents").map((n) => n.midi);
    const lo = pitches.length ? Math.floor(Math.min(...pitches) / 12) - 1 : 0;
    const hi = pitches.length ? Math.floor(Math.max(...pitches) / 12) - 1 : 0;
    return `MIX     ${layers.join(", ") || "nothing"}; registers ${lo}-${hi} occupied; overall ${DYNAMIC_NAMES[last.mix.dynamics]}`;
  }
  /** State for the setup and plan calls, before any music exists. */
  preludeState(callType, extra = []) {
    const lines = [`PROMPT  "${this.prompt}"`];
    if (this.rules) lines.push(this.pieceLine(), pack.styleText(this.rules.style));
    lines.push(...this.preludeLines, ...extra);
    const theory = pack.theory(callType, this.rules?.style);
    if (theory) lines.push(theory);
    return lines.join("\n");
  }
  /** The full state block for calls made while composing phrase `phrase`. */
  state(callType, phrase, extra = []) {
    const s = this.sectionOf(phrase);
    const lines = [
      `PROMPT  "${this.prompt}"`,
      this.pieceLine(),
      pack.styleText(this.rules.style),
      this.planLine(),
      `NOW     section ${s.index + 1}, phrase ${phrase + 1} of ${this.plan.totalPhrases}, role: ${this.roleOf(phrase)}${s.part ? `, song part: ${s.part}${this.chorusAt(phrase) ? ` ${this.chorusAt(phrase).n} of ${this.chorusAt(phrase).of}` : ""}` : ""}, target tension ${this.tensionOf(phrase)}, key ${keyName(s.key)}`,
      this.themeLines(),
      this.lastFour()
    ];
    const last = this.phrases[this.phrases.length - 1];
    if (last) lines.push(`LINEAGE phrase ${last.index + 1} = ${last.lineage}`);
    lines.push(`SINCE   theme intact: ${this.phrases.length ? `${this.phrasesSinceThemeIntact()} phrases ago` : "not yet stated"}`);
    lines.push(this.mixLine());
    if (this.lastReject) lines.push(`REJECTS last round: "${this.lastReject}"`);
    const cue = this.picture?.(phrase);
    if (cue) lines.push(...cue.lines);
    lines.push(...extra);
    const theory = pack.theory(callType, this.rules?.style);
    if (theory) lines.push(theory);
    return lines.filter(Boolean).join("\n");
  }
};

// server/calls/ending.ts
var opt = (key, label, criteria, prior = 0) => ({ key, label, criteria, prior });
function startHold(after) {
  return { notes: after.score.holdChord.map((n) => ({ ...n })), mix: { ...after.mix }, history: [], startedAt: Date.now() };
}
async function holdStep(ctx, hold, after) {
  const { piece, gw } = ctx;
  const key = after.key;
  const chord = after.slots[after.slots.length - 1].chord;
  const pcs = chordPcs(chord, key);
  const sorted = hold.notes.slice().sort((a, b) => a.midi - b.midi);
  const top = sorted[sorted.length - 1];
  const bottom = sorted[0];
  const recent = (k) => hold.history.slice(-2).includes(k) ? -1.6 : hold.history.includes(k) ? -0.5 : 0;
  const seconds = Math.round((Date.now() - hold.startedAt) / 1e3);
  let above = top.midi + 1;
  while (!pcs.includes(mod(above, 12))) above++;
  const canAdd = hold.notes.length < 7 && above <= INSTRUMENTS[top.inst].range[1];
  const canDrop = hold.notes.length > 3;
  const canDeepen = bottom.midi - 12 >= INSTRUMENTS[bottom.inst].range[0];
  const strings = hold.notes.some((n) => INSTRUMENTS[n.inst].arts.includes("tremolo") && n.art !== "tremolo");
  const loud = Math.max(...hold.notes.map((n) => n.vel));
  const options = [
    ...canAdd ? [opt("add_voice_above", "add a voice above", `add ${midiName(above, key)} above the top voice: the chord opens upward, brighter`, 0.9 + recent("add_voice_above"))] : [],
    ...canDrop ? [opt("drop_voice", "drop a voice", "let a middle voice fall away: thinner, more fragile", 0.5 + recent("drop_voice"))] : [],
    opt("swell", "swell", "swell: every voice grows louder, as if drawing breath", (loud < 0.6 ? 0.9 : -0.8) + recent("swell")),
    opt("fade", "fade", "fade: every voice recedes", (loud > 0.3 ? 0.6 : -1) + recent("fade")),
    opt("open_filter", "open the filter", "open the low-pass filter: the sound surfaces, clearer and brighter", (hold.mix.lowpass < 6 ? 0.7 : -3) + recent("open_filter")),
    opt("close_filter", "close the filter", "close the low-pass filter: the sound sinks under water", (hold.mix.lowpass > 1 ? 0.5 : -3) + recent("close_filter")),
    opt("revoice_up", "revoice upward", "the lowest inner voice moves up an octave: the same chord in a lighter spacing", 0.6 + recent("revoice_up")),
    ...strings ? [opt("shimmer", "tremolo shimmer", "the upper voices break into tremolo: the stillness starts to tremble", 0.6 + recent("shimmer"))] : [],
    ...canDeepen ? [opt("deepen", "deepen the bass", "the bass drops an octave: more gravity under the chord", 0.5 + recent("deepen"))] : []
  ];
  const ans = await gw.ask({
    callType: "hold",
    title: "Hold: how the sustain evolves",
    state: piece.state("hold", after.index + 1, [
      `HOLD    playback is holding after phrase ${after.index + 1} while drafts are rejected and redrawn; held for ${seconds} s`,
      `SOUNDING ${sorted.map((n) => `${midiName(n.midi, key)} ${INSTRUMENTS[n.inst].name}${n.art !== "sustain" ? ` ${n.art}` : ""}`).join(", ")}`,
      `SO FAR  ${hold.history.length ? hold.history.join(", ") : "nothing yet"}`
    ]),
    questions: [{
      id: "evolve",
      type: "choice",
      label: "How the hold evolves",
      instructions: "The last chord is being held. How should the sustain change next? It must keep evolving and never loop.",
      options
    }],
    picking: "top",
    // Playback is waiting on this answer; it goes ahead of queued drafting calls.
    priority: true
  });
  const action = ans.picks[0].evolve;
  hold.history.push(action);
  let notes = hold.notes.map((n) => ({ ...n }));
  const mix = {};
  const bump = (v, d) => clamp(v + d, 0, 6);
  switch (action) {
    case "add_voice_above":
      notes.push({ ...top, midi: above, vel: top.vel * 0.9 });
      break;
    case "drop_voice": {
      const mid = notes.slice().sort((a, b) => a.midi - b.midi)[Math.floor(notes.length / 2)];
      notes = notes.filter((n) => n !== mid && !(n.midi === mid.midi && n.inst === mid.inst));
      break;
    }
    case "swell":
      notes = notes.map((n) => ({ ...n, vel: clamp(n.vel * 1.3, 0.1, 0.8) }));
      break;
    case "fade":
      notes = notes.map((n) => ({ ...n, vel: clamp(n.vel * 0.72, 0.1, 0.8) }));
      break;
    case "open_filter":
      mix.lowpass = bump(hold.mix.lowpass, 1);
      break;
    case "close_filter":
      mix.lowpass = bump(hold.mix.lowpass, -1);
      break;
    case "revoice_up": {
      const inner = notes.slice().sort((a, b) => a.midi - b.midi)[1] ?? notes[0];
      inner.midi = Math.min(inner.midi + 12, INSTRUMENTS[inner.inst].range[1]);
      break;
    }
    case "shimmer": {
      const upper = notes.slice().sort((a, b) => b.midi - a.midi).filter((n) => INSTRUMENTS[n.inst].arts.includes("tremolo")).slice(0, 2);
      for (const n of upper) n.art = "tremolo";
      break;
    }
    case "deepen":
      notes.push({ ...bottom, midi: bottom.midi - 12, vel: bottom.vel * 0.9 });
      break;
  }
  hold.notes = notes;
  Object.assign(hold.mix, mix);
  const label = options.find((o) => o.key === action).label;
  return { action, label, notes, mix, overSec: 2.5 };
}
async function chooseEnding(ctx, phrase) {
  const { piece, gw } = ctx;
  const { ending, style } = piece.rules;
  const m = piece.mood;
  const ans = await gw.ask({
    callType: "ending",
    title: "Ending: how the piece closes",
    state: piece.state("ending", phrase, [`ENDING  the rules set at the start say the piece ends: ${ending.replace(/_/g, " ")}`]),
    questions: [
      {
        id: "slow_down",
        type: "choice",
        label: "Slowing down",
        instructions: "How should the tempo behave in the final bars?",
        options: [
          opt("none", "in tempo", "in tempo to the last note: matter-of-fact, or a clean cut", ending === "sudden_stop" ? 2.5 : style === "beat_driven" ? 1.2 : 0),
          opt("slight", "slight", "a slight easing over the last bar: a natural breath", ending === "fade" ? 1 : 0.8),
          opt("broad", "broad", "a broad slowing across the last two bars: weight, finality or reluctance", ending === "resolved" || ending === "suspended" ? 1.1 + (1 - m.energy) * 0.6 : -0.5)
        ]
      },
      {
        id: "final_gesture",
        type: "choice",
        label: "Final gesture",
        instructions: "What should be left sounding in the last bar?",
        options: [
          opt("full", "full texture", "everything that is playing: a full close", ending === "sudden_stop" ? 1.5 : 0.6 + m.size * 0.6),
          opt("melody_and_bass", "melody and bass", "only melody and bass: the outline of the piece, bare", 0.6),
          opt("melody_alone", "melody alone", "the melody alone: a single voice has the last word", ending === "suspended" ? 1.1 : 0.4 + (1 - m.size) * 0.6)
        ]
      },
      {
        id: "linger",
        type: "choice",
        label: "Last chord",
        instructions: "How long should the last sound be held?",
        options: [
          opt("short", "short", "short: it ends and is gone", ending === "sudden_stop" ? 3 : 0),
          opt("bar", "one extra bar", "held for an extra bar", 1),
          opt("long", "two extra bars", "held for two extra bars: a long fermata", ending === "suspended" || ending === "fade" ? 1.2 : 0.6)
        ]
      },
      {
        id: "final_dynamic",
        type: "score",
        label: "Final dynamic",
        instructions: "How loud is the very end?",
        levels: DYNAMIC_LEVELS,
        prior: ending === "sudden_stop" ? 4.5 : ending === "fade" ? 0.5 : ending === "suspended" ? 1.2 : 2 + m.size * 2,
        spread: 0.7
      }
    ],
    picking: "top"
  });
  piece.endingPlan = ans.picks[0];
}
function linger(score, extra) {
  if (extra <= 0) return;
  const end = score.beats;
  for (const n of score.notes) {
    const sustains = n.art === "sustain" || n.art === "tremolo";
    if (sustains && n.layer !== "pulse" && Math.abs(n.t + n.dur - end) < 0.02) n.dur += extra;
  }
  score.beats = end + extra;
}
function applyEnding(ctx, record) {
  const { piece } = ctx;
  const plan = piece.endingPlan ?? { slow_down: "slight", final_gesture: "full", linger: "bar", final_dynamic: "2" };
  const score = record.score;
  const bar = score.beatsPerBar;
  const end = score.beats;
  const lastBar = end - bar;
  const ending = piece.rules.ending;
  score.final = true;
  if (plan.final_gesture !== "full") {
    const keep = plan.final_gesture === "melody_alone" ? ["melody"] : ["melody", "bass"];
    score.notes = score.notes.filter((n) => n.t < lastBar - 1e-6 || keep.includes(n.layer));
    for (const n of score.notes) if (!keep.includes(n.layer) && n.t + n.dur > lastBar) n.dur = Math.max(0.25, lastBar - n.t);
  }
  const target = 0.2 + Number(plan.final_dynamic) * 0.118;
  for (const n of score.notes) {
    if (n.t >= lastBar - 1e-6) n.vel = clamp(n.vel * 0.4 + target * 0.6, 0.05, 1);
  }
  if (ending === "sudden_stop") {
    const cut = lastBar + 1;
    score.notes = score.notes.filter((n) => n.t < cut - 1e-6);
    for (const n of score.notes) if (n.t + n.dur > cut) n.dur = cut - n.t;
    score.cutAtBeat = cut;
    score.pedal.push({ t: cut, down: false });
    return;
  }
  const extra = plan.linger === "long" ? 2 * bar : plan.linger === "bar" ? bar : 0;
  linger(score, extra);
  if (plan.slow_down !== "none") {
    score.ritardando = plan.slow_down === "broad" ? { fromBeat: end - 2 * bar, toBpm: Math.round(score.bpm * 0.6) } : { fromBeat: lastBar, toBpm: Math.round(score.bpm * 0.8) };
  }
  if (ending === "fade") score.fadeOut = { fromBeat: Math.max(0, end - 2 * bar), toBeat: score.beats };
  score.pedal.push({ t: score.beats, down: false });
}

// server/core/transform.ts
var mapPitch = (line, f) => {
  let i = 0;
  return line.map((n) => n.deg === null ? { ...n } : { ...n, deg: f(n.deg, i++) });
};
function reinterval(line, f) {
  const p = pitched(line);
  if (p.length < 2) return line.map((n) => ({ ...n }));
  const intervals = p.slice(1).map((n, i) => n.deg - p[i].deg);
  const next = intervals.map(f);
  const degs = [p[0].deg];
  for (const iv of next) degs.push(degs[degs.length - 1] + iv);
  return mapPitch(line, (_d, i) => degs[i]);
}
function head(line, count) {
  const out = [];
  let seen = 0;
  for (const n of line) {
    if (n.deg !== null) seen++;
    if (seen > count) break;
    out.push({ ...n });
  }
  return out;
}
function tail(line, count) {
  const out = [];
  let seen = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    const n = line[i];
    if (n.deg === null && seen === 0) continue;
    if (n.deg !== null) seen++;
    if (seen > count) break;
    out.unshift({ ...n });
  }
  return out;
}
var sequence = (steps, name) => ({
  id: `seq_${steps > 0 ? "up" : "down"}_${Math.abs(steps) === 1 ? "step" : "third"}`,
  label: `Sequence ${steps > 0 ? "up" : "down"} a ${name}`,
  phrase: `sequenced ${steps > 0 ? "up" : "down"} a ${name}`,
  effect: steps > 0 ? "same shape, higher: climbing momentum" : "same shape, lower: sinking momentum",
  apply: (line) => mapPitch(line, (d) => d + steps)
});
var MELODIC_OPS = [
  sequence(1, "step"),
  sequence(2, "third"),
  sequence(-1, "step"),
  sequence(-2, "third"),
  {
    id: "inversion",
    label: "Inversion",
    phrase: "inverted",
    effect: "intervals flipped: familiar but questioning",
    apply: (line) => {
      const p = pitched(line);
      if (!p.length) return line;
      const axis = p[0].deg;
      return mapPitch(line, (d) => 2 * axis - d);
    }
  },
  {
    id: "retrograde",
    label: "Retrograde",
    phrase: "played backwards",
    effect: "backwards: a distant echo",
    apply: (line) => mergeRests(line.slice().reverse().map((n) => ({ ...n })))
  },
  {
    id: "augmentation",
    label: "Augmentation",
    phrase: "augmented (twice as slow)",
    effect: "twice as slow: weight, calm",
    apply: (line) => line.map((n) => ({ ...n, dur: q(n.dur * 2) }))
  },
  {
    id: "diminution",
    label: "Diminution",
    phrase: "diminished (twice as fast)",
    effect: "twice as fast: urgency, decoration",
    apply: (line, ctx) => line.map((n) => ({ ...n, dur: Math.max(ctx.grid / 2, q(n.dur / 2)) }))
  },
  {
    id: "fragment_head",
    label: "Fragmentation (opening notes)",
    phrase: "fragmented to its opening",
    effect: "two or three notes only: tension, unfinished",
    apply: (line) => head(line, pitched(line).length <= 3 ? 2 : 3)
  },
  {
    id: "fragment_tail",
    label: "Fragmentation (closing notes)",
    phrase: "fragmented to its close",
    effect: "only the last two or three notes: tension, an ending without its beginning",
    apply: (line) => tail(line, pitched(line).length <= 3 ? 2 : 3)
  },
  {
    id: "liquidation",
    label: "Liquidation",
    phrase: "liquidated",
    effect: "stripped to its barest feature: dissolving, preparing change",
    apply: (line) => {
      const p = pitched(line);
      if (p.length < 2) return line.map((n) => ({ ...n }));
      const [a, b] = p;
      return [
        { deg: a.deg, dur: a.dur },
        { deg: b.deg, dur: b.dur },
        { deg: b.deg, dur: b.dur },
        { deg: b.deg, dur: q(b.dur * 2) }
      ];
    }
  },
  {
    id: "extension",
    label: "Extension",
    phrase: "tail extended",
    effect: "runs past its expected end: delay, longing",
    apply: (line) => {
      const out = line.map((n) => ({ ...n }));
      while (out.length && out[out.length - 1].deg === null) out.pop();
      const p = pitched(out);
      if (p.length < 2) return out;
      const last = out[out.length - 1];
      const before = p[p.length - 2];
      const dir = Math.sign(last.deg - before.deg) || -1;
      const longDur = last.dur;
      const shortDur = Math.max(before.dur, 0.5);
      last.dur = q(Math.min(longDur, shortDur));
      out.push({ deg: last.deg + dir, dur: q(shortDur) });
      out.push({ deg: last.deg + 2 * dir, dur: q(longDur) });
      return out;
    }
  },
  {
    id: "expand",
    label: "Interval expansion",
    phrase: "leaps widened",
    effect: "leaps widened: reaching, intensity",
    apply: (line) => {
      const p = pitched(line);
      const intervals = p.slice(1).map((n, i) => n.deg - p[i].deg);
      const hasLeap = intervals.some((iv) => Math.abs(iv) >= 2);
      const biggest = Math.max(0, ...intervals.map(Math.abs));
      let done = false;
      return reinterval(line, (iv) => {
        if (hasLeap) return Math.abs(iv) >= 2 ? iv + Math.sign(iv) : iv;
        if (!done && Math.abs(iv) === biggest && iv !== 0) {
          done = true;
          return iv + Math.sign(iv);
        }
        return iv;
      });
    }
  },
  {
    id: "contract",
    label: "Interval contraction",
    phrase: "leaps narrowed",
    effect: "leaps narrowed: intimacy, withdrawal",
    apply: (line) => reinterval(line, (iv) => Math.abs(iv) >= 2 ? iv - Math.sign(iv) : iv)
  },
  {
    id: "displace_half",
    label: "Rhythmic displacement (off the beat)",
    phrase: "displaced off the beat",
    effect: "starts just after the beat: unsettled, fresh",
    apply: (line, ctx) => mergeRests([{ deg: null, dur: ctx.grid }, ...line.map((n) => ({ ...n }))])
  },
  {
    id: "displace_beat",
    label: "Rhythmic displacement (a beat late)",
    phrase: "displaced by a beat",
    effect: "starts on a different beat: the accents fall in new places",
    apply: (line) => mergeRests([{ deg: null, dur: 1 }, ...line.map((n) => ({ ...n }))])
  },
  {
    id: "ornament",
    label: "Ornamentation",
    phrase: "ornamented",
    effect: "passing and neighbour notes added: warmth, flow",
    apply: (line, ctx) => {
      const g = ctx.grid;
      const out = [];
      let added = 0;
      for (let i = 0; i < line.length; i++) {
        const n = line[i];
        const next = line.slice(i + 1).find((x) => x.deg !== null);
        if (n.deg === null || added >= 4) {
          out.push({ ...n });
          continue;
        }
        const gap = next && next.deg !== null ? next.deg - n.deg : 0;
        if (Math.abs(gap) === 2 && n.dur >= 2 * g) {
          out.push({ ...n, dur: q(n.dur - g) }, { deg: n.deg + Math.sign(gap), dur: g });
          added++;
        } else if (n.dur >= 1.5 && n.dur >= 4 * g && next) {
          out.push({ ...n, dur: q(n.dur - 2 * g) }, { deg: n.deg + 1, dur: g }, { deg: n.deg, dur: g });
          added++;
        } else {
          out.push({ ...n });
        }
      }
      return out;
    }
  },
  {
    id: "register_up",
    label: "Register transfer (octave up)",
    phrase: "moved up an octave",
    effect: "an octave higher: brighter, more exposed",
    apply: (line) => mapPitch(line, (d) => d + 7)
  },
  {
    id: "register_down",
    label: "Register transfer (octave down)",
    phrase: "moved down an octave",
    effect: "an octave lower: darker, heavier",
    apply: (line) => mapPitch(line, (d) => d - 7)
  }
];
var MELODIC_OP_BY_ID = Object.fromEntries(MELODIC_OPS.map((o) => [o.id, o]));
var TEXTURE_OPS = [
  { id: "reharmonise", label: "Reharmonise", phrase: "reharmonised", effect: "same melody, new chords: familiar tune, changed meaning" },
  { id: "mode_mixture", label: "Mode mixture", phrase: "with a chord borrowed from the parallel mode", effect: "one chord late in the phrase is borrowed from the parallel major or minor, the key itself staying put: the same idea in a different light for a moment" },
  { id: "handoff", label: "Instrument handoff", phrase: "handed to a new instrument", effect: "the line passes to another instrument: a new voice takes the idea" },
  { id: "call_response", label: "Call and response", phrase: "split as call and response", effect: "split between two instruments: conversation" },
  { id: "overlap", label: "Overlap", phrase: "second entry overlapping", effect: "a second entry begins before the first ends: density" },
  { id: "pedal_underlay", label: "Pedal underlay", phrase: "over a pedal note", effect: "a held note under changing harmony: suspension, gravity" },
  { id: "octave_doubling", label: "Octave doubling", phrase: "doubled at the octave", effect: "doubled above or below: power, clarity" }
];
var TEXTURE_OP_BY_ID = Object.fromEntries(TEXTURE_OPS.map((o) => [o.id, o]));
function applyOps(line, opIds, ctx) {
  let out = line.map((n) => ({ ...n }));
  for (const id of opIds) {
    const op = MELODIC_OP_BY_ID[id];
    if (op) out = op.apply(out, ctx);
  }
  return out;
}
function describeOps(opIds) {
  const parts = opIds.map((id) => MELODIC_OP_BY_ID[id]?.phrase).filter(Boolean);
  return parts.length ? parts.join(", ") : "intact";
}

// server/calls/orchestrate.ts
var opt2 = (key, label, criteria, prior = 0) => ({ key, label, criteria, prior });
var LAYERS = ["melody", "counter", "inner", "bass", "pedal", "figuration", "texture", "pulse", "accents"];
var LAYER_JOB = {
  melody: "the melody line",
  counter: "the counter-melody",
  inner: "inner harmony (the voice-led chord tones)",
  bass: "the bass line",
  pedal: "a pedal: one held note under the changing harmony",
  figuration: "figuration: arpeggios or plucked patterns on the chords",
  texture: "texture: noise, tremolo or a swell behind everything",
  pulse: "pulse: drums or a kick marking time",
  accents: "accents: hits and swells at chosen moments"
};
var CENTRE = {
  piano: 72,
  violins: 76,
  violins2: 67,
  solo_violin: 76,
  flute: 79,
  oboe: 72,
  clarinet: 65,
  pluck: 72,
  celesta: 84,
  glockenspiel: 88,
  vibraphone: 67,
  celli: 55,
  violas: 62,
  horn: 55,
  harp: 67,
  lead: 74,
  keys: 67,
  bell: 84,
  brass: 65,
  supersaw: 64
};
var velOf = (step) => clamp(0.2 + step * 0.118, 0.12, 0.95);
function fold(midi, inst) {
  const [lo, hi] = INSTRUMENTS[inst].range;
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}
function pcIn(pc, lo) {
  return lo + mod(pc - lo, 12);
}
function melodyFacts(piece) {
  let top = null;
  for (const ph of piece.phrases) {
    for (const n of ph.score.notes) {
      if (n.layer === "melody" && (!top || n.midi > top.midi)) top = { midi: n.midi, phrase: ph.index + 1 };
    }
  }
  const last = piece.phrases[piece.phrases.length - 1];
  const tail2 = last?.score.notes.filter((n) => n.layer === "melody").sort((a, b) => a.t + a.dur - (b.t + b.dur) || a.midi - b.midi).pop();
  return { lastEnd: tail2 ? tail2.midi : null, top };
}
function playedFacts(piece) {
  if (!piece.phrases.length) return null;
  const heard = piece.phrases.map((ph) => new Set(ph.score.notes.map((n) => n.inst)));
  const running = [];
  const resting = [];
  for (const id of piece.rules.palette) {
    let run = 0;
    for (let i = heard.length - 1; i >= 0 && heard[i].has(id); i--) run++;
    if (run > 0) running.push(`${INSTRUMENTS[id].name} (${run} phrase${run === 1 ? "" : "s"} running)`);
    else {
      let since = -1;
      for (let i = heard.length - 1; i >= 0; i--) if (heard[i].has(id)) {
        since = heard.length - 1 - i;
        break;
      }
      resting.push(`${INSTRUMENTS[id].name} (${since < 0 ? "not yet heard" : `silent ${since} phrase${since === 1 ? "" : "s"}`})`);
    }
  }
  const sizes = heard.map((h) => h.size);
  const most = Math.max(...sizes);
  return `PLAYED  sounding in the last phrase: ${running.join(", ") || "nothing"}; resting: ${resting.join(", ") || "none"}; fullest phrase so far: phrase ${sizes.indexOf(most) + 1} with ${most} instruments`;
}
function lastLevel(piece) {
  const last = piece.phrases[piece.phrases.length - 1];
  if (!last) return null;
  const curve = last.score.dynCurve;
  return curve?.length ? curve[curve.length - 1].step : last.mix.dynamics;
}
function dynamicCurve(shape, to, from, beats) {
  const prev = from ?? to;
  if (shape === "crescendo") {
    const start = clamp(Math.min(prev, to - 1), 0, 6);
    return start < to ? [{ beat: 0, step: start }, { beat: beats, step: to }] : void 0;
  }
  if (shape === "diminuendo") {
    const start = prev > to ? prev : to;
    const end = prev > to ? to : Math.max(0, to - 1);
    return start > end ? [{ beat: 0, step: start }, { beat: beats, step: end }] : void 0;
  }
  if (shape === "swell") {
    const low = Math.max(0, to - 1);
    return low < to ? [{ beat: 0, step: low }, { beat: beats / 2, step: to }, { beat: beats, step: low }] : void 0;
  }
  return void 0;
}
function songLevel(piece, index) {
  const part = piece.sectionOf(index).part;
  const level = part ? piece.plan.partLevels?.[part] : void 0;
  if (level === void 0) return null;
  const ch = piece.chorusAt(index);
  return ch && ch.of > 1 && ch.n === ch.of && piece.plan.climaxArrival === "drop" ? 6 : level;
}
function partHint(piece, index) {
  const part = piece.sectionOf(index).part;
  if (!part) return "";
  const ch = piece.chorusAt(index);
  if (ch) return ` This phrase is in the chorus (chorus ${ch.n} of ${ch.of}): a peak of the song, which must sound clearly bigger than the verse, not only louder.`;
  if (part === "verse") return " This phrase is in a verse: lean and held back, so the chorus has somewhere to go.";
  if (part === "prechorus") return " This phrase is in the pre-chorus: building, something still held back for the chorus.";
  if (part === "bridge") return " This phrase is in the bridge: the thinnest part of the song, a real drop before the last chorus.";
  return ` This phrase is in the ${part}.`;
}
function buildQuestions(ctx, index, draft) {
  const { piece } = ctx;
  const { rules, mood: m } = piece;
  const role = piece.roleOf(index);
  const t = piece.tensionOf(index);
  const orch = rules.style === "bittersweet_orchestral";
  const beat = rules.style === "beat_driven";
  const play = rules.style === "playful";
  const last = piece.phrases[piece.phrases.length - 1];
  const was = (r) => !!last?.layers.find((l) => l.role === r && l.inst);
  const lastInst = (r) => last?.layers.find((l) => l.role === r)?.inst ?? null;
  const flags = draft.direction.flags;
  const cue = piece.picture?.(index) ?? null;
  const moves = (...q2) => !!cue && q2.includes(cue.quality);
  const level = (...l) => !!cue && l.includes(cue.bodyLevel);
  const overall = clamp(Math.round(t - 1 + (role === "climax" ? 1 : 0) + (role === "coda" ? -0.5 : 0)), 0, 6);
  const questions = [];
  const offered = {};
  const arrival = piece.plan.climaxArrival;
  const atClimax = index === piece.plan.climaxPhrase;
  const wall = atClimax && isWall(arrival);
  const drop = atClimax && arrival === "drop";
  const peak = wall || drop;
  const bloom = atClimax && arrival === "bloom";
  const still = wall || bloom;
  if (bloom) questions.push({
    id: "bloom_level",
    type: "choice",
    label: "How much louder the clearing is",
    instructions: `The climax arrives as a still, bright clearing after a held breath. The phrase before it left off at ${DYNAMIC_NAMES[clamp(Math.round(lastLevel(piece) ?? 3), 0, 6)]}. How loud should the clearing be?`,
    options: [
      opt2("same", "no louder", "no louder than before: the change is all in colour and stillness", 0.5),
      opt2("one", "one step louder", "one step louder: it opens, gently", 1.2),
      opt2("two", "two steps louder", "two steps louder: a clear lift, still without force", 0.8)
    ]
  });
  const song = songLevel(piece, index);
  const hint = partHint(piece, index);
  if (!peak && !bloom && song === null) questions.push({
    id: "overall_dynamics",
    type: "score",
    label: "Overall dynamics",
    instructions: `How loud is this phrase overall? Target tension is ${t} of 7.`,
    levels: DYNAMIC_LEVELS,
    prior: overall,
    spread: 0.6
  });
  if (!drop) questions.push({
    id: "density",
    type: "score",
    label: "How full the texture is",
    instructions: `How full should the texture of this phrase be: how many supporting layers (counter-melody, inner harmony, bass, pedal, figuration, texture, pulse) play under the melody? ${bloom ? "This is the climax, arriving as a still, bright clearing: nothing moves but the melody, so fullness here means held notes, not activity." : `Target tension is ${t} of 7.`}${hint}`,
    levels: [
      "the melody alone, nothing under it",
      "the melody and one supporting layer: bare, intimate",
      "the melody and two supporting layers: a light texture",
      "three supporting layers: a full, warm texture",
      "four supporting layers: rich",
      "five supporting layers: dense, the whole ensemble at work",
      "every layer available: the fullest texture of the piece"
    ],
    prior: clamp((t - 1) * 0.9, 0, 6),
    spread: 0.7
  });
  const inPrior = {
    melody: 0.97,
    counter: sigmoid((t - 3.6) * 1.2),
    inner: sigmoid((t - 1.6) * 1.3),
    bass: beat ? sigmoid((t - 1.1) * 1.6) : sigmoid((t - 1.4) * 1.4),
    pedal: 0.12,
    figuration: orch ? 0.92 * sigmoid((t - 0.4) * 1.2) : beat ? sigmoid(t - 2.4) : sigmoid((t - 1.3) * 1.2),
    texture: orch ? 0.22 + m.water * 0.5 + (rules.soundWorld === "submerged" ? 0.25 : 0) : beat ? 0.3 : 0.08,
    pulse: beat ? sigmoid((t - 1.5) * 1.6) : play ? sigmoid(t - 3.2) : sigmoid((t - 5.6) * 1.5),
    accents: role === "climax" ? 0.93 : t >= 6 ? 0.5 : t >= 5 && index === piece.sectionOf(index).first ? 0.3 : 0.05
  };
  const instPrefer = {
    melody: orch ? { piano: 1.9 - 0.3 * t, violins: -0.9 + 0.42 * t, solo_violin: 0.7 - 0.2 * t + (1 - m.size) * 0.5, flute: 0.1, oboe: 0.2, clarinet: -0.2 } : play ? { flute: 1.1, clarinet: 1, oboe: 0.5, violins: 0.6, glockenspiel: 0.4, celesta: 0.4, piano: 0.5, pluck: 0.3 } : { pluck: 1.5, piano: 0.7, vibraphone: 0.5, violins: 0.2 },
    counter: { celli: 1.2, violas: 0.7, horn: 0.6 + (t >= 5 ? 0.5 : 0), clarinet: play ? 1 : 0.3, violins2: 0.3, oboe: 0.2, flute: 0.1, vibraphone: beat ? 0.8 : 0 },
    inner: beat ? { pad: 1.6, piano: 0.5, violas: 0.2 } : { violas: 1.1, violins2: 1, pad: 0, piano: 0.2, horn: 0.3 },
    bass: beat ? { sub: 1.8, piano: 0.3, basses: 0.3 } : { basses: 1.1 + 0.15 * t, celli: 1.5 - 0.25 * t, piano: 0.3, sub: -0.5 },
    pedal: { basses: 1, celli: 0.7, horn: 0.5, piano: 0.3, sub: beat ? 1 : -0.5 },
    figuration: orch ? { piano: 1.5, harp: 1.1, violas: 0.1, violins2: 0.1 } : play ? { harp: 0.8, violins2: 1, violas: 0.9, piano: 0.6, celesta: 0.5 } : { pluck: 1.5, piano: 0.6 },
    texture: { noise: 1 + m.water, violins: orch && t >= 4 ? 1.1 : 0.1, pad: beat ? 1 : 0.2, cymbal: t >= 5 ? 0.6 : -0.5 },
    pulse: beat ? { drumkit: 1.6, kick808: 0.8 + (t <= 3 ? 1.2 : 0) } : { timpani: orch ? 1.2 : 0.4, drumkit: play ? 1 : 0, kick808: 0.2 },
    accents: {}
  };
  for (const r of LAYERS) {
    if (r === "accents") continue;
    let pool = ROLE_INSTRUMENTS[r].filter((id) => rules.palette.includes(id));
    if (r === "counter" && draft.direction.counter === "none" && !flags.overlap) pool = [];
    if (r === "melody" && flags.handoff && pool.length > 1) pool = pool.filter((id) => id !== lastInst("melody"));
    if (still && (r === "figuration" || r === "pulse")) pool = [];
    if (bloom && r === "counter") pool = [];
    offered[r] = pool;
    if (!pool.length) continue;
    const forced = r === "pedal" && flags.pedal_underlay || r === "counter" && flags.overlap;
    let p = inPrior[r];
    p = was(r) ? p * 0.7 + 0.3 : p * 0.88;
    if (role === "coda" && r !== "melody") p *= 0.75;
    questions.push({
      id: `${r}_in`,
      type: "noul",
      label: `${r}: in`,
      // For the supporting layers these answers rank which ones fill the places the density answer allows.
      instructions: `Should ${LAYER_JOB[r]} play in this phrase?${r === "melody" ? "" : hint}${forced ? " (The direction for this phrase already calls for it.)" : ""} ${was(r) ? "It played in the previous phrase." : "It was silent in the previous phrase."}`,
      prior: forced ? 0.98 : clamp(p, 0.02, 0.98)
    });
    if (r === "melody") {
      const facts = melodyFacts(piece);
      const semis = (n) => `${Math.abs(n)} semitone${Math.abs(n) === 1 ? "" : "s"}`;
      const REG = [
        ["low", -1, "dark, close, private", 0.2 + (t <= 2 ? 0.5 : 0) + (role === "coda" ? 0.5 : 0) + (level("low") ? 0.9 : 0)],
        ["middle", 0, "natural, singing", 1.2],
        ["high", 1, "bright, exposed, soaring", -0.5 + t * 0.22 + (role === "climax" ? 1.4 : 0) + (level("high", "airborne") ? 1 : 0)]
      ];
      const seen = /* @__PURE__ */ new Set();
      const options = [];
      for (const id of pool) {
        for (const [reg, oct, feel, regPrior] of REG) {
          const placed = placeLine(draft.line, draft.key, id, oct);
          if (!placed.length) continue;
          const lo = Math.min(...placed.map((n) => n.midi));
          const hi = Math.max(...placed.map((n) => n.midi));
          if (seen.has(`${id}:${lo}:${hi}`)) continue;
          seen.add(`${id}:${lo}:${hi}`);
          const leap = facts.lastEnd === null ? null : placed[0].midi - facts.lastEnd;
          const join5 = leap === null ? "" : leap === 0 ? " It starts on the very note the last phrase ended on." : ` It starts ${semis(leap)} ${leap > 0 ? "above" : "below"} the note the last phrase's melody ended on${Math.abs(leap) > 12 ? " (more than an octave away)" : ""}.`;
          const peak2 = !facts.top ? "" : ` Its top note, ${midiName(hi, draft.key)}, is ${hi === facts.top.midi ? "the same as" : `${semis(hi - facts.top.midi)} ${hi > facts.top.midi ? "above" : "below"}`} the highest melody note so far (${midiName(facts.top.midi, draft.key)}, phrase ${facts.top.phrase}).`;
          let prior = (instPrefer.melody[id] ?? -0.3) + regPrior + (role === "return" && lastInst("melody") === id ? -1 : 0);
          if (leap !== null && Math.abs(leap) > 12) prior -= 1.2;
          if (atClimax && facts.top && hi > facts.top.midi) prior += 1;
          options.push(opt2(
            `${id}__${reg}`,
            `${INSTRUMENTS[id].name}, ${reg}`,
            `${INSTRUMENTS[id].name} (${INSTRUMENTS[id].character}), ${reg} register (${feel}): ${midiName(lo, draft.key)} to ${midiName(hi, draft.key)}.${join5}${peak2}`,
            prior
          ));
        }
      }
      if (!options.length) for (const id of pool) options.push(opt2(`${id}__middle`, INSTRUMENTS[id].name, `${INSTRUMENTS[id].name}: ${INSTRUMENTS[id].character}`, instPrefer.melody[id] ?? -0.3));
      const climaxAt = piece.plan.climaxPhrase;
      const where = index < climaxAt ? `The climax is phrase ${climaxAt + 1}, ${climaxAt - index} phrase${climaxAt - index === 1 ? "" : "s"} from now.` : index === climaxAt ? "This phrase is the climax." : `The climax has passed (it was phrase ${climaxAt + 1}).`;
      questions.push({
        id: "melody_voice",
        type: "choice",
        label: "melody: instrument and register",
        instructions: `Which instrument should take the melody, and in which register? ${where}`,
        options
      });
    } else questions.push({
      id: `${r}_inst`,
      type: "choice",
      label: `${r}: instrument`,
      instructions: `Which instrument should take ${LAYER_JOB[r]}?`,
      options: pool.map((id) => opt2(
        id,
        INSTRUMENTS[id].name,
        `${INSTRUMENTS[id].name}: ${INSTRUMENTS[id].character}`,
        (instPrefer[r][id] ?? -0.3) + (lastInst(r) === id ? 0.5 : 0)
      ))
    });
    const offset = { melody: 0.5, counter: -0.5, inner: -1, bass: -0.4, pedal: -1.5, figuration: -1, texture: -1.6, pulse: 0 };
    questions.push({
      id: `${r}_dyn`,
      type: "score",
      label: `${r}: dynamics`,
      instructions: `How loud should ${LAYER_JOB[r]} be? The melody must stay clear above its accompaniment.`,
      levels: DYNAMIC_LEVELS,
      prior: clamp(overall + offset[r], 0, 6),
      spread: 0.55
    });
    questions.push({
      id: `${r}_entry`,
      type: "choice",
      label: `${r}: entry`,
      instructions: `If ${LAYER_JOB[r]} is newly entering, how should it come in?`,
      options: [
        opt2("immediate", "immediate", "immediately, at the start of the phrase", r === "melody" || r === "bass" || r === "pulse" ? 1.4 : 0.8),
        opt2("fade_in", "fade in", "fading in from nothing across the first bar or two", r === "inner" || r === "texture" || r === "pedal" ? 1.2 : 0.3),
        opt2("delayed", "delayed", "delayed: it waits a bar and enters in bar two", r === "counter" ? 1.1 : r === "figuration" ? 0.5 : -0.2)
      ]
    });
  }
  const doublers = [.../* @__PURE__ */ new Set([...ROLE_INSTRUMENTS.melody, ...ROLE_INSTRUMENTS.counter])].filter((id) => rules.palette.includes(id));
  if (doublers.length >= 2) {
    questions.push({
      id: "melody_double",
      type: "choice",
      label: "melody: doubled by",
      instructions: `Should a second instrument play the melody together with the first, and if so which?${hint}`,
      options: [
        opt2("none", "no doubling", "no doubling: the melody on one instrument alone, its own pure colour, free to be expressive", 1.6 - Math.max(0, t - 3) * 0.55),
        ...doublers.map((id) => opt2(id, INSTRUMENTS[id].name, `${INSTRUMENTS[id].name} joins the melody: ${INSTRUMENTS[id].character}`, -0.5 + (t >= 5 ? 0.9 : 0) + (instPrefer.melody[id] ?? 0) * 0.3))
      ]
    });
    questions.push({
      id: "melody_double_at",
      type: "choice",
      label: "melody: doubling at",
      instructions: "If the melody is doubled, where does the second instrument play it?",
      options: [
        opt2("unison", "unison", "in unison: one thicker, sweeter voice", 1),
        opt2("octave_above", "octave above", "an octave above: brilliance on top of the line", t >= 5 ? 0.9 : 0.2),
        opt2("octave_below", "octave below", "an octave below: body and warmth under the line", 0.6)
      ]
    });
  }
  if (!still) questions.push({
    id: "melody_style",
    type: "choice",
    label: "melody: playing style",
    instructions: "How should the melody be played?",
    options: [
      opt2("sustain", "sustained", "sustained and connected: singing", (play ? 0.6 : 1.6) + (moves("flowing", "frozen") ? 0.8 : 0)),
      opt2("staccato", "staccato", "staccato: short, detached, light", (play ? 1.2 : -0.8 + (beat ? 0.8 : 0)) + (moves("sharp", "bouncing") ? 1.3 : 0)),
      opt2("pizzicato", "pizzicato", "pizzicato (strings only): plucked, dry, playful", play ? 0.9 : -1.2)
    ]
  });
  if (flags.octave_doubling) {
    questions.push({
      id: "doubling",
      type: "choice",
      label: "octave doubling",
      instructions: "The melody is doubled at the octave in this phrase. Which way?",
      options: [opt2("above", "above", "doubled an octave above: brilliance, clarity", role === "climax" ? 1 : 0.6), opt2("below", "below", "doubled an octave below: body, power", 0.7)]
    });
  }
  if (flags.call_response) {
    const pool = [.../* @__PURE__ */ new Set([...offered.melody, ...ROLE_INSTRUMENTS.counter.filter((id) => rules.palette.includes(id))])];
    if (pool.length > 1) {
      questions.push({
        id: "response_inst",
        type: "choice",
        label: "response instrument",
        instructions: "Call and response was chosen: the second half of the melody passes to another instrument. Which one answers?",
        options: pool.map((id) => opt2(id, INSTRUMENTS[id].name, `${INSTRUMENTS[id].name}: ${INSTRUMENTS[id].character}`, instPrefer.counter[id] ?? instPrefer.melody[id] ?? 0))
      });
    }
  }
  questions.push({
    id: "inner_style",
    type: "choice",
    label: "inner harmony: style",
    instructions: "How should the inner harmony be played?",
    options: [
      opt2("sustain", "sustained", "sustained: a smooth bed", 1.4 - (play ? 0.8 : 0)),
      opt2("tremolo", "tremolo", "tremolo: shivering, charged, tense", -1 + (t >= 5 ? 1.6 : 0) + (orch ? 0.3 : 0) + (moves("shaking") ? 1.6 : 0)),
      ...still ? [] : [opt2("pulsed", "pulsed", "pulsed: repeated chords on the beat; urgency or bounce", -0.6 + (play ? 1.6 : 0) + (t >= 5 ? 0.6 : 0) + (beat ? 0.6 : 0) + (moves("bouncing", "sharp") ? 0.9 : 0))]
    ]
  });
  questions.push({
    id: "inner_density",
    type: "choice",
    label: "inner harmony: density",
    instructions: "How dense should the inner harmony be?",
    options: [
      opt2("two", "two voices", "two voices: thin, transparent", 1.2 - t * 0.25),
      opt2("three", "three voices", "three voices: full", 0.8),
      opt2("three_plus", "three, top doubled", "three voices with the top doubled an octave up: rich, wide", -1.6 + t * 0.4)
    ]
  });
  questions.push({
    id: "bass_octave",
    type: "choice",
    label: "bass: octave",
    instructions: "Which octave should the bass take?",
    options: [opt2("normal", "normal", "normal bass register: clear", 1), opt2("low", "low", "an octave lower: deep, heavy", -0.6 + t * 0.25 + (beat ? 0.5 : 0))]
  });
  questions.push({
    id: "pedal_note",
    type: "choice",
    label: "pedal: which note",
    instructions: "If a pedal is held, on which note?",
    options: [opt2("tonic", "tonic", "the tonic: grounded, grave", 1), opt2("dominant", "dominant", "the dominant: suspended, expectant", draft.direction.ending === "half_resolved" ? 1.2 : 0.4)]
  });
  questions.push({
    id: "pedal_span",
    type: "choice",
    label: "pedal: how long",
    instructions: "How long should the pedal be held?",
    options: [opt2("half", "half the phrase", "the first two bars only", 0.4), opt2("whole", "the whole phrase", "the whole phrase", 1)]
  });
  const perSec = (n) => n * piece.bpmOf(index) / 60;
  const speeds = [1, 2, 3, 4].filter((n) => perSec(n) <= 9.5 || n === 1);
  questions.push({
    id: "figuration_pattern",
    type: "choice",
    label: "figuration: pattern",
    instructions: "Which figuration pattern?",
    options: [
      opt2("rising", "rising arpeggio", "rising arpeggio, restarting on each chord: lifting, wave after wave", 1),
      opt2("rise_fall", "rise and fall", "rising then falling through the chord: rocking, wave-like", orch ? 1.3 : 0.7),
      opt2("broken", "broken chord", "broken chord alternating low and high notes: gentle motor", play ? 1.1 : 0.5),
      opt2("ostinato", "ostinato", "a fixed root-fifth-octave cell repeated: insistent", beat ? 1.4 : 0.1 + (t >= 5 ? 0.6 : 0))
    ]
  });
  questions.push({
    id: "figuration_speed",
    type: "choice",
    label: "figuration: speed",
    instructions: "How fast should the figuration move?",
    options: speeds.map((n) => opt2(
      `n${n}`,
      `${n} per beat`,
      `${n} note${n === 1 ? "" : "s"} per beat (${perSec(n).toFixed(1)} notes a second)`,
      -(((perSec(n) - (2.4 + t * 0.6)) / 2) ** 2) + (n === rules.meter.sub || n === 1 ? 0.4 : rules.meter.sub === 3 && n !== 3 ? -0.8 : 0)
    ))
  });
  questions.push({
    id: "pulse_pattern",
    type: "choice",
    label: "pulse: pattern",
    instructions: "Which pulse pattern?",
    options: [
      opt2("trap", "trap", "trap: half time with the snare on beat three, sparse syncopated kicks, fast hi-hats that roll into the bar line", 1.6),
      opt2("boom_bap", "boom-bap", "boom-bap: swung hats, kick and snare trading blows, heavy and unhurried", 1.6),
      opt2("funk", "funk", "funk: sixteenth-note hats, syncopated kick, snare on two and four with ghost notes between", 1.6),
      opt2("four_on_floor", "four on the floor", "a kick on every beat: driving, dance", beat ? 1.2 + (t >= 4 ? 0.5 : 0) : -0.3),
      opt2("backbeat", "backbeat", "kick on one and three, snare on two and four: a groove", beat ? 1 : play ? 0.9 : -0.2),
      opt2("half_time", "half time", "half time: one kick, one snare per bar; heavy, spacious", beat ? 0.6 + (t <= 3 ? 0.6 : 0) : 0),
      opt2("syncopated", "syncopated", "syncopated kicks and busy hats: restless, intricate", beat ? 0.8 + (t >= 5 ? 0.6 : 0) : play ? 0.4 : -0.6),
      opt2("heartbeat", "heartbeat", "a soft double thump at the start of each bar: a heartbeat under the music", orch ? 0.9 : 0.3 + (t <= 3 ? 0.6 : 0)),
      opt2("downbeats", "downbeats", "one stroke on each downbeat: solemn, processional", orch ? 1 : 0),
      opt2("roll_to_downbeat", "roll to the downbeat", "a roll swelling through the last bar into the next downbeat: arrival", orch ? 0.7 + (t >= 6 ? 0.8 : 0) : 0)
    ].filter((o) => rules.groove ? GROOVES[rules.groove].patterns.includes(o.key) : !["trap", "boom_bap", "funk"].includes(o.key))
  });
  if (beat) {
    const g = rules.groove;
    questions.push({
      id: "bass_rhythm",
      type: "choice",
      label: "bass: rhythm",
      instructions: "What rhythm should the bass play?",
      options: [
        opt2("held", "held", "held: one long note per chord: weight without motion", 0.6 + (t <= 3 ? 0.8 : 0)),
        opt2("eighths", "pumping eighths", "pumping eighth notes on the chord root: drive, the engine of dance music", g === "house" ? 1.5 : 0.3),
        opt2("with_kick", "with the kick", "hits with every kick and rings until the next: the 808 way, bass and kick as one instrument", g === "trap" || g === "boom_bap" ? 1.7 : 0.5),
        opt2("syncopated", "syncopated", "a syncopated sixteenth-note figure with octave pops: funk, the bass as a second drummer", g === "funk" ? 1.8 : 0.1)
      ]
    });
  }
  questions.push({
    id: "pulse_intensity",
    type: "score",
    label: "pulse: intensity",
    instructions: `How busy and forceful should the pulse be?${hint}`,
    levels: AMOUNT_LEVELS,
    prior: clamp(t - 1.5, 0, 6),
    spread: 0.7
  });
  const accentKinds = [
    ["full_hit", "full hit", "full hit: every available drum, cymbal and low octave together; the biggest blow", ["bass_drum", "cymbal", "timpani", "piano", "drumkit", "tam_tam"], role === "climax" ? 1.6 : 0.2],
    ["cymbal_swell", "cymbal swell", "cymbal swell: a roll rising into the moment; anticipation, light", ["cymbal"], 0.9],
    ["bass_drum", "bass drum", "bass drum: one deep impact", ["bass_drum"], 0.6],
    ["low_piano_octave", "low piano octave", "low piano octave: a dark bell under everything", ["piano"], orch ? 0.9 : 0.3],
    ["timpani", "timpani stroke", "timpani stroke on the root: pitched thunder", ["timpani"], 0.6],
    ["tam_tam", "tam-tam", "tam-tam: a dark metallic wash that blooms after the stroke", ["tam_tam"], 0.2 + m.darkness * 0.6],
    ["crash", "kit crash", "drum-kit crash and kick: a drop landing", ["drumkit"], beat ? 1.4 : 0]
  ];
  const noAccent = atClimax && (arrival === "swell" || arrival === "bloom");
  const hitArrival = atClimax && arrival === "hit";
  const accentPool = noAccent ? [] : accentKinds.filter(([key, , , needs]) => key === "full_hit" ? needs.filter((id) => rules.palette.includes(id)).length >= 2 : needs.every((id) => rules.palette.includes(id)));
  offered.accents = accentPool.length ? accentPool.flatMap((a) => a[3]).filter((id, i, all) => rules.palette.includes(id) && all.indexOf(id) === i) : [];
  if (accentPool.length) {
    questions.push({
      id: "accents_in",
      type: "noul",
      label: "accents: in",
      instructions: `Should this phrase have an accent: a hit or swell at a chosen moment?${hitArrival ? " (The plan already calls for it: the climax arrives as a hit.)" : ""}`,
      prior: hitArrival ? 0.98 : clamp(Math.max(inPrior.accents, cue?.peak && cue.peak.strength >= 5 ? 0.9 : cue?.cut ? 0.45 : 0), 0.02, 0.98)
    });
    questions.push({
      id: "accents_kind",
      type: "choice",
      label: "accents: kind",
      instructions: "Which kind of accent?",
      options: accentPool.map(([key, label, text, , prior]) => opt2(key, label, text, prior))
    });
    questions.push({
      id: "accents_where",
      type: "choice",
      label: "accents: where",
      instructions: "Where in the phrase should the accent land?",
      options: [
        opt2("phrase_start", "phrase start", "on the first downbeat: an arrival", role === "climax" ? 1.1 : 0.8),
        opt2("bar_3", "bar three", "on the downbeat of bar three: the middle of the phrase", 0.5),
        opt2("last_bar", "last bar", "on the downbeat of the last bar: a late blow", 0.3),
        opt2("melody_peak", "melody peak", "on the highest note of the melody: the accent crowns the line", role === "climax" ? 1.3 : 0.6),
        ...cue?.peak ? [opt2("video_peak", "picture high point", `on the high point in the picture at beat ${Math.round(cue.peak.beat * 10) / 10 + 1} (peak ${cue.peak.strength} of 7): the hit lands with the image`, 2.6)] : [],
        ...cue?.cut ? [opt2("video_cut", "scene cut", `on the scene cut at beat ${Math.round(cue.cut.beat * 10) / 10 + 1}: the hit marks the change of shot`, cue.peak ? 0.6 : 1.8)] : []
      ]
    });
    questions.push({
      id: "accents_dyn",
      type: "score",
      label: "accents: how hard",
      instructions: "How hard should the accent hit?",
      levels: DYNAMIC_LEVELS,
      prior: clamp(overall + 1, 0, 6),
      spread: 0.6
    });
    questions.push({
      id: "pause_before_hit",
      type: "noul",
      label: "pause before the hit",
      instructions: "Should everything fall silent for an instant just before the accent, so it lands harder?",
      yes: "A breath of silence before the hit: the biggest moments earn this.",
      no: "No pause: the music runs straight into the accent.",
      prior: role === "climax" ? orch ? 0.82 : 0.5 : cue?.peak && cue.peak.strength >= 6 ? 0.45 : 0.05
    });
  }
  const sectionEnd = index === piece.sectionOf(index).last;
  const sectionEnd0 = index === piece.sectionOf(index).first;
  const chorusNext = !!piece.chorusAt(index + 1)?.starts;
  const finalPhrase = index === piece.plan.totalPhrases - 1;
  const wallNext = index === piece.plan.climaxPhrase - 1 && arrivesAfterBreath(arrival);
  if (!peak && !bloom) {
    questions.push({
      id: "texture_shape",
      type: "choice",
      label: "texture inside the phrase",
      instructions: "How should the texture move inside this phrase? Instruments need not play all the way through.",
      options: [
        opt2("full", "full", "every chosen layer plays through the whole phrase", 1.4),
        opt2("late_entry", "late entry", "the melody and bass begin alone; the rest of the accompaniment waits and enters at the half: space first, then warmth", 0.5 + (t <= 3 ? 0.4 : 0)),
        opt2("drop_out", "drop out", "the accompaniment falls away at the half, leaving melody and bass exposed: a sudden clearing", 0.3),
        opt2("bare_ending", "bare ending", "everything but the melody stops for the last bar: the line is left alone in the air", 0.3 + (sectionEnd ? 0.5 : 0))
      ]
    });
  }
  if (!wallNext && !finalPhrase) {
    questions.push({
      id: "phrase_close",
      type: "choice",
      label: "how the phrase closes",
      instructions: "How should this phrase close before the next one begins?",
      options: [
        opt2("run_on", "run on", "runs straight on into the next phrase: momentum, no punctuation", 0.8 + (t >= 5 ? 0.6 : 0)),
        opt2("melody_breathes", "melody breathes", "the melody lifts off a beat early while the accompaniment carries on underneath: a comma", 0.9),
        opt2("all_breathe", "everyone breathes", "everything stops for a moment just before the bar line, only the hall still ringing: a full stop the listener can feel", 0.4 + (sectionEnd ? 0.9 : 0)),
        opt2("long_silence", "long silence", "everything stops for the whole last half-bar: a long held silence before the music goes on", sectionEnd && t <= 3 ? 0.6 : -0.4),
        ...beat ? [opt2("strip_back", "strip back", "the drums, bass and chords drop out for the last bar and the melody is left alone: the set-up before a chorus or a drop, so what comes next lands harder", chorusNext ? 1.8 : 0.1)] : []
      ]
    });
  }
  const afterSilence = !last || ["breath", "all_breathe", "long_silence", "strip_back"].includes(last.close ?? "");
  if (!afterSilence && !peak && !bloom) {
    const lastStarts = piece.phrases.slice(-3).map((ph) => (ph.start ?? "downbeat").replace("_", " "));
    const first = draft.line[0];
    const g = piece.grid === 0.5 ? "two eighth notes" : "two quick notes";
    questions.push({
      id: "melody_start",
      type: "choice",
      label: "how the melody begins",
      instructions: `How should the melody begin this phrase? The last ${lastStarts.length === 1 ? "phrase began" : `${lastStarts.length} phrases began`}: ${lastStarts.join(", ")}.`,
      options: [
        opt2("downbeat", "on the downbeat", "on the downbeat: the melody begins exactly at the bar line: clear and square", 1 - 0.3 * lastStarts.filter((x) => x === "downbeat").length),
        ...first && first.deg !== null ? [opt2("pickup", "with a pickup", `with a pickup: ${g} step into the first note, starting before the bar line, so the melody is already moving when the phrase begins and the join is sung across`, 0.8)] : [],
        ...first && first.deg !== null && first.dur >= 2 ? [opt2("late", "after the downbeat", "after the downbeat: the accompaniment starts the phrase and the melody waits one beat before coming in: unhurried, conversational", 0.5)] : []
      ]
    });
    const lastJoins = piece.phrases.slice(-3).map((ph) => ph.join ?? "clean");
    questions.push({
      id: "join",
      type: "choice",
      label: "how the instruments change over",
      instructions: `If instruments join or leave at this phrase, how should the change happen? The last ${lastJoins.length === 1 ? "join was" : `${lastJoins.length} joins were`}: ${lastJoins.join(", ")}.`,
      options: [
        opt2("clean", "clean", "clean: every change happens exactly at the bar line: a clear new section", sectionEnd0 ? 1.1 : 0.6),
        opt2("dovetail", "dovetailed", "dovetailed: instruments joining now steal in softly a bar early, under the end of the last phrase, and instruments leaving linger over the first bar before letting go: the seam is hidden and the music flows across it", sectionEnd0 ? 0.6 : 1.2)
      ]
    });
  }
  const lastT = last ? last.score.display.tension : t;
  const before = lastLevel(piece);
  questions.push({
    id: "dynamic_shape",
    type: "choice",
    label: "dynamics inside the phrase",
    instructions: `How should the overall dynamic move inside this phrase?${before === null ? "" : ` The last phrase left off at ${DYNAMIC_NAMES[clamp(Math.round(before), 0, 6)]}.`}`,
    options: [
      opt2("steady", "steady", "steady: one level throughout; any change from the last phrase happens at once, at the bar line", 1),
      ...peak ? [] : [opt2("crescendo", "crescendo", "crescendo: grows through the whole phrase, from where the last phrase left off up to this phrase's dynamic", t > lastT + 0.3 ? 1.6 : 0.2)],
      opt2("diminuendo", "diminuendo", "diminuendo: falls through the phrase; from the last phrase's level down to this one if that was louder, otherwise fading about one level by the end", t < lastT - 0.3 ? 1.5 : role === "coda" ? 0.9 : 0.1),
      ...peak ? [] : [opt2("swell", "swell", "swell: rises to this phrase's dynamic in the middle and falls back by the end, like one breath", 0.6)]
    ]
  });
  const sub = rules.soundWorld === "submerged";
  const fx = [
    ["lowpass", "Low-pass filter", "How open should the low-pass filter be? (none = submerged, muffled; maximum = fully open and bright)", sub ? 1.4 + t * 0.5 : beat ? 2.2 + t * 0.55 : 3.6 + t * 0.35],
    ["reverb", "Reverb amount", "How much reverb? (none = dry and close; maximum = vast)", (rules.soundWorld === "close_dry" ? 1.5 : rules.soundWorld === "electronic_hybrid" ? 2.4 : 3.8) + (t <= 2 ? 0.6 : 0) + (role === "coda" ? 0.5 : 0)],
    ["delay", "Delay", "How much echo? Echoes suit sparse lines and blur busy ones.", (t <= 2.5 ? 2.2 : 0.8) + (beat ? 1 : 0)],
    ["noise", "Noise texture", "How much water-and-air noise texture?", 0.4 + m.water * 2.6 + (sub ? 1 : 0)],
    ["width", "Stereo width", "How wide should the stereo image be? (none = narrow, intimate; maximum = wide)", 1.6 + t * 0.55],
    ["saturation", "Saturation", "How much saturation? (a little = warmth; a lot = grit)", beat ? 1.6 + t * 0.35 : 0.6 + (t >= 6 ? 1 : 0)]
  ];
  for (const [id, label, text, prior] of fx) {
    if ((peak || bloom) && id === "lowpass") continue;
    questions.push({ id: `fx_${id}`, type: "score", label, instructions: id === "lowpass" || id === "width" ? text + hint : text, levels: AMOUNT_LEVELS, prior: clamp(prior, 0, 6), spread: 0.6 });
  }
  questions.push({ id: "fx_chorus", type: "noul", label: "Chorus", instructions: "Should chorus thicken the pads and strings in this phrase?", prior: beat ? 0.6 : 0.12 + (t >= 5 ? 0.15 : 0) });
  questions.push({ id: "fx_sidechain", type: "noul", label: "Sidechain pump", instructions: "Should the mix duck on every kick (sidechain pump)? It only makes sense with a kick-driven pulse.", prior: beat ? 0.84 : 0.02 });
  return { questions, offered };
}
function chordAt(slots, t) {
  return slots.find((s) => t >= s.t - 1e-6 && t < s.t + s.dur - 1e-6) ?? slots[slots.length - 1];
}
function placeLine(line, key, inst, octaves) {
  const notes = timed(line, key);
  if (!notes.length) return [];
  const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  const centre = CENTRE[inst] ?? (INSTRUMENTS[inst].range[0] + INSTRUMENTS[inst].range[1]) / 2;
  const shift = (Math.round((centre - mean) / 12) + octaves) * 12;
  return notes.map((n) => ({ ...n, midi: fold(n.midi + shift, inst) }));
}
function artFor(inst, wanted) {
  const arts = INSTRUMENTS[inst].arts;
  if (arts.includes(wanted)) return wanted;
  if (wanted === "pizzicato" && arts.includes("staccato")) return "staccato";
  return arts[0];
}
function drumBar(pattern, intensity, bar, sub, lastBar, barIndex = 0) {
  const out = [];
  const v = 0.45 + intensity * 0.075;
  const beats = Math.floor(bar + 1e-6);
  const KICK = 36, SNARE = 38, HAT = 42, OPEN = 46, TOM1 = 50, TOM2 = 47, TOM3 = 45;
  const kick = (t, s = 1) => t < bar && out.push({ t, midi: KICK, vel: v * s });
  const snare = (t, s = 1) => t < bar && out.push({ t, midi: SNARE, vel: v * 0.92 * s });
  const hats = (step, accentEvery) => {
    if (intensity < 2) return;
    for (let i = 0; i * step < bar - 1e-6; i++) out.push({ t: q(i * step), midi: HAT, vel: v * (i % accentEvery === 0 ? 0.6 : 0.36) });
  };
  const offbeat = sub === 3 ? 2 / 3 : 0.5;
  const fine = sub === 3 ? 1 / 3 : intensity >= 4 ? 0.25 : 0.5;
  const back = beats >= 4 ? [1, 3] : beats === 3 ? [2] : [1];
  if (sub === 3 && ["trap", "boom_bap", "funk"].includes(pattern)) pattern = "backbeat";
  const odd = barIndex % 2 === 1;
  const hat = (t, s, midi = HAT) => t < bar - 1e-6 && out.push({ t: q(t), midi, vel: v * s });
  switch (pattern) {
    case "trap": {
      kick(0);
      if (odd) kick(0.75, 0.8);
      kick(2.5, 0.85);
      if (intensity >= 4) kick(3.25, 0.7);
      snare(beats >= 4 ? 2 : beats - 1);
      const rolls = intensity >= 2 && (odd || lastBar);
      const stepH = intensity >= 3 ? 0.25 : 0.5;
      for (let i = 0; i * stepH < (rolls ? bar - 1 : bar) - 1e-6; i++) hat(i * stepH, i * stepH % 1 < 1e-6 ? 0.6 : 0.36);
      if (rolls) {
        const r = intensity >= 5 ? 1 / 12 : 1 / 6;
        for (let k = 0; k * r < 1 - 1e-6; k++) hat(bar - 1 + k * r, 0.3 + 0.35 * k * r);
      }
      if (intensity >= 4) hat(1.5, 0.5, OPEN);
      break;
    }
    case "boom_bap": {
      const sw = 2 / 3;
      kick(0);
      if (odd) {
        kick(1 + sw, 0.75);
        kick(2, 0.9);
      } else kick(2 + sw, 0.9);
      if (intensity >= 4) kick(3 + sw, 0.55);
      back.forEach((b) => snare(b));
      for (let b = 0; b < beats; b++) {
        hat(b, 0.6);
        hat(b + sw, 0.4);
      }
      break;
    }
    case "funk": {
      kick(0);
      kick(0.75, 0.7);
      kick(2.5, 0.9);
      if (odd) kick(3.25, 0.7);
      back.forEach((b) => snare(b));
      if (intensity >= 3) {
        snare(1.75, 0.3);
        snare(2.25, 0.3);
        snare(3.75, 0.35);
      }
      for (let i = 0; i * 0.25 < bar - 1e-6; i++) {
        const t = i * 0.25;
        if (intensity >= 4 && Math.abs(t - (bar - 0.5)) < 1e-6) hat(t, 0.55, OPEN);
        else hat(t, i % 2 === 0 ? 0.6 : 0.32);
      }
      break;
    }
    case "four_on_floor":
      for (let b = 0; b < beats; b++) kick(b);
      if (intensity >= 3) back.forEach((b) => snare(b, 0.85));
      hats(fine, sub === 3 ? 3 : Math.round(1 / fine));
      if (intensity >= 2 && sub === 2) for (let b = 0; b < beats; b++) out.push({ t: b + 0.5, midi: intensity >= 5 ? OPEN : HAT, vel: v * 0.55 });
      break;
    case "backbeat":
      kick(0);
      if (beats >= 4) kick(2);
      if (intensity >= 4) kick(q((beats >= 4 ? 2 : 1) - (1 - offbeat)), 0.7);
      back.forEach((b) => snare(b));
      hats(sub === 3 ? 1 / 3 : 0.5, sub === 3 ? 3 : 2);
      break;
    case "half_time":
      kick(0);
      snare(beats >= 4 ? 2 : beats - 1);
      hats(sub === 3 ? 1 / 3 : 0.5, sub === 3 ? 3 : 2);
      if (intensity >= 3) out.push({ t: q(bar - offbeat), midi: OPEN, vel: v * 0.5 });
      break;
    case "syncopated":
      kick(0);
      kick(q(1 + offbeat), 0.85);
      if (beats >= 4) kick(q(2 + offbeat), 0.8);
      back.forEach((b) => snare(b));
      if (intensity >= 4) snare(q(bar - (sub === 3 ? 1 / 3 : 0.25)), 0.45);
      hats(sub === 3 ? 1 / 3 : 0.25, sub === 3 ? 3 : 4);
      break;
    case "heartbeat":
      kick(0, 0.85);
      kick(q(offbeat), 0.6);
      break;
    case "roll_to_downbeat":
      kick(0);
      if (lastBar) [TOM1, TOM1, TOM2, TOM2, TOM3, TOM3].forEach((midi, i) => out.push({ t: q(bar - 1 + i / 6), midi, vel: v * (0.5 + i * 0.08) }));
      else hats(sub === 3 ? 1 / 3 : 0.5, sub === 3 ? 3 : 2);
      break;
    default:
      kick(0);
      if (intensity >= 3) for (let b = 1; b < beats; b++) out.push({ t: b, midi: 51, vel: v * 0.4 });
  }
  return out;
}
function write(ctx, index, draft, picks, values, offered) {
  const { piece } = ctx;
  const { rules } = piece;
  const key = draft.key;
  const bar = rules.meter.beatsPerBar;
  const beats = piece.beatsOf(index);
  const unit = piece.halfOf(index);
  const bars = piece.barsOf(index);
  const last = piece.phrases[piece.phrases.length - 1];
  const flags = draft.direction.flags;
  const notes = [];
  const leadIn = [];
  const remarks = [];
  const step = (id, fallback = 3) => clamp(Number(picks[id] ?? fallback), 0, 6);
  const chosen = {};
  for (const r of LAYERS) {
    const has = (offered[r] ?? []).length > 0 && picks[`${r}_in`] !== void 0;
    let on = has && picks[`${r}_in`] === "yes";
    if (r === "melody" && has) on = on || !LAYERS.some((x) => x !== "melody" && picks[`${x}_in`] === "yes");
    if (r === "pedal" && has && flags.pedal_underlay) on = true;
    if (r === "counter" && has && flags.overlap) on = true;
    if (r === "accents" && has && index === piece.plan.climaxPhrase && piece.plan.climaxArrival === "hit") on = true;
    const inst = on ? (r === "accents" ? null : picks[`${r}_inst`]) ?? null : null;
    const wasIn = !!last?.layers.find((l) => l.role === r && l.inst);
    chosen[r] = {
      role: r,
      on,
      inst,
      dyn: step(`${r}_dyn`),
      art: null,
      detail: "",
      entry: !on ? "continues" : wasIn || index === 0 ? wasIn ? "continues" : "immediate" : picks[`${r}_entry`] ?? "immediate"
    };
  }
  const push = (layer, inst, art, t, dur, midi, vel) => {
    if (t >= beats - 1e-6 || dur <= 0) return;
    notes.push({ t: q(t), dur: q(Math.min(dur, beats - t)), midi, vel: clamp(vel, 0.05, 1), inst, art, layer });
  };
  const mel = chosen.melody;
  let melodyNotes = [];
  if (mel.on && mel.inst) {
    const reg = picks.melody_register === "high" ? 1 : picks.melody_register === "low" ? -1 : 0;
    melodyNotes = placeLine(draft.line, key, mel.inst, reg);
    if (picks.melody_start === "late" && melodyNotes.length && melodyNotes[0].t < 1e-6 && melodyNotes[0].dur >= 2) {
      melodyNotes[0] = { ...melodyNotes[0], t: 1, dur: q(melodyNotes[0].dur - 1) };
      remarks.push("the melody enters after the downbeat");
    }
    const wanted = picks.melody_style ?? "sustain";
    const art = artFor(mel.inst, wanted === "pizzicato" && !INSTRUMENTS[mel.inst].arts.includes("pizzicato") ? "staccato" : wanted);
    mel.art = art;
    const base = velOf(mel.dyn);
    const top = Math.max(...melodyNotes.map((n) => n.midi));
    const responder = flags.call_response ? picks.response_inst ?? null : null;
    const partner = picks.melody_double && picks.melody_double !== "none" && picks.melody_double !== mel.inst && rules.palette.includes(picks.melody_double) ? picks.melody_double : null;
    const partnerShift = picks.melody_double_at === "octave_above" ? 12 : picks.melody_double_at === "octave_below" ? -12 : 0;
    for (const n of melodyNotes) {
      const shape = 0.9 + 0.16 * Math.sin(Math.PI * n.t / beats);
      const strong = rules.meter.strong.includes(q(n.t % bar)) ? 0.03 : 0;
      const vel = base * shape + strong + (n.midi === top ? 0.04 : 0);
      const answering = responder && responder !== mel.inst && n.t >= unit - 1e-6;
      const inst = answering ? responder : mel.inst;
      const midi = answering ? fold(n.midi + Math.round(((CENTRE[inst] ?? n.midi) - n.midi) / 12) * 12, inst) : n.midi;
      const useArt = answering ? artFor(inst, art) : art;
      push("melody", inst, useArt, n.t, n.dur, midi, vel);
      if (flags.octave_doubling) {
        const other = midi + (picks.doubling === "below" ? -12 : 12);
        const [lo, hi] = INSTRUMENTS[inst].range;
        if (other >= lo && other <= hi) push("melody", inst, useArt, n.t, n.dur, other, vel * 0.82);
      }
      if (partner) push("melody", partner, artFor(partner, art), n.t, n.dur, fold(midi + partnerShift, partner), vel * 0.85);
    }
    const firstDeg = draft.line[0]?.deg ?? null;
    if (picks.melody_start === "pickup" && last && melodyNotes.length && firstDeg !== null) {
      const first = melodyNotes[0];
      const from = melodyFacts(piece).lastEnd;
      const dir = from !== null && from > first.midi ? 1 : -1;
      const g = piece.grid;
      const [lo, hi] = INSTRUMENTS[mel.inst].range;
      [2, 1].forEach((k, i) => {
        const midi = first.midi + degreeToMidi(key, firstDeg + dir * k) - degreeToMidi(key, firstDeg);
        if (midi >= lo && midi <= hi) leadIn.push({ t: q(-k * g), dur: q(g), midi, vel: clamp(base * (0.72 + 0.1 * i), 0.05, 1), inst: mel.inst, art, layer: "melody" });
      });
      if (leadIn.length) remarks.push("the melody begins with a pickup");
    }
    mel.detail = `${picks.melody_register ?? "middle"} register${flags.octave_doubling ? `, doubled ${picks.doubling ?? "above"}` : ""}${responder && responder !== mel.inst ? `, answered by ${INSTRUMENTS[responder].name}` : ""}${partner ? `, doubled by ${INSTRUMENTS[partner].name}${partnerShift ? ` an octave ${partnerShift > 0 ? "above" : "below"}` : " in unison"}` : ""}`;
  }
  const ctr = chosen.counter;
  if (ctr.on && ctr.inst) {
    let line = [];
    let startAt = 0;
    let detail = draft.direction.counter.replace(/_/g, " ");
    const tctx = { grid: piece.grid };
    if (flags.overlap) {
      line = truncate(draft.line, beats - bar, piece.grid);
      startAt = bar;
      detail = "second entry of the melody, a bar later";
    } else if (draft.direction.counter === "counter_theme" && piece.theme("B")) {
      line = piece.theme("B").line;
      startAt = bar;
      detail = "counter-theme B";
    } else if (draft.direction.counter === "theme_augmented") {
      line = applyOps(piece.mainTheme.line, ["fragment_head", "augmentation"], tctx);
      detail = "theme A opening, augmented";
    } else if (draft.direction.counter === "sixths_below") {
      line = draft.line.map((n) => n.deg === null ? { ...n } : { ...n, deg: n.deg - 5 });
      detail = "melody a sixth below";
    } else {
      const each = bar / 2;
      let deg = 4;
      for (let t = 0; t < beats - 1e-6; t += each) {
        const slot = chordAt(draft.slots, t);
        if (fitOf(degreeToMidi(key, deg), slot.chord, key) === "clash") deg -= 1;
        line.push({ deg, dur: q(each) });
        deg -= 1;
      }
      detail = "stepwise descent from the fifth";
    }
    line = truncate(line, beats - startAt, piece.grid);
    ctr.art = "sustain";
    ctr.detail = detail;
    const base = velOf(ctr.dyn);
    for (const n of placeLine(line, key, ctr.inst, 0)) push("counter", ctr.inst, "sustain", n.t + startAt, n.dur, n.midi, base * (0.92 + 0.1 * Math.sin(Math.PI * (n.t + startAt) / beats)));
  }
  const inner = chosen.inner;
  if (inner.on && inner.inst) {
    const style = picks.inner_style ?? "sustain";
    const density = picks.inner_density ?? "three";
    const art = style === "tremolo" ? artFor(inner.inst, "tremolo") : style === "pulsed" ? artFor(inner.inst, "staccato") : "sustain";
    inner.art = art;
    inner.detail = `${density.replace("_plus", ", top doubled")} voices, ${style}`;
    const base = velOf(inner.dyn);
    const voicesOf = (slot) => {
      let v = slot.voices.slice().sort((a, b) => a - b);
      if (density === "two") v = v.slice(-2);
      if (density === "three_plus") v = [...v, v[v.length - 1] + 12];
      return [...new Set(v.map((x) => fold(x, inner.inst)))];
    };
    if (style === "pulsed") {
      for (const slot of draft.slots) {
        for (let t = slot.t; t < slot.t + slot.dur - 1e-6; t += 1) {
          for (const midi of voicesOf(slot)) push("inner", inner.inst, art, t, 0.5, midi, base * (rules.meter.strong.includes(q(t % bar)) ? 1 : 0.82));
        }
      }
    } else {
      const open = /* @__PURE__ */ new Map();
      const flush = (midi) => {
        const n = open.get(midi);
        if (n) push("inner", inner.inst, art, n.t, n.dur, midi, base);
        open.delete(midi);
      };
      for (const slot of draft.slots) {
        const now = voicesOf(slot);
        for (const midi of [...open.keys()]) if (!now.includes(midi)) flush(midi);
        for (const midi of now) {
          const held = open.get(midi);
          if (held) held.dur += slot.dur;
          else open.set(midi, { t: slot.t, dur: slot.dur });
        }
      }
      for (const midi of [...open.keys()]) flush(midi);
    }
  }
  const bass = chosen.bass;
  const bassNotes = [];
  const scale = MODES[key.mode].map((s) => mod(key.tonic + s, 12));
  draft.slots.forEach((slot, k) => {
    const root = mod(key.tonic + slot.chord.root, 12);
    const next = draft.slots[k + 1];
    const nextRoot = next ? mod(key.tonic + next.chord.root, 12) : root;
    if (slot.bass === "inversion") bassNotes.push({ t: slot.t, dur: slot.dur, pc: mod(root + slot.chord.intervals[1], 12) });
    else if (slot.bass === "pedal") {
      const prev = bassNotes[bassNotes.length - 1];
      if (prev && prev.pc === key.tonic && Math.abs(prev.t + prev.dur - slot.t) < 1e-6 && k > 0 && draft.slots[k - 1].bass === "pedal") prev.dur += slot.dur;
      else bassNotes.push({ t: slot.t, dur: slot.dur, pc: key.tonic });
    } else if (slot.bass === "walk" && slot.dur >= 2) {
      const walkLen = slot.dur >= 4 ? 2 : 1;
      bassNotes.push({ t: slot.t, dur: slot.dur - walkLen, pc: root });
      const idx = scale.indexOf(nextRoot);
      const below = idx >= 0 ? scale[mod(idx - 1, 7)] : mod(nextRoot - 2, 12);
      const below2 = idx >= 0 ? scale[mod(idx - 2, 7)] : mod(nextRoot - 4, 12);
      if (walkLen === 2) bassNotes.push({ t: slot.t + slot.dur - 2, dur: 1, pc: below2 });
      bassNotes.push({ t: slot.t + slot.dur - 1, dur: 1, pc: below });
    } else if (slot.bass === "octave_drop") {
      bassNotes.push({ t: slot.t, dur: slot.dur / 2, pc: root }, { t: slot.t + slot.dur / 2, dur: slot.dur / 2, pc: -1 - root });
    } else bassNotes.push({ t: slot.t, dur: slot.dur, pc: root });
  });
  const bassMidi = (pc, inst, low) => {
    const drop = pc < 0;
    const real = drop ? -1 - pc : pc;
    const baseOct = low ? 24 : 36;
    let m = pcIn(real, baseOct);
    const [lo] = INSTRUMENTS[inst].range;
    if (drop) m = m - 12 >= lo ? m - 12 : m;
    return fold(m, inst);
  };
  const pulsePattern = picks.pulse_pattern ?? "downbeats";
  const pulseIntensity = step("pulse_intensity");
  if (bass.on && bass.inst) {
    const low = picks.bass_octave === "low";
    const rhythm = picks.bass_rhythm ?? "held";
    bass.art = "sustain";
    bass.detail = `${[...new Set(draft.slots.map((s) => s.bass.replace("_", " ")))].join(", ")}${low ? ", low octave" : ""}${rhythm !== "held" ? `, ${rhythm.replace(/_/g, " ")}` : ""}`;
    const base = velOf(bass.dyn);
    if (rhythm === "held") {
      for (const n of bassNotes) push("bass", bass.inst, "sustain", n.t, n.dur, bassMidi(n.pc, bass.inst, low), base);
    } else {
      const noteAt = (at) => bassNotes.find((n) => at >= n.t - 1e-6 && at < n.t + n.dur - 1e-6) ?? bassNotes[bassNotes.length - 1];
      for (let b = 0; b < bars; b++) {
        let hits;
        if (rhythm === "eighths") hits = Array.from({ length: Math.round(bar * 2) }, (_x, i) => i * 0.5);
        else if (rhythm === "syncopated") hits = [0, 0.75, 1.5, 2.5, 3, 3.5].filter((x) => x < bar - 1e-6);
        else {
          hits = drumBar(pulsePattern, pulseIntensity, bar, rules.meter.sub, b === bars - 1, b).filter((h) => h.midi === 36).map((h) => h.t);
          if (!hits.length) hits = [0];
        }
        hits = [...new Set(hits.map(q))].sort((x, y) => x - y);
        hits.forEach((h, i) => {
          const at = b * bar + h;
          const until = b * bar + (hits[i + 1] ?? bar);
          const n = noteAt(at);
          const pc = n.pc < 0 ? -1 - n.pc : n.pc;
          const pop = rhythm === "syncopated" && (Math.abs(h - 1.5) < 1e-6 || Math.abs(h - 3.5) < 1e-6);
          const dur = rhythm === "with_kick" ? until - at : Math.min(until - at, rhythm === "eighths" ? 0.42 : 0.5);
          const midi = bassMidi(pc, bass.inst, low);
          push("bass", bass.inst, "sustain", at, dur, pop && midi + 12 <= INSTRUMENTS[bass.inst].range[1] ? midi + 12 : midi, base * (i === 0 ? 1 : 0.9));
        });
      }
    }
  }
  const ped = chosen.pedal;
  if (ped.on && ped.inst) {
    const pc = picks.pedal_note === "dominant" ? mod(key.tonic + 7, 12) : key.tonic;
    const span = picks.pedal_span === "half" ? unit : beats;
    const midi = fold(pcIn(pc, ped.inst === "horn" ? 48 : 36), ped.inst);
    ped.art = "sustain";
    ped.detail = `${picks.pedal_note ?? "tonic"}, ${picks.pedal_span === "half" ? "two bars" : "whole phrase"}`;
    push("pedal", ped.inst, "sustain", 0, span, midi, velOf(ped.dyn));
  }
  const fig = chosen.figuration;
  if (fig.on && fig.inst) {
    const perBeat = Number((picks.figuration_speed ?? "n2").slice(1));
    const pattern = picks.figuration_pattern ?? "rising";
    const stepLen = 1 / perBeat;
    const strings = fig.inst === "violins2" || fig.inst === "violas";
    const art = strings ? artFor(fig.inst, "pizzicato") : fig.inst === "pluck" ? "staccato" : "sustain";
    fig.art = art;
    fig.detail = `${pattern.replace("_", " ")}, ${perBeat} per beat`;
    const base = velOf(fig.dyn);
    const floor = fig.inst === "celesta" ? 72 : strings ? 55 : 48;
    for (const slot of draft.slots) {
      const pcs = chordPcs(slot.chord, key);
      const tones = [];
      for (let m = floor; tones.length < 6 && m < floor + 30; m++) if (pcs.includes(mod(m, 12))) tones.push(m);
      const rootLow = pcIn(mod(key.tonic + slot.chord.root, 12), floor);
      let seq;
      if (pattern === "rise_fall") seq = [...tones.slice(0, 5), ...tones.slice(1, 4).reverse()];
      else if (pattern === "broken") seq = [tones[0], tones[2] ?? tones[0], tones[1] ?? tones[0], tones[3] ?? tones[1] ?? tones[0]];
      else if (pattern === "ostinato") seq = [rootLow, rootLow + 7, rootLow + 12, rootLow + 7];
      else seq = tones.slice(0, 5);
      let i = 0;
      for (let t = slot.t; t < slot.t + slot.dur - 1e-6; t += stepLen, i++) {
        const midi = fold(seq[i % seq.length], fig.inst);
        const onBeat = Math.abs(t - Math.round(t)) < 1e-6;
        const ring = fig.inst === "harp" ? Math.min(2, slot.t + slot.dur - t) : fig.inst === "piano" ? Math.max(stepLen, Math.min(1, slot.t + slot.dur - t)) : stepLen;
        push("figuration", fig.inst, art, t, ring, midi, base * (onBeat ? 1 : 0.8));
      }
    }
  }
  const tex = chosen.texture;
  if (tex.on && tex.inst) {
    const base = velOf(tex.dyn);
    if (tex.inst === "noise") {
      tex.art = "sustain";
      tex.detail = "water and wave swell";
      push("texture", "noise", "sustain", 0, beats, 60, base);
    } else if (tex.inst === "cymbal") {
      tex.art = "roll";
      tex.detail = "roll swelling into the phrase end";
      push("texture", "cymbal", artFor("cymbal", "roll"), beats - bar, bar, 49, base * 0.8);
    } else {
      const art = tex.inst === "violins" ? artFor("violins", "tremolo") : "sustain";
      tex.art = art;
      tex.detail = tex.inst === "violins" ? "high tremolo shimmer" : "slow pad swell";
      for (const slot of draft.slots) {
        const top = slot.voices.slice().sort((a, b) => a - b).slice(-2);
        for (const v of top) {
          let midi = v + 12;
          while (midi < (tex.inst === "violins" ? 76 : 60)) midi += 12;
          push("texture", tex.inst, art, slot.t, slot.dur, fold(midi, tex.inst), base * 0.85);
        }
      }
    }
  }
  const pul = chosen.pulse;
  if (pul.on && pul.inst) {
    const pattern = pulsePattern;
    const intensity = pulseIntensity;
    const gain = velOf(pul.dyn) / velOf(3);
    pul.art = "hit";
    pul.detail = `${pattern.replace(/_/g, " ")}, intensity ${intensity + 1}/7`;
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const hits = drumBar(pattern, intensity, bar, rules.meter.sub, b === bars - 1, b);
      if (pul.inst === "drumkit") {
        for (const h of hits) push("pulse", "drumkit", "hit", t0 + h.t, 0.25, h.midi, h.vel * gain);
      } else if (pul.inst === "kick808") {
        for (const h of hits.filter((x) => x.midi === 36)) push("pulse", "kick808", "hit", t0 + h.t, 0.5, 36, h.vel * gain);
        if (rules.palette.includes("drumkit")) for (const h of hits.filter((x) => x.midi !== 36)) push("pulse", "drumkit", "hit", t0 + h.t, 0.25, h.midi, h.vel * gain);
      } else {
        const tonic = fold(pcIn(key.tonic, 41), "timpani");
        const dom = fold(pcIn(mod(key.tonic + 7, 12), 41), "timpani");
        if (pattern === "roll_to_downbeat" && b === bars - 1) push("pulse", "timpani", artFor("timpani", "roll"), t0, bar, dom, 0.5 * gain);
        else for (const h of hits.filter((x) => x.midi === 36)) push("pulse", "timpani", "hit", t0 + h.t, 1, h.t < 1e-6 ? tonic : dom, h.vel * gain * 0.9);
      }
    }
  }
  const acc = chosen.accents;
  let hitAt = null;
  if (acc.on) {
    const where = picks.accents_where ?? "phrase_start";
    const cue = piece.picture?.(index) ?? null;
    const snap = (b) => clamp(Math.round(b / piece.grid) * piece.grid, 0, beats - piece.grid);
    let t = where === "bar_3" ? Math.min(2, bars - 1) * bar : where === "last_bar" ? (bars - 1) * bar : 0;
    if (where === "video_peak" && cue?.peak) t = snap(cue.peak.beat);
    if (where === "video_cut" && cue?.cut) t = snap(cue.cut.beat);
    if (where === "melody_peak" && melodyNotes.length) {
      const top = Math.max(...melodyNotes.map((n) => n.midi));
      t = Math.floor(melodyNotes.find((n) => n.midi === top).t + 1e-6);
    }
    hitAt = t;
    const kind = picks.accents_kind ?? "bass_drum";
    const vel = velOf(acc.dyn);
    const has = (id) => rules.palette.includes(id);
    const root = mod(key.tonic + chordAt(draft.slots, t).chord.root, 12);
    const used = [];
    const hit = (id, art, at, dur, midi, v) => {
      if (!has(id)) return;
      push("accents", id, artFor(id, art), at, dur, midi, v);
      if (!used.includes(id)) used.push(id);
    };
    const all = kind === "full_hit";
    if (all || kind === "bass_drum") hit("bass_drum", "hit", t, 2, 36, vel);
    if (all || kind === "timpani") hit("timpani", "hit", t, 2, fold(pcIn(root, 41), "timpani"), vel);
    if (all || kind === "low_piano_octave") {
      hit("piano", "sustain", t, Math.min(4, beats - t), pcIn(root, 24), vel);
      hit("piano", "sustain", t, Math.min(4, beats - t), pcIn(root, 24) + 12, vel * 0.9);
    }
    if (all || kind === "tam_tam") hit("tam_tam", "hit", t, 4, 52, vel * 0.8);
    if (all || kind === "crash") {
      hit("drumkit", "hit", t, 1, 49, vel);
      hit("drumkit", "hit", t, 1, 36, vel);
    }
    if (all) hit("cymbal", "hit", t, 3, 49, vel * 0.9);
    if (kind === "cymbal_swell") {
      const start = Math.max(0, t - bar);
      if (t > 0) hit("cymbal", "roll", start, t - start, 49, vel * 0.8);
      else hit("cymbal", "roll", 0, bar, 49, vel * 0.8);
    }
    acc.inst = used[0] ?? null;
    acc.on = used.length > 0;
    acc.art = kind === "cymbal_swell" ? "roll" : "hit";
    acc.detail = `${kind.replace(/_/g, " ")} at ${where.replace(/_/g, " ")}`;
  }
  if (acc.on && hitAt !== null && hitAt >= bar && picks.pause_before_hit === "yes") {
    const from = hitAt - breathBeats(piece, index);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.layer === "accents" && n.art === "roll") continue;
      if (n.t >= from - 1e-6 && n.t < hitAt - 1e-6) notes.splice(i, 1);
      else if (n.t < from && n.t + n.dur > from) n.dur = q(from - n.t);
    }
    acc.detail += ", after a pause";
  }
  if (picks.join === "dovetail" && last) {
    const sustainer = (id) => !!id && !INSTRUMENTS[id].synth && INSTRUMENTS[id].arts.includes("sustain") && !["piano", "harp", "celesta", "glockenspiel", "vibraphone"].includes(id);
    const wasOn = (r) => last.layers.find((l) => l.role === r)?.inst ?? null;
    const heardBefore = new Set(last.score.notes.map((n) => n.inst));
    const usedNow = new Set(notes.map((n) => n.inst));
    const prevChord = last.score.holdChord;
    let stole = false;
    let lingered = false;
    if (inner.on && sustainer(inner.inst) && !heardBefore.has(inner.inst) && picks.inner_style !== "pulsed") {
      for (const h of prevChord.slice(1)) leadIn.push({ t: -bar, dur: bar, midi: fold(h.midi, inner.inst), vel: clamp(velOf(inner.dyn) * 0.55, 0.05, 1), inst: inner.inst, art: "sustain", layer: "inner" });
      stole = prevChord.length > 1;
    }
    if (bass.on && sustainer(bass.inst) && !heardBefore.has(bass.inst) && prevChord[0]) {
      leadIn.push({ t: -bar, dur: bar, midi: fold(prevChord[0].midi, bass.inst), vel: clamp(velOf(bass.dyn) * 0.55, 0.05, 1), inst: bass.inst, art: "sustain", layer: "bass" });
      stole = true;
    }
    const oldInner = wasOn("inner");
    if (sustainer(oldInner) && !usedNow.has(oldInner) && draft.slots[0]) {
      for (const v of draft.slots[0].voices) push("inner", oldInner, "sustain", 0, Math.min(bar, draft.slots[0].dur), fold(v, oldInner), 0.3);
      lingered = true;
    }
    const oldBass = wasOn("bass");
    if (sustainer(oldBass) && !usedNow.has(oldBass) && bassNotes[0]) {
      push("bass", oldBass, "sustain", 0, Math.min(bar, bassNotes[0].dur), bassMidi(bassNotes[0].pc, oldBass, false), 0.32);
      lingered = true;
    }
    if (stole || lingered) remarks.push(`dovetailed join${stole ? ": new instruments steal in a bar early" : ""}${lingered ? `${stole ? "," : ":"} the old ones linger a bar` : ""}`);
  }
  const keepOnly = (layers2, from, to) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (!layers2.includes(n.layer)) continue;
      const a = Math.max(n.t, from);
      const b = Math.min(n.t + n.dur, to);
      const struck = n.art !== "sustain" && n.art !== "tremolo";
      if (b - a <= 1e-6 || struck && n.t < from - 1e-6) notes.splice(i, 1);
      else {
        n.t = q(a);
        n.dur = q(b - a);
      }
    }
  };
  const ACCOMPANIMENT = ["counter", "inner", "figuration", "texture", "pulse"];
  if (picks.texture_shape === "late_entry") {
    keepOnly(ACCOMPANIMENT, unit, beats);
    remarks.push("accompaniment enters at the half");
  } else if (picks.texture_shape === "drop_out") {
    keepOnly(ACCOMPANIMENT, 0, unit);
    remarks.push("accompaniment drops out at the half");
  } else if (picks.texture_shape === "bare_ending") {
    keepOnly([...ACCOMPANIMENT, "bass", "pedal"], 0, beats - bar);
    remarks.push("melody alone in the last bar");
  }
  for (const r of LAYERS) {
    const c = chosen[r];
    if (!c.on || r === "accents") continue;
    if (c.entry === "delayed") {
      for (let i = notes.length - 1; i >= 0; i--) if (notes[i].layer === r && notes[i].t < bar - 1e-6) {
        const n = notes[i];
        if (n.t + n.dur > bar + 0.5 && INSTRUMENTS[n.inst].arts.includes("sustain") && n.art !== "hit") {
          n.dur = q(n.t + n.dur - bar);
          n.t = bar;
        } else notes.splice(i, 1);
      }
    } else if (c.entry === "fade_in") {
      for (const n of notes) if (n.layer === r && n.t < 1.5 * bar) n.vel = clamp(n.vel * (0.45 + 0.55 * n.t / (1.5 * bar)), 0.05, 1);
    }
  }
  const pedal = [];
  if (notes.some((n) => n.inst === "piano" && n.art === "sustain")) {
    draft.slots.forEach((slot, k) => {
      if (k > 0 || last) pedal.push({ t: q(slot.t), down: false });
      pedal.push({ t: q(slot.t + 0.08), down: true });
    });
  }
  const mix = {
    dynamics: step("overall_dynamics"),
    lowpass: step("fx_lowpass", 5),
    reverb: step("fx_reverb"),
    delay: step("fx_delay", 1),
    noise: step("fx_noise", 0),
    width: step("fx_width"),
    saturation: step("fx_saturation", 1),
    chorus: picks.fx_chorus === "yes",
    sidechain: picks.fx_sidechain === "yes" && notes.some((n) => n.midi === 36 && (n.inst === "drumkit" || n.inst === "kick808"))
  };
  if (tex.on && tex.inst === "noise") mix.noise = Math.max(mix.noise, 2);
  const lastSlot = draft.slots[draft.slots.length - 1];
  const sustainers = (r) => ROLE_INSTRUMENTS[r].filter((id) => rules.palette.includes(id) && id !== "piano");
  const holdInner = (inner.inst && inner.inst !== "piano" ? inner.inst : sustainers("inner")[0]) ?? sustainers("counter")[0] ?? rules.palette.find((id) => INSTRUMENTS[id].arts.includes("sustain") && !["noise"].includes(id)) ?? "pad";
  const holdBass = (bass.inst && bass.inst !== "piano" ? bass.inst : sustainers("bass")[0]) ?? holdInner;
  const lastBass = bassNotes[bassNotes.length - 1];
  const holdChord = [
    { midi: bassMidi(lastBass ? lastBass.pc : mod(key.tonic + lastSlot.chord.root, 12), holdBass, false), vel: 0.34, inst: holdBass, art: "sustain" },
    ...lastSlot.voices.map((v) => ({ midi: fold(v, holdInner), vel: 0.3, inst: holdInner, art: "sustain" }))
  ];
  const layers = LAYERS.map((r) => {
    const c = chosen[r];
    return { role: r, inst: c.on ? c.inst : null, dynamics: c.dyn, art: c.on ? c.art : null, entry: c.entry, detail: c.on ? c.detail : void 0 };
  });
  notes.sort((a, b) => a.t - b.t);
  return { notes, pedal, layers, mix, holdChord, remarks, leadIn };
}
function breathBeats(piece, index) {
  return clamp(q(0.55 * piece.bpmOf(index) / 60), piece.rules.meter.sub === 3 ? 1 / 3 : 0.5, 1);
}
function holdBreath(piece, index, w, gap, only) {
  const from = piece.beatsOf(index) - gap;
  for (let i = w.notes.length - 1; i >= 0; i--) {
    const n = w.notes[i];
    if (only && !only.includes(n.layer)) continue;
    if (n.t >= from - 1e-6) w.notes.splice(i, 1);
    else if (n.t + n.dur > from) n.dur = q(from - n.t);
  }
  if (only) return;
  w.pedal = w.pedal.filter((p) => p.t < from);
  if (w.pedal.length) w.pedal.push({ t: q(from), down: false });
}
async function orchestrate(ctx, index, draft) {
  const { piece, gw } = ctx;
  const { questions, offered } = buildQuestions(ctx, index, draft);
  const arrival = piece.plan.climaxArrival;
  const wall = index === piece.plan.climaxPhrase && isWall(arrival);
  const drop = index === piece.plan.climaxPhrase && arrival === "drop";
  const bloom = index === piece.plan.climaxPhrase && arrival === "bloom";
  const breath = index === piece.plan.climaxPhrase - 1 && arrivesAfterBreath(arrival);
  const played = playedFacts(piece);
  const chorus = piece.chorusAt(index);
  const chorusLines = [];
  if (chorus) {
    const firstChorus = piece.plan.sections.find((s) => s.part === "chorus");
    const before = piece.phrases.filter((ph) => piece.sectionOf(ph.index).part === "chorus" && piece.sectionOf(ph.index) !== piece.sectionOf(index));
    const biggest = before.sort((a, b) => new Set(b.score.notes.map((n) => n.inst)).size - new Set(a.score.notes.map((n) => n.inst)).size)[0];
    chorusLines.push(
      `CHORUS  this phrase is chorus ${chorus.n} of ${chorus.of}${chorus.source !== null ? `: the hook comes back with the melody and chords of phrase ${chorus.source + 1} (the first chorus began at phrase ${firstChorus.first + 1})` : ": the first time the hook is heard in full"}.` + (biggest ? ` The fullest chorus phrase so far was phrase ${biggest.index + 1}: ${biggest.layers.filter((l) => l.inst).map((l) => `${l.role} on ${INSTRUMENTS[l.inst].name}`).join(", ")}, overall ${DYNAMIC_NAMES[biggest.mix.dynamics]}.` : "") + (chorus.of > 1 ? chorus.n === chorus.of ? " This is the last chorus: it should be the biggest moment of the piece." : " A later chorus still has to top this one." : "")
    );
  } else if (piece.chorusAt(index + 1)?.starts) chorusLines.push(`NEXT    chorus ${piece.chorusAt(index + 1).n} of ${piece.chorusAt(index + 1).of} starts with the next phrase.`);
  const levelBefore = lastLevel(piece);
  const ans = await gw.ask({
    callType: "orchestration",
    title: `Phrase ${index + 1}: orchestration and mix`,
    state: piece.state("orchestration", index, [
      `ACCEPTED ${notation(draft.line)}   = ${draft.lineage}`,
      `CHORDS  ${draft.slots.map((s) => `${chordName(s.chord, draft.key)} (bass: ${s.bass.replace("_", " ")})`).join(" | ")}; key ${keyName(draft.key)}`,
      `PALETTE ${piece.rules.palette.map((id) => INSTRUMENTS[id].name).join(", ")}`,
      ...wall ? [`ARRIVAL this phrase is the climax, and the plan has it arrive as: ${ARRIVAL_LABEL[arrival]}. Already decided by that choice: overall dynamics fff, filter fully open, no pulse and no figuration, everything sustained.`] : [],
      ...bloom ? ["ARRIVAL this phrase is the climax, and the plan has it arrive as a held breath, then a still, bright clearing. Already decided by that choice: no pulse, no figuration, no counter-melody, no accent, everything sustained, the filter fully open. What makes the moment is stillness, light and the melody singing above held chords, not volume or the number of notes."] : [],
      ...chorusLines,
      ...drop ? ["ARRIVAL this phrase is the climax, and the plan has it arrive as the drop. Already decided by that choice: every layer plays, overall dynamics fff, filter fully open."] : [],
      ...breath ? [`ARRIVAL the next phrase is the climax, arriving after a held breath: this phrase stops just before its final bar line${arrival === "drop" ? ", and only the melody plays through its last bar" : ""}.`] : [],
      ...played ? [played] : []
    ]),
    questions,
    picking: "top"
  });
  const picks = ans.picks[0];
  if (drop) picks.density = "6";
  if (picks.density !== void 0) {
    const flags = draft.direction.flags;
    const supporting = ["counter", "inner", "bass", "pedal", "figuration", "texture", "pulse"].filter((r) => picks[`${r}_in`] !== void 0);
    const called = supporting.filter((r) => r === "pedal" && flags.pedal_underlay || r === "counter" && flags.overlap);
    const rest = supporting.filter((r) => !called.includes(r)).sort((a, b) => ans.values[`${b}_in`] - ans.values[`${a}_in`]);
    const places = Number(picks.density) >= 6 ? supporting.length : Number(picks.density);
    const on = /* @__PURE__ */ new Set([...called, ...supporting.filter((r) => ans.values[`${r}_in`] >= 0.5), ...rest.slice(0, Math.max(0, places - called.length))]);
    for (const r of supporting) picks[`${r}_in`] = on.has(r) ? "yes" : "no";
  }
  if (picks.melody_voice) [picks.melody_inst, picks.melody_register] = picks.melody_voice.split("__");
  if (picks.melody_double && picks.melody_double === picks.melody_inst) {
    const next = Object.entries(ans.probabilities.melody_double ?? {}).sort((a, b) => b[1] - a[1]).find(([id]) => id !== picks.melody_inst);
    picks.melody_double = next ? next[0] : "none";
  }
  if (picks.counter_inst && picks.counter_inst === picks.melody_inst && picks.melody_in === "yes") {
    const next = Object.entries(ans.probabilities.counter_inst ?? {}).sort((a, b) => b[1] - a[1]).find(([id]) => id !== picks.melody_inst);
    if (next) picks.counter_inst = next[0];
  }
  if (wall || drop) {
    picks.overall_dynamics = "6";
    picks.fx_lowpass = "6";
  }
  const song = wall || drop ? null : songLevel(piece, index);
  if (song !== null) picks.overall_dynamics = String(song);
  if (bloom) {
    picks.overall_dynamics = String(clamp(Math.round(levelBefore ?? 3) + (picks.bloom_level === "two" ? 2 : picks.bloom_level === "same" ? 0 : 1), 0, 6));
    picks.fx_lowpass = "6";
  }
  const w = write(ctx, index, draft, picks, ans.values, offered);
  const bar = piece.rules.meter.beatsPerBar;
  if (breath && arrival === "drop") holdBreath(piece, index, w, bar, ["counter", "inner", "bass", "pedal", "figuration", "texture", "pulse", "accents"]);
  if (breath) holdBreath(piece, index, w, breathBeats(piece, index));
  else if (picks.phrase_close === "melody_breathes") {
    holdBreath(piece, index, w, 1, ["melody"]);
    w.remarks.push("the melody breathes before the bar line");
  } else if (picks.phrase_close === "all_breathe") {
    holdBreath(piece, index, w, breathBeats(piece, index));
    w.remarks.push("everyone breathes before the bar line");
  } else if (picks.phrase_close === "long_silence") {
    holdBreath(piece, index, w, bar / 2);
    w.remarks.push("a long silence closes the phrase");
  } else if (picks.phrase_close === "strip_back") {
    holdBreath(piece, index, w, bar, ["counter", "inner", "bass", "pedal", "figuration", "texture", "pulse", "accents"]);
    w.remarks.push("the beat drops out for the last bar");
  }
  const dynCurve = dynamicCurve(picks.dynamic_shape ?? "steady", w.mix.dynamics, levelBefore, piece.beatsOf(index));
  if (dynCurve) w.remarks.push(picks.dynamic_shape);
  const holdSec = piece.phraseHoldSec.get(index) ?? 0;
  const section = piece.sectionOf(index);
  const role = piece.roleOf(index);
  const score = {
    index,
    section: section.index,
    role,
    bars: piece.barsOf(index),
    beatsPerBar: piece.rules.meter.beatsPerBar,
    beats: piece.beatsOf(index),
    bpm: piece.bpmOf(index),
    notes: w.notes,
    pedal: w.pedal,
    mix: w.mix,
    holdChord: w.holdChord,
    ...dynCurve ? { dynCurve } : {},
    display: {
      key: keyName(draft.key),
      notation: notation(draft.line),
      lineage: `phrase ${index + 1} = ${draft.lineage}${wall || drop || bloom ? `; the climax arrives: ${ARRIVAL_LABEL[arrival]}` : breath ? "; ends on a held breath" : ""}${w.remarks.length ? `; ${w.remarks.join(", ")}` : ""}`,
      chords: draft.slots.map((s) => chordName(s.chord, draft.key)),
      layers: w.layers,
      tension: piece.tensionOf(index)
    }
  };
  if (holdSec > 0) linger(score, holdSec * score.bpm / 60);
  return {
    index,
    section: section.index,
    role,
    key: draft.key,
    direction: draft.direction,
    line: draft.line,
    lineage: draft.lineage,
    depth: draft.depth,
    slots: draft.slots,
    themeIntact: draft.intact,
    related: draft.related,
    layers: w.layers,
    mix: w.mix,
    score,
    close: breath ? "breath" : picks.phrase_close ?? "run_on",
    start: picks.melody_start ?? "downbeat",
    join: picks.join ?? "clean",
    ...w.leadIn.length ? { leadIn: w.leadIn } : {}
  };
}

// server/core/facts.ts
function lcs(a, b, same = (x, y) => x === y) {
  if (!a.length || !b.length) return 0;
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = same(a[i - 1], b[j - 1]) ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = up;
    }
  }
  return row[b.length];
}
var intervalsOf = (line) => {
  const p = pitched(line);
  return p.slice(1).map((n, i) => n.deg - p[i].deg);
};
var contourSigns = (line) => intervalsOf(line).map(Math.sign);
var durations = (line) => pitched(line).map((n) => q(n.dur));
var ratios = (line) => {
  const d = durations(line);
  return d.slice(1).map((x, i) => Math.round(x / d[i] * 100) / 100);
};
function keptIn(a, b) {
  if (!a.length || !b.length) return 0;
  const width = Math.ceil(a.length * 1.5) + 1;
  if (b.length <= width) return lcs(a, b) / a.length;
  let best = 0;
  for (let i = 0; i + width <= b.length && best < a.length; i++) best = Math.max(best, lcs(a, b.slice(i, i + width)));
  return best / a.length;
}
function shareKept(theme, line) {
  const intervals = keptIn(intervalsOf(theme), intervalsOf(line));
  const contour = keptIn(contourSigns(theme), contourSigns(line));
  const rhythm = Math.max(keptIn(durations(theme), durations(line)), keptIn(ratios(theme), ratios(line)));
  return { contour, intervals, rhythm, overall: 0.4 * intervals + 0.25 * contour + 0.35 * rhythm };
}
function similarity(a, b, chordsA = [], chordsB = []) {
  const tok = (line) => pitched(line).map((n) => `${n.deg}:${q(n.dur)}`);
  const ta = tok(a);
  const tb = tok(b);
  const melodic = ta.length && tb.length ? lcs(ta, tb) / Math.max(ta.length, tb.length) : 0;
  if (!chordsA.length || chordsA.length !== chordsB.length) return melodic;
  const same = chordsA.filter((c, i) => c === chordsB[i]).length / chordsA.length;
  return 0.75 * melodic + 0.25 * same;
}
function clashes(line, slots, key) {
  const out = [];
  let t = 0;
  for (const n of line) {
    if (n.deg !== null && n.dur >= 0.5) {
      const slot = slots.find((s) => t >= s.t - 1e-6 && t < s.t + s.dur - 1e-6);
      if (slot) {
        const midi = degreeToMidi(key, n.deg, n.alt ?? 0);
        if (fitOf(midi, slot.chord, key) === "clash") out.push({ beat: q(t), note: midiName(midi, key), chord: chordName(slot.chord, key) });
      }
    }
    t += n.dur;
  }
  return out;
}
function shapeOf(line, key) {
  const p = pitched(line);
  const midis = p.map((n) => degreeToMidi(key, n.deg, n.alt ?? 0));
  const iv = intervalsOf(line);
  let largest = 0;
  let recovered = false;
  iv.forEach((x, i) => {
    if (Math.abs(x) > Math.abs(largest)) largest = x;
    if (Math.abs(x) >= 2 && i + 1 < iv.length && Math.abs(iv[i + 1]) === 1 && Math.sign(iv[i + 1]) === -Math.sign(x)) recovered = true;
  });
  const signs = iv.map(Math.sign).filter((s) => s !== 0);
  return {
    rangeSemitones: midis.length ? Math.max(...midis) - Math.min(...midis) : 0,
    largestLeap: Math.abs(largest),
    distinct: new Set(p.map((n) => n.deg)).size,
    repeats: iv.filter((x) => x === 0).length,
    leapRecovered: recovered,
    oneDirection: signs.length > 1 && signs.every((s) => s === signs[0])
  };
}
var pct = (x) => `${Math.round(x * 100)}%`;

// server/calls/phrase.ts
var opt3 = (key, label, criteria, prior = 0) => ({ key, label, criteria, prior });
var PHRASE_DRAFTS = 4;
var COPY_LEVEL = 0.8;
var DRIFT_LEVEL = 0.4;
var HARMONIC_RHYTHM = {
  two_bars: "one chord every two bars: broad and still",
  bar: "one chord per bar: steady, walking harmony",
  half_bar: "two chords per bar: busy, urgent, pushing forward",
  oscillation: "two chords alternating bar by bar: stillness, breathing"
};
var ENDINGS = {
  resolved: "resolved: the phrase comes to rest on the tonic",
  half_resolved: "half-resolved: the phrase pauses on the dominant, expecting more",
  suspended: "suspended: the phrase ends unresolved and floating"
};
var COUNTER = {
  none: "no counter-melody: the melody stands alone against the harmony",
  counter_theme: "the counter-theme runs under the melody",
  theme_augmented: "the opening of the main theme at half speed, low, as a slow shadow of the melody",
  descending_steps: "a slow stepwise descent from the fifth: a sighing line against the melody",
  sixths_below: "the melody doubled a sixth below: sweet, blended, sung together"
};
function recentOps(piece) {
  const out = /* @__PURE__ */ new Map();
  piece.phrases.slice(-2).forEach((ph, i, all) => {
    const weight = i === all.length - 1 ? 0.9 : 0.5;
    for (const id of [...ph.direction.seg1.ops, ...ph.direction.seg2.ops]) out.set(id, Math.max(out.get(id) ?? 0, weight));
  });
  return out;
}
function opWeight(role, seg, id) {
  const dev = {
    seq_up_step: 1,
    seq_up_third: 1,
    seq_down_step: 0.9,
    seq_down_third: 0.8,
    inversion: 0.7,
    fragment_head: 0.9,
    fragment_tail: 0.6,
    expand: 0.8,
    contract: 0.5,
    displace_half: 0.5,
    displace_beat: 0.4,
    ornament: 0.9,
    extension: 0.7,
    register_up: 0.5,
    register_down: 0.4,
    diminution: 0.5,
    augmentation: 0.3,
    retrograde: 0.3,
    liquidation: seg === 2 ? 1 : 0.3,
    none: 0.1
  };
  const table = {
    statement: seg === 1 ? { none: 3.2 } : { none: 0.9, seq_up_step: 1, seq_up_third: 0.8, seq_down_step: 0.8, ornament: 0.8, extension: 0.6 },
    development: dev,
    departure: { none: 1.6, seq_up_step: 0.6, seq_down_step: 0.6, ornament: 0.6, extension: 0.5, inversion: 0.4, seq_up_third: 0.5 },
    return: seg === 1 ? { none: 3.2 } : { none: 1, ornament: 1, extension: 0.8, seq_up_step: 0.6 },
    climax: { register_up: 1.6, expand: 1.3, seq_up_third: 1, augmentation: 0.9, extension: 0.8, none: 0.5, seq_up_step: 0.7 },
    coda: { augmentation: 1.4, liquidation: seg === 2 ? 1.5 : 0.6, fragment_tail: 1, register_down: 0.8, contract: 0.8, none: 0.6, fragment_head: 0.6 }
  };
  return table[role][id] ?? -0.8;
}
function planFixed(piece, index) {
  if (piece.chorusAt(index)) return { seg1_source: "A", seg1_op1: "none" };
  if (index !== piece.plan.climaxPhrase) return {};
  if (piece.plan.climaxTheme === "returns") return { seg1_source: "A", seg1_op1: "none" };
  if (piece.plan.climaxTheme === "broadened") return { seg1_source: "A", seg1_op1: "augmentation" };
  return {};
}
function directionQuestions(ctx, index) {
  const { piece } = ctx;
  const role = piece.roleOf(index);
  const t = piece.tensionOf(index);
  const style = piece.rules.style;
  const orch = style === "bittersweet_orchestral";
  const m = piece.mood;
  const recent = recentOps(piece);
  const rej = piece.lastReject.toLowerCase();
  const wasCopy = /close|copy/.test(rej);
  const wasDrift = /related|drift/.test(rej);
  const wasTooNear = /contrast/.test(rej);
  const last = piece.phrases[piece.phrases.length - 1];
  const hasB = !!piece.theme("B");
  const hasC = !!piece.theme("C");
  const section = piece.sectionOf(index);
  const sectionEnd = index === section.last;
  const finalPhrase = index === piece.plan.totalPhrases - 1;
  const fixed = planFixed(piece, index);
  const wallHere = index === piece.plan.climaxPhrase && (isWall(piece.plan.climaxArrival) || piece.plan.climaxArrival === "bloom");
  const wallNext = index === piece.plan.climaxPhrase - 1 && arrivesAfterBreath(piece.plan.climaxArrival);
  const sources = (seg) => {
    const lead = role === "statement" || role === "return" || role === "climax" || role === "coda";
    const out = [
      opt3(
        "A",
        "theme A",
        `the main theme: ${notation(piece.mainTheme.line)}`,
        role === "departure" ? (hasC ? -1.5 : 0.3) - (wasTooNear ? 2.5 : 0) : lead ? 2.6 : 1.5 + (wasDrift ? 1.5 : 0)
      )
    ];
    if (hasB) out.push(opt3("B", "counter-theme B", `the counter-theme: ${notation(piece.theme("B").line)}`, role === "development" ? 0.3 : -1));
    if (hasC) out.push(opt3("C", "contrast theme C", `the contrast theme, for departures: ${notation(piece.theme("C").line)}`, role === "departure" ? 3 : -2));
    if (last) {
      out.push(opt3(
        "prev",
        "previous phrase",
        `carry on from the second half of the previous phrase (${last.lineage})`,
        role === "development" ? (last.depth < 3 ? 1.1 : -0.4) - (wasDrift ? 1.5 : 0) : role === "departure" ? hasC ? 0 : 0.6 : 0.2
      ));
    }
    if (seg === 2) out.push(opt3("first_half", "first half of this phrase", "answer the first half of this phrase with a variant of itself", role === "development" ? 1.5 : role === "departure" ? 1.2 : 0.9));
    return out;
  };
  const ops = (seg, second) => {
    const all = [
      opt3("none", "none (intact)", second ? "no further change" : "leave the material intact", (second ? 1.7 : 0) + opWeight(role, seg, "none") * (second ? 0.3 : 1) - (wasCopy ? 1.5 : 0) + (wasDrift ? 1.2 : 0)),
      ...MELODIC_OPS.map((o) => {
        let w = opWeight(role, seg, o.id) * (second ? 0.6 : 1);
        if (t >= 5 && ["seq_up_step", "seq_up_third", "expand", "diminution", "fragment_head", "register_up"].includes(o.id)) w += 0.5;
        if (t <= 2.5 && ["augmentation", "contract", "register_down", "liquidation"].includes(o.id)) w += 0.4;
        w -= recent.get(o.id) ?? 0;
        if (wasCopy) w += 0.5;
        if (wasDrift && ["retrograde", "liquidation", "inversion", "fragment_tail"].includes(o.id)) w -= 0.8;
        if (wasTooNear && !hasC && ["retrograde", "inversion", "liquidation", "augmentation", "contract"].includes(o.id)) w += 1.4;
        return opt3(o.id, o.label, o.effect, w);
      })
    ];
    if (seg === 1 && second && fixed.seg1_source) return all.filter((o) => o.key === "none" || o.key === "register_up");
    return all;
  };
  const questions = [
    { id: "seg1_source", type: "choice", label: "First half: material", instructions: "A phrase has two halves. What material should the first half be built from?", options: sources(1) },
    { id: "seg1_op1", type: "choice", label: "First half: transformation", instructions: "Which transformation should be applied to the first half's material?", options: ops(1, false) },
    { id: "seg1_op2", type: "choice", label: "First half: second transformation", instructions: "Should a second transformation be applied on top, in the first half?", options: ops(1, true) },
    { id: "seg2_source", type: "choice", label: "Second half: material", instructions: "What material should the second half be built from?", options: sources(2) },
    { id: "seg2_op1", type: "choice", label: "Second half: transformation", instructions: "Which transformation should be applied to the second half's material?", options: ops(2, false) },
    { id: "seg2_op2", type: "choice", label: "Second half: second transformation", instructions: "Should a second transformation be applied on top, in the second half?", options: ops(2, true) },
    {
      id: "counter_line",
      type: "choice",
      label: "Counter-melody",
      instructions: "What should the counter-melody line be, if the orchestration brings one in?",
      options: Object.entries(COUNTER).filter(([k]) => k !== "counter_theme" || hasB).map(([k, text]) => opt3(
        k,
        k.replace(/_/g, " "),
        text,
        k === "none" ? 2.4 - t * 0.55 : k === "counter_theme" ? 1.1 : k === "theme_augmented" ? 0.5 + (role === "departure" ? 0.5 : 0) : k === "descending_steps" ? 0.5 + Math.max(0, -m.valence) * 0.5 : 0.2 + (role === "climax" ? 0.6 : 0)
      ))
    }
  ];
  const yesPrior = {
    reharmonise: role === "return" ? 0.88 : role === "development" ? 0.3 : role === "statement" ? 0.05 : 0.2,
    mode_mixture: clamp((0.05 + m.darkness * 0.12 + (section.key.tonic !== piece.rules.key.tonic ? 0.15 : 0)) * (index < 3 ? 0.3 : 1), 0, 1),
    handoff: !last ? 0.02 : role === "return" ? 0.72 : role === "development" ? 0.28 : 0.15,
    call_response: style === "playful" ? 0.3 : 0.1,
    overlap: t >= 5 ? 0.34 : 0.07,
    pedal_underlay: role === "coda" ? 0.5 : orch ? 0.2 + (t <= 2.5 ? 0.2 : 0) : 0.12,
    octave_doubling: role === "climax" ? 0.88 : t >= 6 ? 0.55 : 0.08
  };
  for (const tex of TEXTURE_OPS) {
    questions.push({
      id: tex.id,
      type: "noul",
      label: tex.label,
      instructions: `Should this phrase use ${tex.label.toLowerCase()}? Effect: ${tex.effect}.`,
      prior: yesPrior[tex.id]
    });
  }
  questions.push({
    id: "harmonic_rhythm",
    type: "choice",
    label: "Harmonic rhythm",
    instructions: "How fast should the chords change in this phrase?",
    options: Object.entries(HARMONIC_RHYTHM).filter(([k]) => !(wallHere && k === "half_bar")).map(([k, text]) => opt3(
      k,
      k.replace(/_/g, " "),
      text,
      k === "oscillation" ? (orch ? 1.6 - t * 0.3 : 0.6) + (index === 0 && orch ? 0.8 : 0) : k === "two_bars" ? 1.2 - t * 0.25 : k === "bar" ? 1 : -1.2 + t * 0.32
    ))
  });
  const endPref = finalPhrase ? { resolved: piece.rules.ending === "resolved" ? 3 : 0.3, half_resolved: piece.rules.ending === "sudden_stop" ? 2 : 0, suspended: piece.rules.ending === "suspended" || piece.rules.ending === "fade" ? 2.5 : 0.2 } : { resolved: (sectionEnd ? 1 : 0.2) + (orch ? 0 : 0.4), half_resolved: 0.9 + (wallNext ? 1.5 : 0), suspended: orch ? 1 : 0.4 };
  questions.push({
    id: "phrase_ending",
    type: "choice",
    label: "Phrase ending",
    instructions: wallNext ? "How should the phrase end? The climax arrives straight after it, following a held breath: the chord left hanging in that silence decides whether the arrival feels earned." : "How should the phrase end?",
    options: Object.entries(ENDINGS).map(([k, text]) => opt3(k, k.replace(/_/g, " "), text, endPref[k]))
  });
  const nextKey = index + 1 < piece.plan.totalPhrases ? piece.sectionOf(index + 1).key : section.key;
  if (nextKey.tonic !== section.key.tonic || nextKey.mode !== section.key.mode) {
    questions.push({
      id: "modulation",
      type: "choice",
      label: "Modulation",
      instructions: `The next phrase is in ${keyName(nextKey)}. How should this phrase get there?`,
      options: [
        opt3("pivot", "pivot chord", "pivot chord: end on the dominant of the new key so the change feels prepared", 1.2),
        opt3("direct", "direct shift", "direct shift: no preparation; the new key simply arrives, a jolt or a lift", index + 1 === piece.plan.climaxPhrase ? 1.4 : 0.5),
        opt3("common_tone", "common tone", "common tone: end on a suspended chord sharing a note with the new key, then melt into it", 0.7)
      ]
    });
  }
  if (lengthAsked(piece)) {
    const recent2 = piece.phrases.slice(-4).map((ph) => ph.score.bars);
    let sameRun = 0;
    for (let i = recent2.length - 1; i >= 0 && recent2[i] === 4; i--) sameRun++;
    const text = {
      2: ["two bars: half the usual length. One idea said once, then straight on: urgency, an interjection, a quick answer", -0.4 + (t >= 5 ? 0.5 : 0)],
      3: ["three bars: a contracted phrase. The close comes a bar early, so the next phrase arrives sooner than expected: pressing forward", 0.2 + (t >= 4.5 ? 0.5 : 0)],
      4: ["four bars: the regular length. Balanced and expected", 1.7 - 0.45 * sameRun],
      5: ["five bars: an extended phrase. The last note is held through an extra bar: the close lingers, with time to breathe", 0.4 + (sectionEnd ? 0.7 : 0) + (t <= 3 ? 0.3 : 0)],
      6: ["six bars: a long-breathed phrase. Its first idea is said twice before the answer comes: insistence, a broad span", 0.1 + (role === "climax" ? 0.6 : 0)]
    };
    const min = Math.max(2, piece.themeBars, fixed.seg1_source ? 4 : 2, index === 0 ? Math.min(4, piece.themeBars + 1) : 2);
    questions.push({
      id: "phrase_length",
      type: "choice",
      label: "Phrase length",
      instructions: `How many bars long should this phrase be? The theme fills ${piece.themeBars} bar${piece.themeBars === 1 ? "" : "s"}.${recent2.length ? ` The last ${recent2.length === 1 ? "phrase was" : `${recent2.length} phrases were`} ${recent2.join(", ")} bars long.` : ""}`,
      options: [2, 3, 4, 5, 6].filter((b) => b >= min).map((b) => opt3(String(b), `${b} bars`, text[b][0], text[b][1]))
    });
  }
  return questions.filter((qn) => !(qn.id in fixed));
}
var lengthAsked = (piece) => piece.rules.style !== "beat_driven" && !piece.picture;
function directionFrom(p) {
  const seg = (n) => {
    const o1 = p[`seg${n}_op1`];
    const o2 = p[`seg${n}_op2`];
    const ops = [o1, o2].filter((o, i, all) => o && o !== "none" && all.indexOf(o) === i);
    return { source: p[`seg${n}_source`], ops };
  };
  const flags = {};
  for (const tex of TEXTURE_OPS) flags[tex.id] = p[tex.id] === "yes";
  return { seg1: seg(1), seg2: seg(2), counter: p.counter_line, flags, harmonicRhythm: p.harmonic_rhythm, ending: p.phrase_ending, modulation: p.modulation };
}
function sliceLine(line, from, to) {
  const out = [];
  let t = 0;
  for (const n of line) {
    const a = Math.max(t, from);
    const b = Math.min(t + n.dur, to);
    if (b - a > 1e-6) out.push({ ...n, dur: q(b - a) });
    t += n.dur;
  }
  while (out.length && out[0].deg === null) out.shift();
  while (out.length && out[out.length - 1].deg === null) out.pop();
  return out;
}
function buildLine(piece, dir, index) {
  const unit = piece.segStart(index);
  const whole = piece.beatsOf(index);
  const bars = piece.barsOf(index);
  const prevHalf = piece.phrases.length ? piece.segStart(piece.phrases[piece.phrases.length - 1].index) : unit;
  const prevWhole = piece.phrases.length ? piece.beatsOf(piece.phrases[piece.phrases.length - 1].index) : whole;
  const ctx = { grid: piece.grid };
  const last = piece.phrases[piece.phrases.length - 1];
  let truncated = false;
  const material = (source, firstHalf) => {
    if (source === "first_half") return { line: firstHalf, name: "first half", depth: 0 };
    if (source === "prev" && last) {
      const tail2 = sliceLine(last.line, prevHalf, prevWhole);
      const use = pitched(tail2).length >= 2 ? tail2 : sliceLine(last.line, 0, prevHalf);
      return { line: use, name: `phrase ${last.index + 1} tail`, depth: last.depth + 1 };
    }
    const theme = piece.theme(source) ?? piece.mainTheme;
    return { line: theme.line, name: theme.id, depth: 0 };
  };
  const m1 = material(dir.seg1.source === "first_half" ? "A" : dir.seg1.source, []);
  let seg1 = applyOps(m1.line, dir.seg1.ops, ctx);
  if (lineLength(seg1) > whole) {
    seg1 = truncate(seg1, whole, piece.grid);
    truncated = true;
  }
  const twice = bars === 6 && lineLength(seg1) <= unit / 2 && pitched(seg1).length > 0;
  if (twice) seg1 = [...padTo(seg1, unit / 2), ...seg1];
  const len1 = lineLength(seg1);
  const start2 = Math.max(unit, Math.ceil(len1 - 1e-6));
  const room = q(whole - start2);
  const m2 = material(dir.seg2.source, seg1);
  let seg2 = applyOps(m2.line, dir.seg2.ops, ctx);
  let seg2Used = room >= 1 && pitched(seg2).length > 0;
  if (seg2Used && lineLength(seg2) > room) {
    seg2 = truncate(seg2, room, piece.grid);
    truncated = true;
    seg2Used = pitched(seg2).length > 0;
  }
  let line = padTo(seg1, start2);
  if (seg2Used) line = [...line, ...seg2];
  line = mergeRests(padTo(line, whole));
  if (bars === 5 && line.length >= 2 && line[line.length - 1].deg === null && line[line.length - 2].deg !== null) {
    const rest = line.pop();
    line[line.length - 1] = { ...line[line.length - 1], dur: q(line[line.length - 1].dur + rest.dur) };
  }
  const part = (name, ops) => `${name} ${describeOps(ops)}`.replace(" intact", ops.length ? "" : " intact");
  let lineage = part(m1.name, dir.seg1.ops) + (twice ? ", said twice" : "");
  if (seg2Used) lineage += ` + ${part(m2.name === "first half" ? "the same again" : m2.name, dir.seg2.ops)}`;
  const texture = TEXTURE_OPS.filter((x) => dir.flags[x.id]).map((x) => x.phrase);
  if (texture.length) lineage += `; ${texture.join(", ")}`;
  if (bars !== 4) lineage += `; ${bars} bars${bars === 5 ? ", the close held" : ""}`;
  const intact = (dir.seg1.source === "A" || dir.seg1.source === "first_half") && dir.seg1.ops.length === 0;
  const depth = Math.max(m1.depth + dir.seg1.ops.length, seg2Used ? (m2.name === "first half" ? m1.depth + dir.seg1.ops.length : m2.depth) + dir.seg2.ops.length : 0);
  return { line, lineage, depth, intact, truncated };
}
function slotLayout(piece, harmonicRhythm, index) {
  const bar = piece.rules.meter.beatsPerBar;
  const bars = piece.barsOf(index);
  if (harmonicRhythm === "two_bars" && bars >= 2) {
    const out = [];
    for (let b = 0; b < bars; b += 2) out.push({ t: b * bar, dur: Math.min(2, bars - b) * bar, group: String(out.length + 1) });
    return out;
  }
  if (harmonicRhythm === "half_bar") return Array.from({ length: bars * 2 }, (_x, i) => ({ t: q(i * bar / 2), dur: q(bar / 2), group: String(i + 1) }));
  if (harmonicRhythm === "oscillation" && bars >= 3) return Array.from({ length: bars }, (_x, i) => ({ t: i * bar, dur: bar, group: i === bars - 1 ? "end" : i % 2 === 0 ? "a" : "b" }));
  return Array.from({ length: bars }, (_x, i) => ({ t: i * bar, dur: bar, group: String(i + 1) }));
}
function melodyOver(line, key, from, to) {
  const out = [];
  let t = 0;
  for (const n of line) {
    const overlap = Math.min(t + n.dur, to) - Math.max(t, from);
    if (n.deg !== null && overlap > 1e-6) out.push({ midi: degreeToMidi(key, n.deg, n.alt ?? 0), weight: overlap / (to - from) });
    t += n.dur;
  }
  return out;
}
function endingAllowed(chord, ending) {
  if (ending === "resolved") return chord.root === 0 && chord.family !== "suspended" && chord.family !== "late_romantic";
  if (ending === "half_resolved") return chord.root === 7 && chord.family !== "chromatic_mediant";
  return chord.family === "suspended" || [5, 8, 9, 2].includes(chord.root);
}
function modulationChords(key, next, how) {
  const rel = mod(next.tonic - key.tonic, 12);
  const mk = (id, root, intervals, roman, effect, fn = "dominant") => ({ id, root: mod(root, 12), intervals, family: "borrowed", fn, roman, effect });
  if (how === "pivot") {
    return [
      mk("pivot_V", rel + 7, [0, 4, 7], "V of new key", "the dominant of the new key: prepares the change firmly"),
      mk("pivot_V7", rel + 7, [0, 4, 7, 10], "V7 of new key", "the dominant seventh of the new key: leans hard into the change")
    ];
  }
  if (how === "common_tone") {
    return [
      mk("ct_sus4", rel, [0, 5, 7], "new I sus4", "the new tonic, suspended: melts into the new key", "tonic"),
      mk("ct_sus2", rel, [0, 2, 7], "new I sus2", "the new tonic, open and unresolved: drifts into the new key", "tonic"),
      mk("ct_Vsus", rel + 7, [0, 5, 7], "new V sus4", "the new dominant, suspended: hovers before the change")
    ];
  }
  return null;
}
async function chordPath(ctx, index, draft, label) {
  const { piece, gw } = ctx;
  const { direction: dir, key, line } = draft;
  const role = piece.roleOf(index);
  const t = piece.tensionOf(index);
  const lang = piece.rules.harmonicLanguage;
  const section = piece.sectionOf(index);
  const dark = section.key.tonic !== piece.rules.key.tonic && piece.rules.keyPlan === "distant_dark_turn";
  const layout = slotLayout(piece, dir.harmonicRhythm, index);
  const groups = [...new Set(layout.map((s) => s.group))];
  const lastGroup = layout[layout.length - 1].group;
  const candidates = chordCandidates(key);
  const nextKey = index + 1 < piece.plan.totalPhrases ? piece.sectionOf(index + 1).key : section.key;
  const modChords = dir.modulation ? modulationChords(key, nextKey, dir.modulation) : null;
  let previousUse = [];
  if (dir.flags.reharmonise) {
    const ref = [...piece.phrases].reverse().find((ph) => ph.direction.seg1.source === dir.seg1.source && ph.direction.seg1.ops.join() === dir.seg1.ops.join());
    if (ref && ref.slots.length === layout.length) previousUse = ref.slots.map((s) => s.chord.id);
  }
  const famPrior = (c) => {
    const four = c.intervals.length >= 4;
    switch (c.family) {
      case "diatonic":
        return (lang === "triads" ? 1 : lang === "sevenths" ? 0.2 : lang === "extended" ? -0.3 : 0) - (c.intervals[2] === 6 ? 1.2 : 0);
      case "diatonic_extended":
        return (lang === "extended" ? 1.1 + (c.intervals.includes(14) ? 0.3 : 0) : lang === "sevenths" ? four ? 0.9 : 0.4 : lang === "triads" ? -0.6 : 0.3) - (c.intervals[2] === 6 ? 1 : 0);
      case "suspended":
        return lang === "suspended" ? 1.2 : 0;
      case "borrowed":
        return -1.3 + t * 0.16 + (lang === "chromatic" ? 1.2 : 0) + (dark ? 0.6 : 0);
      case "chromatic_mediant":
        return -1.5 + (lang === "chromatic" ? 1.2 : 0) + (dark ? 1 : 0) + (t >= 6 ? 0.5 : 0);
      default:
        return -1.7 + (lang === "chromatic" ? 1.3 : 0) + (dark ? 1.4 : 0);
    }
  };
  const mixGroup = dir.flags.mode_mixture && groups.length >= 2 ? groups[groups.length - 2] : null;
  const wallNext = index === piece.plan.climaxPhrase - 1 && arrivesAfterBreath(piece.plan.climaxArrival);
  const climaxHere = index === piece.plan.climaxPhrase;
  const questions = [];
  for (const g of groups) {
    const slots = layout.filter((s) => s.group === g);
    const first = layout.indexOf(slots[0]);
    const pos = layout.length === 1 ? 0 : first / (layout.length - 1);
    const isLast = g === lastGroup;
    const notes = slots.flatMap((s) => melodyOver(line, key, s.t, s.t + s.dur).map((n) => ({ ...n, weight: n.weight / slots.length })));
    let pool = candidates;
    if (isLast) {
      pool = modChords ?? candidates.filter((c) => endingAllowed(c, dir.ending));
      if (!pool.length) pool = candidates;
    }
    if (g === mixGroup && !isLast) {
      const borrowed = candidates.filter((c) => c.family === "borrowed");
      if (borrowed.length >= 2) pool = borrowed;
    }
    const excluded = previousUse[first];
    if (excluded && pool.length > 3) pool = pool.filter((c) => c.id !== excluded);
    const options = pool.map((c) => {
      let fits = 0;
      let colours = 0;
      let bad = 0;
      let s = famPrior(c);
      for (const n of notes) {
        const f = fitOf(n.midi, c, key);
        if (f === "chord_tone") {
          fits++;
          s += 0.9 * n.weight * 2;
        } else if (f === "colour") {
          colours++;
          s += 0.1 * n.weight;
        } else {
          bad++;
          s -= 1.8 * n.weight * 2;
        }
      }
      if (!isLast) {
        const home = c.family === "diatonic" || c.family === "diatonic_extended" || c.family === "suspended";
        if (pos === 0) s += c.fn === "tonic" && home ? c.root === 0 ? role === "statement" || role === "return" ? 2 : 1.1 : 0.6 : 0;
        else if (first === layout.length - 2) s += c.fn === "dominant" ? 0.8 : c.fn === "predominant" ? 0.5 : 0;
        else s += c.fn === "predominant" ? 0.6 : c.fn === "tonic" && c.root !== 0 ? 0.5 : c.fn === "colour" ? 0.2 : 0;
        if (dir.harmonicRhythm === "oscillation") s += g === "a" ? c.fn === "tonic" ? 0.6 : 0 : c.fn === "predominant" || c.fn === "tonic" && c.root !== 0 ? 0.7 : 0;
      } else if (c.root === 0 && c.family === "diatonic_extended" && lang !== "triads") s += 0.3;
      const melodyText = notes.length ? `Melody here: ${[...new Set(notes.map((n) => midiName(n.midi, key)))].join(" ")} \u2192 ${fits} chord tone${fits === 1 ? "" : "s"}, ${colours} colour, ${bad} clash${bad === 1 ? "" : "es"}.` : "No melody notes here.";
      return opt3(c.id, `${chordName(c, key)} (${c.roman})`, `${chordName(c, key)}, ${c.roman}: ${c.effect}. Function: ${c.fn}. ${melodyText}`, s);
    });
    const where = dir.harmonicRhythm === "oscillation" && !isLast ? `the ${g === "a" ? "first" : "second"} chord of the alternating pair` : `chord ${first + 1} of ${layout.length}${isLast ? " (the last: it carries the phrase ending)" : ""}`;
    questions.push({
      id: `chord_${g}`,
      type: "choice",
      label: `Chord ${g}`,
      instructions: `Choose ${where}, starting at beat ${slots[0].t + 1}.${isLast && !modChords ? ` The phrase ending was chosen as ${dir.ending.replace("_", "-")}.` : ""}${g === mixGroup && !isLast ? " Mode mixture was chosen for this phrase: this is the chord borrowed from the parallel mode." : ""}${isLast && wallNext ? " The climax arrives straight after this chord, following a held breath." : ""}${first === 0 && climaxHere ? " This is the chord the climax arrives on." : ""}`,
      options
    });
    questions.push({
      id: `bass_${g}`,
      type: "choice",
      label: `Bass ${g}`,
      instructions: `What should the bass do under ${where}?`,
      options: [
        opt3("root", "root", "root: the chord's root, plain and firm", 1.3),
        opt3("inversion", "inversion", "inversion: the third in the bass; lighter, smoother, less final", isLast && dir.ending === "resolved" ? -1 : 0.3),
        opt3("pedal", "pedal", "pedal: the bass stays on the tonic while the harmony moves over it; suspended, grave", (dir.flags.pedal_underlay ? 1.6 : 0.2) + (dir.harmonicRhythm === "oscillation" ? 0.7 : 0) - (isLast && dir.ending === "half_resolved" ? 1 : 0)),
        opt3("walk", "stepwise walk", "stepwise walk: the root, then steps leading toward the next chord; motion", -0.2 + t * 0.14),
        opt3("octave_drop", "octave drop", "octave drop: the root, then the octave below; weight, a deepening", -0.4 + (t >= 5 ? 0.7 : 0) + (piece.rules.style === "beat_driven" ? 0.5 : 0))
      ]
    });
  }
  const ans = await gw.ask({
    callType: "chord_path",
    title: `Phrase ${index + 1} ${label}: chord path`,
    state: piece.state("chord_path", index, [
      `DRAFT   ${notation(line)}   = ${draft.lineage}`,
      `HARMONY ${HARMONIC_RHYTHM[dir.harmonicRhythm]}; ending ${dir.ending.replace("_", "-")}${mixGroup ? "; mode mixture: one chord is borrowed from the parallel mode" : ""}${dir.modulation ? `; modulation to ${keyName(nextKey)} by ${dir.modulation.replace("_", " ")}` : ""}${piece.lastChord ? `; the previous phrase ended on ${chordName(piece.lastChord, piece.phrases[piece.phrases.length - 1].key)}` : ""}`
    ]),
    questions,
    picking: "sampled",
    draws: 1
  });
  const p = ans.picks[0];
  const all = [...candidates, ...modChords ?? []];
  draft.slots = layout.map((s) => ({
    t: s.t,
    dur: s.dur,
    chord: all.find((c) => c.id === p[`chord_${s.group}`]) ?? tonicChord(key),
    bass: p[`bass_${s.group}`],
    voices: []
  }));
}
function chordTonesNear(chord, key, lo, hi) {
  const pcs = chordPcs(chord, key);
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod(m, 12))) out.push(m);
  return out;
}
function initialVoicing(chord, key) {
  const tones = chordTonesNear(chord, key, 52, 72);
  const targets = [55, 60, 64];
  const out = [];
  for (const target of targets) {
    const free = tones.filter((x) => !out.includes(x));
    out.push(free.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target);
  }
  return out.sort((a, b) => a - b);
}
function voiceOptions(pitch, chord, key, susLanguage) {
  const scale = MODES[key.mode].map((s) => mod(key.tonic + s, 12));
  const tones = chordTonesNear(chord, key, pitch - 12, pitch + 12);
  const nameAt = (m) => chordToneName(m, chord, key);
  const describe = (m) => {
    const tone = nameAt(m);
    return tone ? `${midiName(m, key)}, the chord's ${tone}` : `${midiName(m, key)}, not a chord tone (a ${intervalName(mod(m - key.tonic - chord.root, 12))} above the root: an added colour or suspension)`;
  };
  const range = (m) => m < 48 || m > 77 ? -1.5 : 0;
  const stepTo = (dir) => {
    const tone = tones.filter((x) => (x - pitch) * dir > 0 && Math.abs(x - pitch) <= 2).sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch))[0];
    if (tone !== void 0) return tone;
    for (let d = 1; d <= 2; d++) if (scale.includes(mod(pitch + d * dir, 12))) return pitch + d * dir;
    return pitch + dir;
  };
  const up = stepTo(1);
  const down = stepTo(-1);
  const far = tones.filter((x) => Math.abs(x - pitch) >= 3).sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch) || Math.abs(a - 62) - Math.abs(b - 62))[0] ?? pitch + 7;
  const holdIn = !!nameAt(pitch);
  return [
    { key: "hold", label: "hold", target: pitch, criteria: `Hold: stays on ${describe(pitch)}. A common tone binds the two chords.`, prior: (holdIn ? 1.7 : susLanguage ? -0.2 : -0.9) + range(pitch) },
    { key: "step_up", label: "step up", target: up, criteria: `Step up to ${describe(up)}.`, prior: (nameAt(up) ? 1.1 : -1) + range(up) + (pitch < 52 ? 0.5 : 0) },
    { key: "step_down", label: "step down", target: down, criteria: `Step down to ${describe(down)}.`, prior: (nameAt(down) ? 1.2 : -1) + range(down) + (pitch > 74 ? 0.5 : 0) },
    { key: "leap", label: "leap", target: far, criteria: `Leap ${far > pitch ? "up" : "down"} a ${intervalName(far - pitch)} to ${describe(far)}.`, prior: -0.3 - 0.15 * (Math.abs(far - pitch) - 3) + range(far) + (holdIn ? 0 : 0.5) }
  ];
}
async function voiceLead(ctx, index, draft, label) {
  const { piece, gw } = ctx;
  const key = draft.key;
  const sus = piece.rules.harmonicLanguage === "suspended";
  let voices = piece.voices.length ? piece.voices.slice() : [];
  const lastPhrase = piece.phrases[piece.phrases.length - 1];
  const sameKey = !!lastPhrase && lastPhrase.key.tonic === key.tonic && lastPhrase.key.mode === key.mode;
  let prevChord = sameKey ? piece.lastChord : null;
  const stats = { leaps: 0, nonChord: 0, motion: 0 };
  for (let k = 0; k < draft.slots.length; k++) {
    const slot = draft.slots[k];
    if (!voices.length) {
      voices = initialVoicing(slot.chord, key);
    } else if (!prevChord || prevChord.id !== slot.chord.id || prevChord.root !== slot.chord.root || prevChord.intervals.join() !== slot.chord.intervals.join()) {
      const perVoice = voices.map((v) => voiceOptions(v, slot.chord, key, sus));
      const names = ["low", "middle", "high"];
      const questions = perVoice.map((options, v) => ({
        id: `voice_${v + 1}`,
        type: "choice",
        label: `${names[v]} voice`,
        instructions: `The ${names[v]} inner voice is on ${midiName(voices[v], key)}. How should it move into the new chord?`,
        options: options.map((o) => opt3(o.key, o.label, o.criteria, o.prior))
      }));
      const ans = await gw.ask({
        callType: "voice_leading",
        title: `Phrase ${index + 1} ${label}: voices into chord ${k + 1}`,
        state: piece.state("voice_leading", index, [
          `DRAFT   ${notation(draft.line)}`,
          `CHANGE  ${prevChord ? chordName(prevChord, key) : "previous chord"} \u2192 ${chordName(slot.chord, key)} (${slot.chord.roman}); bass plays the ${slot.bass.replace("_", " ")}; inner voices now ${voices.map((v) => midiName(v, key)).join(" ")}`
        ]),
        questions,
        picking: "sampled",
        draws: 1
      });
      voices = voices.map((v, i) => {
        const chosen = perVoice[i].find((o) => o.key === ans.picks[0][`voice_${i + 1}`]);
        if (chosen.key === "leap") stats.leaps++;
        if (!chordToneName(chosen.target, slot.chord, key)) stats.nonChord++;
        stats.motion += Math.abs(chosen.target - v);
        return chosen.target;
      });
    }
    slot.voices = voices.slice();
    prevChord = slot.chord;
  }
  return stats;
}
var REASONS = {
  drift: "Drift: the phrase is no longer related to the theme.",
  copy: "Copy: too close to one of the last four phrases.",
  weak_contrast: "Weak contrast: a departure must leave the theme, and this stays too near it.",
  stale_return: "Stale return: the theme comes back intact without new harmony or instruments.",
  clash: "Clash: melody notes grind against the chords under them.",
  aimless: "Aimless: the phrase does not serve its role or its place on the tension curve."
};
async function draftRound(ctx, index, round) {
  const { piece, gw } = ctx;
  const role = piece.roleOf(index);
  const section = piece.sectionOf(index);
  const dirAns = await gw.ask({
    callType: "phrase_direction",
    title: `Phrase ${index + 1} direction${round > 1 ? ` (round ${round})` : ""}`,
    state: piece.state("phrase_direction", index),
    questions: directionQuestions(ctx, index),
    picking: "sampled",
    draws: PHRASE_DRAFTS
  });
  const lengths = dirAns.probabilities.phrase_length;
  if (lengths) piece.phraseBars.set(index, Number(Object.entries(lengths).sort((a, b) => b[1] - a[1])[0][0]));
  const letters = "abcdefgh";
  const fixed = planFixed(piece, index);
  const drafts = dirAns.picks.map((p, i) => {
    const direction = directionFrom({ ...p, ...fixed });
    const key = section.key;
    const built = buildLine(piece, direction, index);
    return {
      id: `draft_${letters[i]}`,
      direction,
      key,
      line: built.line,
      lineage: built.lineage,
      depth: built.depth,
      intact: built.intact,
      related: 0,
      slots: [],
      facts: built.truncated ? [{ label: "fit", value: "material ran past the phrase and was cut short" }] : [],
      quality: 0,
      failure: ""
    };
  });
  const vl = await Promise.all(
    drafts.map(async (d) => {
      await chordPath(ctx, index, d, d.id.replace("_", " "));
      if (d.direction.ending === "resolved") snapEnding(d);
      return voiceLead(ctx, index, d, d.id.replace("_", " "));
    })
  );
  return judgeDrafts(ctx, index, round, drafts, vl);
}
async function judgeDrafts(ctx, index, round, drafts, vl) {
  const { piece, gw } = ctx;
  const role = piece.roleOf(index);
  const main = piece.mainTheme;
  const contrast = piece.theme("C");
  const lastFour = piece.phrases.slice(-4);
  const firstStatement = piece.phrases.find((ph) => ph.themeIntact);
  drafts.forEach((d, i) => {
    const half = piece.segStart(index);
    const halves = [sliceLine(d.line, 0, half), sliceLine(d.line, half, piece.beatsOf(index))].filter((h) => pitched(h).length >= 2);
    const kept = role === "departure" && halves.length ? halves.map((h) => shareKept(main.line, h)).sort((a, b) => b.overall - a.overall)[0] : shareKept(main.line, d.line);
    const keptC = contrast ? shareKept(contrast.line, d.line) : null;
    const chordIds = d.slots.map((s2) => s2.chord.id);
    const sims = lastFour.map((ph) => ({ n: ph.index + 1, sim: similarity(d.line, ph.line, chordIds, ph.slots.map((s2) => s2.chord.id)) }));
    const maxSim = sims.length ? Math.max(...sims.map((s2) => s2.sim)) : 0;
    const earlier = piece.phrases.slice(0, -4).map((ph) => ({ n: ph.index + 1, sim: similarity(d.line, ph.line, chordIds, ph.slots.map((s2) => s2.chord.id)) }));
    const closest = earlier.sort((x, y) => y.sim - x.sim)[0];
    const bad = clashes(d.line, d.slots, d.key);
    const newHarmony = firstStatement ? d.slots.length !== firstStatement.slots.length || d.slots.filter((s2, k) => s2.chord.id !== firstStatement.slots[k].chord.id).length >= Math.ceil(d.slots.length / 2) : true;
    d.related = kept.overall;
    d.facts.push(
      { label: "derivation", value: d.lineage },
      { label: `kept from theme ${main.id}`, value: `contour ${pct(kept.contour)}, intervals ${pct(kept.intervals)}, rhythm ${pct(kept.rhythm)}` },
      ...keptC && role === "departure" ? [{ label: "kept from theme C", value: `contour ${pct(keptC.contour)}, intervals ${pct(keptC.intervals)}, rhythm ${pct(keptC.rhythm)}` }] : [],
      { label: "similarity to last four", value: sims.length ? sims.map((s2) => `phrase ${s2.n}: ${pct(s2.sim)}`).join(", ") : "no earlier phrases" },
      ...closest && closest.sim > 0.6 ? [{ label: "closest earlier phrase", value: `phrase ${closest.n}: ${pct(closest.sim)}` }] : [],
      { label: "theme last heard intact", value: piece.phrases.length ? `${piece.phrasesSinceThemeIntact()} phrases ago` : "not yet" },
      { label: "clashing notes", value: bad.length ? bad.slice(0, 4).map((c) => `${c.note} over ${c.chord} at beat ${c.beat + 1}`).join("; ") : "none" },
      { label: "chords", value: d.slots.map((s2) => chordName(s2.chord, d.key)).join(" | ") },
      { label: "inner voices", value: `${vl[i].motion} semitones of motion, ${vl[i].leaps} leap${vl[i].leaps === 1 ? "" : "s"}, ${vl[i].nonChord} non-chord tone${vl[i].nonChord === 1 ? "" : "s"}` },
      ...d.intact && firstStatement ? [{ label: "theme returns intact", value: `${newHarmony ? "with new harmony" : "over the same harmony as its first statement"}${d.direction.flags.handoff ? ", on a new instrument" : ""}` }] : []
    );
    const chainRelated = d.depth <= 2 && ["A", "B"].includes(d.direction.seg1.source);
    let s = 0;
    let failure = "";
    if (role === "departure") {
      if (kept.overall > 0.62) {
        s -= 2;
        failure = "weak_contrast";
      } else s += 1.6;
    } else if (role === "statement") {
      s += 2.2 * kept.overall;
      if (!d.intact) {
        s -= 1;
        failure = "aimless";
      }
    } else if (role === "return") {
      if (!d.intact) {
        s -= 1.2;
        failure = "aimless";
      } else s += 1.5;
      if (d.intact && !newHarmony && !d.direction.flags.handoff && !piece.chorusAt(index)) {
        s -= 2.2;
        failure = "stale_return";
      } else if (d.intact) s += 0.7;
    } else {
      const rel = Math.max(kept.overall, chainRelated ? 0.42 : 0);
      if (rel < DRIFT_LEVEL) {
        s -= 2;
        failure = "drift";
      } else s += 1 + (kept.overall > 0.35 && kept.overall < 0.92 ? 0.7 : 0);
    }
    const plannedReturn = index === piece.plan.climaxPhrase && piece.plan.climaxTheme !== "continues" || piece.rules.style === "beat_driven";
    if (lastFour.length && maxSim > COPY_LEVEL && role !== "return" && !plannedReturn) {
      s -= 2.6;
      failure = "copy";
    } else s += (1 - maxSim) * 0.8;
    if (closest && closest.sim > COPY_LEVEL && !(role === "return" && d.intact) && !plannedReturn) {
      s -= 2.6;
      failure = "copy";
    }
    if (bad.length >= 3) failure = failure || "clash";
    s -= 0.4 * Math.min(4, bad.length);
    s -= 0.12 * vl[i].leaps + 0.15 * vl[i].nonChord;
    d.quality = s;
    d.failure = failure;
  });
  const order = shuffled(drafts, ctx.rng);
  const best = Math.max(...order.map((d) => d.quality));
  const failures = order.map((d) => d.failure).filter(Boolean);
  const mainFailure = failures.sort((a, b) => failures.filter((x) => x === b).length - failures.filter((x) => x === a).length)[0] ?? "aimless";
  const themeBack = index === piece.plan.climaxPhrase && piece.plan.climaxTheme !== "continues";
  const loops = piece.rules.style === "beat_driven";
  const roleRule = {
    statement: "This phrase states the theme: it should be plainly recognisable.",
    development: loops ? "This is a development phrase in a loop-based style. It must stay related to the theme; an exact repeat of an earlier phrase is right here, because the change comes from the drums, bass, layers and filter around it. Reject drift (no longer related)." : "This is a development phrase: it must be related to the theme AND new. Reject drift (no longer related) and copies (too close to any of the last four phrases).",
    departure: "This is a planned departure: the test flips. The phrase must CONTRAST with the main theme while fitting the key and mood.",
    return: piece.chorusAt(index) ? "This phrase is the chorus: the hook must be whole and plainly recognisable. Hearing it again is the point; prefer the draft whose chords and second half serve the hook best." : "The theme returns here. A theme that comes back intact must have new harmony or new instruments.",
    climax: themeBack ? `This is the climax, and the plan brings the main theme back here ${piece.plan.climaxTheme === "broadened" ? "at half speed" : "whole"}: hearing the theme again at full intensity is the point of the moment, not a copy.` : "This is the climax: related to the theme, at its most intense, and not a copy of the last four phrases.",
    coda: "This is the coda: related to the theme, winding down, not a copy of the last four phrases."
  };
  const verdictQ = {
    id: "verdict",
    type: "choice",
    label: `Phrase ${index + 1}: best draft`,
    instructions: `${roleRule[role]} Which draft should be played? Choose "none" to reject all of them and redraft.`,
    options: [
      ...order.map((d) => opt3(d.id, d.id.replace("_", " "), `${notation(d.line)} | ${d.facts.map((f) => `${f.label}: ${f.value}`).join("; ")}`, d.quality * 1.5)),
      opt3("none", "none", "Reject all drafts and redraft.", (best < 1 ? 2.2 : 0.4) * 1.5)
    ]
  };
  const whyQ = {
    id: "reject_reason",
    type: "choice",
    label: "If none: why",
    instructions: "If every draft is rejected, what is the main reason? It is fed into the next round of drafting.",
    options: Object.entries(REASONS).map(([k, text]) => opt3(k, k.replace("_", " "), text, k === mainFailure ? 2 : 0))
  };
  const strongQ = {
    id: "strength",
    type: "choice",
    label: "If accepted: why",
    instructions: "If a draft is accepted, what is its main strength?",
    options: [
      opt3("related_and_new", "related and new", "It is clearly from the theme and clearly new.", role === "development" ? 1.5 : 0.5),
      opt3("serves_role", "serves its role", "It does exactly what its role in the plan asks.", role === "development" ? 0.6 : 1.6),
      opt3("harmony", "harmony", "Its chords give the melody new meaning.", 0.4),
      opt3("momentum", "momentum", "It carries the tension curve where it needs to go.", 0.5)
    ]
  };
  const judge = await gw.ask({
    callType: "phrase_judge",
    title: `Phrase ${index + 1} judge${round > 1 ? ` (round ${round})` : ""}`,
    state: piece.state("phrase_judge", index, ["DRAFTS  " + order.map((d) => `${d.id}: ${notation(d.line)}   = ${d.lineage}`).join("\n        ")]),
    questions: [verdictQ, whyQ, strongQ],
    picking: "top"
  });
  const picked = judge.picks[0].verdict;
  const accepted = picked === "none" ? null : order.find((d) => d.id === picked);
  const reason = accepted ? strongQ.options.find((o) => o.key === judge.picks[0].strength).criteria : REASONS[judge.picks[0].reject_reason];
  const verdict = { picked: accepted ? accepted.id : null, reason, probabilities: judge.probabilities.verdict };
  const views = order.map((d) => ({
    id: d.id,
    notation: notation(d.line),
    lineage: d.lineage,
    chords: d.slots.map((s) => chordName(s.chord, d.key)),
    notes: timed(d.line, d.key),
    facts: d.facts
  }));
  ctx.emit({ type: "phrase_drafts", phrase: index, round, drafts: views, verdict });
  piece.lastReject = accepted ? "" : reason;
  return accepted;
}
function snapEnding(draft) {
  const final = draft.slots[draft.slots.length - 1];
  const lastNote = [...draft.line].reverse().find((n) => n.deg !== null);
  if (!final || !lastNote || lastNote.deg === null) return;
  const pcs = chordPcs(final.chord, draft.key);
  for (const delta of [0, -1, 1, -2, 2]) {
    if (pcs.includes(mod(degreeToMidi(draft.key, lastNote.deg + delta), 12))) {
      lastNote.deg += delta;
      lastNote.alt = 0;
      return;
    }
  }
}

// server/calls/compose.ts
function chorusDraft(ctx, index) {
  const { piece } = ctx;
  const src = piece.chorusAt(index)?.source;
  const from = src === null || src === void 0 ? void 0 : piece.phrases[src];
  if (!from) return null;
  const key = piece.sectionOf(index).key;
  let shift = ((key.tonic - from.key.tonic) % 12 + 12) % 12;
  if (shift > 6) shift -= 12;
  piece.phraseBars.set(index, from.score.bars);
  const lineage = `the chorus again (phrase ${from.index + 1}): ${from.lineage}`;
  const draft = {
    id: "chorus",
    direction: from.direction,
    key,
    line: from.line.map((n) => ({ ...n })),
    lineage,
    depth: from.depth,
    intact: from.themeIntact,
    related: from.related,
    slots: from.slots.map((s) => ({ ...s, voices: s.voices.map((v) => v + shift) })),
    facts: [],
    quality: 0,
    failure: ""
  };
  ctx.emit({
    type: "phrase_drafts",
    phrase: index,
    round: 1,
    drafts: [{ id: "chorus", notation: notation(draft.line), lineage, chords: draft.slots.map((s) => chordName(s.chord, key)), notes: [], facts: [{ label: "chorus", value: `same melody and chords as phrase ${from.index + 1}` }] }],
    verdict: { picked: "chorus", reason: "The chorus returns: composed once, played again. Only its orchestration is decided anew.", probabilities: { chorus: 1 } }
  });
  return draft;
}
async function composePhrase(ctx, index, onReject, keepGoing = () => true) {
  const { piece } = ctx;
  let accepted = chorusDraft(ctx, index);
  for (let round = 1; !accepted && keepGoing(); round++) {
    accepted = await draftRound(ctx, index, round);
    if (!accepted) onReject?.();
  }
  if (!accepted) return null;
  const record = await orchestrate(ctx, index, accepted);
  if (index === piece.plan.totalPhrases - 1) applyEnding(ctx, record);
  const prev = piece.phrases[piece.phrases.length - 1];
  if (prev && record.leadIn?.length) {
    const end = prev.score.beats;
    const start = end + Math.min(...record.leadIn.map((n) => n.t));
    for (const lead of record.leadIn) {
      for (const n of prev.score.notes) if (n.inst === lead.inst && n.t < start && n.t + n.dur > start) n.dur = q(start - n.t);
      if (end + lead.t >= 0) prev.score.notes.push({ ...lead, t: q(end + lead.t) });
    }
    prev.score.notes.sort((a, b) => a.t - b.t);
  }
  piece.phrases.push(record);
  piece.voices = record.slots[record.slots.length - 1].voices.slice();
  piece.lastChord = record.slots[record.slots.length - 1].chord;
  piece.lastReject = "";
  return record;
}

// server/calls/setup.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";

// server/core/mood.ts
var LEXICON = [
  [/sad|sorrow|grief|griev|mourn|loss|lost|lonely|alone|miss(ing)?|goodbye|farewell|tears?|cry|heartbreak|melanchol|regret|bittersweet|nostalg|longing|yearn|wistful|rain/, { valence: -0.6, energy: -0.15, size: 0.1 }],
  [/happy|joy|cheer|bright|sunny|sunrise|morning|celebrat|party|smile|laugh|delight|hope|wonder|spring|summer/, { valence: 0.6, energy: 0.15 }],
  [/dark|shadow|night|midnight|3 ?am|ominous|sinister|dread|fear|horror|haunt|ghost|grave|doom|storm|war|battle|boss|villain|menac|death|dying|abyss|void/, { darkness: 0.6, valence: -0.25 }],
  [/calm|quiet|still|gentle|soft|peace|serene|sleep|dream|lullaby|slow|drift|float|frozen|snow|mist|fog|dawn|meditat|tender/, { energy: -0.4, size: -0.15 }],
  [/fast|run|chase|race|rush|frantic|urgent|driv|pound|fight|battle|boss|action|explosi|energetic|hyper|sprint|wild/, { energy: 0.55 }],
  [/danc|club|rave|neon|arcade|cyber|synth|electr|techno|house|beat|bass|robot|machine|digital|glitch|future|laser|disco|drum|trap|808|video ?game/, { electronic: 0.7, energy: 0.25 }],
  [/play|playful|silly|funny|absurd|goofy|bounc|skip|cartoon|kitten|puppy|child|kid|toy|circus|clown|mischie|whims|quirky|pineapple|learning to|tiptoe|sneak/, { playful: 0.75, valence: 0.3, energy: 0.1 }],
  [/epic|huge|vast|grand|triumph|hero|victor|soar|mountain|cathedral|orchestra|cinematic|overwhelm|climax|glory|ascend|majest|galaxy|space|universe/, { size: 0.6, energy: 0.15 }],
  [/small|intimate|alone|solo|whisper|room|letter|memory|candle|close/, { size: -0.4 }],
  [/water|pool|ocean|sea|wave|river|lake|rain|underwater|swim|tide|drown|submerge|shore|beach/, { water: 0.8 }],
  [/love|kiss|embrace|romance|wedding|heart/, { valence: 0.2, size: 0.15, energy: -0.1 }]
];
function readMood(prompt) {
  const text = prompt.toLowerCase();
  const m = { valence: 0, energy: 0.45, darkness: 0.2, playful: 0, electronic: 0, size: 0.45, water: 0, hash: hashString(text) };
  for (const [re, delta] of LEXICON) {
    if (re.test(text)) {
      for (const [axis, d] of Object.entries(delta)) m[axis] += d;
    }
  }
  m.valence = clamp(m.valence, -1, 1);
  for (const axis of ["energy", "darkness", "playful", "electronic", "size", "water"]) m[axis] = clamp(m[axis], 0, 1);
  if (m.valence < -0.2) m.darkness = clamp(m.darkness + 0.15, 0, 1);
  return m;
}
function promptJitter(mood, salt) {
  return (hashString(`${mood.hash}:${salt}`) % 2001 - 1e3) / 1e3;
}

// server/calls/setup.ts
var opt4 = (key, label, criteria, prior = 0) => ({ key, label, criteria, prior });
function tempoFeel(bpm) {
  if (bpm < 58) return "very slow: grave, suspended, time almost stopped";
  if (bpm < 78) return "slow: breathing, tender, room for long lines";
  if (bpm < 98) return "walking pace: gentle motion, unhurried";
  if (bpm < 118) return "moderate: moving, purposeful";
  if (bpm < 138) return "lively: a dance pulse, bright energy";
  if (bpm < 163) return "fast: driving, excited";
  return "very fast: frantic, breathless";
}
function rulesView(ctx) {
  const r = ctx.piece.rules;
  return {
    style: r.style,
    styleName: pack.sheet(r.style).name,
    ...r.groove ? { groove: r.groove } : {},
    bpm: r.bpm,
    meter: r.meter.id,
    keyName: keyName(r.key),
    mode: r.key.mode,
    harmonicLanguage: r.harmonicLanguage,
    palette: r.palette,
    soundWorld: r.soundWorld,
    lengthSec: r.lengthSec,
    form: r.form,
    ending: r.ending,
    keyPlan: r.keyPlan
  };
}
function planView(ctx, revised = false) {
  const { plan } = ctx.piece;
  return {
    sections: plan.sections.map((s) => ({
      index: s.index,
      role: s.role,
      ...s.part ? { part: s.part } : {},
      tension: s.tension,
      departure: s.departure,
      phrases: [s.first, s.last],
      keyName: keyName(s.key),
      startSec: s.startSec,
      endSec: s.endSec
    })),
    totalPhrases: plan.totalPhrases,
    climaxPhrase: plan.climaxPhrase,
    climaxArrival: plan.climaxArrival,
    phraseSec: ctx.piece.phraseSec,
    revised
  };
}
async function runSetup(ctx, opts = {}) {
  const { piece, gw } = ctx;
  const fixed = opts.fixed ?? {};
  const m = piece.mood;
  const styleQ = {
    id: "style_sheet",
    type: "choice",
    label: "Style sheet",
    instructions: "Which style sheet should this piece be written in, given the prompt?",
    options: pack.sheets.map((s) => opt4(
      s.id,
      s.name,
      `${s.summary} Traits: ${s.traits.join("; ")}.`,
      s.id === "beat_driven" ? m.electronic * 4 + m.energy * 1.2 - 1.6 : s.id === "playful" ? m.playful * 4 + Math.max(0, m.valence) * 0.8 - 1.3 : 0.6 + m.size * 1.2 + Math.max(0, -m.valence) * 1.2 + m.water * 0.8 - m.electronic * 1.5 - m.playful * 1.5
    ))
  };
  const groovePrior = {
    house: m.energy * 1.5 + m.electronic * 0.6,
    boom_bap: (1 - m.energy) * 1.2 + m.darkness * 0.4,
    trap: m.darkness * 1.6 + m.electronic * 0.8,
    funk: m.playful * 1.8 + Math.max(0, m.valence) * 0.8,
    lofi: 0.9 + (1 - m.energy) * 1.2
  };
  const grooveQ = {
    id: "groove",
    type: "choice",
    label: "Groove (beat-driven only)",
    instructions: `The piece is "${piece.prompt}". If it is written on the beat-driven sheet, which groove family should it use?`,
    options: Object.keys(GROOVES).map((g) => opt4(g, GROOVES[g].label, GROOVES[g].text, groovePrior[g]))
  };
  const styleAns = await gw.ask({ callType: "setup", title: "Setup: style", state: piece.preludeState("setup"), questions: [styleQ, grooveQ], picking: "top" });
  const style = styleAns.picks[0].style_sheet;
  const groove = style === "beat_driven" ? styleAns.picks[0].groove : void 0;
  const orch = style === "bittersweet_orchestral";
  const beat = style === "beat_driven";
  const play = style === "playful";
  const targetBpm = orch ? 60 + m.energy * 34 : groove ? GROOVES[groove].bpm : beat ? 96 + m.energy * 48 : 98 + m.energy * 44;
  const fastFixed = fixed.bpm !== void 0 && fixed.bpm >= 96;
  const tempo = {
    id: "tempo",
    type: "choice",
    label: "Tempo",
    instructions: "Choose the tempo in beats per minute. In 6/8 and 12/8 the beat is the dotted quarter.",
    options: Array.from({ length: 33 }, (_x, i) => 40 + i * 5).map((bpm) => opt4(`bpm_${bpm}`, `${bpm} BPM`, `${bpm} BPM, ${tempoFeel(bpm)}`, -(((bpm - targetBpm) / 11) ** 2)))
  };
  const meterPrior = {
    "4/4": orch ? 0.5 : beat ? 3 : 1.1,
    "3/4": orch ? 0.5 : beat ? -1 : 0.6,
    "6/8": orch ? 0.6 : beat ? -0.5 : 0.9 + m.playful * 0.4,
    "12/8": (orch ? 1.6 + (1 - m.energy) * 0.6 : beat ? -0.5 : -0.2) - (fastFixed ? 2.5 : 0),
    "5/4": orch ? -0.6 + m.darkness : -1,
    "7/8": play ? 0.1 + m.playful * 0.5 : -1.2
  };
  const meter = {
    id: "meter",
    type: "choice",
    label: "Meter",
    instructions: "Choose the meter.",
    options: Object.values(METERS).map((mt) => opt4(mt.id, mt.id, `${mt.id}: ${mt.feel}`, meterPrior[mt.id] + promptJitter(m, `meter${mt.id}`) * 0.3))
  };
  const keyCentre = {
    id: "key_centre",
    type: "choice",
    label: "Key centre",
    instructions: "Choose the tonal centre. Sharper keys tend to sound brighter on strings; flat keys warmer and darker.",
    options: Array.from({ length: 12 }, (_x, pc) => opt4(`pc_${pc}`, pcName(pc), `tonic ${pcName(pc)}`, promptJitter(m, `key${pc}`) * 1.4))
  };
  const modePrior = {
    major: m.valence * 2 - m.darkness + (play ? 0.5 : 0),
    natural_minor: -m.valence * 1.5 + 0.3 + (orch ? 0.6 : 0),
    harmonic_minor: m.darkness * 1.5 - m.valence + m.energy * 0.5 - 0.4,
    melodic_minor: -m.valence * 0.5 - 0.6,
    dorian: -m.valence * 0.8 + m.electronic * 1.2 + 0.1,
    phrygian: m.darkness * 2.4 - 1.3,
    lydian: m.valence + m.playful + (1 - m.energy) * 0.6 - 0.6 + (play ? 0.5 : 0),
    mixolydian: m.playful * 1.5 + m.valence * 0.5 - 0.5 + (play ? 0.4 : 0)
  };
  const mode = {
    id: "mode",
    type: "choice",
    label: "Mode",
    instructions: "Choose the scale the piece is built on.",
    options: Object.keys(MODES).map((id) => opt4(id, MODE_NAMES[id], `${MODE_NAMES[id]}: ${MODE_FEEL[id]}`, modePrior[id]))
  };
  const langPrior = {
    triads: orch ? -0.5 : beat ? 0.5 : 1,
    sevenths: orch ? 0.3 : beat ? 0.9 : 0.6,
    extended: orch ? 1.5 : beat ? 0.4 : 0,
    suspended: orch ? 0.5 + m.water * 0.5 : beat ? 0.8 : -0.2,
    chromatic: orch ? m.darkness * 2 - 0.2 : m.darkness - 1
  };
  const language = {
    id: "harmonic_language",
    type: "choice",
    label: "Harmonic language",
    instructions: "Choose the main harmonic language. Every chord family stays available later; this sets the home dialect.",
    options: Object.keys(HARMONIC_LANGUAGE_TEXT).map((id) => opt4(id, id, HARMONIC_LANGUAGE_TEXT[id], langPrior[id]))
  };
  const worldText = {
    close_dry: "close and dry: a small room, every detail audible, intimate",
    large_hall: "large hall: a concert hall around an orchestra, long warm tail",
    submerged: "submerged: heard through water, soft-edged, highs veiled",
    electronic_hybrid: "electronic hybrid: synths and samples together, tight low end"
  };
  const worldPrior = {
    close_dry: orch ? (1 - m.size) * 1.2 - 0.3 : play ? 1.5 : 0,
    large_hall: orch ? 1.5 + m.size * 0.5 : play ? 0.4 : -0.5,
    submerged: m.water * 2.6 - 0.8 + (orch ? 0.2 : 0),
    electronic_hybrid: beat ? 2.6 : m.electronic * 2 - 1.2
  };
  const world = {
    id: "sound_world",
    type: "choice",
    label: "Sound world",
    instructions: "Choose the space the music is heard in.",
    options: Object.keys(worldText).map((id) => opt4(id, id.replace(/_/g, " "), worldText[id], worldPrior[id]))
  };
  const targetLen = 165 + m.size * 30;
  const length = {
    id: "length",
    type: "choice",
    label: "Length",
    instructions: "Choose how long the piece lasts. Bigger arcs need more time; a small idea should not outstay its welcome.",
    options: [150, 180, 210].map((s) => opt4(`s${s}`, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim(), -(((s - targetLen) / 35) ** 2)))
  };
  const formText = {
    arch: "arch: grows to a peak in the middle and returns the way it came",
    slow_build: "slow build: one long climb from almost nothing to a climax near the end",
    theme_development_return: "theme and development with return: state the theme, travel away from it, bring it back changed",
    through_composed: "through-composed: always moving on, sections do not come back",
    verse_like: "verse-like: a recurring main section alternating with contrasting ones"
  };
  const formPrior = {
    arch: 0.6 + (1 - m.energy) * 0.4,
    slow_build: m.size * 1.6 + (orch ? 0.7 : 0),
    theme_development_return: 0.8,
    through_composed: m.darkness * 0.6 - 0.2,
    verse_like: beat ? 1.3 : play ? 1 : -0.3
  };
  const form = {
    id: "form",
    type: "choice",
    label: "Form",
    instructions: "Choose the overall form.",
    options: Object.keys(formText).map((id) => opt4(id, id.replace(/_/g, " "), formText[id], formPrior[id] + promptJitter(m, `form${id}`) * 0.3))
  };
  const endText = {
    resolved: "resolved: comes home to rest on the tonic",
    suspended: "suspended: stops on an unresolved chord, the question left open",
    fade: "fade: thins out and recedes into silence",
    sudden_stop: "sudden stop: cuts off abruptly, leaving the room ringing"
  };
  const endPrior = {
    resolved: 0.4 + Math.max(0, m.valence) * 1.2,
    suspended: 0.3 + Math.max(0, -m.valence) * 1.4 + (orch ? 0.4 : 0),
    fade: (1 - m.energy) * 0.9 + m.water * 0.6 + (beat ? 0.4 : 0) - 0.2,
    sudden_stop: m.playful * 1.6 + Math.max(0, m.energy - 0.65) * 3 - 0.6
  };
  const ending = {
    id: "ending",
    type: "choice",
    label: "Ending",
    instructions: "Choose how the piece will end.",
    options: Object.keys(endText).map((id) => opt4(id, id.replace(/_/g, " "), endText[id], endPrior[id]))
  };
  const kpText = {
    none: "none: stay in the home key throughout",
    relative: "relative key: visit the relative major or minor for contrast, then return",
    step_up_at_climax: "up a step at the climax: lift the whole key for the peak",
    distant_dark_turn: "distant key for a dark turn: move to a remote key late on, then come home"
  };
  const kpPrior = {
    none: 0.5,
    relative: 0.6,
    step_up_at_climax: m.size * 1.6 + Math.max(0, m.valence) * 0.5 - 0.2,
    distant_dark_turn: m.darkness * 2 + (orch ? 0.6 : 0) - 0.5
  };
  const keyPlan = {
    id: "key_change_plan",
    type: "choice",
    label: "Key-change plan",
    instructions: "Choose the plan for key changes.",
    options: Object.keys(kpText).map((id) => opt4(id, id.replace(/_/g, " "), kpText[id], kpPrior[id]))
  };
  const sheetLine = pack.styleText(style);
  const rulesAns = await gw.ask({
    callType: "setup",
    title: "Setup: rules of the piece",
    state: piece.preludeState("setup", [sheetLine, ...groove ? [`GROOVE  ${GROOVES[groove].text}`] : []]),
    questions: [
      ...fixed.bpm === void 0 ? [tempo] : [],
      meter,
      keyCentre,
      mode,
      language,
      world,
      ...fixed.lengthSec === void 0 ? [length] : [],
      ...fixed.form === void 0 ? [form] : [],
      keyPlan,
      ending
    ],
    picking: "top"
  });
  const p = rulesAns.picks[0];
  const key = { tonic: Number(p.key_centre.slice(3)), mode: p.mode };
  piece.rules = {
    style,
    ...groove ? { groove } : {},
    bpm: fixed.bpm ?? Number(p.tempo.slice(4)),
    meter: METERS[p.meter],
    key,
    harmonicLanguage: p.harmonic_language,
    palette: [],
    soundWorld: p.sound_world,
    lengthSec: fixed.lengthSec ?? Number(p.length.slice(1)),
    form: fixed.form ?? p.form,
    ending: p.ending,
    keyPlan: p.key_change_plan
  };
  const base = orch ? { piano: 0.95, violins: 0.9, violins2: 0.82, violas: 0.86, celli: 0.9, basses: 0.86, horn: 0.6, flute: 0.5, oboe: 0.45, clarinet: 0.35, harp: 0.62, timpani: 0.42 + m.size * 0.3, cymbal: 0.4 + m.size * 0.3, bass_drum: 0.35 + m.size * 0.3, solo_violin: 0.35 + (1 - m.size) * 0.3, noise: 0.25 + m.water * 0.6, pad: 0.12, celesta: 0.2, vibraphone: 0.15, tam_tam: 0.2 + m.darkness * 0.3 } : beat ? { drumkit: 0.95, kick808: 0.8, sub: 0.9, pad: 0.88, pluck: 0.85, piano: 0.45, noise: 0.4, keys: 0.75, lead: 0.7, supersaw: 0.55 + m.energy * 0.3, synth_bass: 0.7, bell: 0.55, brass: 0.45 } : { flute: 0.82, clarinet: 0.8, oboe: 0.58, violins: 0.85, violins2: 0.6, violas: 0.62, celli: 0.66, basses: 0.55, piano: 0.6, harp: 0.5, pluck: 0.35, glockenspiel: 0.6, celesta: 0.55, drumkit: 0.42 + m.energy * 0.4, timpani: 0.3, horn: 0.3, cymbal: 0.25, vibraphone: 0.3 };
  const avail = [...availableInstruments()].filter((id) => offeredTo(piece.rules.style, id));
  const paletteQs = avail.map((id) => ({
    id: `use_${id}`,
    type: "noul",
    label: INSTRUMENTS[id].name,
    // The palette is a pool, not a line-up: asked as "will it have a real job" Drex kept it small and the same few instruments played throughout.
    instructions: `The palette is the pool of instruments this piece may draw on. Instruments come and go: one may colour a single phrase and then rest. Could the ${INSTRUMENTS[id].name} have a moment somewhere in this piece? Character: ${INSTRUMENTS[id].character}.`,
    yes: "It could colour at least one moment of this piece.",
    no: "It would sound wrong anywhere in this piece.",
    prior: clamp((base[id] ?? 0.05) + promptJitter(m, `pal${id}`) * 0.06, 0.02, 0.98)
  }));
  const palAns = await gw.ask({
    callType: "setup",
    title: "Setup: palette",
    state: piece.preludeState("setup"),
    questions: paletteQs,
    picking: "top"
  });
  const palette = avail.filter((id) => palAns.values[`use_${id}`] >= 0.5);
  for (const role of ["melody", "bass"]) {
    if (!palette.some((id) => ROLE_INSTRUMENTS[role].includes(id))) {
      const best = ROLE_INSTRUMENTS[role].filter((id) => avail.includes(id)).sort((a, b) => palAns.values[`use_${b}`] - palAns.values[`use_${a}`])[0];
      if (best) palette.push(best);
    }
  }
  if (beat) {
    const colour = (id) => !["sub", "pad", "pluck", "kick808", "noise", "drumkit"].includes(id) && [...ROLE_INSTRUMENTS.melody, ...ROLE_INSTRUMENTS.counter, ...ROLE_INSTRUMENTS.inner].includes(id);
    const missing = 2 - palette.filter(colour).length;
    if (missing > 0) {
      palette.push(...avail.filter((id) => colour(id) && !palette.includes(id) && palAns.values[`use_${id}`] >= 0.15).sort((a, b) => palAns.values[`use_${b}`] - palAns.values[`use_${a}`]).slice(0, missing));
    }
  }
  piece.rules.palette = palette;
  ctx.emit({ type: "rules", rules: rulesView(ctx) });
}
var ROLE_TEXT = {
  statement: "statement: present the theme plainly so it can be remembered",
  development: "development: work the theme, vary it, keep it related and new",
  departure: "departure: leave the theme on purpose for contrast",
  return: "return: bring the theme back, intact but in a new light",
  climax: "climax: the peak of the piece, everything at its fullest",
  coda: "coda: wind down and close"
};
function template(form, n) {
  const roles = [];
  const tension = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i / (n - 1);
    let role = "development";
    let t = 3;
    if (form === "arch") {
      t = 1.5 + 5.2 * Math.sin(Math.PI * Math.min(1, x * 0.9 + 0.05)) ** 1.4;
      role = x < 0.01 ? "statement" : Math.abs(x - 0.55) < 0.5 / n ? "climax" : x > 0.7 && x < 0.99 ? "return" : x >= 0.99 ? "coda" : "development";
    } else if (form === "slow_build") {
      t = x >= 0.99 ? 3 : 1 + 6 * (x / 0.86) ** 1.1;
      role = x < 0.01 ? "statement" : x >= 0.99 ? "coda" : i === n - 2 ? "climax" : "development";
    } else if (form === "theme_development_return") {
      t = x >= 0.99 ? 2.5 : 2 + 4.5 * Math.min(1, x / 0.8) ** 1.2;
      role = x < 0.01 ? "statement" : x >= 0.99 ? "coda" : i === n - 2 ? "return" : i === Math.floor(n / 2) ? "departure" : "development";
    } else if (form === "through_composed") {
      t = x >= 0.99 ? 3 : 2 + 4.6 * Math.abs(Math.sin(x * Math.PI * 1.3)) * (0.6 + 0.4 * x);
      role = x < 0.01 ? "statement" : x >= 0.99 ? "coda" : i === n - 2 ? "climax" : i % 2 === 0 ? "departure" : "development";
    } else {
      t = x >= 0.99 ? 2.5 : i % 2 === 0 ? 3 + 2.5 * x : 4.5 + 2 * x;
      role = x < 0.01 ? "statement" : x >= 0.99 ? "coda" : i % 2 === 0 ? "return" : i === 1 ? "development" : "departure";
    }
    roles.push(role);
    tension.push(clamp(t, 1, 7));
  }
  const lo = Math.min(...tension);
  const hi = Math.max(...tension);
  const floor = Math.min(lo, 2);
  const scaled = tension.map((t) => hi > lo ? floor + (t - lo) * (7 - floor) / (hi - lo) : t);
  const peakAt = scaled.indexOf(Math.max(...scaled));
  if (roles.includes("climax") && roles[peakAt] !== "climax" && peakAt !== 0) {
    roles[roles.indexOf("climax")] = "development";
    roles[peakAt] = "climax";
  }
  return { roles, tension: scaled };
}
function applyKeyPlan(sections, home, plan, climaxSection) {
  const last = sections.length - 1;
  for (const s of sections) s.key = home;
  if (plan === "relative") {
    const targets = sections.filter((s) => s.departure && s.index !== 0 && s.index !== last);
    const chosen = targets.length ? targets : sections.filter((s) => s.index === Math.floor(sections.length / 2));
    for (const s of chosen) s.key = relativeKey(home);
  } else if (plan === "step_up_at_climax") {
    for (const s of sections) if (s.index >= climaxSection) s.key = transposeKey(home, 2);
  } else if (plan === "distant_dark_turn") {
    const lateDeparture = sections.filter((s) => s.departure && s.index > sections.length / 2 && s.index !== last).pop();
    const target = lateDeparture ?? sections[Math.max(1, Math.min(last - 1, climaxSection + 1 === last ? climaxSection - 1 : climaxSection + 1))];
    if (target && target.index !== 0) target.key = transposeKey(home, 8);
  }
}
var SONG_FORMS = {
  verse_chorus: { label: "verse and chorus", text: "verse and chorus: verses alternate with a chorus that returns two or three times, a bridge before the last one. The standard pop and rock song" },
  prechorus: { label: "verse, pre-chorus, chorus", text: "verse, pre-chorus, chorus: each chorus is set up by a short lift, so it lands harder. Modern pop and dance-pop" },
  hook_first: { label: "hook first", text: "hook first: the piece opens straight on the chorus hook, then trades verses and hooks. Hip-hop and rap beats" },
  one_groove: { label: "one groove", text: "one groove: no chorus and no hook that returns; a single groove that builds slowly, with one breakdown for contrast. Minimal, hypnotic tracks and background beats" }
};
function songLayout(form, n) {
  if (form === "one_groove") {
    const out = Array.from({ length: n }, () => "verse");
    out[0] = "intro";
    out[n - 1] = "outro";
    if (n >= 5) out[Math.round((n - 1) * 0.62)] = "bridge";
    return out;
  }
  const pre = form === "prechorus";
  const head2 = [form === "hook_first" ? "chorus" : "intro"];
  const m = n - 2;
  if (m <= 0) return [head2[0], "outro"].slice(0, n);
  const size = pre ? 3 : 2;
  const count = m < size + 2 ? 1 : m < size * 2 + 2 ? 2 : 3;
  const blocks = [];
  for (let i = 0; i < count; i++) blocks.push(i === count - 1 && count >= 2 ? ["bridge", "chorus"] : pre ? ["verse", "prechorus", "chorus"] : ["verse", "chorus"]);
  if (m === 1) blocks[0] = ["chorus"];
  if (pre && m === 2) blocks[0] = ["verse", "chorus"];
  let spare = m - blocks.reduce((a, b) => a + b.length, 0);
  const grow = [
    () => blocks[0].unshift("verse"),
    () => blocks[blocks.length - 1].push("chorus"),
    () => (blocks.length >= 3 ? blocks[1] : blocks[0]).unshift("verse")
  ];
  for (let i = 0; spare > 0; i++, spare--) grow[i % grow.length]();
  return [...head2, ...blocks.flat(), "outro"];
}
var BROADEN = 0.85;
async function runPlan(ctx) {
  const { piece, gw } = ctx;
  const { rules, mood } = piece;
  const phraseSec = PHRASE_BARS * rules.meter.beatsPerBar * 60 / rules.bpm;
  const total = Math.max(4, Math.round(rules.lengthSec / phraseSec));
  const song = rules.style === "beat_driven";
  const n = song ? clamp(Math.round(total / 2), 4, 12) : clamp(Math.round(total / 3), 3, 8);
  const bounds = Array.from({ length: n + 1 }, (_x, i) => Math.round(i * total / n));
  const tpl = template(rules.form, n);
  const peak = 4.6 + mood.size * 2.6 + mood.energy * 0.6;
  let parts = null;
  if (song) {
    const g = rules.groove;
    const formPrior = { verse_chorus: 1, prechorus: g === "house" ? 1.3 : 0.4, hook_first: g === "trap" || g === "boom_bap" ? 1.7 : 0.3, one_groove: g === "lofi" ? 1.8 : g === "funk" ? 1.2 : 0.2 };
    const formAns = await gw.ask({
      callType: "plan",
      title: "Plan: song form",
      state: piece.preludeState("plan", [`FORM    ${total} phrases of ${PHRASE_BARS} bars in ${n} sections of about eight bars`]),
      questions: [{
        id: "song_form",
        type: "choice",
        label: "Song form",
        instructions: `The piece is "${piece.prompt}". Which song form should it take? Each option lists the ${n} sections in order.`,
        options: Object.entries(SONG_FORMS).map(([k, f]) => opt4(k, f.label, `${f.text}. Here: ${songLayout(k, n).join(", ")}.`, formPrior[k]))
      }],
      picking: "top"
    });
    parts = songLayout(formAns.picks[0].song_form, n);
  }
  const questions = [];
  for (let i = 0; i < n; i++) {
    const span = `section ${i + 1} of ${n} (${parts ? `${parts[i]}, ` : ""}phrases ${bounds[i] + 1}-${bounds[i + 1]}, about ${Math.round((bounds[i + 1] - bounds[i]) * phraseSec)} s)`;
    const roleOptions = i === n - 1 ? ["coda", "return"] : ["development", "departure", "return", "climax"];
    if (i > 0 && !parts) questions.push({
      id: `role_${i + 1}`,
      type: "choice",
      label: `Section ${i + 1} role`,
      instructions: `What is the role of ${span}?${i === n - 1 ? " It is the last section of the piece." : ""}`,
      options: roleOptions.map((r) => opt4(r, r, ROLE_TEXT[r], r === tpl.roles[i] ? 2.2 : r === "development" || r === "coda" ? 0.4 : 0))
    });
    questions.push({
      id: `tension_${i + 1}`,
      type: "score",
      label: `Section ${i + 1} tension`,
      instructions: `How much tension should ${span} carry? Plan peaks and lulls deliberately across the piece.${parts ? ` ${PART_TEXT[parts[i]]}.` : ""}`,
      levels: TENSION_LEVELS,
      prior: clamp(tpl.tension[i] / 7 * peak, 1, 7) - 1,
      spread: 0.6
    });
    if (i > 0 && i < n - 1 && !parts) questions.push({
      id: `departure_${i + 1}`,
      type: "noul",
      label: `Section ${i + 1} leaves the theme`,
      instructions: `Should ${span} leave the theme on purpose, for contrast?`,
      yes: "A planned departure: contrasting material that still fits the key and mood.",
      no: "Stays with the theme: every phrase is related to it.",
      prior: tpl.roles[i] === "departure" ? 0.86 : i === 0 || i === n - 1 ? 0.03 : 0.1
    });
  }
  const tplClimax = tpl.tension.indexOf(Math.max(...tpl.tension));
  const climaxAt = (bounds[tplClimax] + bounds[tplClimax + 1]) / 2 / total;
  let lastChorus = parts ? parts.lastIndexOf("chorus") : -1;
  while (parts && lastChorus > 0 && parts[lastChorus - 1] === "chorus") lastChorus--;
  if (lastChorus < 0) questions.push({
    id: "climax_position",
    type: "choice",
    label: "Climax position",
    instructions: "How far through the piece should the climax fall?",
    options: [50, 60, 70, 80, 90].map((pc) => opt4(`at_${pc}`, `${pc}%`, `${pc}% of the way through`, -(((pc / 100 - climaxAt) / 0.09) ** 2)))
  });
  const orchStyle = rules.style === "bittersweet_orchestral";
  const arrivalPrior = {
    swell: (1 - mood.size) * 1.4 + (1 - mood.energy) * 0.6 - 0.9,
    hit: orchStyle ? 0.2 : 1.2,
    open_wall: (orchStyle ? 0.9 : 0) + mood.size * 1.2 + mood.water * 0.5,
    broaden: mood.size * 1.1 + mood.darkness * 0.8 - 0.6,
    bloom: (orchStyle ? 0.8 : 0.3) + (1 - mood.energy) * 0.9 + (1 - mood.size) * 0.6,
    drop: 1.6
  };
  questions.push({
    id: "climax_arrival",
    type: "choice",
    label: "How the climax arrives",
    // The prompt is quoted here because it is a tiny share of the state: measured live, that is what lets it steer this choice.
    instructions: `The piece is "${piece.prompt}". How should its climax arrive?`,
    options: arrivalsFor(rules.style, rules.groove).map((a) => opt4(a, ARRIVAL_LABEL[a], ARRIVAL_TEXT[a], arrivalPrior[a]))
  });
  questions.push({
    id: "climax_theme",
    type: "choice",
    label: "The melody at the climax",
    instructions: `The piece is "${piece.prompt}". A climax means something when the listener recognises what has arrived. What should the melody be at the climax?`,
    options: Object.keys(CLIMAX_THEME_TEXT).map((k) => opt4(k, k, CLIMAX_THEME_TEXT[k], k === "returns" ? 1.4 : k === "broadened" ? 0.6 + mood.size * 0.8 : 0.3))
  });
  questions.push({
    id: "restate_theme",
    type: "noul",
    label: "State the theme twice",
    instructions: "Should the theme be stated a second time straight after the first, on a new instrument or over new harmony, so the listener has it by heart before it is developed?",
    yes: "Heard twice, it can be recognised when it comes back later.",
    no: "Once is enough; move straight on to developing it.",
    prior: total >= 8 ? 0.75 : 0.35
  });
  questions.push({
    id: "counter_theme",
    type: "noul",
    label: "Needs a counter-theme",
    instructions: "Does this piece need a counter-theme derived from the main theme, to run against it in fuller sections?",
    prior: total >= 8 ? 0.78 : 0.3
  });
  questions.push({
    id: "contrast_theme",
    type: "noul",
    label: "Needs a contrast theme",
    instructions: "Does this piece need a fresh contrasting theme for its departures?",
    prior: tpl.roles.includes("departure") ? 0.85 : 0.2
  });
  const kinds = parts ? [...new Set(parts)] : [];
  const levelPrior = { intro: 1, verse: 2, prechorus: 3, chorus: 5, bridge: 1, outro: 1 };
  for (const k of kinds) {
    questions.push({
      id: `level_${k}`,
      type: "choice",
      label: `How loud the ${k} is`,
      instructions: `The piece is "${piece.prompt}". How loud should every ${k} section be? ${PART_TEXT[k]}. A song moves in waves: each chorus is a peak the listener can feel, and the parts between drop well back so the next chorus hits again.`,
      options: DYNAMIC_NAMES.map((name, i) => opt4(String(i), name, `${name}: ${["very soft", "soft", "moderately soft", "moderately loud", "loud", "very loud", "as loud as the piece gets"][i]}`, -Math.abs(i - levelPrior[k]) * 1.2))
    });
  }
  const ans = await gw.ask({
    callType: "plan",
    title: "Plan: sections, tension curve, departures, climax",
    state: piece.preludeState("plan", [`FORM    ${rules.form.replace(/_/g, " ")}; ${total} phrases of ${PHRASE_BARS} bars (${phraseSec.toFixed(1)} s each) in ${n} sections; key plan: ${rules.keyPlan.replace(/_/g, " ")}; ending: ${rules.ending.replace(/_/g, " ")}`]),
    questions,
    picking: "top"
  });
  const p = ans.picks[0];
  const climaxPhrase = lastChorus >= 0 ? bounds[lastChorus] : clamp(Math.round(Number(p.climax_position.slice(3)) / 100 * total) - 1, 1, total - 1);
  const sections = [];
  for (let i = 0; i < n; i++) {
    let role = p[`role_${i + 1}`] ?? "statement";
    if (parts) role = PART_ROLE[parts[i]];
    const departure = parts ? parts[i] === "bridge" : i > 0 && i < n - 1 && ((ans.values[`departure_${i + 1}`] ?? 0) >= 0.5 || role === "departure");
    if (i === 0) role = "statement";
    else if (departure) role = "departure";
    sections.push({ index: i, role, ...parts ? { part: parts[i] } : {}, tension: Number(p[`tension_${i + 1}`]) + 1, departure, first: bounds[i], last: bounds[i + 1] - 1, key: rules.key });
  }
  const climaxSection = sections.find((s) => climaxPhrase >= s.first && climaxPhrase <= s.last);
  if (climaxSection.index !== 0 && !climaxSection.departure && !parts) climaxSection.role = "climax";
  applyKeyPlan(sections, rules.key, rules.keyPlan, climaxSection.index);
  const plan = {
    sections,
    totalPhrases: total,
    climaxPhrase,
    climaxArrival: p.climax_arrival,
    climaxTheme: p.climax_theme,
    restate: ans.values.restate_theme >= 0.5,
    needsCounter: ans.values.counter_theme >= 0.5,
    needsContrast: ans.values.contrast_theme >= 0.5 || sections.some((s) => s.departure),
    ...kinds.length ? { partLevels: Object.fromEntries(kinds.map((k) => [k, Number(p[`level_${k}`])])) } : {}
  };
  piece.plan = plan;
  if (plan.climaxArrival === "broaden") piece.phraseBpm.set(climaxPhrase, Math.round(rules.bpm * BROADEN));
  ctx.emit({ type: "plan", plan: planView(ctx) });
}
async function revisePlan(ctx, nextPhrase) {
  const { piece, gw } = ctx;
  const upcoming = piece.plan.sections.filter((s) => s.first >= nextPhrase);
  if (!upcoming.length) return;
  const done = piece.phrases.slice(-4).map((ph) => `phrase ${ph.index + 1} ${ph.role} (tension reached ${ph.score.display.tension})`).join("; ");
  const questions = upcoming.map((s) => ({
    id: `tension_${s.index + 1}`,
    type: "score",
    label: `Section ${s.index + 1} tension`,
    instructions: `Section ${s.index + 1} (${s.role}, phrases ${s.first + 1}-${s.last + 1}) was planned at tension ${s.tension}. Given how the piece has actually gone, what tension should it carry?`,
    levels: TENSION_LEVELS,
    prior: s.tension - 1,
    spread: 0.55
  }));
  const ans = await gw.ask({
    callType: "plan_revision",
    title: `Plan revision before section ${upcoming[0].index + 1}`,
    state: piece.state("plan_revision", nextPhrase, [`SO FAR  ${done}`]),
    questions,
    picking: "top"
  });
  for (const s of upcoming) s.tension = Number(ans.picks[0][`tension_${s.index + 1}`]) + 1;
  ctx.emit({ type: "plan", plan: planView(ctx, true) });
}
async function runBackdrop(ctx) {
  const file = join3(ROOT, "assets/backdrops/backdrops.json");
  if (!existsSync3(file)) return;
  let list = [];
  try {
    list = JSON.parse(readFileSync3(file, "utf8"));
  } catch {
    return;
  }
  for (const b of list) {
    const real = ["jpg", "jpeg", "png", "webp"].map((ext) => `${b.id}.${ext}`).find((f) => existsSync3(join3(ROOT, "assets/backdrops", f)));
    if (real) b.file = real;
  }
  list = list.filter((b) => existsSync3(join3(ROOT, "assets/backdrops", b.file)));
  if (!list.length) return;
  const m = ctx.piece.mood;
  const mv = { valence: m.valence, energy: m.energy, darkness: m.darkness, water: m.water, playful: m.playful, electronic: m.electronic };
  const ans = await ctx.gw.ask({
    callType: "backdrop",
    title: "Backdrop",
    state: ctx.piece.preludeState("backdrop"),
    questions: [{
      id: "backdrop",
      type: "choice",
      label: "Backdrop image",
      instructions: "Which backdrop image fits this piece best?",
      options: list.map((b) => {
        let d = 0;
        for (const [k, v] of Object.entries(b.tags ?? {})) d += (v - (mv[k] ?? 0)) ** 2;
        return opt4(b.id, b.id.replace(/[-_]/g, " "), b.mood, -d * 2.5);
      })
    }],
    picking: "top"
  });
  const chosen = list.find((b) => b.id === ans.picks[0].backdrop);
  ctx.emit({ type: "backdrop", id: chosen.id, file: chosen.file, mood: chosen.mood });
}

// server/calls/themes.ts
var opt5 = (key, label, criteria, prior = 0) => ({ key, label, criteria, prior });
var THEME_DRAFTS = 6;
var SIMPLE_CELLS = [
  { id: "even", label: "even", feel: "even notes: calm, hymn-like, steady", pattern: [1] },
  { id: "long_short", label: "long-short", feel: "dotted long-short: leaning forward, lyrical", pattern: [1.5, 0.5] },
  { id: "short_short_long", label: "short-short-long", feel: "two quick notes then a long one: speech-like, catchy", pattern: [0.5, 0.5, 1] },
  { id: "syncopated", label: "syncopated", feel: "off-beat pushes: restless, dance-like", pattern: [0.75, 0.75, 0.5] },
  { id: "long_then_run", label: "long, then a run", feel: "a held note released into quick notes: a breath then motion", pattern: [2, 0.5, 0.5, 0.5, 0.5] }
];
var COMPOUND_CELLS = [
  { id: "even", label: "even beats", feel: "one note per beat: broad, calm", pattern: [1] },
  { id: "lilt", label: "lilt", feel: "long-short lilt inside the beat: rocking, wave-like", pattern: [2 / 3, 1 / 3] },
  { id: "flowing", label: "flowing", feel: "running triplet eighths: flowing, restless", pattern: [1 / 3] },
  { id: "held_then_lilt", label: "held, then lilt", feel: "a long held note that tips into a lilt: longing", pattern: [2, 2 / 3, 1 / 3] },
  { id: "broad_then_quick", label: "broad, then quick", feel: "a broad note answered by a quick one: sighing", pattern: [4 / 3, 2 / 3] }
];
var cellsFor = (sub) => sub === 3 ? COMPOUND_CELLS : SIMPLE_CELLS;
function rhythmFor(cell, count, unit) {
  for (const m of [2, 1, 0.5]) {
    const durs = [];
    for (let i = 0; i < count - 1; i++) durs.push(q(cell.pattern[i % cell.pattern.length] * m));
    const used = durs.reduce((a, b) => a + b, 0);
    const room = q(unit - used);
    if (room >= Math.min(1, m)) {
      durs.push(Math.min(room, 4));
      return durs;
    }
  }
  const each = q(unit / count);
  return Array.from({ length: count }, () => each);
}
var CONTOURS = {
  arch: "arch: rises to a peak near the middle, then falls. Balanced, singing",
  rising: "rising: climbs through the phrase. Hopeful, reaching, opening outward",
  falling: "falling: descends through the phrase. Sighing, resigned, settling",
  valley: "valley: dips and comes back up. Searching, then recovering",
  wave: "wave: turns back on itself more than once. Restless or playful"
};
var START = [
  { key: "start_1", deg: 0, text: "starts on the tonic: grounded" },
  { key: "start_3", deg: 2, text: "starts on the third: warm, already in mid-thought" },
  { key: "start_5", deg: 4, text: "starts on the fifth: open, poised" }
];
var END = [
  { key: "end_1", deg: 0, text: "ends on the tonic: closed, at rest" },
  { key: "end_2", deg: 1, text: "ends on the second: unresolved, leaning" },
  { key: "end_3", deg: 2, text: "ends on the third: gentle, half-settled" },
  { key: "end_5", deg: 4, text: "ends on the fifth: open, asking for more" },
  { key: "end_7", deg: 6, text: "ends on the seventh: left hanging, aching" }
];
function shapeQuestions(ctx, contrastWith) {
  const { piece } = ctx;
  const { style } = piece.rules;
  const m = piece.mood;
  const orch = style === "bittersweet_orchestral";
  const beat = style === "beat_driven";
  const targetCount = beat ? 4.6 : orch ? 6 : 5.4;
  const other = contrastWith ? { contour: contrastWith.contour, count: pitched(contrastWith.line).length } : null;
  const contourPrior = {
    arch: 1 + (orch ? 0.4 : 0),
    rising: Math.max(0, m.valence) * 1.1 + m.size * 0.5,
    falling: Math.max(0, -m.valence) * 1.2 + 0.2,
    valley: 0.2 + m.darkness * 0.5,
    wave: m.playful * 1.5 + (beat ? 0.7 : 0)
  };
  const cells = cellsFor(piece.rules.meter.sub);
  const cellPrior = {
    even: (1 - m.energy) * 0.8,
    long_short: 0.9,
    short_short_long: 0.5 + m.playful,
    syncopated: (beat ? 1.6 : 0) + m.energy * 0.6 - 0.3,
    long_then_run: 0.4,
    lilt: 1 + (orch ? 0.3 : 0),
    flowing: m.energy * 0.9 - 0.2,
    held_then_lilt: orch ? 1.1 : 0.3,
    broad_then_quick: 0.7
  };
  const barText = {
    1: ["one bar: a short motif, a cell that can be repeated, answered and broken up", beat ? 1.2 : 0.5],
    2: ["two bars: a sung phrase, the classic length", 1.2],
    3: ["three bars: a long-breathed line that does not fall into squares", beat ? -2 : 0.3]
  };
  return [
    // Only the main theme chooses its length; later themes match it.
    ...contrastWith ? [] : [{
      id: "bars",
      type: "choice",
      label: "Theme length in bars",
      instructions: "How many bars should the theme fill?",
      options: (beat ? [1, 2] : [1, 2, 3]).map((b) => opt5(`b${b}`, `${b} bar${b === 1 ? "" : "s"}`, barText[b][0], barText[b][1]))
    }],
    {
      id: "length",
      type: "choice",
      label: "Theme length",
      instructions: "How many notes should the theme have? A theme must be short enough to remember and long enough to develop.",
      options: [4, 5, 6, 7, 8].map((n) => opt5(`n${n}`, `${n} notes`, `${n} notes`, -(((n - targetCount) / 1.3) ** 2) - (other && other.count === n ? 0.8 : 0)))
    },
    {
      id: "contour",
      type: "choice",
      label: "Contour",
      instructions: "What overall shape should the theme trace?",
      options: Object.entries(CONTOURS).map(([k, text]) => opt5(k, k, text, contourPrior[k] - (other?.contour === k ? 1.6 : 0)))
    },
    {
      id: "rhythm_cell",
      type: "choice",
      label: "Rhythm cell",
      instructions: "Which rhythm cell should the theme be built from?",
      options: cells.map((c) => opt5(c.id, c.label, c.feel, cellPrior[c.id] ?? 0))
    },
    {
      id: "start_degree",
      type: "choice",
      label: "Starting degree",
      instructions: "Which scale degree should the theme start on?",
      options: START.map((s) => opt5(s.key, s.key.replace("start_", "degree "), s.text, s.deg === 4 ? 0.5 : s.deg === 2 ? 0.4 : 0.3))
    },
    {
      id: "end_degree",
      type: "choice",
      label: "Ending degree",
      instructions: "Which scale degree should the theme end on?",
      options: END.map((e) => opt5(
        e.key,
        e.key.replace("end_", "degree "),
        e.text,
        e.deg === 0 ? 0.6 + Math.max(0, m.valence) * 0.5 : e.deg === 1 ? 0.3 + (orch ? 0.5 : 0) : e.deg === 2 ? 0.4 : e.deg === 4 ? 0.3 : -0.3 + Math.max(0, -m.valence) * 0.6
      ))
    },
    {
      id: "leap_position",
      type: "choice",
      label: "Where the leap sits",
      instructions: "A theme gets one leap; everything else moves by step or repeats. Where should the leap sit?",
      options: [
        opt5("early", "early", "early: the theme opens with its gesture, then settles by step", 0.6),
        opt5("middle", "middle", "in the middle: steps lead to the leap and away from it", 0.7),
        opt5("late", "late", "late: steps build up to a leap just before the end", 0.2)
      ]
    }
  ];
}
function shapeFrom(p, sub, themeBars) {
  const bars = p.bars ? Number(p.bars.slice(1)) : themeBars;
  const count = clamp(Number(p.length.slice(1)), bars === 3 ? 5 : 4, bars === 1 ? 6 : 8);
  const leapAt = p.leap_position === "early" ? 1 : p.leap_position === "late" ? count - 2 : Math.floor((count - 1) / 2);
  return {
    bars,
    count,
    contour: p.contour,
    cell: cellsFor(sub).find((c) => c.id === p.rhythm_cell),
    start: START.find((s) => s.key === p.start_degree).deg,
    end: END.find((e) => e.key === p.end_degree).deg,
    leapAt: clamp(leapAt, 1, Math.max(1, count - 2))
  };
}
var CHORD_DEGREES = [0, 2, 4];
var degName = (d) => `degree ${mod(d, 7) + 1}${d >= 7 ? " (upper octave)" : d < 0 ? " (lower octave)" : ""}`;
function leapTarget(from, dir) {
  for (let d = from + 2 * dir; Math.abs(d - from) <= 7; d += dir) {
    if (CHORD_DEGREES.includes(mod(d, 7))) return d;
  }
  return from + 2 * dir;
}
function nearestEnd(prev, end) {
  let best = end;
  for (const cand of [end - 14, end - 7, end, end + 7, end + 14]) if (Math.abs(cand - prev) < Math.abs(best - prev)) best = cand;
  return best;
}
function wantedDirection(shape, i) {
  const f = i / (shape.count - 1);
  switch (shape.contour) {
    case "arch":
      return f <= 0.5 ? 1 : -1;
    case "rising":
      return 1;
    case "falling":
      return -1;
    case "valley":
      return f <= 0.5 ? -1 : 1;
    default:
      return Math.floor((i - 1) / 2) % 2 === 0 ? 1 : -1;
  }
}
async function draftNotes(ctx, shape, label, themeId, extraState) {
  const { piece, gw } = ctx;
  const durs = rhythmFor(shape.cell, shape.count, shape.bars * piece.rules.meter.beatsPerBar);
  const degs = [shape.start];
  for (let i = 1; i <= shape.count - 2; i++) {
    const prev = degs[i - 1];
    const before = degs[i - 2];
    const lastMove = before === void 0 ? 0 : prev - before;
    const remaining = shape.count - 1 - i;
    const want = wantedDirection(shape, i);
    const describe = (target, how) => {
      const toEnd = Math.abs(nearestEnd(target, shape.end) - target);
      return `${how} to ${degName(target)}. ${remaining} note${remaining === 1 ? "" : "s"} left after this; the last must be degree ${mod(shape.end, 7) + 1}, ${toEnd} step${toEnd === 1 ? "" : "s"} from here.`;
    };
    const prior = (target, kind) => {
      const dir = Math.sign(target - prev);
      let s = 0;
      if (dir === want) s += 1.2;
      if (kind === "repeat") s -= ctx.piece.rules.style === "beat_driven" ? 0 : 0.5;
      if (kind === "repeat" && lastMove === 0 && degs.length > 1) s -= 1.2;
      if (Math.abs(lastMove) >= 2 && dir === -Math.sign(lastMove) && kind === "step") s += 1;
      const toEnd = Math.abs(nearestEnd(target, shape.end) - target);
      if (toEnd > remaining + 1) s -= 1.5 * (toEnd - remaining - 1);
      if (Math.abs(target - shape.start) > 6) s -= 1.5;
      return s;
    };
    let options;
    if (i === shape.leapAt) {
      const up = leapTarget(prev, 1);
      const down = leapTarget(prev, -1);
      options = [
        opt5("leap_up", "leap up", describe(up, `Leap up a ${["", "", "third", "fourth", "fifth", "sixth", "seventh", "octave"][up - prev] ?? "wide interval"} to a chord tone,`), prior(up, "leap") + 0.3),
        opt5("leap_down", "leap down", describe(down, `Leap down a ${["", "", "third", "fourth", "fifth", "sixth", "seventh", "octave"][prev - down] ?? "wide interval"} to a chord tone,`), prior(down, "leap"))
      ];
    } else {
      options = [
        opt5("step_up", "step up", describe(prev + 1, "Step up"), prior(prev + 1, "step")),
        opt5("step_down", "step down", describe(prev - 1, "Step down"), prior(prev - 1, "step")),
        opt5("repeat", "repeat", describe(prev, "Repeat the note, staying"), prior(prev, "repeat"))
      ];
    }
    const soFar = degs.map((d, k) => ({ deg: d, dur: durs[k] }));
    const ans = await gw.ask({
      callType: "theme_note",
      title: `Theme ${themeId} ${label}: note ${i + 1} of ${shape.count}`,
      state: piece.preludeState("theme_note", [
        ...extraState,
        `SHAPE   ${shape.bars} bar${shape.bars === 1 ? "" : "s"}, ${shape.count} notes; contour ${shape.contour}; rhythm ${shape.cell.label} (${durs.map((d) => Math.round(d * 100) / 100).join(" ")} beats); ends on degree ${mod(shape.end, 7) + 1}; the one leap is note ${shape.leapAt + 1}`,
        `SO FAR  ${notation(soFar)}   (degree(beats); this is note ${i + 1})`
      ]),
      questions: [{
        id: "next_note",
        type: "choice",
        label: `Note ${i + 1}`,
        instructions: i === shape.leapAt ? "This is the theme's one leap. Which way should it go?" : "How should the melody move to its next note?",
        options
      }],
      picking: "sampled",
      draws: 1
    });
    const pick = ans.picks[0].next_note;
    degs.push(pick === "step_up" ? prev + 1 : pick === "step_down" ? prev - 1 : pick === "repeat" ? prev : pick === "leap_up" ? leapTarget(prev, 1) : leapTarget(prev, -1));
  }
  degs.push(nearestEnd(degs[degs.length - 1], shape.end));
  return degs.map((d, k) => ({ deg: d, dur: durs[k] }));
}
function themeView(ctx, theme) {
  return { id: theme.id, kind: theme.kind, notation: notation(theme.line), contour: theme.contour, notes: timed(theme.line, ctx.piece.rules.key) };
}
async function writeTheme(ctx, id, kind, contrastWith) {
  const { piece, gw } = ctx;
  const key = piece.rules.key;
  const extra = [`KEY     ${keyName(key)}; ${piece.rules.meter.id}${contrastWith || piece.themes.length ? `; one theme fills ${piece.unitBeats} beats (${piece.themeBars} bar${piece.themeBars === 1 ? "" : "s"})` : ""}`];
  if (contrastWith) extra.push(`THEME ${contrastWith.id} ${notation(contrastWith.line)}   contour: ${contrastWith.contour}   (the main theme; the new theme must contrast with it)`);
  let rejectNote = "";
  for (let round = 1; ; round++) {
    const state = piece.preludeState("theme_shape", [...extra, ...rejectNote ? [`REJECTS last round: "${rejectNote}"`] : []]);
    const shapeAns = await gw.ask({
      callType: "theme_shape",
      title: `Theme ${id}: shape (round ${round})`,
      state,
      questions: shapeQuestions(ctx, contrastWith),
      picking: "sampled",
      draws: THEME_DRAFTS
    });
    const shapes = shapeAns.picks.map((p) => shapeFrom(p, piece.rules.meter.sub, piece.themeBars));
    const lines = await Promise.all(shapes.map((s, i) => draftNotes(ctx, s, `draft ${i + 1}`, id, extra)));
    const order = shuffled(lines.map((_l, i) => i), ctx.rng);
    const labelled = order.map((src, pos) => ({ id: `draft_${pos + 1}`, line: lines[src], shape: shapes[src] }));
    const scored = labelled.map((d) => {
      const sh = shapeOf(d.line, key);
      const kept = contrastWith ? shareKept(contrastWith.line, d.line) : null;
      let s = 0;
      if (sh.rangeSemitones >= 5 && sh.rangeSemitones <= 12) s += 1;
      if (sh.rangeSemitones > 14) s -= 1;
      if (sh.leapRecovered) s += 0.9;
      if (sh.distinct >= Math.min(4, d.shape.count - 1)) s += 0.9;
      if (sh.repeats > 2) s -= 0.6 * (sh.repeats - 2);
      if (sh.oneDirection) s -= 1;
      if (contourOf(d.line) === d.shape.contour) s += 0.5;
      if (kept) s += 1.6 * (1 - kept.overall) - 0.6;
      const facts = [
        { label: "length", value: `${d.shape.bars} bar${d.shape.bars === 1 ? "" : "s"}, ${d.shape.count} notes` },
        { label: "range", value: `${sh.rangeSemitones} semitones` },
        { label: "largest leap", value: `${sh.largestLeap + 1 > 1 ? `${["unison", "second", "third", "fourth", "fifth", "sixth", "seventh", "octave"][sh.largestLeap] ?? "wide"}` : "none"}${sh.leapRecovered ? ", recovered by step" : ""}` },
        { label: "distinct pitches", value: String(sh.distinct) },
        { label: "contour heard", value: contourOf(d.line) },
        ...kept ? [{ label: `kept from theme ${contrastWith.id}`, value: `contour ${pct(kept.contour)}, intervals ${pct(kept.intervals)}, rhythm ${pct(kept.rhythm)}` }] : []
      ];
      return { ...d, facts, score: s };
    });
    const best = Math.max(...scored.map((d) => d.score));
    const verdictQ = {
      id: "verdict",
      type: "choice",
      label: `Best theme ${id} draft`,
      instructions: contrastWith ? `Which draft is the best contrast theme for the departures of this piece: clearly different from theme ${contrastWith.id}, yet at home in the key and mood of the prompt? Choose "none" if none is good enough.` : 'Which draft is the best main theme for this piece: memorable, singable, fitting the prompt and style sheet, with room to be developed? Choose "none" if none is good enough.',
      options: [
        ...scored.map((d) => opt5(d.id, d.id.replace("_", " "), `${notation(d.line)} | ${d.facts.map((f) => `${f.label}: ${f.value}`).join("; ")}`, d.score * 1.6)),
        opt5("none", "none", "None of these is good enough; draft again.", (best < 1.9 ? 2.4 : 1.1) * 1.6)
      ]
    };
    const whyQ = {
      id: "reject_reason",
      type: "choice",
      label: "If none: why",
      instructions: "If no draft is good enough, what is the main weakness to fix in the next round?",
      options: [
        opt5("shapeless", "shapeless", "The drafts wander without a clear shape or gesture.", 1),
        opt5("too_plain", "too plain", "The drafts are scale fragments with nothing memorable.", 0.8),
        opt5("too_jumpy", "too jumpy", "The drafts are awkward to sing; too wide or erratic.", 0.2),
        opt5("wrong_mood", "wrong mood", "The drafts do not fit the prompt or style sheet.", 0.4),
        ...contrastWith ? [opt5("too_similar", "too similar", `The drafts are too close to theme ${contrastWith.id} to work as a contrast.`, 1.2)] : []
      ]
    };
    const judge = await gw.ask({
      callType: "theme_judge",
      title: `Theme ${id} judge (round ${round})`,
      state: piece.preludeState("theme_judge", [
        ...extra,
        "DRAFTS  " + scored.map((d) => `${d.id}: ${notation(d.line)}`).join("\n        ")
      ]),
      questions: [verdictQ, whyQ],
      picking: "top"
    });
    const picked = judge.picks[0].verdict;
    const reasonKey = judge.picks[0].reject_reason;
    const reasonText = whyQ.options.find((o) => o.key === reasonKey).criteria;
    const verdict = {
      picked: picked === "none" ? null : picked,
      reason: picked === "none" ? reasonText : "Accepted as the theme.",
      probabilities: judge.probabilities.verdict
    };
    const drafts = scored.map((d) => ({
      id: d.id,
      notation: notation(d.line),
      lineage: `${d.shape.contour}, ${d.shape.cell.label}`,
      notes: timed(d.line, key),
      facts: d.facts
    }));
    ctx.emit({ type: "theme_drafts", themeId: id, round, drafts, verdict });
    if (picked !== "none") {
      const win = scored.find((d) => d.id === picked);
      const theme = { id, kind, line: win.line, contour: contourOf(win.line) };
      if (kind === "main") piece.themeBars = win.shape.bars;
      piece.themes.push(theme);
      ctx.emit({ type: "theme", theme: themeView(ctx, theme) });
      return theme;
    }
    rejectNote = reasonText;
  }
}
async function deriveCounterTheme(ctx, id) {
  const { piece, gw } = ctx;
  const main = piece.mainTheme;
  const tctx = { grid: piece.grid };
  const below = (line, steps) => line.map((n) => n.deg === null ? { ...n } : { ...n, deg: n.deg - steps });
  const candidates = [
    { key: "inversion_low", label: "inverted, an octave lower", how: "the theme inverted and set an octave lower: moves against the theme in contrary motion", line: below(applyOps(main.line, ["inversion"], tctx), 7), prior: 1.1 },
    { key: "augmented_head", label: "opening, augmented", how: "the opening of the theme at half speed, an octave lower: a slow shadow of the theme", line: below(applyOps(main.line, ["fragment_head", "augmentation"], tctx), 7), prior: 0.9 },
    { key: "retrograde_low", label: "backwards, a sixth lower", how: "the theme backwards, a sixth lower: the same notes heard as an echo", line: below(applyOps(main.line, ["retrograde"], tctx), 5), prior: 0.5 },
    { key: "sixths_below", label: "in sixths below", how: "the theme a sixth lower, moving in parallel: sweet and blended", line: below(main.line, 5), prior: 0.3 },
    { key: "inverted_tail", label: "closing notes inverted, augmented", how: "the close of the theme inverted at half speed, an octave lower: a slow answer to the theme's ending", line: below(applyOps(main.line, ["fragment_tail", "inversion", "augmentation"], tctx), 7), prior: 0.6 }
  ];
  const ans = await gw.ask({
    callType: "theme_derive",
    title: `Counter-theme ${id}: derivation`,
    state: piece.preludeState("theme_derive", [`KEY     ${keyName(piece.rules.key)}`, piece.themeLines()]),
    questions: [{
      id: "derivation",
      type: "choice",
      label: "Counter-theme derivation",
      instructions: `Which derivation of theme ${main.id} makes the best counter-theme: one that can run under the theme without copying or fighting it?`,
      options: candidates.map((c) => {
        const kept = shareKept(main.line, c.line);
        return opt5(c.key, c.label, `${c.how}. Notes: ${notation(c.line)}. Keeps contour ${pct(kept.contour)}, intervals ${pct(kept.intervals)}, rhythm ${pct(kept.rhythm)} of the theme; lasts ${lineLength(c.line)} beats.`, c.prior);
      })
    }],
    picking: "top"
  });
  const chosen = candidates.find((c) => c.key === ans.picks[0].derivation);
  const theme = { id, kind: "counter", line: chosen.line, contour: contourOf(chosen.line), derivation: `theme ${main.id} ${chosen.label}` };
  piece.themes.push(theme);
  ctx.emit({ type: "theme", theme: themeView(ctx, theme) });
  return theme;
}

// server/gateway/gateway.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join as join4 } from "node:path";

// server/gateway/models.ts
var DEFAULT_MODEL = "drex-max-v1.1";
var MODEL_OVERRIDES = {
  // voice_leading: 'drex-v2.0',
};
function modelFor(callType, hasImages = false) {
  const base = (process.env.DREX_MODEL ?? "").trim() || DEFAULT_MODEL;
  if (hasImages) return base.startsWith("drex-max") ? base : DEFAULT_MODEL;
  const env = process.env[`DREX_MODEL_${callType.toUpperCase()}`];
  return env && env.trim() || MODEL_OVERRIDES[callType] || base;
}

// server/gateway/gateway.ts
var DrexError = class extends Error {
  constructor(status, kind, message, requestId) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.requestId = requestId;
  }
  status;
  kind;
  requestId;
};
var TIERS = {
  free: { rpm: 120, inFlight: 8 },
  paid: { rpm: 1200, inFlight: 16 }
};
var Limiter = class {
  constructor(rpm, inFlight) {
    this.rpm = rpm;
    this.inFlight = inFlight;
  }
  rpm;
  inFlight;
  stamps = [];
  active = 0;
  waiters = [];
  wake() {
    const w = this.waiters.shift();
    if (w) w();
  }
  urgent = 0;
  /**
   * Wait for a slot. Priority requests go first: when the account is at its limit, the next free
   * slot goes to them and ordinary requests stand back (a hold must keep evolving while drafts queue).
   */
  async acquire(priority = false) {
    if (priority) this.urgent++;
    try {
      await this.wait(priority);
    } finally {
      if (priority) this.urgent--;
    }
  }
  async wait(priority) {
    for (; ; ) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 6e4);
      if (!priority && this.urgent > 0) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      const budget = priority || !Number.isFinite(this.rpm) ? this.rpm : this.rpm - Math.ceil(this.rpm * 0.1);
      if (this.active < this.inFlight && this.stamps.length < budget) {
        this.active++;
        this.stamps.push(now);
        return;
      }
      if (this.active >= this.inFlight) {
        await new Promise((r) => this.waiters.push(r));
      } else {
        const over = Math.max(0, this.stamps.length - budget);
        const wait = Math.max(25, 6e4 - (now - this.stamps[Math.min(over, this.stamps.length - 1)]) + (priority ? 1 : 5));
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  release() {
    this.active = Math.max(0, this.active - 1);
    this.wake();
  }
  lastMinute() {
    const now = Date.now();
    return this.stamps.filter((t) => now - t < 6e4).length;
  }
};
var HOSTS = ["https://console.nace.ai/v1/systemone", "https://drex.nace.ai/v1/systemone"];
var hostIndex = 0;
var apiUrl = () => (process.env.DREX_API_URL ?? "").trim().replace(/^["']|["']$/g, "") || HOSTS[hostIndex];
function switchHost() {
  if ((process.env.DREX_API_URL ?? "").trim() || hostIndex >= HOSTS.length - 1) return false;
  hostIndex += 1;
  console.warn(`[drex] ${HOSTS[hostIndex - 1]} answered with a non-API 403; using ${HOSTS[hostIndex]}`);
  return true;
}
function apiKey() {
  const k = (process.env.NACE_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return k.startsWith("nace_sk_") ? k : null;
}
function tier() {
  if (!apiKey()) {
    return { rpm: Number(process.env.STANDIN_RPM) || Infinity, inFlight: 16 };
  }
  const t = (process.env.DREX_TIER ?? "").toLowerCase();
  return t === "paid" ? TIERS.paid : TIERS.free;
}
var limiter = null;
function sharedLimiter() {
  if (!limiter) {
    const t = tier();
    limiter = new Limiter(Number(process.env.DREX_RPM) || t.rpm, Number(process.env.DREX_IN_FLIGHT) || t.inFlight);
  }
  return limiter;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var Gateway = class {
  constructor(opts) {
    this.opts = opts;
    this.standin = opts.forceStandin || this.random || !apiKey();
    this.rng = mulberry32(opts.seed ^ 2654435769);
    this.standinRng = mulberry32(opts.seed ^ 1374496523);
  }
  opts;
  standin;
  calls = 0;
  rng;
  standinRng;
  started = Date.now();
  aborted = false;
  /** DREX_PICKER=random swaps Drex for a uniform random picker: the control for the blind listening test. */
  random = (process.env.DREX_PICKER ?? "").toLowerCase() === "random";
  dumped = /* @__PURE__ */ new Map();
  abort() {
    this.aborted = true;
  }
  get model() {
    return this.random ? "random picker" : this.standin ? "stand-in" : modelFor("setup");
  }
  /** DREX_DUMP_DIR=<dir> saves the first few request bodies of each call type, exactly as Drex would receive them. */
  dump(req) {
    const dir = process.env.DREX_DUMP_DIR;
    if (!dir) return;
    const n = this.dumped.get(req.callType) ?? 0;
    if (n >= (Number(process.env.DREX_DUMP_MAX) || 3)) return;
    this.dumped.set(req.callType, n + 1);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join4(dir, `${req.callType}.${n + 1}.json`), JSON.stringify(this.buildBody(req, modelFor(req.callType, !!req.images?.length)), null, 2));
  }
  callsLastMinute() {
    return sharedLimiter().lastMinute();
  }
  async ask(req) {
    if (this.aborted) throw new DrexError(0, "aborted", "Session stopped");
    if (!req.questions.length) throw new Error(`${req.callType}: no questions`);
    if (!req.images) {
      const images = this.opts.imagesFor?.(req.callType);
      if (images?.length) req = { ...req, images: images.slice(0, 8) };
    }
    this.dump(req);
    const lim = sharedLimiter();
    await lim.acquire(req.priority);
    const t0 = Date.now();
    let probabilities;
    let values;
    let model;
    try {
      if (this.standin) {
        ({ probabilities, values } = await this.answerLocally(req));
        model = "stand-in";
      } else {
        ({ probabilities, values, model } = await this.answerRemotely(req));
      }
    } finally {
      lim.release();
    }
    if (this.aborted) throw new DrexError(0, "aborted", "Session stopped");
    const ms = Date.now() - t0;
    this.calls++;
    const picks = [];
    const n = req.picking === "sampled" ? Math.max(1, req.draws ?? 1) : 1;
    for (let i = 0; i < n; i++) {
      const p = {};
      for (const qn of req.questions) {
        const probs = probabilities[qn.id];
        if (req.picking === "sampled") p[qn.id] = sampleFrom(probs, this.rng);
        else if (qn.type === "score") p[qn.id] = String(clamp(Math.round(values[qn.id]), 0, qn.levels.length - 1));
        else p[qn.id] = topOf(probs);
      }
      picks.push(p);
    }
    if (!req.quiet && this.opts.onCall) {
      const questions = req.questions.map((qn) => ({
        id: qn.id,
        type: qn.type,
        label: qn.label,
        options: qn.type === "choice" ? qn.options.map((o) => ({ key: o.key, label: o.label })) : qn.type === "score" ? qn.levels.map((l, i) => ({ key: String(i), label: l })) : [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }],
        probabilities: probabilities[qn.id],
        picked: picks.map((p) => p[qn.id]),
        picking: req.picking
      }));
      this.opts.onCall({
        id: this.calls,
        callType: req.callType,
        title: req.title,
        at: Date.now() - this.started,
        model,
        standin: this.standin,
        ms,
        questions
      });
    }
    return { probabilities, values, picks, model, standin: this.standin, ms };
  }
  // ── The local stand-in ──
  async answerLocally(req) {
    const [lo, hi] = (process.env.STANDIN_LATENCY_MS ?? "30-110").split("-").map(Number);
    const wait = (lo || 0) + this.standinRng() * Math.max(0, (hi || lo || 0) - (lo || 0));
    if (wait > 0) await sleep(wait);
    const probabilities = {};
    const values = {};
    const sharp = this.random ? 0 : Number(process.env.STANDIN_SHARPNESS) || (req.picking === "sampled" ? 1.8 : 1);
    for (const qn of req.questions) {
      if (qn.type === "choice") {
        const w = qn.options.map((o) => Math.exp((o.prior ?? 0) * sharp + (this.standinRng() - 0.5) * 0.35));
        const total = w.reduce((a, b) => a + b, 0) || 1;
        probabilities[qn.id] = Object.fromEntries(qn.options.map((o, i) => [o.key, w[i] / total]));
        values[qn.id] = Math.max(...w) / total;
      } else if (qn.type === "noul") {
        const raw = this.random ? 0.5 : clamp(qn.prior ?? 0.5, 0.01, 0.99);
        const logit = Math.log(raw / (1 - raw)) * (req.picking === "sampled" ? 1.3 : 1) + (this.standinRng() - 0.5) * 0.4;
        const p = clamp(1 / (1 + Math.exp(-logit)), 0.01, 0.99);
        probabilities[qn.id] = { yes: p, no: 1 - p };
        values[qn.id] = p;
      } else {
        const mean = this.random ? this.standinRng() * (qn.levels.length - 1) : clamp((qn.prior ?? (qn.levels.length - 1) / 2) + (this.standinRng() - 0.5) * 0.3, 0, qn.levels.length - 1);
        const sd = this.random ? 3 : qn.spread ?? 0.7;
        const w = qn.levels.map((_l, i) => Math.exp(-((i - mean) ** 2) / (2 * sd * sd)));
        const total = w.reduce((a, b) => a + b, 0) || 1;
        probabilities[qn.id] = Object.fromEntries(w.map((x, i) => [String(i), x / total]));
        values[qn.id] = w.reduce((s, x, i) => s + i * x / total, 0);
      }
    }
    return { probabilities, values };
  }
  // ── The real API ──
  buildBody(req, model) {
    const questions = {};
    for (const qn of req.questions) {
      if (qn.type === "choice") {
        questions[qn.id] = {
          type: "choice",
          instructions: qn.instructions,
          criteria: Object.fromEntries(qn.options.map((o) => [o.key, o.criteria]))
        };
      } else if (qn.type === "noul") {
        const criteria = {};
        if (qn.yes) criteria.true = qn.yes;
        if (qn.no) criteria.false = qn.no;
        questions[qn.id] = { type: "noul", instructions: qn.instructions, ...Object.keys(criteria).length ? { criteria } : {} };
      } else {
        questions[qn.id] = { type: "score", instructions: qn.instructions, criteria: qn.levels };
      }
    }
    const body = { model, state: req.state, questions };
    if (req.images?.length) body.images = req.images;
    return body;
  }
  async answerRemotely(req) {
    const model = req.model ?? modelFor(req.callType, !!req.images?.length);
    const payload = JSON.stringify(this.buildBody(req, model));
    if (Buffer.byteLength(payload) > 4194304) {
      throw new DrexError(422, "invalid_request_error", `${req.callType}: request body is over the 4 MiB limit`);
    }
    const maxAttempts = 6;
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.aborted) throw new DrexError(0, "aborted", "Session stopped");
      let res;
      try {
        res = await fetch(apiUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey()}`,
            "Content-Type": "application/json",
            "X-Nace-Legend": "array"
          },
          body: payload,
          // Drex can take up to 55 s before answering 529; shorter client timeouts cancel requests about to succeed.
          signal: AbortSignal.timeout(65e3)
        });
      } catch (err) {
        lastError = err;
        await sleep(backoff(attempt));
        continue;
      }
      if (res.ok) {
        const json = await res.json();
        return { ...this.normalise(req, json.answers), model: json.model };
      }
      let detail = null;
      try {
        detail = await res.json();
      } catch {
      }
      if (res.status === 403 && !detail?.error && switchHost()) {
        attempt--;
        continue;
      }
      const kind = detail?.error?.type ?? `http_${res.status}`;
      const issues = (detail?.error?.issues ?? []).map((i) => `${i.path}: ${i.message}`).join("; ");
      const message = `${detail?.error?.message ?? res.statusText}${issues ? ` (${issues})` : ""}`;
      const error = new DrexError(res.status, kind, `Drex ${res.status} on ${req.callType}: ${message}`, detail?.request_id);
      if (![429, 500, 503, 529, 408].includes(res.status)) throw error;
      lastError = error;
      const retryMs = Number(res.headers.get("retry-after-ms")) || Number(res.headers.get("retry-after")) * 1e3 || 0;
      await sleep(Math.max(retryMs, backoff(attempt)));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  normalise(req, answers) {
    const probabilities = {};
    const values = {};
    for (const qn of req.questions) {
      const a = answers?.[qn.id];
      if (!a) throw new DrexError(500, "missing_answer", `Drex returned no answer for "${qn.id}"`);
      if (qn.type === "choice") {
        const probs = {};
        for (const o of qn.options) probs[o.key] = Number(a.probabilities?.[o.key] ?? (a.choice === o.key ? 1 : 0));
        probabilities[qn.id] = probs;
        values[qn.id] = Number(a.confidence ?? 0);
      } else if (qn.type === "noul") {
        const p = clamp(Number(a.noul ?? 0.5), 0, 1);
        probabilities[qn.id] = { yes: p, no: 1 - p };
        values[qn.id] = p;
      } else {
        const probs = {};
        qn.levels.forEach((_l, i) => probs[String(i)] = Number(a.probabilities?.[String(i)] ?? 0));
        probabilities[qn.id] = probs;
        values[qn.id] = Number(a.score ?? 0);
      }
    }
    return { probabilities, values };
  }
};
function backoff(attempt) {
  const base = Math.min(5e3, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

// server/session.ts
var BUFFER_AHEAD = 4;
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var Session = class {
  constructor(opts) {
    this.opts = opts;
    this.seed = opts.seed ?? (hashString(opts.prompt) ^ Date.now() & 65535) >>> 0;
    this.piece = new Piece(opts.prompt, readMood(opts.prompt));
    this.gw = new Gateway({
      seed: this.seed,
      onCall: (call) => {
        this.send({ type: "call", call });
        if (Date.now() - this.lastStats > 400) this.stats();
      }
    });
    this.ctx = { gw: this.gw, piece: this.piece, rng: mulberry32(this.seed), emit: (e) => this.send(e) };
  }
  opts;
  piece;
  gw;
  seed;
  rejects = 0;
  holds = 0;
  ctx;
  stopped = false;
  started = -1;
  holding = false;
  wake = null;
  lastStats = 0;
  send(event) {
    if (!this.stopped) this.opts.send(event);
  }
  stats() {
    this.lastStats = Date.now();
    this.send({ type: "stats", calls: this.gw.calls, callsLastMinute: this.gw.callsLastMinute(), rejects: this.rejects, holds: this.holds, composed: this.piece.phrases.length });
  }
  stop() {
    this.stopped = true;
    this.holding = false;
    this.gw.abort();
    this.wake?.();
  }
  onClient(event) {
    if (event.type === "phrase_started") {
      this.started = Math.max(this.started, event.index);
      this.wake?.();
    } else if (event.type === "hold_started") {
      void this.runHold(event.afterIndex);
    } else if (event.type === "hold_ended") {
      this.holding = false;
    } else if (event.type === "stop") {
      this.stop();
    }
  }
  /** While playback holds, Drex keeps choosing how the sustain evolves. */
  async runHold(afterIndex) {
    const after = this.piece.phrases[afterIndex];
    if (!after || this.holding || afterIndex >= this.piece.plan.totalPhrases - 1) return;
    this.holding = true;
    this.holds++;
    this.send({ type: "status", stage: "holding", message: `Holding after phrase ${afterIndex + 1} while drafts are redrawn` });
    const hold = startHold(after);
    const barMs = after.score.beatsPerBar * 6e4 / after.score.bpm;
    await sleep2(1500);
    while (this.holding && !this.stopped) {
      try {
        const update = await holdStep(this.ctx, hold, after);
        if (!this.holding || this.stopped) break;
        this.send({ type: "hold_update", update });
      } catch (err) {
        if (!(err instanceof DrexError && err.kind === "aborted")) console.error("[hold]", err);
        break;
      }
      await sleep2(Math.max(2500, barMs));
    }
  }
  async waitForRoom() {
    while (this.opts.paced && !this.stopped && this.piece.phrases.length - (this.started + 1) >= BUFFER_AHEAD) {
      await new Promise((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
  async run() {
    const { piece, ctx } = this;
    try {
      this.send({ type: "session", id: `s${this.seed.toString(36)}`, prompt: piece.prompt, standin: this.gw.standin, model: this.gw.model, seed: this.seed });
      this.send({ type: "status", stage: "setup", message: "Drex is setting the rules of the piece" });
      await runSetup(ctx);
      this.send({ type: "status", stage: "plan", message: "Drex is planning sections and the tension curve" });
      await runPlan(ctx);
      await runBackdrop(ctx);
      this.send({ type: "status", stage: "themes", message: "Drafting and judging the theme" });
      await writeTheme(ctx, "A", "main");
      if (piece.plan.needsCounter) await deriveCounterTheme(ctx, "B");
      this.stats();
      const total = piece.plan.totalPhrases;
      let pending = null;
      for (let index = 0; index < total && !this.stopped; index++) {
        await this.waitForRoom();
        if (this.stopped) break;
        const section = piece.sectionOf(index);
        if (index === section.first && index > 0) await revisePlan(ctx, index);
        const lastSection = piece.plan.sections[piece.plan.sections.length - 1];
        if (!piece.endingPlan && (index === lastSection.first || index === total - 1)) await chooseEnding(ctx, index);
        if (piece.roleOf(index) === "departure" && piece.plan.needsContrast && !piece.theme("C")) {
          this.send({ type: "status", stage: "themes", message: "Drafting a contrast theme for the departure" });
          await writeTheme(ctx, "C", "contrast", piece.mainTheme);
        }
        this.send({
          type: "status",
          stage: this.started < 0 ? "buffering" : this.holding ? "holding" : "composing",
          message: `Composing phrase ${index + 1} of ${total} (${piece.roleOf(index)}, tension ${piece.tensionOf(index)})`
        });
        const record = await composePhrase(ctx, index, () => {
          this.rejects++;
          this.stats();
        }, () => !this.stopped);
        if (!record) break;
        if (pending) {
          this.holding = false;
          this.send({ type: "phrase", score: pending });
        }
        pending = record.score;
        this.stats();
      }
      if (!this.stopped) {
        if (pending) this.send({ type: "phrase", score: pending });
        this.send({ type: "status", stage: "done", message: `Composed ${piece.phrases.length} phrases in ${this.gw.calls} Drex calls` });
        this.send({ type: "done" });
      }
    } catch (err) {
      if (err instanceof DrexError && err.kind === "aborted") return;
      console.error("[session]", err);
      this.send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      this.send({ type: "status", stage: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
};

// server/vercel.ts
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: 'POST a JSON body with a "prompt".' }));
    return;
  }
  const body = await readBody(req);
  const prompt = String(body.prompt ?? "").trim().slice(0, 600) || "a quiet piece";
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  const send = (e) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(e)}
`);
  };
  const session = new Session({ prompt, seed: typeof body.seed === "number" ? body.seed : void 0, paced: false, send });
  res.on("close", () => session.stop());
  await session.run();
  res.end();
}
export {
  handler as default
};
