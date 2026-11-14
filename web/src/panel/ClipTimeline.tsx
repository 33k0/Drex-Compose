import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { BeatView, FitView, GridView, LiveCue } from '../../../shared/choreo';
import { phraseSeconds, type PhraseScore, type PlanView } from '../../../shared/types';
import { barTimes, beatSec, beatTimes, unclearSpans } from '../beat';
import { clock } from '../clock';
import { controller } from '../controller';
import { fitGlyph, fitShort, timecode } from '../format';
import { beatUncertain, phraseAt, readingsInOrder, scoresInOrder } from '../state';
import { store, useSel } from '../store';
import { useFrame } from './useFrame';
import './timeline.css';

const VB_W = 1000;
const VB_H = 100;

/** Tension 1..7 to a y position in the 0..100 plot (7 near the top). */
function tensionY(t: number): number {
  const clamped = Math.max(1, Math.min(7, t));
  return VB_H - (10 + ((clamped - 1) / 6) * 78);
}

interface Span { start: number; end: number }

/** Where each section sits on the video clock: from the plan, else from the picture's sections. */
function planSpans(plan: PlanView, fallback: Map<number, Span>): Map<number, Span> {
  const out = new Map<number, Span>();
  for (const s of plan.sections) {
    const f = fallback.get(s.index);
    const start = s.startSec ?? f?.start;
    const end = s.endSec ?? f?.end;
    if (start !== undefined && end !== undefined) out.set(s.index, { start, end });
  }
  return out;
}

/** The planned tension over the clip: flat through each section, eased between them. */
function tensionPath(plan: PlanView, spans: Map<number, Span>, dur: number): { line: string; area: string } | null {
  const pts: [number, number, number][] = [];
  for (const s of plan.sections) {
    const sp = spans.get(s.index);
    if (!sp) continue;
    pts.push([(sp.start / dur) * VB_W, (sp.end / dur) * VB_W, tensionY(s.tension)]);
  }
  if (pts.length === 0) return null;
  pts.sort((a, b) => a[0] - b[0]);
  const ease = Math.min(14, VB_W / 80);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][2].toFixed(1)}`;
  pts.forEach(([x0, x1, y], i) => {
    const next = pts[i + 1];
    const flatEnd = next ? Math.max(x0, x1 - ease) : x1;
    d += ` L${flatEnd.toFixed(1)},${y.toFixed(1)}`;
    if (next) {
      const nx = Math.min(next[1], next[0] + ease);
      const mid = (flatEnd + nx) / 2;
      d += ` C${mid.toFixed(1)},${y.toFixed(1)} ${mid.toFixed(1)},${next[2].toFixed(1)} ${nx.toFixed(1)},${next[2].toFixed(1)}`;
    }
  });
  const last = pts[pts.length - 1];
  return { line: d, area: `${d} L${last[1].toFixed(1)},${VB_H} L${pts[0][0].toFixed(1)},${VB_H} Z` };
}

function motionPath(perSecond: number[], dur: number): string {
  const max = Math.max(0.0001, ...perSecond);
  let d = `M0,${VB_H}`;
  perSecond.forEach((v, i) => {
    const x = ((i + 0.5) / dur) * VB_W;
    d += ` L${Math.min(VB_W, x).toFixed(1)},${(VB_H - (v / max) * 82).toFixed(1)}`;
  });
  return `${d} L${Math.min(VB_W, (perSecond.length / dur) * VB_W).toFixed(1)},${VB_H} Z`;
}

interface Cell { index: number; start: number; end: number; score: PhraseScore | null }

/**
 * Phrase cells on the video clock. Composed phrases sit at their startSec; the rest of the plan
 * is estimated by sharing each section's span among its phrases.
 */
function phraseCells(plan: PlanView | null, spans: Map<number, Span>, ordered: PhraseScore[]): Cell[] {
  const byIndex = new Map(ordered.map((p) => [p.index, p]));
  const cells: Cell[] = [];
  if (plan) {
    for (const s of plan.sections) {
      const sp = spans.get(s.index);
      const n = s.phrases[1] - s.phrases[0] + 1;
      if (!sp || n <= 0) continue;
      for (let k = 0; k < n; k++) {
        const index = s.phrases[0] + k;
        if (byIndex.has(index)) continue;
        cells.push({ index, start: sp.start + ((sp.end - sp.start) * k) / n, end: sp.start + ((sp.end - sp.start) * (k + 1)) / n, score: null });
      }
    }
  }
  for (const p of ordered) {
    const start = p.startSec ?? 0;
    cells.push({ index: p.index, start, end: start + phraseSeconds(p), score: p });
  }
  return cells.sort((a, b) => a.start - b.start);
}

const pctOf = (sec: number, dur: number): string => `${Math.max(0, Math.min(100, (sec / dur) * 100)).toFixed(3)}%`;

/** Beat ticks are drawn only when they stand at least this far apart; otherwise bars only. */
const MIN_BEAT_PX = 4;
/** Below this many pixels per bar, every bar line is too dense to read: only every 4th is drawn. */
const MIN_BAR_PX = 6;

interface GridLines {
  /** Plain bar lines and the stronger ones (every 4th bar, or every 8th when the bars are close). */
  bars: string;
  strong: string;
  /** Beat ticks for the beat row, empty when they would be closer than MIN_BEAT_PX. */
  beats: string;
  strongEvery: number;
}

/** The beat grid as SVG paths in the 0..VB_W by 0..100 box. */
function gridLines(grid: GridView, dur: number, widthPx: number): GridLines {
  const pxPerSec = widthPx / dur;
  const barPx = grid.barSec * pxPerSec;
  const strongEvery = barPx * 4 >= 48 ? 4 : 8;
  const every = barPx >= MIN_BAR_PX ? 1 : 4;
  const x = (t: number): string => ((t / dur) * VB_W).toFixed(2);
  let bars = '';
  let strong = '';
  barTimes(grid, dur).forEach((t, k) => {
    if (k % strongEvery === 0) strong += `M${x(t)},0V${VB_H}`;
    else if (k % every === 0) bars += `M${x(t)},0V${VB_H}`;
  });
  let beats = '';
  if (beatSec(grid) * pxPerSec >= MIN_BEAT_PX) {
    for (const t of beatTimes(grid, dur)) beats += `M${x(t)},${VB_H}V${VB_H * 0.62}`;
  }
  return { bars, strong, beats, strongEvery };
}

/** The dancers' landings as four paths, by weight: taller and brighter for a heavier landing. */
function landingPaths(landings: BeatView['landings'], dur: number): string[] {
  const out = ['', '', '', ''];
  if (landings.length === 0) return out;
  // Normalise by a high percentile so one huge jump does not flatten the rest.
  const weights = landings.map((l) => l.weight).sort((a, b) => a - b);
  const top = Math.max(1e-6, weights[Math.min(weights.length - 1, Math.floor(weights.length * 0.97))]);
  for (const l of landings) {
    if (l.t < 0 || l.t > dur) continue;
    const w = Math.min(1, l.weight / top);
    const bucket = w < 0.2 ? 0 : w < 0.45 ? 1 : w < 0.75 ? 2 : 3;
    const h = 18 + w * 78;
    out[bucket] += `M${((l.t / dur) * VB_W).toFixed(2)},${VB_H}V${(VB_H - h).toFixed(1)}`;
  }
  return out;
}

/**
 * The whole clip at a glance: time axis, the motion code measured, what Drex read each second,
 * cuts, the sections and the planned tension over them, the beat grid (bar lines, the dancers'
 * landings, bridges, unclear stretches, extra hits), the phrases on the video clock, the climax,
 * how each section change is marked, the live-read refinements, and the playhead.
 */
export const ClipTimeline = memo(function ClipTimeline() {
  const clip = useSel((s) => s.clip);
  const motion = useSel((s) => s.motion);
  const readings = useSel((s) => s.readings);
  const videoSections = useSel((s) => s.videoSections);
  const plan = useSel((s) => s.plan);
  const previous = useSel((s) => s.previousPlan);
  const revisions = useSel((s) => s.planRevisions);
  const phrases = useSel((s) => s.phrases);
  const fits = useSel((s) => s.fits);
  const liveCues = useSel((s) => s.liveCues);
  const nowIndex = useSel((s) => s.nowIndex);
  const ready = useSel((s) => s.ready);
  const rules = useSel((s) => s.rules);
  const tempoBpm = useSel((s) => s.grid?.bpm ?? s.tempo?.bpm ?? null);
  const beat = useSel((s) => s.beat);
  const grid = useSel((s) => s.grid);
  const hits = useSel((s) => s.hits);
  const uncertain = useSel(beatUncertain);

  const dur = Math.max(1, clip?.durationSec ?? ready?.totalSec ?? motion?.perSecond.length ?? 60);

  const fallbackSpans = useMemo(
    () => new Map(videoSections.map((v) => [v.index, { start: v.startSec, end: v.endSec }])),
    [videoSections],
  );
  const spans = useMemo(() => (plan ? planSpans(plan, fallbackSpans) : fallbackSpans), [plan, fallbackSpans]);
  const ordered = useMemo(() => scoresInOrder(phrases), [phrases]);
  const cells = useMemo(() => phraseCells(plan, spans, ordered), [plan, spans, ordered]);
  const curve = useMemo(() => (plan ? tensionPath(plan, spans, dur) : null), [plan, spans, dur]);
  const ghost = useMemo(
    () => (previous ? tensionPath(previous, planSpans(previous, fallbackSpans), dur) : null),
    [previous, fallbackSpans, dur],
  );
  const motionD = useMemo(() => (motion ? motionPath(motion.perSecond, dur) : null), [motion, dur]);
  const readingList = useMemo(() => readingsInOrder(readings), [readings]);
  const cues = useMemo(() => latestCues(liveCues), [liveCues]);

  // The plot's width in pixels decides how dense the grid may be drawn. Re-measured on resize only.
  const plot = useRef<HTMLDivElement>(null);
  const [{ widthPx, remPx }, setSize] = useState({ widthPx: 1600, remPx: 16 });
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const measure = (): void => {
      const w = Math.max(200, Math.round(el.getBoundingClientRect().width));
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setSize((cur) => (cur.widthPx === w && cur.remPx === rem ? cur : { widthPx: w, remPx: rem }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = useMemo(() => (grid ? gridLines(grid, dur, widthPx) : null), [grid, dur, widthPx]);
  const landings = useMemo(() => landingPaths(beat?.landings ?? [], dur), [beat, dur]);
  const unclear = useMemo(() => unclearSpans(beat?.stretches ?? []), [beat]);
  // The whole score is a bridge when no beat was found anywhere.
  const bridges = useMemo(
    () => (grid?.noBeat ? [{ startSec: Math.max(0, grid.musicStartSec), endSec: dur }] : grid?.bridges ?? []),
    [grid, dur],
  );
  // A full fit tag ("≋ FILL") is about 4.4rem wide: closer than that to the one before, glyph only.
  const fitList = useMemo(() => fitMarks(fits, spans, dur, widthPx, remPx * 4.4), [fits, spans, dur, widthPx, remPx]);

  // ── per frame: the playhead, its timecode, and which phrase is sounding ──
  const nowMarker = useRef<HTMLDivElement>(null);
  const nowText = useRef<HTMLSpanElement>(null);
  const lastText = useRef('');
  useFrame(() => {
    if (!ready) return;
    const t = clock.now();
    const el = nowMarker.current;
    if (el) el.style.transform = `translateX(${((Math.max(0, Math.min(dur, t)) / dur) * 100).toFixed(3)}%)`;
    const text = timecode(t, true);
    if (nowText.current && text !== lastText.current) {
      lastText.current = text;
      nowText.current.textContent = text;
    }
    const index = phraseAt(ordered, t, phraseSeconds);
    if (index !== store.getState().nowIndex) store.dispatch({ type: 'local/now', index });
  });

  const seek = (e: MouseEvent<HTMLDivElement>): void => {
    if (!ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    controller.seek(frac * dur);
  };

  const climax = useMemo(() => {
    if (!plan) return null;
    const p = phrases[plan.climaxPhrase];
    const cell = cells.find((c) => c.index === plan.climaxPhrase);
    const section = plan.sections.find((s) => plan.climaxPhrase >= s.phrases[0] && plan.climaxPhrase <= s.phrases[1]);
    if (!cell) return null;
    return { sec: (cell.start + cell.end) / 2, y: tensionY(p?.display.tension ?? section?.tension ?? 7) };
  }, [plan, phrases, cells]);

  const nowSection = nowIndex === null ? null : phrases[nowIndex]?.section ?? null;
  const axis = useMemo(() => axisTicks(dur), [dur]);
  const composed = ordered.length;
  const total = plan?.totalPhrases ?? ready?.phrases ?? null;

  return (
    <section className={`panel ctl${ready ? ' is-ready' : ''}`} aria-label="Clip timeline">
      <div className="panel__head">
        <h2 className="panel__title">Clip timeline</h2>
        <ul className="ctl__legend" aria-label="Legend">
          {/* One line, so only what is on the plot, beat first after the curve; the playhead labels itself. */}
          <li><i className="lg lg--motion" aria-hidden="true" />motion (measured)</li>
          <li><i className="lg lg--read" aria-hidden="true" />Drex read</li>
          {(motion?.cuts.length ?? 0) > 0 && <li><i className="lg lg--cut" aria-hidden="true" />cut</li>}
          <li><i className="lg lg--plan" aria-hidden="true" />tension</li>
          {grid && <li><i className="lg lg--bar" aria-hidden="true" />{lines && lines.strongEvery === 8 ? 'bars (8 bold)' : 'bars'}</li>}
          {beat && beat.landings.length > 0 && <li><i className="lg lg--land" aria-hidden="true" />landings</li>}
          {hits.length > 0 && <li><i className="lg lg--hit" aria-hidden="true" />hit</li>}
          {bridges.length > 0 && <li><i className="lg lg--bridge" aria-hidden="true" />bridge</li>}
          {ghost && <li><i className="lg lg--ghost" aria-hidden="true" />earlier plan</li>}
          {(ready || cues.length > 0) && <li><i className="lg lg--live" aria-hidden="true" />live read</li>}
        </ul>
        <span className="ctl__right">
          {uncertain && (
            <span className="tag tag--reject" role="status" title="No clear beat in the dancers' movement. Tap the beat with T on the clip stage, then score it again.">
              Beat uncertain
            </span>
          )}
          {revisions > 0 && (
            <span key={revisions} className="tag tag--accent tl__revised">
              Plan revised{revisions > 1 ? ` ×${revisions}` : ''}
            </span>
          )}
          <span className="panel__meta">
            {rules && (
              <>
                <span className="mono">{Math.round(tempoBpm ?? rules.bpm)}</span> bpm, {rules.meter}, {rules.keyName}
                {' · '}
              </>
            )}
            <b className="mono">{composed}</b>
            {total !== null && total !== composed && <> of <span className="mono">{total}</span></>} phrases
          </span>
        </span>
      </div>

      <div ref={plot} className={`ctl__plot${ready ? ' is-seekable' : ''}${grid ? ' has-grid' : ''}`} onClick={seek} title={ready ? 'Click to seek' : undefined}>
        {/* Section bands: role, tension and key on top; a hatch for departures. */}
        {plan
          ? plan.sections.map((s) => {
            const sp = spans.get(s.index);
            if (!sp) return null;
            return (
              <div
                key={`p${s.index}`}
                className={`band${s.departure ? ' is-departure' : ''}${nowSection === s.index ? ' is-now' : ''}`}
                style={{ left: pctOf(sp.start, dur), width: pctOf(sp.end - sp.start, dur) }}
                title={`Section ${s.index + 1}, ${timecode(sp.start)}–${timecode(sp.end)}: ${s.role}, planned tension ${s.tension} of 7, ${s.keyName}`}
              >
                <span className="band__label">
                  <span className="band__role score-text">{s.role}</span>
                  <span className="band__t mono">{s.tension}</span>
                  <span className="band__key">{s.keyName}</span>
                </span>
              </div>
            );
          })
          : videoSections.map((v) => (
            <div
              key={`v${v.index}`}
              className="band is-pending"
              style={{ left: pctOf(v.startSec, dur), width: pctOf(v.endSec - v.startSec, dur) }}
              title={v.summary}
            >
              <span className="band__label">
                <span className="band__role score-text">{v.mood}</span>
                <span className="band__key">movement {v.movement}</span>
              </span>
            </div>
          ))}

        {/* The beat grid: bar lines through the curve and the beat row, from the first downbeat. */}
        {lines && (
          <svg className="ctl__bars" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="ctl__bar" d={lines.bars} vectorEffect="non-scaling-stroke" />
            <path className="ctl__bar is-strong" d={lines.strong} vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {/* Where the dancers give no clear beat: the grid is carried through, kick and snare step back. */}
        {bridges.map((b) => (
          <div
            key={`b${b.startSec}`}
            className="ctl__bridge"
            style={{ left: pctOf(b.startSec, dur), width: pctOf(b.endSec - b.startSec, dur) }}
            title={`Bridge ${timecode(b.startSec, true)}–${timecode(b.endSec, true)}: no clear beat from the dancers here, so kick and snare step back and the grid is carried through`}
          >
            <span className="ctl__bridge-label score-text">{grid?.noBeat ? 'bridge: no beat found' : 'bridge'}</span>
          </div>
        ))}

        <div className="ctl__curve">
          <span className="tl__axis tl__axis--hi mono" aria-hidden="true">7</span>
          <span className="tl__axis tl__axis--lo mono" aria-hidden="true">1</span>
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="ctl-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {motionD && <path className="ctl__motion" d={motionD} />}
            <line className="tl__grid" x1="0" x2={VB_W} y1={tensionY(4)} y2={tensionY(4)} vectorEffect="non-scaling-stroke" />
            {ghost && <path key={revisions} className="tl__ghost" d={ghost.line} fill="none" vectorEffect="non-scaling-stroke" />}
            {curve && (
              <>
                <path className="tl__area" d={curve.area} fill="url(#ctl-fill)" />
                <path className="tl__line" d={curve.line} fill="none" vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>

          {/* What Drex read: movement 1..7 for every second. */}
          {readingList.map((r) => (
            <span
              key={r.second}
              className={`ctl__read${r.peak >= 6 ? ' is-peak' : ''}`}
              style={{ left: pctOf(r.second, dur), width: pctOf(1, dur), top: `${tensionY(r.movement)}%` }}
            />
          ))}

          {(motion?.cuts ?? []).map((c) => (
            <span key={c} className="ctl__cut" style={{ left: pctOf(c, dur) }} title={`Cut at ${timecode(c, true)}`} />
          ))}

          {climax && (
            <div className="tl__climax" style={{ left: pctOf(climax.sec, dur) }}>
              <span className="tl__climax-mark" style={{ top: `${climax.y}%` }} aria-hidden="true" />
              <span className="tl__climax-label score-text">climax</span>
            </div>
          )}

          {fitList.map((m) => <FitMark key={m.fit.section} mark={m} dur={dur} />)}

          {cues.map((c) => (
            <span
              key={c.atSec}
              className={`ctl__live${c.accent ? ' is-accent' : ''}${c.label === 'as composed' ? ' is-plain' : ''}`}
              style={{ left: pctOf(c.atSec, dur) }}
              title={`Live read at ${timecode(c.atSec, true)}: ${c.label}`}
            />
          ))}
        </div>

        {/* The beat row: the dancers' landings under the bar lines, unclear stretches, and the extra hits. */}
        <div className="ctl__beat">
          {unclear.map((u) => (
            <span
              key={`u${u.startSec}`}
              className="ctl__unclear"
              style={{ left: pctOf(u.startSec, dur), width: pctOf(u.endSec - u.startSec, dur) }}
              title={`${timecode(u.startSec)}–${timecode(u.endSec)}: the dancers' beat is unclear here; the grid is carried through from its neighbours`}
            />
          ))}
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
            {lines?.beats && <path className="ctl__tick" d={lines.beats} vectorEffect="non-scaling-stroke" />}
            {landings.map((d, i) => d && <path key={i} className={`ctl__land ctl__land--${i}`} d={d} vectorEffect="non-scaling-stroke" />)}
          </svg>
          {hits.map((t) => (
            <span key={t} className="ctl__hit" style={{ left: pctOf(t, dur) }} title={`Extra hit at ${timecode(t, true)}, on one of the dancers' biggest landings`} />
          ))}
          {!beat && <span className="ctl__beat-wait">finding the beat in the dancers' bodies</span>}
        </div>

        {/* The phrases on the video clock. */}
        <ol className="ctl__phrases">
          {cells.map((c) => {
            const played = nowIndex !== null && c.index < nowIndex;
            return (
              <li
                key={c.index}
                className={`pcell${c.score ? ' is-composed' : ''}${played ? ' is-played' : ''}${c.index === nowIndex ? ' is-now' : ''}${plan?.climaxPhrase === c.index ? ' is-climax' : ''}`}
                style={{ left: pctOf(c.start, dur), width: pctOf(c.end - c.start, dur) }}
                title={c.score
                  ? `Phrase ${c.index + 1}, ${timecode(c.start, true)}–${timecode(c.end, true)}: ${c.score.role}, ${c.score.bars} bars at ${Math.round(c.score.bpm)} bpm`
                  : `Phrase ${c.index + 1}: not composed yet`}
              >
                <span className="pcell__bar" aria-hidden="true" />
                <span className="pcell__n mono">{c.index + 1}</span>
              </li>
            );
          })}
        </ol>

        <ol className="ctl__axis" aria-hidden="true">
          {axis.map((t) => (
            <li key={t.sec} className={t.label ? 'is-label' : undefined} style={{ left: pctOf(t.sec, dur) }}>
              {t.label && <span className="mono">{timecode(t.sec)}</span>}
            </li>
          ))}
        </ol>

        {ready && (
          <div ref={nowMarker} className="tl__marker tl__marker--now">
            <span className="tl__marker-line" />
            <span ref={nowText} className="tl__marker-head mono">0:00.0</span>
          </div>
        )}
      </div>
    </section>
  );
});

interface FitPos { fit: FitView; sec: number; compact: boolean }

/**
 * Each section change, marked at its boundary (the bar line the next section starts on). Marks
 * closer than a full label's width to the one before show their glyph only.
 */
function fitMarks(fits: Record<number, FitView>, spans: Map<number, Span>, dur: number, widthPx: number, labelPx: number): FitPos[] {
  const out: FitPos[] = [];
  for (const fit of Object.values(fits)) {
    const span = spans.get(fit.section);
    if (span && fit.choice !== 'none') out.push({ fit, sec: span.end, compact: false });
  }
  out.sort((a, b) => a.sec - b.sec);
  const pxPerSec = widthPx / dur;
  out.forEach((m, i) => {
    const prev = out[i - 1];
    if (prev && (m.sec - prev.sec) * pxPerSec < labelPx) m.compact = true;
  });
  return out;
}

function FitMark({ mark, dur }: { mark: FitPos; dur: number }) {
  const { fit, sec, compact } = mark;
  return (
    <span
      className={`ctl__fit ctl__fit--${fit.choice}${compact ? ' is-compact' : ''}`}
      style={{ left: pctOf(sec, dur) }}
      title={`How the change is marked: ${fit.label}, ${fit.detail}`}
    >
      <span className="ctl__fit-glyph" aria-hidden="true">{fitGlyph(fit.choice)}</span>
      {!compact && fitShort(fit.choice)}
    </span>
  );
}

/** One tick per moment: a replay re-reads the same seconds, and the newest read wins. */
function latestCues(cues: LiveCue[]): LiveCue[] {
  const byMoment = new Map<string, LiveCue>();
  for (const c of cues) byMoment.set(c.atSec.toFixed(2), c);
  return [...byMoment.values()];
}

function axisTicks(dur: number): { sec: number; label: boolean }[] {
  const step = dur > 240 ? 10 : dur > 45 ? 5 : 1;
  const labelEvery = dur > 240 ? 60 : dur > 90 ? 15 : dur > 45 ? 10 : 5;
  const out: { sec: number; label: boolean }[] = [];
  for (let s = 0; s <= dur + 1e-6; s += step) out.push({ sec: s, label: s % labelEvery === 0 });
  return out;
}

