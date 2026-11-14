// Motion analyser: pure signal processing on a tiny decoded copy of the video (no ML).
//
// Pipeline
//   1. ffmpeg decodes the clip to ~64 px RGB thumbnails at `sampleRate` Hz.
//   2. For every pair of consecutive thumbnails we measure: the mean absolute RGB difference (global),
//      the same per 4x4 px block (so a small subject on a static background still registers), how many
//      blocks changed (coverage), and how far the colour histogram moved.
//   3. Hard cuts = isolated one-frame spikes that change a large part of the picture and its colour
//      histogram, and whose new picture stays (see detectCuts). They are taken out of the motion curve and
//      reported separately.
//   4. Tempo = a steady pulse in the motion, looked for with an autocorrelation comb and with spectral
//      lines over the whole clip (see the Tempo section), folded into 60-180 BPM.
//   5. Downbeat offsets = phases at which a 4-beat pulse train collects the most motion energy.
//
// Time base: curve[i] is the change between thumbnail i-1 and thumbnail i and belongs to t = i / sampleRate
// (curve[0] is 0).

import path from 'node:path';
import { lastLines, probeVideo, runFfmpeg } from './ffmpeg.ts';

export interface TempoCandidate {
  bpm: number;
  /**
   * 0..1: confidence that the motion carries a steady pulse at this tempo. 1 = strictly periodic motion;
   * 0.25-0.4 = a pulse that is statistically there but a small part of the motion (typical for real dance
   * footage); below 0.2 = not convincing (a weak hint at 0.1-0.18, or a neutral fallback at 0.1 / 0.07 / 0.05).
   */
  strength: number;
  /**
   * 'base' = the motion's own repetition rate folded into 60-180 BPM; 'half' / 'double' = its octave
   * neighbours (they inherit up to 85% of the base strength, because the same pulse fits them);
   * 'other' = an unrelated hypothesis or a neutral fallback derived from how lively the footage is.
   */
  relation: 'base' | 'half' | 'double' | 'other';
}

export interface DownbeatCandidate {
  /** Time (s) of the first downbeat-like pulse for the given bpm; later downbeats are offsetSec + n * 4 * 60 / bpm. */
  offsetSec: number;
  /** 0..1: how much more motion the pulse train at this phase collects than an average phase would. */
  strength: number;
}

export interface MotionAnalysis {
  /** Hz of `curve`. */
  sampleRate: number;
  /** Frame-to-frame change energy, normalised 0..1. Cut frames are replaced by their neighbours. */
  curve: number[];
  /** Mean of curve per whole second of video (length = ceil(duration)). */
  perSecond: number[];
  /** Times of the strongest motion spikes (ascending, at most two per second on average, cuts excluded). */
  peaksSec: number[];
  /** Times (s) of likely hard scene cuts: the first frame of each new shot. */
  cuts: number[];
  /**
   * Dominant repeating period of the motion in seconds (not folded: a left-right sway reports the full swing),
   * or null when the motion is not convincingly periodic.
   */
  periodSec: number | null;
  tempo: { candidates: TempoCandidate[]; downbeats: Record<string, DownbeatCandidate[]> };
}

export interface MotionOptions {
  /** Analysis rate in Hz. Default: the source frame rate halved until it is <= 32 (so 24, 25 or 30 for common sources). */
  sampleRate?: number;
}

/** Raw per-transition measurements; index i describes thumbnail i-1 -> i (index 0 is all zeros). */
export interface MotionSeries {
  rate: number;
  length: number;
  /** Mean absolute RGB difference over the whole thumbnail, 0..1. */
  global: Float32Array;
  /** Mean of the most-changed 10% of blocks, 0..1. */
  top: Float32Array;
  /** Fraction of blocks whose mean change exceeds BLOCK_CHANGED. */
  coverage: Float32Array;
  /** Colour histogram distance, 0..1. */
  hist: Float32Array;
  /**
   * How much of the change is still there PERSIST_SEC later: mean absolute RGB difference between thumbnail i-1
   * and thumbnail i+k (may be empty). A cut persists; a flash or a pop that decays does not.
   */
  persist: Float32Array;
  /**
   * How new the picture is: mean absolute RGB difference between thumbnail i and the one PERSIST_SEC before the
   * transition (may be empty). Small when the picture merely returns to what it was (the end of a flash or strobe).
   */
  novelty: Float32Array;
  /** Mean change in each cell of a coarse REGION_GRID x REGION_GRID grid. */
  regions: Float32Array[];
  /**
   * SIGNED change of mean brightness in each 8x8 px cell (may be empty). Unlike the magnitudes above this keeps
   * direction, so something swinging there and back repeats once per full swing instead of twice.
   */
  signed: Float32Array[];
}

const THUMB_LONG_SIDE = 64;
const BLOCK = 4;
const REGION_GRID = 4;
const BLOCK_CHANGED = 0.03;
const PERSIST_SEC = 0.4;
/** Blend level that maps to curve = 1 when the clip itself never gets that lively (keeps noise near 0). */
const NORM_FLOOR = 0.012;
const MIN_BPM = 60;
const MAX_BPM = 180;
/** Range searched for the motion's fundamental rate before folding. */
const SEARCH_MIN_BPM = 30;
const SEARCH_MAX_BPM = 240;
const BEATS_PER_BAR = 4;
/** Base strength from which the motion is called periodic (periodSec non-null, no neutral fallbacks). */
const PERIODIC_STRENGTH = 0.2;
/** Ceiling for the strength of a tempo that is only the best weak hypothesis, not a significant detection. */
const HINT_MAX_STRENGTH = 0.18;
const HINT_MIN_STRENGTH = 0.12;
/** Spectral score that noise is not expected to reach in a 20 s clip (see spectralDetector for other lengths). */
const SPECTRAL_GATE = 6;

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

function chooseRate(requested: number | undefined, sourceFps: number | null, tbr: number | null): number {
  if (requested !== undefined) {
    if (!Number.isFinite(requested) || requested < 2 || requested > 120) throw new Error(`sampleRate out of range: ${requested}`);
    return requested;
  }
  // For variable frame rate files the average rate is not a real frame clock; "tbr" (when sane) is.
  let r = tbr && tbr >= 5 && tbr <= 240 ? tbr : sourceFps && Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30;
  while (r > 32) r /= 2;
  if (r < 10) r *= Math.ceil(10 / r);
  // Snap 23.976 / 29.97 / slightly-off averages of variable frame rate files to the nearby integer.
  if (Math.abs(r - Math.round(r)) / r < 0.02) r = Math.round(r);
  return Math.round(r * 1000) / 1000;
}

function thumbSize(width: number, height: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { w: THUMB_LONG_SIDE, h: THUMB_LONG_SIDE };
  const even = (v: number) => Math.max(8, 2 * Math.round(v / 2));
  return width >= height
    ? { w: THUMB_LONG_SIDE, h: even((THUMB_LONG_SIDE * height) / width) }
    : { w: even((THUMB_LONG_SIDE * width) / height), h: THUMB_LONG_SIDE };
}

/** Decode the clip to thumbnails and measure every frame-to-frame transition. */
export async function collectMotionSeries(videoPath: string, opts: MotionOptions = {}): Promise<MotionSeries> {
  const source = path.resolve(videoPath);
  const probe = await probeVideo(source);
  const rate = chooseRate(opts.sampleRate, probe.fps, probe.tbr);
  const { w, h } = thumbSize(probe.width, probe.height);
  const npx = w * h;
  const frameBytes = npx * 3;

  const bw = Math.ceil(w / BLOCK);
  const bh = Math.ceil(h / BLOCK);
  const nBlocks = bw * bh;
  const blockOfPixel = new Uint16Array(npx);
  const blockCount = new Float32Array(nBlocks);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK);
      blockOfPixel[y * w + x] = b;
      blockCount[b]++;
    }
  }
  const nRegions = REGION_GRID * REGION_GRID;
  const regionOfBlock = new Uint8Array(nBlocks);
  const regionBlocks = new Float32Array(nRegions);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const r = Math.min(REGION_GRID - 1, Math.floor((by * REGION_GRID) / bh)) * REGION_GRID + Math.min(REGION_GRID - 1, Math.floor((bx * REGION_GRID) / bw));
      regionOfBlock[by * bw + bx] = r;
      regionBlocks[r]++;
    }
  }
  const topCount = Math.max(1, Math.round(nBlocks * 0.1));
  const cw = Math.ceil(bw / 2);
  const nCells = cw * Math.ceil(bh / 2);
  const cellOfPixel = new Uint16Array(npx);
  const cellCount = new Float32Array(nCells);
  for (let i = 0; i < npx; i++) {
    const b = blockOfPixel[i];
    const c = Math.floor(Math.floor(b / bw) / 2) * cw + Math.floor((b % bw) / 2);
    cellOfPixel[i] = c;
    cellCount[c]++;
  }

  const global: number[] = [];
  const top: number[] = [];
  const coverage: number[] = [];
  const hist: number[] = [];
  const regions: number[][] = Array.from({ length: nRegions }, () => []);
  const signed: number[][] = Array.from({ length: nCells }, () => []);
  let prevCell = new Float32Array(nCells);
  let curCell = new Float32Array(nCells);

  const prev = Buffer.alloc(frameBytes);
  const lookahead = Math.max(1, Math.round(PERSIST_SEC * rate));
  const ring = Array.from({ length: lookahead + 2 }, () => Buffer.alloc(frameBytes));
  const persist: number[] = [0];
  const novelty: number[] = [];
  const frameDiff = (a: Buffer, b: Buffer) => {
    let total = 0;
    for (let j = 0; j < frameBytes; j++) total += Math.abs(a[j] - b[j]);
    return total / frameBytes / 255;
  };
  let prevHist = new Float32Array(64);
  let curHist = new Float32Array(64);
  const blockSum = new Float32Array(nBlocks);
  const sorted = new Float32Array(nBlocks);
  const regionSum = new Float32Array(nRegions);
  let frames = 0;

  const consume = (buf: Buffer) => {
    curHist.fill(0);
    curCell.fill(0);
    for (let i = 0, j = 0; i < npx; i++, j += 3) {
      curHist[((buf[j] >> 6) << 4) | ((buf[j + 1] >> 6) << 2) | (buf[j + 2] >> 6)]++;
      curCell[cellOfPixel[i]] += 77 * buf[j] + 150 * buf[j + 1] + 29 * buf[j + 2];
    }
    for (let c = 0; c < nCells; c++) curCell[c] /= cellCount[c] * 65280;
    if (frames === 0) {
      global.push(0);
      top.push(0);
      coverage.push(0);
      hist.push(0);
      for (const r of regions) r.push(0);
      for (const c of signed) c.push(0);
    } else {
      blockSum.fill(0);
      let total = 0;
      for (let i = 0, j = 0; i < npx; i++, j += 3) {
        // Mean absolute difference over R, G and B, so a change of hue at equal brightness still counts.
        const d = (Math.abs(buf[j] - prev[j]) + Math.abs(buf[j + 1] - prev[j + 1]) + Math.abs(buf[j + 2] - prev[j + 2])) / 3;
        total += d;
        blockSum[blockOfPixel[i]] += d;
      }
      regionSum.fill(0);
      let changed = 0;
      for (let b = 0; b < nBlocks; b++) {
        const v = blockSum[b] / blockCount[b] / 255;
        sorted[b] = v;
        regionSum[regionOfBlock[b]] += v;
        if (v > BLOCK_CHANGED) changed++;
      }
      sorted.sort();
      let topSum = 0;
      for (let k = nBlocks - topCount; k < nBlocks; k++) topSum += sorted[k];
      let hd = 0;
      for (let k = 0; k < 64; k++) hd += Math.abs(curHist[k] - prevHist[k]);
      global.push(total / npx / 255);
      top.push(topSum / topCount);
      coverage.push(changed / nBlocks);
      hist.push(hd / (2 * npx));
      for (let r = 0; r < nRegions; r++) regions[r].push(regionBlocks[r] > 0 ? regionSum[r] / regionBlocks[r] : 0);
      for (let c = 0; c < nCells; c++) signed[c].push(curCell[c] - prevCell[c]);
    }
    [prevCell, curCell] = [curCell, prevCell];
    buf.copy(prev);
    buf.copy(ring[frames % ring.length]);
    novelty.push(frames === 0 ? 0 : frameDiff(buf, ring[Math.max(0, frames - 1 - lookahead) % ring.length]));
    // Transition i = frames - lookahead can now be compared with the picture `lookahead` frames after it.
    const i = frames - lookahead;
    if (i >= 1) persist[i] = frameDiff(ring[(i - 1) % ring.length], ring[frames % ring.length]);
    [prevHist, curHist] = [curHist, prevHist];
    frames++;
  };

  const frame = Buffer.alloc(frameBytes);
  let filled = 0;
  const res = await runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', source,
      '-map', '0:V:0', '-an', '-sn', '-dn',
      '-vf', `setpts=PTS-STARTPTS,fps=${rate},scale=${w}:${h}:flags=area,format=rgb24`,
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo', 'pipe:1',
    ],
    {
      onStdout: (chunk) => {
        let off = 0;
        while (off < chunk.length) {
          const n = Math.min(frameBytes - filled, chunk.length - off);
          chunk.copy(frame, filled, off, off + n);
          filled += n;
          off += n;
          if (filled === frameBytes) {
            consume(frame);
            filled = 0;
          }
        }
      },
    },
  );
  if (frames === 0) throw new Error(`could not decode any frames from ${source}: ${lastLines(res.stderr)}`);
  // The last transitions have no full look-ahead: compare with the final picture instead.
  for (let i = Math.max(1, frames - lookahead); i < frames; i++) {
    persist[i] = frameDiff(ring[(i - 1) % ring.length], ring[(frames - 1) % ring.length]);
  }

  return {
    rate,
    length: frames,
    global: Float32Array.from(global),
    top: Float32Array.from(top),
    coverage: Float32Array.from(coverage),
    hist: Float32Array.from(hist),
    persist: Float32Array.from(persist),
    novelty: Float32Array.from(novelty),
    regions: regions.map((r) => Float32Array.from(r)),
    signed: signed.map((c) => Float32Array.from(c)),
  };
}

// ---------------------------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(x: ArrayLike<number>, p: number): number {
  if (x.length === 0) return 0;
  const s = Float32Array.from(x).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

function gaussianSmooth(x: Float32Array, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-0.5 * (k / sigma) ** 2);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= x.length) continue;
      acc += x[j] * kernel[k + radius];
      wsum += kernel[k + radius];
    }
    out[i] = acc / wsum;
  }
  return out;
}

/** Centred moving mean; the window shrinks at the edges. */
function movingMean(x: Float32Array, window: number): Float32Array {
  const half = Math.max(1, Math.floor(window / 2));
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(x.length, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}

/** Linear interpolation; 0 outside the array. */
function sampleAt(x: Float32Array, pos: number): number {
  if (pos < 0 || pos > x.length - 1) return 0;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < x.length ? x[i] * (1 - f) + x[i + 1] * f : x[i];
}

// ---------------------------------------------------------------------------------------------
// Cuts
// ---------------------------------------------------------------------------------------------

/**
 * A hard cut is a ONE-frame event that replaces a large part of the picture and stays: the change is far
 * above the motion just before and after it (fast dancing is sustained over several frames; a flash gives
 * two adjacent spikes), it touches many blocks, moves the colour histogram, the picture is still different
 * 0.4 s later and it is not simply the picture of 0.4 s earlier coming back. (So an insert shorter than
 * 0.4 s reads as a flash, not as two cuts.)
 * Jump cuts on a shared plain background (same subject, new framing) count as cuts; an object or caption
 * popping in or out of a small part of the frame does not.
 */
export function detectCuts(s: MotionSeries): number[] {
  const n = s.length;
  const found: { i: number; score: number }[] = [];
  for (let i = 1; i < n; i++) {
    const g = s.global[i];
    const hd = s.hist[i];
    if (!(g >= 0.04 && s.coverage[i] >= 0.2 && hd >= 0.05)) continue;
    // The new picture has to stay: a flash, strobe or pop that fades back within ~0.4 s is not a cut.
    if (s.persist && s.persist.length === n && s.persist[i] < 0.5 * g) continue;
    // ... and it has to be new: going back to the picture of 0.4 s ago is the end of a flash, not a cut.
    if (s.novelty && s.novelty.length === n && s.novelty[i] < 0.5 * g) continue;
    const around: number[] = [];
    for (let k = i - 4; k <= i + 4; k++) if (k !== i && k >= 1 && k < n) around.push(s.global[k]);
    const adjacent = Math.max(i - 1 >= 1 ? s.global[i - 1] : 0, i + 1 < n ? s.global[i + 1] : 0);
    const histAdjacent = Math.max(i - 1 >= 1 ? s.hist[i - 1] : 0, i + 1 < n ? s.hist[i + 1] : 0);
    const ratio = g / Math.max(adjacent, 0.004);
    const histRatio = hd / Math.max(histAdjacent, 0.004);
    const isolated = g >= 2 * median(around) + 0.01 && ratio >= 1.6 && histRatio >= 2 && ratio * histRatio >= 5;
    if (!isolated) continue;
    found.push({ i, score: g * hd });
  }
  // Keep the strongest of any candidates closer than 0.2 s.
  const minGap = Math.max(2, Math.round(0.2 * s.rate));
  found.sort((a, b) => b.score - a.score);
  const kept: number[] = [];
  for (const c of found) if (kept.every((k) => Math.abs(k - c.i) >= minGap)) kept.push(c.i);
  return kept.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------------------------
//
// Two detectors look for a steady pulse in the motion:
//   * Autocorrelation comb (lags up to 8 s) over the motion-energy envelopes. It measures rho, the share
//     of the envelope's variance that repeats at a tempo (1 = strictly periodic). Tolerant of tempo drift,
//     but blind to a pulse that is only a small part of the motion.
//   * Spectral lines over the whole clip. A pulse that stays phase-locked for the whole clip (footage
//     performed or cut to a song or click) piles up in one narrow spectral line even when it is a small
//     share of the motion. Two feature sets are searched: the motion-energy envelopes, and the SIGNED
//     brightness change of each 8 px cell (keeps direction, so it sees the true period of a swing or bob).
//     Each spectrum is turned into z-scores against its own local background, and a tempo is scored by the
//     z-scores of its first four harmonics.
// strength (0..1) is the larger of sqrt(rho) and a confidence derived from the spectral score, scaled down
// for near-static footage and for tempos seen for fewer than ~4 periods.

/** Compress, smooth, remove the slow trend and even out loud/quiet stretches. Zero-mean, roughly unit scale. */
function prepareEnvelope(x: Float32Array, rate: number): { env: Float32Array; level: number } {
  const compressed = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) compressed[i] = Math.sqrt(Math.max(0, x[i]));
  const smooth = gaussianSmooth(compressed, Math.max(0.6, 0.035 * rate));
  const trend = movingMean(smooth, Math.round(2 * rate) | 1);
  const d = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) d[i] = smooth[i] - trend[i];
  const level = rms(d);
  if (!(level > 1e-7)) return { env: new Float32Array(x.length), level: 0 };
  const sq = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) sq[i] = d[i] * d[i];
  const local = movingMean(sq, Math.round(4 * rate) | 1);
  const env = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) env[i] = d[i] / (Math.sqrt(local[i]) + 0.5 * level);
  return { env, level };
}

/** Unbiased autocorrelation normalised so acf[0] = 1. */
function autocorrelation(x: Float32Array, maxLag: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(maxLag + 1);
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[i] * x[i];
  e0 /= n;
  if (!(e0 > 0)) return out;
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += x[i] * x[i + lag];
    out[lag] = acc / (n - lag) / e0;
  }
  return out;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Hann-windowed power spectrum up to `fmax`, scaled so a pure sinusoid reads 1 at its frequency
 * (i.e. each value is the share of the signal's power sitting in that spectral line).
 */
function lineSpectrum(x: Float32Array, rate: number, fmax: number): { df: number; power: Float32Array } {
  const n = x.length;
  let nfft = 1;
  while (nfft < 4 * n) nfft <<= 1;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let sumW = 0;
  let sumWx = 0;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n) : 1;
    sumW += w[i];
    sumWx += w[i] * x[i];
  }
  const mean = sumWx / sumW;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i] - mean;
    re[i] = w[i] * v;
    variance += w[i] * v * v;
  }
  variance /= sumW;
  const df = rate / nfft;
  const bins = Math.min(nfft >> 1, Math.ceil(fmax / df) + 2);
  const power = new Float32Array(bins);
  if (!(variance > 0)) return { df, power };
  fft(re, im);
  const norm = 2 / (sumW * sumW * variance);
  for (let k = 0; k < bins; k++) power[k] = (re[k] * re[k] + im[k] * im[k]) * norm;
  return { df, power };
}

function foldBpm(bpm: number): number {
  let b = bpm;
  while (b < MIN_BPM) b *= 2;
  while (b >= MAX_BPM) b /= 2;
  return b;
}

interface Peak {
  bpm: number;
  value: number;
}

function localMaxima(fn: (bpm: number) => number, step: number): Peak[] {
  const out: Peak[] = [];
  // Interior maxima only: a value that is still rising at the edge of the range is not a peak.
  let prev = fn(SEARCH_MIN_BPM - step);
  let cur = fn(SEARCH_MIN_BPM);
  for (let b = SEARCH_MIN_BPM; b <= SEARCH_MAX_BPM + 1e-9; b += step) {
    const next = fn(b + step);
    if (cur > 0 && cur >= prev && cur > next) out.push({ bpm: b, value: cur });
    prev = cur;
    cur = next;
  }
  return out;
}

/** Fastest rate that scores nearly as well as the best one (slower multiples of a true period score at least as well). */
function fundamentalOf(maxima: Peak[]): Peak | null {
  if (maxima.length === 0) return null;
  const top = Math.max(...maxima.map((m) => m.value));
  return maxima.filter((m) => m.value >= 0.8 * top).reduce((a, b) => (b.bpm > a.bpm ? b : a));
}

interface WeightedSeries {
  env: Float32Array;
  weight: number;
}

/** rho(bpm) = share of envelope variance repeating at that tempo, with chance level subtracted. */
function acfDetector(envs: WeightedSeries[], rate: number): { rho: (bpm: number) => number; maxima: Peak[] } {
  const n = envs[0].env.length;
  const maxLag = Math.min(Math.floor(n / 2), Math.round(8 * rate));
  const acf = new Float32Array(maxLag + 1);
  for (const e of envs) {
    const a = autocorrelation(e.env, maxLag);
    for (let i = 0; i <= maxLag; i++) acf[i] += a[i] * e.weight;
  }
  // Random series still produce small positive combs; subtract what chance alone would give.
  const noiseFloor = Math.min(0.35, 3 / Math.sqrt(n));
  const rho = (bpm: number) => {
    const period = (60 / bpm) * rate;
    const k = Math.min(8, Math.floor(maxLag / period));
    if (k < 1) return 0;
    let acc = 0;
    for (let j = 1; j <= k; j++) acc += sampleAt(acf, j * period);
    return clamp01((acc / k - noiseFloor) / (1 - noiseFloor));
  };
  return { rho, maxima: localMaxima(rho, 0.25) };
}

/**
 * Weighted power spectrum of a set of series, converted to z-scores against the local background:
 * power / running-median, cube-rooted (which makes chi-square-like noise roughly normal whatever its degrees
 * of freedom), then centred and scaled robustly. Returns null when the spectrum is empty.
 */
function zSpectrum(series: WeightedSeries[], rate: number, fmax: number): { df: number; z: Float32Array } | null {
  if (series.length === 0) return null;
  const durationSec = series[0].env.length / rate;
  let df = 0;
  let power = new Float32Array(0);
  for (const s of series) {
    const sp = lineSpectrum(s.env, rate, fmax);
    if (power.length === 0) {
      df = sp.df;
      power = new Float32Array(sp.power.length);
    }
    for (let k = 0; k < power.length; k++) power[k] += sp.power[k] * s.weight;
  }
  // One point per independent frequency bin; background = running median over about +-0.3 Hz.
  const coarseStep = Math.max(1, Math.round(1 / durationSec / df));
  const coarse: number[] = [];
  for (let k = 0; k < power.length; k += coarseStep) coarse.push(power[k]);
  const half = Math.max(8, Math.round(0.3 * durationSec));
  const background = new Float32Array(coarse.length);
  for (let j = 0; j < coarse.length; j++) background[j] = median(coarse.slice(Math.max(0, j - half), Math.min(coarse.length, j + half + 1)));

  const firstBin = Math.ceil(0.4 / (df * coarseStep));
  const ratios: number[] = [];
  for (let j = firstBin; j < coarse.length; j++) if (background[j] > 0) ratios.push(Math.cbrt(coarse[j] / background[j]));
  if (ratios.length < 8) return null;
  const centre = median(ratios);
  const sigma = 1.4826 * median(ratios.map((r) => Math.abs(r - centre)));
  if (!(sigma > 1e-6)) return null;
  const z = new Float32Array(power.length);
  for (let k = 0; k < power.length; k++) {
    const bg = sampleAt(background, k / coarseStep);
    z[k] = bg > 0 ? (Math.cbrt(power[k] / bg) - centre) / sigma : 0;
  }
  return { df, z };
}

/**
 * score(bpm) = root-sum-square of the z-scores (above 1.5) found at the tempo's first four harmonics in
 * every feature spectrum that shows a line at the tempo itself. `gate` is the score pure noise is not expected to reach anywhere in the search range.
 */
function spectralDetector(channels: WeightedSeries[][], rate: number): { score: (bpm: number) => number; maxima: Peak[]; gate: number } {
  const n = channels[0][0].env.length;
  const durationSec = n / rate;
  const fmax = Math.min(rate / 2, 8);
  const spectra = channels.map((c) => zSpectrum(c, rate, fmax)).filter((s): s is { df: number; z: Float32Array } => s !== null);
  const score = (bpm: number) => {
    const f = bpm / 60;
    let acc = 0;
    for (const s of spectra) {
      // The tempo's own line must be there; otherwise any tempo sharing one harmonic with a real pulse
      // (half time, 2:3, 3:4 ...) would score as well as the pulse itself.
      if (sampleAt(s.z, f / s.df) < 2.5) continue;
      for (let hmul = 1; hmul <= 4 && hmul * f <= fmax; hmul++) {
        const z = sampleAt(s.z, (hmul * f) / s.df) - 1.5;
        if (z > 0) acc += z * z;
      }
    }
    return Math.sqrt(acc);
  };
  const step = Math.min(0.25, Math.max(0.01, (60 * 0.125) / durationSec));
  // Calibrated on seeded white and red noise (60 runs per length): from 20 s up, noise peaks at a score of
  // about 4-6 and grows slowly with length (more bins, more chances). Below 20 s there are too few bins to
  // estimate the background of a sloping spectrum, noise reaches 15-25, and only a very strong line counts;
  // short clips are effectively left to the autocorrelation.
  const gate = durationSec >= 20 ? SPECTRAL_GATE + 0.25 * Math.log2(durationSec / 20) : SPECTRAL_GATE * (20 / durationSec) ** 1.5;
  return { score, maxima: spectra.length ? localMaxima(score, step) : [], gate };
}

interface TempoResult {
  candidates: TempoCandidate[];
  periodSec: number | null;
}

function estimateTempo(blend: Float32Array, regions: Float32Array[], signed: Float32Array[], rate: number, energy: number): TempoResult {
  const n = blend.length;
  const durationSec = n / rate;
  const fallbacks = (): TempoCandidate[] => {
    // Neutral suggestions when the picture gives no pulse: calmer footage -> slower.
    const primary = Math.round(66 + 60 * Math.sqrt(clamp01(energy / 0.05)));
    const secondary = Math.round(primary * (2 / 3) >= MIN_BPM ? primary * (2 / 3) : primary * (4 / 3));
    const third = Math.round(primary * 1.25 <= MAX_BPM ? primary * 1.25 : primary * 0.8);
    return [
      { bpm: primary, strength: 0.1, relation: 'other' },
      { bpm: secondary, strength: 0.07, relation: 'other' },
      { bpm: third, strength: 0.05, relation: 'other' },
    ];
  };

  const main = prepareEnvelope(blend, rate);
  const minPeriod = (60 / SEARCH_MAX_BPM) * rate;
  if (main.level === 0 || Math.floor(n / 2) < 2 * minPeriod) return { candidates: fallbacks(), periodSec: null };

  // The whole-frame envelope carries half the weight; the per-region envelopes share the other half, so
  // motion that alternates between parts of the picture (left/right) is seen as well as its overall pulse.
  const envs: WeightedSeries[] = [{ env: main.env, weight: 1 }];
  const prepared = regions.map((r) => prepareEnvelope(r, rate));
  const maxLevel = Math.max(0, ...prepared.map((p) => p.level));
  const active = prepared.filter((p) => p.level > 0 && p.level >= 0.2 * maxLevel);
  if (active.length > 0) {
    const total = active.reduce((a, p) => a + p.level, 0);
    envs[0].weight = 0.5;
    for (const p of active) envs.push({ env: p.env, weight: (0.5 * p.level) / total });
  }
  // Signed cell series, weighted by how much each cell moves.
  const cellPower = signed.map((c) => rms(c) ** 2);
  const totalCellPower = cellPower.reduce((a, v) => a + v, 0);
  const cells: WeightedSeries[] = totalCellPower > 0 ? signed.map((c, i) => ({ env: c, weight: cellPower[i] / totalCellPower })).filter((c) => c.weight > 1e-4) : [];

  const acf = acfDetector(envs, rate);
  const spectral = spectralDetector(cells.length ? [envs, cells] : [envs], rate);
  // Confidence terms: very quiet footage is mostly codec noise; a tempo seen for fewer than ~4 periods is a guess.
  const activity = clamp01(percentile(blend, 0.9) / 0.004);
  const confidence = (bpm: number) => activity * clamp01((durationSec / (60 / bpm) - 1) / 3);
  // Spectral score -> 0..1: below the gate it is only a hint; at the gate 0.25; 8 above the gate 1.
  const spectralStrength = (score: number) => (score < spectral.gate ? (HINT_MAX_STRENGTH * score) / spectral.gate : clamp01(0.25 + (0.75 * (score - spectral.gate)) / 8));
  const strengthOf = (bpm: number) => Math.max(Math.sqrt(acf.rho(bpm)), spectralStrength(spectral.score(bpm))) * confidence(bpm);

  // Pick the motion's fundamental rate. A significant spectral line wins (it uses the whole clip coherently and
  // is the more precise estimate); otherwise a clearly periodic autocorrelation; otherwise the best weak hint.
  const fs = spectral.maxima.length ? spectral.maxima.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const fa = fundamentalOf(acf.maxima);
  const spectralOk = fs !== null && fs.value >= spectral.gate;
  const acfOk = fa !== null && Math.sqrt(fa.value) >= PERIODIC_STRENGTH;
  let f0: number | null = null;
  let f0Strength = 0;
  if (spectralOk || acfOk) {
    const sStrength = spectralOk && fs ? spectralStrength(fs.value) : 0;
    const aStrength = acfOk && fa ? Math.sqrt(fa.value) : 0;
    // Prefer the spectral estimate unless the autocorrelation is far more convinced (drifting tempo, very short clips).
    if (spectralOk && fs && (!acfOk || sStrength >= aStrength - 0.3)) {
      f0 = fs.bpm;
      f0Strength = Math.max(sStrength, Math.sqrt(acf.rho(fs.bpm)));
    } else if (fa) {
      f0 = fa.bpm;
      f0Strength = aStrength;
    }
  }
  let periodic = f0 !== null;
  if (f0 === null) {
    const hint = fs ?? fa;
    if (!hint) return { candidates: fallbacks(), periodSec: null };
    f0 = hint.bpm;
    // A hint is weak evidence, but it is evidence: it ranks just above the neutral fallbacks (0.1) and
    // always below the "periodic" line.
    const closeness = clamp01(hint === fs ? hint.value / spectral.gate : Math.sqrt(hint.value) / PERIODIC_STRENGTH);
    f0Strength = HINT_MIN_STRENGTH + (HINT_MAX_STRENGTH - HINT_MIN_STRENGTH) * closeness;
  }

  // 'base' = the motion's own repetition rate folded into 60-180 BPM. Its octave neighbours fit the same
  // pulse (every motion pulse still lands on a beat or half-beat), so they inherit most of its strength.
  const base = foldBpm(f0);
  const folded = Math.abs(base - f0) > 1e-6;
  let baseStrength = Math.max(strengthOf(base), f0Strength * (folded ? 0.85 : 1) * confidence(base));
  if (!periodic) baseStrength = Math.min(baseStrength, HINT_MAX_STRENGTH);
  if (baseStrength < PERIODIC_STRENGTH) periodic = false;
  const family: TempoCandidate[] = [{ bpm: base, strength: baseStrength, relation: 'base' }];
  for (const [bpm, relation] of [[base / 2, 'half'], [base * 2, 'double']] as const) {
    if (bpm < MIN_BPM * 0.98 || bpm > MAX_BPM * 1.02) continue;
    family.push({ bpm, strength: Math.min(baseStrength, Math.max(strengthOf(bpm), 0.85 * baseStrength)), relation });
  }

  // Other hypotheses: peaks inside the musical range that are not octave-related to the base.
  const related = (a: number, b: number) => [0.25, 0.5, 1, 2, 4].some((r) => Math.abs(a / b - r) / r < 0.04);
  const others: TempoCandidate[] = [];
  // Spectral peaks far below the best one are leakage or noise; tempos in a simple ratio to the base (2:3, 3:4 ...)
  // belong to the same harmonic series (bar-level structure) and are marked down so the base stands out.
  const bestScore = fs ? fs.value : 0;
  const sameSeries = (a: number, b: number) => {
    for (let p = 1; p <= 8; p++) for (let q = 1; q <= 8; q++) if (p !== q && Math.abs(a / b - p / q) / (p / q) < 0.012) return true;
    return false;
  };
  const pool = [...acf.maxima, ...spectral.maxima.filter((m) => m.value >= spectral.gate && m.value >= 0.35 * bestScore)]
    .filter((m) => m.bpm >= MIN_BPM && m.bpm <= MAX_BPM)
    .map((m) => ({ bpm: m.bpm, strength: Math.min(strengthOf(m.bpm), baseStrength) * (sameSeries(m.bpm, base) ? 0.6 : 1), relation: 'other' as const }))
    .sort((a, b) => b.strength - a.strength);
  for (const c of pool) {
    if (others.length >= 2 || c.strength < 0.12) break;
    if (related(c.bpm, base) || others.some((o) => related(c.bpm, o.bpm))) continue;
    // Closer to the base than the analysis can resolve: the skirt of the same spectral line, not another tempo.
    if (Math.abs(c.bpm - base) < 150 / durationSec) continue;
    others.push(c);
  }

  let candidates: TempoCandidate[] = [...family, ...others];
  if (!periodic || candidates.length < 3) {
    for (const fb of fallbacks()) {
      if (candidates.length >= (periodic ? 3 : Math.max(3, family.length + others.length + 2))) break;
      if (!candidates.some((c) => Math.abs(c.bpm - fb.bpm) < 3)) candidates.push(fb);
    }
  }
  candidates = candidates
    .map((c) => ({ bpm: round(c.bpm, 2), strength: round(c.strength, 3), relation: c.relation }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);

  return { candidates, periodSec: periodic ? round(60 / f0, 4) : null };
}

// ---------------------------------------------------------------------------------------------
// Downbeats
// ---------------------------------------------------------------------------------------------

function downbeatsFor(bpm: number, accent: Float32Array, rate: number, cuts: number[]): DownbeatCandidate[] {
  const n = accent.length;
  const durationSec = n / rate;
  const period = 60 / bpm;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += accent[i];
  mean = n ? mean / n : 0;
  if (!(mean > 0)) return [{ offsetSec: 0, strength: 0 }, { offsetSec: round(Math.min(period, durationSec) / 2, 3), strength: 0 }];

  // Beat phase: mean accent collected by a pulse train starting at offset o.
  const stepSec = 1 / (rate * 4);
  const nPhase = Math.max(4, Math.round(period / stepSec));
  const phase = new Float32Array(nPhase);
  for (let p = 0; p < nPhase; p++) {
    const o = (p / nPhase) * period;
    let acc = 0;
    let count = 0;
    for (let t = o; t <= durationSec; t += period) {
      acc += sampleAt(accent, t * rate);
      count++;
    }
    phase[p] = count ? acc / count : 0;
  }
  const contrast = (v: number) => clamp01((v - mean) / (v + mean));
  let bestP = 0;
  for (let p = 1; p < nPhase; p++) if (phase[p] > phase[bestP]) bestP = p;
  const bestOffset = (bestP / nPhase) * period;

  const barPositions = (offset: number): { offsetSec: number; rel: number }[] => {
    const rows: { offsetSec: number; accent: number; cutHits: number }[] = [];
    for (let j = 0; j < BEATS_PER_BAR; j++) {
      const start = offset + j * period;
      if (start > durationSec) break;
      let acc = 0;
      let count = 0;
      let cutHits = 0;
      for (let t = start; t <= durationSec; t += period * BEATS_PER_BAR) {
        acc += sampleAt(accent, t * rate);
        count++;
        if (cuts.some((c) => Math.abs(c - t) <= 0.12)) cutHits++;
      }
      rows.push({ offsetSec: start, accent: count ? acc / count : 0, cutHits });
    }
    const maxAccent = Math.max(1e-9, ...rows.map((r) => r.accent));
    // Edits tend to land on bar lines, so bar phases that coincide with cuts get a bonus.
    const scored = rows.map((r) => ({ offsetSec: r.offsetSec, score: (r.accent / maxAccent) * (1 + (cuts.length >= 2 ? (0.5 * r.cutHits) / cuts.length : 0)) }));
    const maxScore = Math.max(1e-9, ...scored.map((r) => r.score));
    return scored.map((r) => ({ offsetSec: r.offsetSec, rel: r.score / maxScore })).sort((a, b) => b.rel - a.rel);
  };

  const out: DownbeatCandidate[] = [];
  const beatStrength = contrast(phase[bestP]);
  for (const pos of barPositions(bestOffset).slice(0, 3)) out.push({ offsetSec: pos.offsetSec, strength: beatStrength * (0.5 + 0.5 * pos.rel) });

  // An alternative beat phase (typically the off-beat), if the pulse train also collects clear energy there.
  let altP = -1;
  for (let p = 0; p < nPhase; p++) {
    const dist = Math.min(Math.abs(p - bestP), nPhase - Math.abs(p - bestP)) / nPhase;
    if (dist < 0.25) continue;
    const prev = phase[(p - 1 + nPhase) % nPhase];
    const next = phase[(p + 1) % nPhase];
    if (phase[p] < prev || phase[p] < next) continue;
    if (altP < 0 || phase[p] > phase[altP]) altP = p;
  }
  if (altP >= 0 && phase[altP] - mean > 0.5 * (phase[bestP] - mean)) {
    const alt = barPositions((altP / nPhase) * period)[0];
    if (alt) out.push({ offsetSec: alt.offsetSec, strength: contrast(phase[altP]) * (0.5 + 0.5 * alt.rel) });
  }
  if (out.length < 2) {
    // Clip shorter than two beats: offer the opposite phase so callers always have a choice.
    const other = (bestOffset + period / 2) % period;
    out.push({ offsetSec: other <= durationSec ? other : 0, strength: 0 });
  }
  return out
    .map((d) => ({ offsetSec: round(d.offsetSec, 3), strength: round(d.strength, 3) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

function findPeaks(curve: Float32Array, rate: number, cutFrames: Set<number>): number[] {
  const n = curve.length;
  if (n < 3) return [];
  const smooth = gaussianSmooth(curve, Math.max(0.6, 0.03 * rate));
  let mean = 0;
  for (let i = 0; i < n; i++) mean += smooth[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (smooth[i] - mean) ** 2;
  const threshold = Math.max(0.15, mean + Math.sqrt(variance / n));
  const candidates: { i: number; v: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (smooth[i] < threshold || smooth[i] < smooth[i - 1] || smooth[i] <= smooth[i + 1]) continue;
    if (cutFrames.has(i) || cutFrames.has(i - 1) || cutFrames.has(i + 1)) continue;
    candidates.push({ i, v: smooth[i] });
  }
  candidates.sort((a, b) => b.v - a.v);
  const minGap = Math.max(2, Math.round(0.25 * rate));
  // At most two per second on average, strongest first.
  const limit = Math.min(240, Math.max(4, Math.round((2 * n) / rate)));
  const kept: number[] = [];
  for (const c of candidates) {
    if (kept.length >= limit) break;
    if (kept.every((k) => Math.abs(k - c.i) >= minGap)) kept.push(c.i);
  }
  return kept.sort((a, b) => a - b).map((i) => round(i / rate, 3));
}

/** Everything after decoding: cuts, curve, peaks, tempo and downbeats from the raw measurements. */
export function analyseMotionSeries(series: MotionSeries): MotionAnalysis {
  const n = series.length;
  const rate = series.rate;
  const global = Float32Array.from(series.global);
  const top = Float32Array.from(series.top);
  const regions = series.regions.map((r) => Float32Array.from(r));
  const all = [global, top, ...regions];

  // A sample that is exactly zero between two non-zero ones is a duplicated frame (rate mismatch,
  // variable frame rate, animation "on twos"), not a real stop: bridge it.
  for (let i = 1; i + 1 < n; i++) {
    if (series.global[i] === 0 && series.global[i - 1] > 0 && series.global[i + 1] > 0) {
      for (const arr of all) arr[i] = (arr[i - 1] + arr[i + 1]) / 2;
    }
  }

  const cutFrames = detectCuts(series);
  const cutSet = new Set(cutFrames);
  for (const i of cutFrames) {
    const a = i - 1 >= 1 && !cutSet.has(i - 1) ? i - 1 : -1;
    const b = i + 1 < n && !cutSet.has(i + 1) ? i + 1 : -1;
    for (const arr of all) arr[i] = a >= 0 && b >= 0 ? (arr[a] + arr[b]) / 2 : a >= 0 ? arr[a] : b >= 0 ? arr[b] : 0;
  }
  const cuts = cutFrames.map((i) => round(i / rate, 3));

  // Motion energy: how much of the picture changes, plus how hard its busiest part changes.
  const blend = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    blend[i] = global[i] + 0.25 * top[i];
    energy += blend[i];
  }
  energy = n ? energy / n : 0;
  const scale = Math.max(NORM_FLOOR, percentile(blend, 0.99));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = clamp01(blend[i] / scale);

  const seconds = Math.max(1, Math.ceil(n / rate - 1e-9));
  const perSecond: number[] = [];
  for (let s = 0; s < seconds; s++) {
    let acc = 0;
    let count = 0;
    for (let i = Math.ceil(s * rate - 1e-9); i < n && i / rate < s + 1 - 1e-9; i++) {
      acc += curve[i];
      count++;
    }
    perSecond.push(count ? round(acc / count, 4) : 0);
  }

  // Signed cell series: cuts would be huge one-sample steps, so they are blanked.
  const signed = (series.signed ?? []).map((c) => {
    const y = Float32Array.from(c);
    for (const i of cutFrames) y[i] = 0;
    return y;
  });
  const tempo = estimateTempo(blend, regions, signed, rate, energy);

  // Accent signal for phase alignment: the part of the smoothed motion that rises above its local level.
  const smooth = gaussianSmooth(blend, Math.max(0.6, 0.035 * rate));
  const trend = movingMean(smooth, Math.round(2 * rate) | 1);
  const accent = new Float32Array(n);
  for (let i = 0; i < n; i++) accent[i] = Math.max(0, smooth[i] - trend[i]);
  const downbeats: Record<string, DownbeatCandidate[]> = {};
  for (const c of tempo.candidates) downbeats[String(c.bpm)] = downbeatsFor(c.bpm, accent, rate, cuts);

  return {
    sampleRate: rate,
    curve: Array.from(curve, (v) => round(v, 4)),
    perSecond,
    peaksSec: findPeaks(curve, rate, cutSet),
    cuts,
    periodSec: tempo.periodSec,
    tempo: { candidates: tempo.candidates, downbeats },
  };
}

export async function analyseMotion(videoPath: string, opts: MotionOptions = {}): Promise<MotionAnalysis> {
  return analyseMotionSeries(await collectMotionSeries(videoPath, opts));
}
