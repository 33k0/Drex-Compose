import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { clock } from '../clock';
import { FPS, frameSrc } from '../clips';
import { controller } from '../controller';
import { timecode } from '../format';
import { store, useSel } from '../store';
import { BeatPulse } from './BeatPulse';
import { ReadingReadout, aspectOf, selectMediaOk } from './Frame';
import { useFrame } from './useFrame';
import './video.css';

/**
 * The picture: the muted clip (the music follows its clock), the beat grid pulsing on it, the six
 * frames of the current second under it, and what Drex read from that second.
 */
export const VideoStage = memo(function VideoStage() {
  const clip = useSel((s) => s.clip);
  const mediaOk = useSel(selectMediaOk);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const useVideo = Boolean(clip && mediaOk && !failed);

  useEffect(() => {
    if (clip) clock.setLength(clip.durationSec);
  }, [clip]);

  useEffect(() => {
    if (useVideo && video.current) {
      clock.attachVideo(video.current);
    } else {
      clock.useFake(clock.now());
    }
    return () => clock.detach();
  }, [useVideo]);

  const onError = (): void => {
    console.warn('[panel] the clip video did not load; running the clock without it');
    setFailed(true);
  };

  return (
    <section className="panel vstage" aria-label="The clip">
      <div className="vstage__screen" style={{ '--ar': aspectOf(clip) } as CSSProperties}>
        {useVideo ? (
          <video
            ref={video}
            className="vstage__video"
            src={clip!.videoUrl}
            muted
            playsInline
            preload="auto"
            onError={onError}
            onClick={() => controller.togglePlay()}
          />
        ) : (
          <NoVideo />
        )}
        <PlayOverlay />
        <BeatPulse />
        <LiveFlash />
        <Timecode />
      </div>
      <FrameStrip />
      <NowReading />
    </section>
  );
});

const NoVideo = memo(function NoVideo() {
  const mock = useSel((s) => s.conn === 'mock');
  return (
    <div className="vstage__none" onClick={() => controller.togglePlay()}>
      <span className="score-text">{mock ? 'Scripted run: no video here' : 'The video did not load'}</span>
      <span>The clock runs on its own, so the music and the views still follow it.</span>
    </div>
  );
});

const PlayOverlay = memo(function PlayOverlay() {
  const playing = useSel((s) => s.playing);
  const ended = useSel((s) => s.videoEnded);
  const started = useSel((s) => s.playbackStarted);
  const audio = useSel((s) => s.audio);
  if (playing) return null;
  const loading = audio.mode === 'pending' || (!audio.instrumentsReady && audio.mode === 'real');
  return (
    <div className="vstage__overlay">
      <button type="button" className="btn btn--primary vstage__play" onClick={() => controller.play()}>
        {ended ? 'Play again' : started ? 'Resume' : 'Play'} <kbd>Space</kbd>
      </button>
      {!started && (
        <span className="vstage__hint">
          {loading ? 'Instruments still loading: the first notes may be missing' : 'The whole piece is composed. The music follows the video.'}
        </span>
      )}
    </div>
  );
});

const Timecode = memo(function Timecode() {
  const el = useRef<HTMLSpanElement>(null);
  const last = useRef('');
  const dur = useSel((s) => s.clip?.durationSec ?? 0);
  useFrame(() => {
    const text = `${timecode(clock.now(), true)} / ${timecode(dur)}`;
    if (el.current && text !== last.current) {
      last.current = text;
      el.current.textContent = text;
    }
  });
  return <span ref={el} className="vstage__tc mono" aria-hidden="true" />;
});

/** The label of a live-read refinement, shown as the playhead reaches the moment it applies to. */
const LiveFlash = memo(function LiveFlash() {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const hideAt = useRef(0);
  useFrame((ms) => {
    const t = clock.now();
    const from = prev.current;
    prev.current = t;
    const el = box.current;
    if (!el || !text.current) return;
    // Only a forward step of normal size counts: a seek jumps past cues without showing them.
    if (t > from && t - from < 0.5) {
      const cues = store.getState().liveCues;
      for (let i = cues.length - 1; i >= 0; i--) {
        const c = cues[i];
        if (c.atSec > from && c.atSec <= t && c.label !== 'as composed') {
          text.current.textContent = c.label;
          el.classList.toggle('is-accent', Boolean(c.accent));
          el.classList.remove('is-in');
          void el.offsetWidth; // restart the entry animation
          el.classList.add('is-in');
          hideAt.current = ms + 2400;
          break;
        }
      }
    }
    if (hideAt.current && ms > hideAt.current) {
      hideAt.current = 0;
      el.classList.remove('is-in');
    }
  });
  return (
    <div ref={box} className="vstage__live" aria-live="polite">
      <span className="vstage__live-who">live read</span>
      <span ref={text} className="vstage__live-text score-text" />
    </div>
  );
});

/** The six frames of the current second, the one nearest the playhead marked. */
const FrameStrip = memo(function FrameStrip() {
  const clip = useSel((s) => s.clip);
  const mediaOk = useSel(selectMediaOk);
  const slots = useRef<(HTMLSpanElement | null)[]>([]);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const shownSecond = useRef(-1);
  const shownNear = useRef(-1);

  useFrame(() => {
    if (!clip) return;
    const t = clock.now();
    const second = Math.max(0, Math.min(Math.ceil(clip.durationSec) - 1, Math.floor(t)));
    if (second !== shownSecond.current) {
      shownSecond.current = second;
      for (let k = 0; k < FPS; k++) {
        const i = second * FPS + k;
        const el = slots.current[k];
        if (el) {
          const src = frameSrc(clip, i, mediaOk);
          el.style.backgroundImage = src ? `url("${src}")` : 'none';
        }
        const label = labels.current[k];
        if (label) label.textContent = timecode((i + 0.5) / FPS, true);
      }
      // Warm the cache for the next second so the strip does not flash as it turns over.
      for (let k = 0; k < FPS; k++) {
        const src = frameSrc(clip, (second + 1) * FPS + k, mediaOk);
        if (src) new Image().src = src;
      }
    }
    const near = Math.max(0, Math.min(FPS - 1, Math.round((t - second) * FPS - 0.5)));
    if (near !== shownNear.current) {
      slots.current[shownNear.current]?.parentElement?.classList.remove('is-now');
      slots.current[near]?.parentElement?.classList.add('is-now');
      shownNear.current = near;
    }
  });

  useEffect(() => {
    // New clip or media state: redraw on the next frame.
    shownSecond.current = -1;
  }, [clip, mediaOk]);

  return (
    <ol className="vstage__strip" style={{ '--ar': aspectOf(clip) } as CSSProperties} aria-label="The six frames of this second">
      {Array.from({ length: FPS }, (_, k) => (
        <li key={k} className="strip__cell">
          <span className="frame">
            <span ref={(el) => { labels.current[k] = el; }} className="frame__time mono" />
            <span ref={(el) => { slots.current[k] = el; }} className="frame__img strip__img" />
          </span>
        </li>
      ))}
    </ol>
  );
});

/** Drex's reading for the second under the playhead. Re-renders once a second, not per frame. */
const NowReading = memo(function NowReading() {
  const [second, setSecond] = useState(0);
  const latest = useRef(0);
  useFrame(() => {
    const s = Math.max(0, Math.floor(clock.now()));
    if (s !== latest.current) {
      latest.current = s;
      setSecond(s);
    }
  });
  const reading = useSel((st) => st.readings[second] ?? null);
  return (
    <div className="vstage__reading">
      <span className="vstage__reading-head">
        <span className="panel__title">Drex read</span>
        <span className="mono">{timecode(second)}</span>
      </span>
      <ReadingReadout reading={reading} />
    </div>
  );
});
