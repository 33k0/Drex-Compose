import { memo, useRef } from 'react';
import { DYNAMIC_NAMES, type LayerRole, type LayerSummary, type PhraseScore } from '../../../shared/types';
import { LAYER_ROLES, engineRef } from '../engineBridge';
import { articulationName, entryName, instrumentName } from '../format';
import { useSel } from '../store';
import { useFrame } from './useFrame';
import './layers.css';

/**
 * What is sounding right now: the phrase under the video playhead (the whole piece is composed
 * before playback, so this follows the picture, not composition).
 */
export const LayersPanel = memo(function LayersPanel() {
  const nowIndex = useSel((s) => s.nowIndex);
  const score = useSel((s) => (s.nowIndex === null ? null : s.phrases[s.nowIndex] ?? null));
  const total = useSel((s) => s.plan?.totalPhrases ?? null);
  const started = useSel((s) => s.playbackStarted);

  return (
    <section className="panel layers" aria-label="Now sounding">
      <div className="panel__head">
        <h2 className="panel__title">Now sounding</h2>
        {nowIndex !== null && (
          <span className="panel__meta">
            phrase <b className="mono">{nowIndex + 1}</b>
            {total !== null && (
              <>
                {' '}of <span className="mono">{total}</span>
              </>
            )}
          </span>
        )}
      </div>

      {score && started ? <NowHead score={score} /> : <Preparing />}

      <LayerRows phrase={score?.index ?? -1} layers={started ? score?.display.layers ?? null : null} />
    </section>
  );
});

// ───────────────────────────── Sounding phrase ─────────────────────────────

const NowHead = memo(function NowHead({ score }: { score: PhraseScore }) {
  const progress = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const el = progress.current;
    const engine = engineRef.current;
    if (!el || !engine) return;
    const ph = engine.playhead();
    const frac = ph.index === score.index && ph.beats > 0 ? Math.max(0, Math.min(1, ph.beat / ph.beats)) : 0;
    el.style.transform = `scaleX(${frac.toFixed(4)})`;
  });

  return (
    <div className="now" key={score.index}>
      <div className="now__line">
        <span className="now__role score-text">{score.role}</span>
        <span className="now__dyn score-text" title="Overall dynamic">{DYNAMIC_NAMES[score.mix.dynamics]}</span>
      </div>
      <div className="now__facts">
        <span>{score.display.key}</span>
        <span className="mono now__chords">{score.display.chords.join('  ')}</span>
        <span className="mono">{score.bars} bars</span>
      </div>
      <span className="now__progress" aria-hidden="true">
        <span ref={progress} />
      </span>
    </div>
  );
});

// ───────────────────────────── Before playback, after the end ─────────────────────────────

const Preparing = memo(function Preparing() {
  const audio = useSel((s) => s.audio);
  const started = useSel((s) => s.playbackStarted);
  const ended = useSel((s) => s.videoEnded);
  const hasRules = useSel((s) => s.rules !== null);

  let headline = 'Press play';
  let detail = 'The music starts with the video and follows it through pauses and seeks.';
  if (ended) {
    headline = 'The clip has played out';
    detail = 'Play again, or choose a new clip.';
  } else if (started) {
    headline = 'Between phrases';
    detail = 'No phrase is planned for this moment of the clip.';
  } else if (hasRules && !audio.instrumentsReady && audio.mode !== 'silent') {
    headline = 'Loading instruments';
    detail = audio.mode === 'pending' ? 'Waiting for the audio engine.' : 'Fetching samples for the palette Drex chose.';
  }

  const showLoad = hasRules && audio.total > 0 && !audio.instrumentsReady;
  const frac = audio.total > 0 ? audio.loaded / audio.total : 0;

  return (
    <div className="prep" role="status">
      <strong className="score-text">{headline}</strong>
      <span>{detail}</span>
      {showLoad && (
        <div className="prep__load">
          <span className="prep__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${frac})` }} />
          </span>
          <span className="mono">
            {audio.loaded} of {audio.total} samples
          </span>
        </div>
      )}
      {audio.mode === 'silent' && <span className="prep__warn">Audio engine unavailable: running a silent playhead.</span>}
    </div>
  );
});

// ───────────────────────────── The nine layers ─────────────────────────────

const SEGMENTS = 24;

const LayerRows = memo(function LayerRows({ phrase, layers }: { phrase: number; layers: LayerSummary[] | null }) {
  const meters = useRef<Partial<Record<LayerRole, HTMLSpanElement | null>>>({});
  const shown = useRef<Partial<Record<LayerRole, number>>>({});

  useFrame(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let levels: Record<LayerRole, number>;
    try {
      levels = engine.levels();
    } catch {
      return;
    }
    for (const role of LAYER_ROLES) {
      const el = meters.current[role];
      if (!el) continue;
      const target = Math.max(0, Math.min(1, levels[role] ?? 0));
      const prev = shown.current[role] ?? 0;
      // Fast up, slow down, like a desk meter; snapped to whole segments.
      const next = target > prev ? target : Math.max(target, prev - 0.035);
      shown.current[role] = next;
      const lit = Math.round(next * SEGMENTS);
      if (el.dataset.lit !== String(lit)) {
        el.dataset.lit = String(lit);
        el.style.clipPath = `inset(0 ${(100 - (lit / SEGMENTS) * 100).toFixed(2)}% 0 0)`;
      }
    }
  });

  const byRole = new Map<LayerRole, LayerSummary>();
  for (const l of layers ?? []) byRole.set(l.role, l);

  return (
    <ol className="rows">
      {LAYER_ROLES.map((role) => {
        const l = byRole.get(role);
        const active = Boolean(l && l.inst);
        const entering = active && l!.entry !== 'continues';
        return (
          // A layer that enters in this phrase is remounted so its entry highlight plays once.
          <li key={entering ? `${role}@${phrase}` : role} className={`row${active ? ' is-active' : ''}${entering ? ' is-entering' : ''}`}>
            <span className="row__role">{role}</span>
            {active ? (
              <>
                <span className="row__inst" title={l!.detail}>
                  {instrumentName(l!.inst!)}
                  {l!.art && <span className="row__art">{articulationName(l!.art)}</span>}
                </span>
                <span className="row__entry">{entryName(l!.entry)}</span>
                <span className="row__dyn score-text">{DYNAMIC_NAMES[l!.dynamics]}</span>
              </>
            ) : (
              <span className="row__tacet score-text">tacet</span>
            )}
            <span className="row__meter" aria-hidden="true">
              <span ref={(el) => { meters.current[role] = el; }} className="row__lit" />
            </span>
          </li>
        );
      })}
    </ol>
  );
});
