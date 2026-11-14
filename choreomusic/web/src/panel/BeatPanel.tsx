import { memo, useMemo, type CSSProperties } from 'react';
import type { BeatView, TempoView } from '../../../shared/choreo';
import { fitGlyph, fitShort, pct, relationName, sourceName, timecode } from '../format';
import { beatUncertain, trackingProgress } from '../state';
import { useSel } from '../store';
import { Frame } from './Frame';
import './tempo.css';

interface CandRow {
  key: string;
  bpm: number;
  relation: string;
  /** How well the dancers' landings agree with this grid; null for a candidate only Drex was offered. */
  agreement: number | null;
  /** Drex's probability, once the tempo call has answered. */
  probability: number | null;
  source: string;
}

const sameBpm = (a: number, b: number): boolean => Math.abs(a - b) < 0.6;

/** The beat's candidates joined with Drex's probabilities from the tempo call, slowest first. */
function candidateRows(beat: BeatView | null, tempo: TempoView | null): CandRow[] {
  const rows: CandRow[] = [];
  const used = new Set<string>();
  for (const [i, c] of (beat?.candidates ?? []).entries()) {
    const t = tempo?.candidates.find((x) => !used.has(x.key) && sameBpm(x.bpm, c.bpm));
    if (t) used.add(t.key);
    rows.push({
      key: t?.key ?? `b${i}`, bpm: c.bpm, relation: c.relation, agreement: c.agreement,
      probability: t ? t.probability : null, source: t?.source ?? beat?.method ?? '',
    });
  }
  for (const t of tempo?.candidates ?? []) {
    if (used.has(t.key)) continue;
    rows.push({ key: t.key, bpm: t.bpm, relation: t.relation, agreement: null, probability: t.probability, source: t.source ?? '' });
  }
  return rows.sort((a, b) => a.bpm - b.bpm);
}

/**
 * The beat: found from the dancers' bodies alone (or, when that cannot run, the raw pixel motion),
 * how sure the grid is, the candidate tempos with how well the landings agree with each, the
 * probability Drex gave each and the one it picked. A tapped tempo that overrode Drex is said
 * plainly, in the copper override colour; so is a beat that could not be found.
 */
export const BeatPanel = memo(function BeatPanel() {
  const beat = useSel((s) => s.beat);
  const tempo = useSel((s) => s.tempo);
  const grid = useSel((s) => s.grid);
  const hits = useSel((s) => s.hits.length);
  const uncertain = useSel(beatUncertain);
  // Primitives only: a selector that built an object would re-render forever.
  const trackingMessage = useSel((s) => (s.stage === 'loading' ? s.message : ''));
  const tracking = trackingProgress(trackingMessage);
  const rows = useMemo(() => candidateRows(beat, tempo), [beat, tempo]);
  const topAgreement = useMemo(() => Math.max(1e-6, ...rows.map((r) => r.agreement ?? 0)), [rows]);

  if (!beat && !tempo) {
    return (
      <section className="panel tempo" aria-label="Beat">
        <div className="panel__head">
          <h2 className="panel__title">Beat</h2>
        </div>
        <div className="panel__empty">
          <strong>Finding the beat</strong>
          <span>
            {tracking
              ? `Tracking the dancers' bodies: frame ${tracking.done} of ${tracking.total}.`
              : "Code finds one beat grid from the dancers' bodies alone. Drex picks the tempo."}
          </span>
        </div>
      </section>
    );
  }

  const drexPick = tempo ? (tempo.manual ? tempo.drexBpm : tempo.bpm) : undefined;
  const isPicked = (bpm: number): boolean => drexPick !== undefined && sameBpm(bpm, drexPick);
  const best = beat?.candidates.reduce((a, c) => (c.agreement > a.agreement ? c : a), beat.candidates[0]);
  const leadBpm = tempo?.bpm ?? best?.bpm ?? null;
  const firstDownbeat = grid?.musicStartSec ?? tempo?.offsetSec ?? best?.firstBeatSec ?? null;

  return (
    <section className="panel tempo" aria-label="The beat, found from the dancers">
      <div className="panel__head">
        <h2 className="panel__title">Beat</h2>
        <span className="panel__meta">
          {firstDownbeat !== null && <>first downbeat <b className="mono">{timecode(firstDownbeat, true)}</b></>}
          {grid && <>, bar <b className="mono">{grid.barSec.toFixed(2)}</b> s</>}
        </span>
      </div>

      {beat && (
        <div className="beat__method">
          {beat.method === 'body' ? (
            <span className="tag tag--accent">Body tracking</span>
          ) : (
            <span className="tag tag--reject beat__pixels" title={beat.note}>
              Pixel motion{beat.note ? ` — ${beat.note}` : ''}
            </span>
          )}
          <span className="beat__people">
            <b className="mono">{beat.people.toFixed(1)}</b> {beat.method === 'body' ? 'people tracked' : 'people'}
          </span>
          <span className="beat__conf" title="How far the best beat grid stands above chance">
            <span>confidence</span>
            <span className="beat__meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, beat.confidence))})` }} />
            </span>
            <b className="mono">{pct(beat.confidence)}</b>
          </span>
        </div>
      )}

      <div className="tempo__lead">
        <span className="tempo__bpm mono">{leadBpm !== null ? Math.round(leadBpm) : '…'}</span>
        <span className="tempo__unit">bpm</span>
        {tempo?.manual ? (
          <span className="tempo__override" role="status">
            tapped <b className="mono">{Math.round(tempo.bpm)}</b> — Drex picked <b className="mono">{drexPick !== undefined ? Math.round(drexPick) : '?'}</b>
          </span>
        ) : tempo ? (
          <span className="tempo__who">
            picked by Drex from {tempo.candidates.length} candidates{tempo.source ? `, ${sourceName(tempo.source)}` : ''}
          </span>
        ) : (
          <span className="tempo__who">best grid in the movement; Drex has not picked yet</span>
        )}
      </div>

      {uncertain && (
        <p className="beat__warn" role="status">
          Beat uncertain — tap the beat (<kbd>T</kbd>) on the clip stage
        </p>
      )}

      <ol className="cands" aria-label="Candidate tempos">
        <li className="cands__head" aria-hidden="true">
          <span>bpm</span>
          <span>relation</span>
          <span>agreement</span>
          <span>Drex</span>
          <span>from</span>
        </li>
        {rows.map((c, i) => (
          <li key={c.key} className={`cand${isPicked(c.bpm) ? ' is-picked' : ''}`} style={{ '--i': i } as CSSProperties}>
            <span className="cand__bpm mono">{Math.round(c.bpm)}</span>
            <span className="cand__rel">{relationName(c.relation)}</span>
            <span className="cand__agree" title={c.agreement === null ? 'Not one of the grids found in the movement' : `The dancers' landings agree ${c.agreement.toFixed(3)} with this grid`}>
              <span className="cand__agree-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${c.agreement === null ? 0 : Math.max(0.01, c.agreement / topAgreement)})` }} />
              </span>
              <span className="mono">{c.agreement === null ? '—' : c.agreement.toFixed(2)}</span>
            </span>
            <span className="cand__p">
              <span className="cand__track" aria-hidden="true">
                {c.probability !== null && <span className="cand__fill" style={{ transform: `scaleX(${Math.max(0.004, c.probability)})` }} />}
              </span>
              <span className="mono">{c.probability === null ? '…' : pct(c.probability)}</span>
            </span>
            <span className={`cand__src${c.source === 'body' ? ' is-body' : c.source === 'pixels' ? ' is-pixels' : ''}`}>{sourceName(c.source)}</span>
          </li>
        ))}
      </ol>

      {grid && (
        <p className="beat__grid">
          {grid.noBeat ? (
            <>No beat found anywhere: the whole score is a bridge on a steady grid.</>
          ) : (
            <>
              {grid.bridges.length === 0
                ? 'No bridges: the beat holds through the clip'
                : `${grid.bridges.length} ${grid.bridges.length === 1 ? 'bridge' : 'bridges'}: ${grid.bridges.map((b) => `${timecode(b.startSec)}–${timecode(b.endSec)}`).join(', ')}`}
              {hits > 0 && <> · <b className="mono">{hits}</b> extra {hits === 1 ? 'hit' : 'hits'} on the biggest landings</>}
            </>
          )}
        </p>
      )}
    </section>
  );
});

/** The sections Drex found in the picture, with the plan's role for each and how each change is marked inside the beat. */
export const SectionsPanel = memo(function SectionsPanel() {
  const sections = useSel((s) => s.videoSections);
  const plan = useSel((s) => s.plan);
  const fits = useSel((s) => s.fits);
  const onGrid = useSel((s) => s.grid !== null);

  return (
    <section className="panel secs" aria-label="Sections of the clip">
      <div className="panel__head">
        <h2 className="panel__title">Sections of the clip</h2>
        <span className="panel__meta">{sections.length > 0 ? `${sections.length} found${onGrid ? ', on bar lines' : ''}` : ''}</span>
      </div>
      {sections.length === 0 ? (
        <div className="panel__empty">
          <strong>Finding the sections</strong>
          <span>From the readings: where the movement, the mood or the scene changes. Each one is moved to a bar line.</span>
        </div>
      ) : (
        <ol className="secs__list scroll">
          {sections.map((v) => {
            const p = plan?.sections.find((s) => s.index === v.index);
            const fit = fits[v.index];
            return (
              <li key={v.index} className="sec">
                <Frame index={v.keyFrame} className="sec__frame" />
                <div className="sec__body">
                  <div className="sec__line">
                    <span className="sec__time mono">{timecode(v.startSec)}–{timecode(v.endSec)}</span>
                    {p ? (
                      <span className="sec__role score-text">
                        {p.role} <span className="sec__tension mono">tension {p.tension}</span>
                      </span>
                    ) : (
                      <span className="sec__role sec__role--pending score-text">{v.mood}</span>
                    )}
                    {fit && (
                      <span className={`sec__fit sec__fit--${fit.choice}`} title={`How the change is marked: ${fit.label}, ${fit.detail}`}>
                        <span aria-hidden="true">{fitGlyph(fit.choice)}</span> {fitShort(fit.choice)}
                      </span>
                    )}
                  </div>
                  <p className="sec__text" title={fit ? `How the change is marked: ${fit.label}, ${fit.detail}` : v.summary}>
                    {fit ? `Change ${fit.choice === 'none' ? 'unmarked' : `marked by ${fit.label}`}, ${fit.detail}` : v.summary.replace(/^[\d:]+-[\d:]+:\s*/, '')}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
