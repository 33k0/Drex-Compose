import { memo, useMemo, type CSSProperties } from 'react';
import type { Reading } from '../../../shared/choreo';
import { FPS, middleFrame } from '../clips';
import { pct, timecode } from '../format';
import { beatUncertain, shownReading, trackingProgress } from '../state';
import { useSel } from '../store';
import { Frame, ReadingReadout, aspectOf } from './Frame';
import './watching.css';

/**
 * "Drex is watching the clip": one request per second of video, eight image slots (this second's
 * six frames, plus the middle frames of one and three seconds earlier for comparison), and what
 * it answered.
 */
export const Watching = memo(function Watching() {
  const reading = useSel(shownReading);
  const clip = useSel((s) => s.clip);
  const prescan = useSel((s) => s.prescan);
  const standin = useSel((s) => s.session?.standin ?? false);
  const mock = useSel((s) => s.conn === 'mock');
  const stage = useSel((s) => s.stage);
  const message = useSel((s) => s.message);
  const tracking = stage === 'loading' ? trackingProgress(message) : null;

  const second = reading?.second ?? null;
  const refs = second === null ? [] : [second - 1, second - 3].filter((s) => s >= 0);

  return (
    <section className="panel watch" aria-label="Drex is watching the clip">
      <div className="panel__head">
        <h2 className="panel__title">Drex is watching</h2>
        <span className="panel__meta">
          {second !== null ? (
            <>
              second <b className="mono">{timecode(second)}</b>: one request, eight images
            </>
          ) : (
            'one request per second of video'
          )}
        </span>
      </div>

      {(standin || mock) && (
        <p className="watch__standin">
          <span className="tag tag--reject">{mock ? 'Scripted' : 'Stand-in'}</span>
          The stand-in cannot see frames; these readings come from motion analysis.
        </p>
      )}

      {second === null ? (
        <div className="watch__wait">
          {tracking ? (
            <>
              <strong className="score-text">Tracking the dancers' bodies</strong>
              <span>
                Frame <b className="mono">{tracking.done}</b> of <span className="mono">{tracking.total}</span>. The beat comes from their bodies alone: where they land, every frame.
              </span>
              <span className="watch__track" aria-hidden="true">
                <span style={{ transform: `scaleX(${tracking.done / tracking.total})` }} />
              </span>
              <span className="watch__note">The first time takes about a minute and a half on a three-minute clip; it is kept for next time.</span>
            </>
          ) : (
            <>
              <strong className="score-text">{stage === 'loading' ? 'Preparing the clip' : 'Reading the first seconds'}</strong>
              <span>{message || 'Extracting six frames a second, then finding the beat in the dancers\' bodies.'}</span>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="watch__slots" style={{ '--ar': aspectOf(clip) } as CSSProperties}>
            {Array.from({ length: FPS }, (_, k) => (
              <Frame key={`${second}-${k}`} index={second * FPS + k} className="watch__now" label={`${k + 1}`} />
            ))}
            <div className="watch__refs" aria-label="Earlier frames, for comparison">
              {[0, 1].map((k) => {
                const s = refs[k];
                return s === undefined ? (
                  <span key={k} className="watch__ref-empty">
                    <span className="mono">{k + 7}</span> no earlier frame
                  </span>
                ) : (
                  <Frame key={`${s}-${k}`} index={middleFrame(s)} className="watch__ref" label={`${k + 7} · ${k === 0 ? '1 s' : '3 s'} earlier`} />
                );
              })}
            </div>
          </div>
          <div className="watch__answers">
            <ReadingReadout reading={reading} size="large" />
            <Boundary reading={reading!} />
          </div>
        </>
      )}

      <div className="watch__count">
        <span className="mono">
          <b>{prescan.done}</b>
          {prescan.total > 0 && <> of {prescan.total}</>}
        </span>
        <span>seconds read</span>
        <span className="watch__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${prescan.total ? prescan.done / prescan.total : 0})` }} />
        </span>
        <BeatFound />
      </div>
    </section>
  );
});

/** Once the beat is found (before the readings finish), say how and how sure, at the end of the count line. */
const BeatFound = memo(function BeatFound() {
  const beat = useSel((s) => s.beat);
  const uncertain = useSel(beatUncertain);
  if (!beat) return null;
  const best = beat.candidates.reduce<(typeof beat.candidates)[number] | null>((a, c) => (!a || c.agreement > a.agreement ? c : a), null);
  return (
    <span className="watch__beat">
      {beat.method === 'body'
        ? <span className="tag tag--accent">Body tracking</span>
        : <span className="tag tag--reject" title={beat.note}>Pixel motion{beat.note ? ` — ${beat.note}` : ''}</span>}
      {uncertain ? (
        <span className="watch__beat-warn">Beat uncertain — tap the beat (T) on the clip stage</span>
      ) : (
        <span title={`${beat.landings.length} landings, ${beat.people.toFixed(1)} people tracked, confidence ${pct(beat.confidence)}`}>
          beat <b className="mono">{best ? Math.round(best.bpm) : '?'}</b> bpm, confidence <b className="mono">{pct(beat.confidence)}</b>
        </span>
      )}
    </span>
  );
});

function Boundary({ reading }: { reading: Reading }) {
  const likely = reading.boundary >= 0.5;
  return (
    <p className={`watch__boundary${likely ? ' is-likely' : ''}`}>
      A new section starts here: <b className="mono">{pct(reading.boundary)}</b>
    </p>
  );
}

// ───────────────────────────── Contact sheet ─────────────────────────────

/** One cell per second of the clip, filled in as the readings arrive (in any order). */
export const ContactSheet = memo(function ContactSheet() {
  const readings = useSel((s) => s.readings);
  const total = useSel((s) => s.prescan.total || (s.clip ? Math.ceil(s.clip.durationSec) : 0) || s.motion?.perSecond.length || 0);
  const clip = useSel((s) => s.clip);
  const shown = useSel((s) => shownReading(s)?.second ?? null);
  const done = Object.keys(readings).length;

  const rows = total <= 40 ? 2 : total <= 96 ? 3 : 4;
  const cols = Math.max(1, Math.ceil(total / rows));
  const cells = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  return (
    <section className="panel sheet" aria-label="Contact sheet: one cell per second">
      <div className="panel__head">
        <h2 className="panel__title">Contact sheet</h2>
        <ul className="sheet__legend" aria-label="Legend">
          <li><i className="lg-move" aria-hidden="true" />movement 1 to 7</li>
          <li><i className="lg-cut" aria-hidden="true" />scene cut</li>
          <li><i className="lg-bound" aria-hidden="true" />new section likely</li>
        </ul>
        <span className="panel__meta">
          <b className="mono">{done}</b> of <span className="mono">{total || '…'}</span> seconds read
        </span>
      </div>
      <ol className="sheet__grid" style={{ '--cols': cols, '--ar': aspectOf(clip) } as CSSProperties}>
        {cells.map((sec) => {
          const r = readings[sec];
          return (
            <li
              key={sec}
              className={`cell${r ? ' is-read' : ''}${r?.cut ? ' is-cut' : ''}${r && r.boundary >= 0.5 ? ' is-boundary' : ''}${sec === shown ? ' is-shown' : ''}`}
              style={r ? ({ '--m': r.movement } as CSSProperties) : undefined}
              title={r ? `${timecode(sec)}: movement ${r.movement}, ${r.change}, ${r.quality}, mood ${r.mood}${r.cut ? ', cut' : ''}, peak ${r.peak}` : `${timecode(sec)}: not read yet`}
            >
              {r ? <Frame index={middleFrame(sec)} className="cell__frame" /> : <span className="cell__empty mono">{sec}</span>}
              {r && <span className="cell__move" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </section>
  );
});
