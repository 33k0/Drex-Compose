// Electronic drum kit `ekit`: fetch CC0 one-shots, shape them into one punchy kit, encode, and merge the
// instrument into assets/samples/manifest.json (+ manifest.extra.json). Re-runnable; downloads are cached.
// Usage: node build-ekit.mjs [--force] [--dry]
//
// Sources (licences read from each project's own licence file, see assets/CREDITS.md):
//  * Sonic Pi `etc/samples` (CC0 1.0; every bundled sample is from freesound.org under CC0) - kick, snare,
//    hats, snaps, cowbell, crash, ride. Pinned commit below.
//  * VCSL (CC0 1.0) - hand claps and a small shaker. Pinned commit below.
//  * Toms: generated here (808-style sine with a pitch drop and a click), no third-party audio.
//
// Pieces are mono, trimmed hard to the transient, filtered, given an envelope where noted, and set to one
// kit balance (`levelDb`, relative loudness of the loudest 50 ms). One common gain then puts the hottest
// file at -1 dBFS. The engine applies no per-key evening-out to unpitched kits, so this balance is what plays.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, ROOT, SAMPLES, ensureDir, ffmpeg, decodeMono, dB, pool } from './lib.mjs';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry');
const R = 44100;
const OUT_DIR = 'ekit';
const MAX_PEAK_DB = -1;

const SP_COMMIT = '25baaed3c28003bf141f591081217136194b0d69'; // sonic-pi-net/sonic-pi, branch `stable`
const SP_BASE = `https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/${SP_COMMIT}/`;
const SP_DIR = path.join(RAW, 'sonic-pi-samples');
const VC_COMMIT = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'; // sgossner/VCSL (same commit as the glockenspiel / vibraphone)
const VC_BASE = `https://raw.githubusercontent.com/sgossner/VCSL/${VC_COMMIT}/`;
const VC_DIR = path.join(RAW, 'vcsl-ekit');
const VC_PERC = 'Idiophones/Struck Idiophones/';

const sp = (name) => ({ lib: 'sp', rel: `${name}.flac` });
const vc = (rel) => ({ lib: 'vc', rel });
const srcPath = (s) => (s.lib === 'sp' ? path.join(SP_DIR, s.rel) : path.join(VC_DIR, s.rel));
const srcUrl = (s) => (s.lib === 'sp' ? `${SP_BASE}etc/samples/${s.rel}` : VC_BASE + (VC_PERC + s.rel).split('/').map(encodeURIComponent).join('/'));
const srcLabel = (s) => (s.lib === 'sp' ? `sonic-pi etc/samples/${s.rel}` : `VCSL ${VC_PERC}${s.rel}`);

// ------------------------------------------------------------------ the kit
// layer: { src | synth, gainDb, hp, lp (Hz, 2nd order; hp4 = 4th order), from (s into the source), len, fadeOut,
//          decay: { from, tau } (exponential decay laid over the source after `from` s) }
// piece: { key, name, levelDb, crestDb (transient clip, see clipCrest), takes }
// take:  { layers, cap, fade, trimDb (onset = first sample within trimDb of the peak, minus 3 ms) }
const PIECES = [
  {
    // compressed club kick (pitch 85 -> 52 Hz in 30 ms, full-level body) shortened into a punchy decay, plus the
    // high-passed click of a techno kick so it still reads on small speakers (no low-end overlap: no phase issue)
    key: 36, name: 'kick', levelDb: 0,
    takes: [{
      cap: 0.5, fade: 0.06,
      layers: [
        { src: sp('bd_klub'), hp: 28, decay: { from: 0.07, tau: 0.13 } },
        { src: sp('bd_tek'), hp4: 1400, len: 0.035, fadeOut: 0.025, gainDb: -3 },
      ],
    }],
  },
  // rimshot / finger snap (the second take has a low thump that is filtered away)
  { key: 37, name: 'snap', levelDb: -9, crestDb: 9, takes: [
    { cap: 0.3, fade: 0.08, layers: [{ src: sp('perc_snap'), hp: 300 }] },
    { cap: 0.3, fade: 0.08, layers: [{ src: sp('perc_snap2'), hp4: 380 }] },
  ] },
  // 909-flavoured snare (freesound user "Adriak909")
  { key: 38, name: 'snare', levelDb: -2, crestDb: 8, takes: [{ cap: 0.4, fade: 0.1, layers: [{ src: sp('sn_dub'), hp: 110 }] }] },
  // real group hand claps (the two tightest takes), room tail shortened
  { key: 39, name: 'clap', levelDb: -3, crestDb: 8, takes: [
    { cap: 0.42, fade: 0.2, layers: [{ src: vc('Claps/Clap_rr6.wav'), hp: 220 }] },
    { cap: 0.42, fade: 0.2, layers: [{ src: vc('Claps/Clap_rr1.wav'), hp: 220 }] },
  ] },
  { key: 42, name: 'hat_closed', levelDb: -13, takes: [
    { cap: 0.16, fade: 0.05, layers: [{ src: sp('hat_gem'), hp: 600 }] },
    { cap: 0.16, fade: 0.05, layers: [{ src: sp('hat_yosh'), hp: 600 }] },
  ] },
  { key: 44, name: 'hat_pedal', levelDb: -16, takes: [{ cap: 0.2, fade: 0.06, layers: [{ src: sp('hat_tap'), hp: 600 }] }] },
  { key: 46, name: 'hat_open', levelDb: -12, takes: [{ cap: 0.6, fade: 0.15, layers: [{ src: sp('hat_gump'), hp: 500 }] }] },
  // generated 808-style toms
  { key: 45, name: 'tom_low', levelDb: -4, takes: [{ cap: 0.75, fade: 0.15, layers: [{ synth: { tom: 87.3, tau: 0.19 } }] }] },
  { key: 47, name: 'tom_mid', levelDb: -4, takes: [{ cap: 0.65, fade: 0.15, layers: [{ synth: { tom: 116.5, tau: 0.16 } }] }] },
  { key: 50, name: 'tom_high', levelDb: -4, takes: [{ cap: 0.55, fade: 0.15, layers: [{ synth: { tom: 155.6, tau: 0.13 } }] }] },
  { key: 49, name: 'crash', levelDb: -8, takes: [{ cap: 1.7, fade: 0.5, layers: [{ src: sp('drum_cymbal_hard'), hp: 300 }] }] },
  { key: 51, name: 'ride', levelDb: -14, takes: [{ cap: 3, fade: 1, layers: [{ src: sp('ride_tri'), hp: 250 }] }] },
  { key: 56, name: 'cowbell', levelDb: -11, takes: [{ cap: 0.4, fade: 0.1, layers: [{ src: sp('drum_cowbell'), hp: 300 }] }] },
  // small shaker, the up-strokes (crisp onset; the down-strokes swell for ~60 ms); the low room rumble is filtered off.
  // The onset is taken nearer the peak so the soft rise does not drag the hit late.
  { key: 70, name: 'shaker', levelDb: -15, crestDb: 12, takes: [
    { cap: 0.2, fade: 0.06, trimDb: -18, layers: [{ src: vc('Shaker, Small/Mid_ShakerHighFaster_Up_rr1.wav'), hp4: 700 }] },
    { cap: 0.2, fade: 0.06, trimDb: -18, layers: [{ src: vc('Shaker, Small/Mid_ShakerHighFaster_Up_rr2.wav'), hp4: 700 }] },
  ] },
];

// ------------------------------------------------------------------ download
async function fetchTo(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
  ensureDir(path.dirname(dest));
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(dest + '.part', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(dest + '.part', dest);
      return 'ok';
    } catch (e) {
      if (attempt === 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

async function download() {
  const srcs = new Map();
  for (const p of PIECES) for (const t of p.takes) for (const l of t.layers) if (l.src) srcs.set(srcPath(l.src), l.src);
  const jobs = [...srcs.values()].map((s) => ({ url: srcUrl(s), dest: srcPath(s) }));
  // the licence texts travel with the audio
  jobs.push({ url: `${SP_BASE}LICENSE.md`, dest: path.join(SP_DIR, 'LICENSE.md') });
  jobs.push({ url: `${SP_BASE}etc/samples/README.md`, dest: path.join(SP_DIR, 'README.md') });
  jobs.push({ url: `${VC_BASE}LICENSE`, dest: path.join(VC_DIR, 'LICENSE') });
  const res = await pool(jobs, 8, (j) => fetchTo(j.url, j.dest));
  console.log(`ekit sources: ${res.filter((r) => r === 'ok').length} downloaded, ${res.filter((r) => r === 'cached').length} cached`);
}

// ------------------------------------------------------------------ DSP (mono Float32 at 44.1 kHz)
function biquad(x, type, f, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f) / R;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'hp') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** First sample within `relDb` of the peak, minus 3 ms. */
function onset(x, relDb) {
  const thr = peakOf(x) * Math.pow(10, relDb / 20);
  let i = 0;
  while (i < x.length && Math.abs(x[i]) < thr) i++;
  return Math.max(0, i - Math.round(0.003 * R));
}

/** 808-style tom: sine falling ~0.45 octave onto f0 in ~25 ms, exponential decay, short noise click, light saturation. */
function synthTom({ tom: f0, tau }, len) {
  const n = Math.round(len * R);
  const y = new Float32Array(n);
  let ph = 0;
  let seed = 0x7a3c19 ^ Math.round(f0);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  let hpPrev = 0, hpOut = 0;
  for (let i = 0; i < n; i++) {
    const t = i / R;
    const f = f0 * (1 + 0.38 * Math.exp(-t / 0.025));
    ph += (2 * Math.PI * f) / R;
    const body = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0008);
    const w = rnd();
    hpOut = 0.86 * (hpOut + w - hpPrev); // one-pole high-pass, ~1 kHz
    hpPrev = w;
    const click = hpOut * 0.35 * Math.exp(-t / 0.004);
    y[i] = Math.tanh(1.6 * (body + click)) / Math.tanh(1.6);
  }
  return y;
}

async function renderLayer(l, cap) {
  let x;
  if (l.synth) x = synthTom(l.synth, cap);
  else {
    x = await decodeMono(srcPath(l.src), R);
    x = x.slice(onset(x, -40) + Math.round((l.from ?? 0) * R));
  }
  if (l.hp) x = biquad(x, 'hp', l.hp);
  if (l.hp4) x = biquad(biquad(x, 'hp', l.hp4, 0.54), 'hp', l.hp4, 1.31);
  if (l.lp) x = biquad(x, 'lp', l.lp);
  if (l.decay) for (let i = Math.round(l.decay.from * R); i < x.length; i++) x[i] *= Math.exp(-(i / R - l.decay.from) / l.decay.tau);
  if (l.len) {
    x = x.slice(0, Math.round(l.len * R));
    const f = Math.round((l.fadeOut ?? 0.01) * R);
    for (let i = 0; i < f && i < x.length; i++) x[x.length - 1 - i] *= i / f;
  }
  const g = Math.pow(10, (l.gainDb ?? 0) / 20);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

async function renderTake(t) {
  const layers = await Promise.all(t.layers.map((l) => renderLayer(l, t.cap)));
  let x = new Float32Array(Math.max(...layers.map((l) => l.length)));
  for (const l of layers) for (let i = 0; i < l.length; i++) x[i] += l[i];
  // tight trim at the transient (the drum kit rule), optionally nearer the peak (soft-onset shakers)
  const start = onset(x, t.trimDb ?? -40);
  x = x.slice(start);
  const fin = Math.round(0.0015 * R);
  for (let i = 0; i < fin && i < x.length; i++) x[i] *= i / fin;
  // cap with a fade-out; also drop the inaudible end of the file
  const thr = peakOf(x) * Math.pow(10, -66 / 20);
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < thr) end--;
  end = Math.min(end, Math.round(t.cap * R));
  x = x.slice(0, end);
  const fo = Math.min(x.length, Math.round(t.fade * R));
  for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= Math.sin(((i / fo) * Math.PI) / 2);
  return x;
}

/**
 * Transient clip (standard on pop drums): peaks more than `crestDb` above the punch level are rounded off with a
 * soft knee. Affects only the first milliseconds of spiky hits (claps, snaps), so the kit can sit louder.
 */
function clipCrest(x, crestDb) {
  const thr = Math.pow(10, (punchDb(x) + crestDb) / 20);
  const knee = 0.6 * thr;
  return x.map((v) => {
    const a = Math.abs(v);
    if (a <= knee) return v;
    return Math.sign(v) * (knee + (thr - knee) * Math.tanh((a - knee) / (thr - knee)));
  });
}

/** Loudness proxy: RMS of the loudest 50 ms window (dB). */
function punchDb(x) {
  const w = Math.round(0.05 * R);
  let best = 0;
  for (let i = 0; i < x.length; i += Math.round(w / 5)) {
    let s = 0;
    const e = Math.min(x.length, i + w);
    for (let k = i; k < e; k++) s += x[k] * x[k];
    best = Math.max(best, s / w);
  }
  return 10 * Math.log10(best + 1e-20);
}

function rmsDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return dB(Math.sqrt(s / Math.max(1, x.length)));
}

function writeWavF32(file, x) {
  const b = Buffer.alloc(44 + x.length * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(R, 24); b.writeUInt32LE(R * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 4, 40);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 44 + i * 4);
  fs.writeFileSync(file, b);
}

// ------------------------------------------------------------------ build
const mp3Quality = (peakDb) => (peakDb < -24 ? '0' : peakDb < -12 ? '2' : '4'); // same rule as build.mjs

await download();
const renders = [];
for (const p of PIECES) {
  for (let ti = 0; ti < p.takes.length; ti++) {
    const t = p.takes[ti];
    let x = await renderTake(t);
    if (p.crestDb) x = clipCrest(x, p.crestDb);
    renders.push({ p, ti, t, x, punch: punchDb(x), out: `${OUT_DIR}/${p.name}${p.takes.length > 1 ? `_rr${ti + 1}` : ''}.mp3` });
  }
}
// kit balance: every take of a piece gets the same gain (their mean punch hits the piece's level)
const pieceGain = new Map();
for (const p of PIECES) {
  const rs = renders.filter((r) => r.p === p);
  const mean = rs.reduce((a, r) => a + r.punch, 0) / rs.length;
  pieceGain.set(p, p.levelDb - mean);
}
let maxPeak = -Infinity;
for (const r of renders) maxPeak = Math.max(maxPeak, dB(peakOf(r.x)) + pieceGain.get(r.p));
const commonDb = +(MAX_PEAK_DB - maxPeak).toFixed(2);

const renderDir = path.join(ROOT, '.cache', 'ekit-render');
ensureDir(renderDir);
ensureDir(path.join(SAMPLES, OUT_DIR));
const stateFile = path.join(ROOT, '.cache', 'build-ekit-state.json');
const state = fs.existsSync(stateFile) && !FORCE ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const files = {};
let encoded = 0;
await pool(renders, 6, async (r) => {
  const g = pieceGain.get(r.p) + commonDb;
  const k = Math.pow(10, g / 20);
  const y = r.x.map((v) => v * k);
  const peak = dB(peakOf(y));
  const q = mp3Quality(peak);
  const wav = path.join(renderDir, path.basename(r.out, '.mp3') + '.wav');
  const recipe = JSON.stringify({ t: r.t, g: +g.toFixed(3), q, v: 2 });
  const dest = path.join(SAMPLES, r.out);
  files[r.out] = {
    source: r.t.layers.map((l) => (l.src ? srcLabel(l.src) : `generated: 808-style tom ${l.synth.tom} Hz`)).join(' + '),
    durationSec: +(y.length / R).toFixed(3),
    gainDb: +g.toFixed(1),
    peakDb: +peak.toFixed(1),
    rmsDb: +rmsDb(y).toFixed(1),
    punchDb: +(r.punch + g).toFixed(1),
    mp3Vbr: 'V' + q,
  };
  console.log(`  ${r.out.padEnd(26)} ${files[r.out].durationSec.toFixed(2)} s  peak ${peak.toFixed(1)}  punch ${(r.punch + g).toFixed(1)} dB  (gain ${g >= 0 ? '+' : ''}${g.toFixed(1)})`);
  if (DRY || (state[r.out] === recipe && fs.existsSync(dest))) return;
  writeWavF32(wav, y);
  // explicit channel copy: ffmpeg's default mono -> stereo upmix would lower each channel by 3 dB
  const res = await ffmpeg(['-y', '-i', wav, '-af', 'pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=s16p', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', q, '-map_metadata', '-1', dest]);
  if (res.code !== 0) throw new Error(`ffmpeg failed for ${r.out}\n${res.stderr.slice(-600)}`);
  state[r.out] = recipe;
  encoded++;
});
if (DRY) process.exit(0);
fs.writeFileSync(stateFile, JSON.stringify(state));

// stale outputs
const keep = new Set(renders.map((r) => r.out));
for (const f of fs.readdirSync(path.join(SAMPLES, OUT_DIR))) {
  const rel = `${OUT_DIR}/${f}`;
  if (f.endsWith('.mp3') && !keep.has(rel)) {
    fs.rmSync(path.join(SAMPLES, rel));
    console.log('  removed stale', rel);
  }
}

// ------------------------------------------------------------------ manifest merge
const samples = {};
for (const p of [...PIECES].sort((a, b) => a.key - b.key)) samples[String(p.key)] = renders.filter((r) => r.p === p).map((r) => r.out);
const entry = {
  label: 'Electronic Drum Kit (808/909-style; CC0 one-shots + generated toms)',
  family: 'drums',
  source: 'Sonic Pi sample set (freesound.org, CC0) + VCSL claps / shaker (CC0) + toms generated by build-ekit.mjs',
  licence: 'CC0',
  range: [36, 70],
  articulations: { hit: { gainDb: commonDb, oneShot: true, layers: [{ velMax: 1, samples }] } },
};
const mFile = path.join(SAMPLES, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(mFile, 'utf8'));
manifest.instruments.ekit = entry;
fs.writeFileSync(mFile, JSON.stringify(manifest, null, 1) + '\n');

const xFile = path.join(SAMPLES, 'manifest.extra.json');
const extra = JSON.parse(fs.readFileSync(xFile, 'utf8'));
for (const k of Object.keys(extra.files ?? {})) if (k.startsWith(`${OUT_DIR}/`)) delete extra.files[k];
const all = Object.values(files);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
extra.instruments.ekit = {
  hit: {
    gainDb: commonDb, capSec: null, builtBy: 'tools/samples/build-ekit.mjs',
    layers: [{ velMax: 1, medianPeakDb: med(all.map((f) => f.peakDb)), medianRmsDb: med(all.map((f) => f.rmsDb)), medianDurationSec: med(all.map((f) => f.durationSec)), minDurationSec: Math.min(...all.map((f) => f.durationSec)) }],
  },
};
extra.files = { ...extra.files, ...Object.fromEntries(Object.entries(files).sort()) };
fs.writeFileSync(xFile, JSON.stringify(extra, null, 1) + '\n');
console.log(`ekit: ${renders.length} files (${encoded} encoded), common gain ${commonDb} dB; manifest.json + manifest.extra.json updated`);
