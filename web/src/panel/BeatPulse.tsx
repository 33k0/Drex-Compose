import { memo, useRef } from 'react';
import { beatAt, beatSec, beatsPerBar, inSpans } from '../beat';
import { clock } from '../clock';
import { beatUncertain } from '../state';
import { useSel } from '../store';
import { useFrame, useReducedMotion } from './useFrame';

/** How fast a beat's flash dies away, in seconds. */
const FLASH_DECAY_SEC = 0.13;

/**
 * The grid's beat, on the picture: one dot per beat of the bar, lit on every beat of the grid and
 * harder on every downbeat, so a viewer can check by eye that the grid sits on the dancers. Driven
 * from the video clock in the shared rAF loop and written straight to the DOM. With reduced motion
 * nothing flashes: a small marker glides along the bar instead.
 */
export const BeatPulse = memo(function BeatPulse() {
  const grid = useSel((s) => s.grid);
  const uncertain = useSel(beatUncertain);
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const runner = useRef<HTMLSpanElement>(null);
  const barText = useRef<HTMLSpanElement>(null);
  const shown = useRef({ bar: Number.NaN, bridge: false, lit: -1 });

  const bpb = grid ? Math.min(12, beatsPerBar(grid)) : 4;

  useFrame(() => {
    const el = box.current;
    if (!grid || !el) return;
    const t = clock.now();
    const pos = beatAt(grid, t);
    const playing = clock.playing();
    const last = shown.current;

    const bridge = grid.noBeat || inSpans(grid.bridges, t);
    if (bridge !== last.bridge) {
      last.bridge = bridge;
      el.classList.toggle('is-bridge', bridge);
    }
    if (pos.bar !== last.bar) {
      last.bar = pos.bar;
      if (barText.current) barText.current.textContent = pos.bar < 0 ? 'before bar 1' : `bar ${pos.bar + 1}`;
    }

    if (reduced) {
      // No flashing: a marker moves smoothly through the bar, one tick per beat underneath.
      const frac = (pos.beatInBar + pos.phase) / bpb;
      if (runner.current) runner.current.style.transform = `translateX(${(frac * 100).toFixed(2)}%)`;
      return;
    }

    const flash = playing ? Math.exp(-(pos.phase * beatSec(grid)) / FLASH_DECAY_SEC) : 0;
    for (let k = 0; k < bpb; k++) {
      const dot = dots.current[k];
      if (!dot) continue;
      const on = k === pos.beatInBar;
      const f = on ? flash : 0;
      const strong = k === 0;
      dot.style.opacity = (on && !playing ? 0.7 : 0.22 + 0.78 * f).toFixed(3);
      dot.style.transform = `scale(${(1 + (strong ? 0.75 : 0.35) * f).toFixed(3)})`;
    }
    // The plate itself kicks on the downbeat.
    const lit = playing && pos.beatInBar === 0 && pos.phase * beatSec(grid) < FLASH_DECAY_SEC ? 1 : 0;
    if (lit !== last.lit) {
      last.lit = lit;
      el.classList.toggle('is-down', lit === 1);
    }
  });

  if (!grid) return null;

  return (
    <div
      ref={box}
      className={`bpulse${reduced ? ' is-reduced' : ''}${uncertain ? ' is-uncertain' : ''}`}
      aria-hidden="true"
      title="The beat grid the music sits on: check it against the dancers"
    >
      <span className="bpulse__head">
        <span className="bpulse__label">{uncertain ? 'beat uncertain' : 'beat'}</span>
        <span ref={barText} className="bpulse__bar mono" />
      </span>
      {reduced ? (
        <span className="bpulse__track">
          {Array.from({ length: bpb }, (_, k) => (
            <i key={k} className={k === 0 ? 'is-down' : undefined} style={{ left: `${(k / bpb) * 100}%` }} />
          ))}
          <span ref={runner} className="bpulse__runner"><b /></span>
        </span>
      ) : (
        <span className="bpulse__dots">
          {Array.from({ length: bpb }, (_, k) => (
            <span key={k} ref={(d) => { dots.current[k] = d; }} className={`bpulse__dot${k === 0 ? ' is-down' : ''}`} />
          ))}
        </span>
      )}
      <span className="bpulse__bpm mono">{Math.round(grid.bpm)}</span>
      <span className="bpulse__bridge score-text">bridge</span>
    </div>
  );
});
