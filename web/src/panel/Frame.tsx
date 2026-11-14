import { memo, type CSSProperties } from 'react';
import type { ClipInfo, Reading } from '../../../shared/choreo';
import { frameSrc } from '../clips';
import { peopleName, timecode } from '../format';
import type { PanelState } from '../state';
import { useSel } from '../store';
import './frames.css';

/** Frames can be fetched unless this is a mock run with no server behind it. */
export const selectMediaOk = (s: PanelState): boolean => s.conn !== 'mock' || s.health?.ok === true;

export function aspectOf(clip: ClipInfo | null): number {
  return clip && clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 16 / 9;
}

interface FrameProps {
  index: number;
  className?: string;
  /** Small label in the corner (image slot number, time). */
  label?: string;
}

/**
 * One extracted frame. The neutral placeholder sits underneath, so a frame that has not loaded
 * (or cannot: mock mode without a server) still reads as a frame slot with its time on it.
 */
export const Frame = memo(function Frame({ index, className, label }: FrameProps) {
  const clip = useSel((s) => s.clip);
  const mediaOk = useSel(selectMediaOk);
  const src = frameSrc(clip, index, mediaOk);
  return (
    <span className={`frame${className ? ` ${className}` : ''}`} style={{ '--ar': aspectOf(clip) } as CSSProperties}>
      <span className="frame__time mono" aria-hidden="true">{timecode((index + 0.5) / 6, true)}</span>
      {src && <span className="frame__img" style={{ backgroundImage: `url("${src}")` }} />}
      {label && <span className="frame__label">{label}</span>}
    </span>
  );
});

// ───────────────────────────── What Drex read from one second ─────────────────────────────

interface Field {
  key: string;
  label: string;
  value: string;
  /** Picked out: a cut, a repeat, a high peak, an airborne body. */
  marked?: boolean;
  /** 1..7 for the two seven-step answers, drawn as a small meter. */
  level?: number;
}

export function readingFields(r: Reading): Field[] {
  return [
    { key: 'movement', label: 'Movement', value: String(r.movement), level: r.movement },
    { key: 'change', label: 'Change', value: r.change },
    { key: 'quality', label: 'Quality', value: r.quality },
    { key: 'body', label: 'Body', value: r.bodyLevel, marked: r.bodyLevel === 'airborne' },
    { key: 'mood', label: 'Mood', value: r.mood },
    { key: 'people', label: 'People', value: peopleName(r.people) },
    { key: 'cut', label: 'Cut', value: r.cut ? 'cut' : 'no', marked: r.cut },
    { key: 'peak', label: 'Peak', value: String(r.peak), level: r.peak, marked: r.peak >= 6 },
    { key: 'repeat', label: 'Repeat', value: r.repeat ? 'repeat' : 'no', marked: r.repeat },
  ];
}

/** The nine answers for one second, as a legible row. */
export const ReadingReadout = memo(function ReadingReadout({ reading, size = 'normal' }: { reading: Reading | null; size?: 'normal' | 'large' }) {
  if (!reading) {
    return (
      <dl className={`readout readout--${size} is-empty`} aria-label="Reading for this second">
        <div className="readout__wait score-text">no reading for this second</div>
      </dl>
    );
  }
  return (
    <dl key={reading.second} className={`readout readout--${size}`} aria-label={`What Drex read at ${timecode(reading.second)}`}>
      {readingFields(reading).map((f) => (
        <div key={f.key} className={`readout__f${f.marked ? ' is-marked' : ''}${f.value === 'no' ? ' is-no' : ''}`}>
          <dt>{f.label}</dt>
          <dd>
            {f.level !== undefined ? (
              <>
                <b className="mono">{f.value}</b>
                <Steps level={f.level} />
              </>
            ) : (
              <span className="score-text">{f.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
});

/** Seven small cells, lit up to `level`. */
export function Steps({ level }: { level: number }) {
  return (
    <span className="steps" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} className={i < level ? 'is-lit' : undefined} />
      ))}
    </span>
  );
}
