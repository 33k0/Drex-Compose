import assert from 'node:assert/strict';
import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { clipId, extractClip, frameBase64, framesForSecond, type ExtractedClip } from '../extract.ts';
import { probeVideo, runFfmpeg } from '../ffmpeg.ts';
import { colorClip, ffmpeg, makeTempDir, patternClip, removeDir } from './helpers.ts';

let dir = '';
let cacheDir = '';
const file = (name: string) => path.join(dir, name);
const extract = (name: string, opts: Parameters<typeof extractClip>[1] = {}) => extractClip(file(name), { cacheDir, ...opts });

/** Decodes the whole file; returns ffmpeg's error output (empty when everything decoded). */
async function decodeErrors(videoPath: string): Promise<string> {
  const res = await runFfmpeg(['-hide_banner', '-v', 'error', '-nostdin', '-i', videoPath, '-f', 'null', '-']);
  return res.code === 0 ? res.stderr.trim() : `exit ${res.code}: ${res.stderr.trim()}`;
}

async function assertPlayable(clip: ExtractedClip): Promise<void> {
  const p = await probeVideo(clip.playable);
  assert.equal(p.codec, 'h264');
  assert.equal(p.pixFmt, 'yuv420p');
  assert.equal(p.hasAudio, false, 'playable must not have an audio stream');
  assert.match(p.container, /mp4/);
  assert.equal(p.rotation, 0);
  assert.equal(await decodeErrors(clip.playable), '');
}

async function assertFrames(clip: ExtractedClip, expectedCount: number): Promise<void> {
  assert.equal(clip.fps, 6);
  assert.equal(clip.frames.length, expectedCount);
  for (const [i, f] of clip.frames.entries()) {
    assert.equal(f.index, i);
    assert.ok(Math.abs(f.t - (i + 0.5) / 6) < 1e-3, `frame ${i} has t=${f.t}`);
    assert.ok(path.isAbsolute(f.file));
    assert.ok(f.t < clip.durationSec, `frame ${i} at t=${f.t} is past the end (${clip.durationSec})`);
  }
  const sizes = await Promise.all(clip.frames.map(async (f) => (await stat(f.file)).size));
  assert.ok(sizes.every((s) => s > 100), 'every frame file has content');
}

before(async () => {
  dir = await makeTempDir('extract');
  cacheDir = path.join(dir, 'cache');
  await Promise.all([
    patternClip(file('land.mp4'), { seconds: 3 }),
    patternClip(file('audio.mp4'), { seconds: 3, audio: true }),
    patternClip(file('vertical.mp4'), { seconds: 2, size: '360x640' }),
    patternClip(file('small.mp4'), { seconds: 1, size: '200x120' }),
    patternClip(file('short.mp4'), { seconds: 0.4 }),
    patternClip(file('mpeg4.mkv'), { seconds: 2, fps: 25, size: '320x180', audio: true, codecArgs: ['-c:v', 'mpeg4', '-q:v', '5'] }),
    colorClip(file('black.mp4'), 'black', { seconds: 4 }),
    // Brightness rises linearly with time, so a frame's brightness tells when it was taken.
    ffmpeg(['-f', 'lavfi', '-i', "color=c=black:s=64x36:r=30:d=4,geq=lum='16+T*50':cb=128:cr=128", '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', file('ramp.mp4')]),
    // Variable frame rate: 4 of every 10 frames are dropped and the rest keep their timestamps.
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=4', '-vf', "select='lt(mod(n,10),6)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('vfr.mp4')]),
  ]);
  // Same pixels as land.mp4, flagged "rotate by 90 degrees" in the container (as phones do).
  await ffmpeg(['-display_rotation', '90', '-i', file('land.mp4'), '-c', 'copy', file('rotated.mp4')]);
});

after(async () => {
  await removeDir(dir);
});

describe('extractClip', () => {
  test('six evenly spaced frames per second, long side 512, aspect kept', async () => {
    const clip = await extract('land.mp4');
    await assertFrames(clip, 18);
    assert.ok(Math.abs(clip.durationSec - 3) < 0.05);
    assert.equal(clip.width, 512);
    assert.equal(clip.height, 288);
    assert.equal(clip.source, file('land.mp4'));
    assert.match(clip.id, /^[0-9a-f]{16}$/);
    // The files really are JPEGs of the advertised size.
    for (const f of [clip.frames[0], clip.frames[17]]) {
      const p = await probeVideo(f.file);
      assert.equal(p.codec, 'mjpeg');
      assert.deepEqual([p.width, p.height], [512, 288]);
    }
  });

  test('frame timestamps match the picture content', async () => {
    const clip = await extract('ramp.mp4');
    await assertFrames(clip, 24);
    const chunks: Buffer[] = [];
    const res = await runFfmpeg(
      ['-hide_banner', '-loglevel', 'error', '-i', path.join(path.dirname(clip.frames[0].file), '%06d.jpg'), '-vf', 'scale=1:1:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1'],
      { onStdout: (c) => chunks.push(c) },
    );
    assert.equal(res.code, 0, res.stderr);
    const luma = Buffer.concat(chunks);
    assert.equal(luma.length, 24);
    for (const f of clip.frames) {
      // JPEG is full range: studio-range luma Y becomes (Y - 16) * 255 / 219, and Y was 16 + 50 * time.
      const pictureTime = (luma[f.index] * 219) / 255 / 50;
      assert.ok(Math.abs(pictureTime - f.t) <= 0.06, `frame ${f.index}: picture from t=${pictureTime.toFixed(3)}, labelled ${f.t}`);
    }
  });

  test('framesForSecond returns the six frames of that second; frameBase64 returns the raw JPEG', async () => {
    const clip = await extract('land.mp4');
    for (let s = 0; s < 3; s++) {
      const six = framesForSecond(clip, s);
      assert.equal(six.length, 6);
      assert.deepEqual(six.map((f) => f.index), [0, 1, 2, 3, 4, 5].map((k) => s * 6 + k));
      assert.ok(six.every((f) => f.t >= s && f.t < s + 1));
    }
    assert.deepEqual(framesForSecond(clip, 3), []);
    const b64 = await frameBase64(clip.frames[4]);
    assert.ok(!b64.startsWith('data:'));
    const bytes = Buffer.from(b64, 'base64');
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xff, 0xd8, 0xff]);
    assert.equal(bytes.length, (await stat(clip.frames[4].file)).size);
  });

  test('six frames plus two reference frames stay far below a 4 MiB request body', async () => {
    const clip = await extract('land.mp4'); // testsrc2 is much busier than real footage
    const eight = [...framesForSecond(clip, 1), clip.frames[0], clip.frames[17]];
    const total = (await Promise.all(eight.map(frameBase64))).reduce((a, s) => a + s.length, 0);
    assert.ok(total < 1024 * 1024, `8 base64 frames take ${total} bytes`);
  });

  test('an H.264 MP4 without audio is reused as the playable file', async () => {
    const clip = await extract('land.mp4');
    assert.equal(clip.playable, file('land.mp4'));
    await assertPlayable(clip);
  });

  test('audio is always stripped (stream copy into the cache)', async () => {
    const clip = await extract('audio.mp4');
    assert.equal((await probeVideo(file('audio.mp4'))).hasAudio, true);
    assert.notEqual(clip.playable, file('audio.mp4'));
    assert.ok(clip.playable.startsWith(cacheDir));
    await assertPlayable(clip);
    await assertFrames(clip, 18);
  });

  test('non-H.264 input is transcoded to H.264/yuv420p without audio', async () => {
    const clip = await extract('mpeg4.mkv');
    assert.ok(clip.playable.endsWith('.mp4') && clip.playable.startsWith(cacheDir));
    await assertPlayable(clip);
    await assertFrames(clip, 12);
    assert.deepEqual([clip.width, clip.height], [320, 180]);
  });

  test('vertical video keeps its orientation', async () => {
    const clip = await extract('vertical.mp4');
    assert.deepEqual([clip.width, clip.height], [288, 512]);
    await assertFrames(clip, 12);
  });

  test('rotation metadata is applied to frames and baked into the playable file', async () => {
    assert.equal(Math.abs((await probeVideo(file('rotated.mp4'))).rotation), 90);
    const clip = await extract('rotated.mp4');
    assert.deepEqual([clip.width, clip.height], [288, 512]);
    await assertFrames(clip, 18);
    assert.notEqual(clip.playable, file('rotated.mp4'));
    await assertPlayable(clip);
    const p = await probeVideo(clip.playable);
    assert.ok(p.height > p.width, `playable is ${p.width}x${p.height}`);
  });

  test('never upscales', async () => {
    const clip = await extract('small.mp4');
    assert.deepEqual([clip.width, clip.height], [200, 120]);
    await assertFrames(clip, 6);
  });

  test('longSide option', async () => {
    const clip = await extract('land.mp4', { longSide: 256 });
    assert.deepEqual([clip.width, clip.height], [256, 144]);
    await assertFrames(clip, 18);
    // The default-size extraction is still intact next to it.
    const again = await extract('land.mp4');
    assert.equal(again.width, 512);
    assert.equal((await probeVideo(again.frames[0].file)).width, 512);
  });

  test('a clip shorter than a second', async () => {
    const clip = await extract('short.mp4');
    assert.ok(Math.abs(clip.durationSec - 0.4) < 0.05);
    await assertFrames(clip, 2);
    assert.equal(framesForSecond(clip, 0).length, 2);
    await assertPlayable(clip);
  });

  test('variable frame rate input still gives evenly spaced frames', async () => {
    const clip = await extract('vfr.mp4');
    const expected = Math.round(clip.durationSec * 6);
    assert.ok(Math.abs(clip.frames.length - expected) <= 1, `${clip.frames.length} frames for ${clip.durationSec}s`);
    await assertFrames(clip, clip.frames.length);
  });

  test('a static black clip extracts fine', async () => {
    const clip = await extract('black.mp4');
    await assertFrames(clip, 24);
  });

  test('second call is served from the cache', async () => {
    const first = await extract('land.mp4');
    const frameStat = await stat(first.frames[0].file);
    const progress: [number, number][] = [];
    const t0 = performance.now();
    const second = await extract('land.mp4', { onProgress: (d, t) => progress.push([d, t]) });
    const ms = performance.now() - t0;
    assert.deepEqual(second, first);
    assert.ok(ms < 250, `cached call took ${ms.toFixed(0)} ms`);
    assert.equal((await stat(second.frames[0].file)).mtimeMs, frameStat.mtimeMs, 'frames were not rewritten');
    assert.deepEqual(progress, [[18, 18]]);
    const meta = JSON.parse(await readFile(path.join(cacheDir, first.id, 'clip.json'), 'utf8'));
    assert.equal(meta.id, first.id);
    assert.equal(meta.frameCount, 18);
  });

  test('progress is reported while extracting and ends at the frame count', async () => {
    await patternClip(file('progress.mp4'), { seconds: 5 });
    const progress: [number, number][] = [];
    const clip = await extract('progress.mp4', { onProgress: (d, t) => progress.push([d, t]) });
    assert.ok(progress.length >= 1);
    assert.deepEqual(progress.at(-1), [clip.frames.length, clip.frames.length]);
    assert.ok(progress.every(([d, t]) => d >= 0 && d <= t));
  });

  test('concurrent calls for the same file share one extraction', async () => {
    await patternClip(file('twice.mp4'), { seconds: 2 });
    const [a, b] = await Promise.all([extract('twice.mp4'), extract('twice.mp4')]);
    assert.deepEqual(a, b);
    await assertFrames(a, 12);
  });

  test('the id follows the file content, size and mtime', async () => {
    const a = await clipId(file('land.mp4'));
    assert.equal(a, await clipId(file('land.mp4')));
    assert.notEqual(a, await clipId(file('vertical.mp4')));
    const before = await stat(file('small.mp4'));
    const idBefore = await clipId(file('small.mp4'));
    await utimes(file('small.mp4'), before.atime, new Date(before.mtimeMs + 5000));
    assert.notEqual(await clipId(file('small.mp4')), idBefore);
  });

  test('rejects files that are not video', async () => {
    await writeFile(file('notes.txt'), 'this is not a video\n');
    await assert.rejects(extract('notes.txt'));
    await assert.rejects(extract('missing.mp4'));
  });
});
