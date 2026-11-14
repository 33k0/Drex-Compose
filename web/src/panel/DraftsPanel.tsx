import { memo, useEffect, useState, type CSSProperties } from 'react';
import type { DraftView } from '../../../shared/types';
import { pct } from '../format';
import type { DraftRound } from '../state';
import { useSel } from '../store';
import { Sparkline } from './Sparkline';
import './drafts.css';

function roundSubject(r: DraftRound): string {
  return r.kind === 'theme' ? `Theme ${r.themeId ?? ''}`.trim() : `Phrase ${(r.phrase ?? 0) + 1}`;
}

function draftName(id: string, position: number): string {
  // Ids are the server's; a single letter reads well as is, anything longer gets its position.
  return /^[a-z]$/i.test(id) ? id.toUpperCase() : String(position + 1);
}

/** The drafts for the latest judge round, and what the judge did with them. */
export const DraftsPanel = memo(function DraftsPanel() {
  const focus = useSel((s) => s.focusRound);
  const lastRejection = useSel((s) => s.lastRejection);
  const phraseRounds = useSel((s) => s.phraseRounds);
  const themeRounds = useSel((s) => s.themeRounds);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!lastRejection) setReviewing(false);
  }, [lastRejection]);

  const round = reviewing && lastRejection ? lastRejection : focus;

  if (!round) {
    return (
      <section className="panel drafts" aria-label="Drafts">
        <div className="panel__head">
          <h2 className="panel__title">Drafts and the judge</h2>
        </div>
        <div className="panel__empty">
          <strong>No drafts yet</strong>
          <span>Drex writes several drafts of every theme and phrase, then judges them. It may accept one or reject them all.</span>
        </div>
      </section>
    );
  }

  // Earlier rounds for the same theme or phrase: the rejections that led here.
  const siblings = round.kind === 'phrase' ? phraseRounds[round.phrase ?? -1] ?? [] : themeRounds.filter((r) => r.themeId === round.themeId);
  const earlier = siblings.filter((r) => r.seq < round.seq && r.rejected);
  const n = round.drafts.length;
  const dense = n > 4;
  const columns = round.kind === 'theme' && n > 4 ? Math.ceil(n / 2) : Math.min(n, 6);
  const picked = round.drafts.findIndex((d) => d.id === round.verdict.picked);
  // Offer the last rejection only when it is not already on screen (as this round or in the list above).
  const offerReview = Boolean(lastRejection) && lastRejection !== focus && !earlier.includes(lastRejection!);

  return (
    <section className={`panel drafts${round.rejected ? ' is-rejected' : ''}`} aria-label="Drafts">
      <div className="panel__head">
        <h2 className="panel__title">Drafts and the judge</h2>
        <span className="drafts__where">
          {reviewing && <span className="tag">Reviewing</span>}
          <span className="drafts__subject">
            {roundSubject(round)}, round <span className="mono">{round.round}</span>
          </span>
          {round.rejected ? (
            <span key={round.seq} className="tag tag--reject">All {n} rejected</span>
          ) : (
            <span key={round.seq} className="tag tag--accent">Accepted {picked >= 0 ? draftName(round.drafts[picked].id, picked) : ''}</span>
          )}
        </span>
      </div>

      {earlier.length > 0 && (
        <ol className="drafts__earlier">
          {earlier.map((r) => (
            <li key={r.seq}>
              <span className="drafts__earlier-tag">Round {r.round} rejected</span>
              <span className="drafts__earlier-reason">{r.verdict.reason}</span>
            </li>
          ))}
        </ol>
      )}

      <ol
        key={round.seq}
        className={`drafts__grid${dense ? ' is-dense' : ''}`}
        style={{ '--cols': columns } as CSSProperties}
      >
        {round.drafts.map((d, i) => (
          <DraftCard
            key={d.id}
            draft={d}
            position={i}
            state={round.rejected ? 'rejected' : d.id === round.verdict.picked ? 'picked' : 'passed'}
            probability={round.verdict.probabilities[d.id]}
          />
        ))}
      </ol>

      <p key={`v${round.seq}`} className={`verdict${round.rejected ? ' verdict--reject' : ''}`}>
        <span className="verdict__who">{round.rejected ? 'Judge rejected every draft' : 'Judge'}</span>
        <span className="verdict__reason score-text">{round.verdict.reason}</span>
        {round.verdict.probabilities.none !== undefined && (
          <span className="verdict__none">
            none of these <b className="mono">{pct(round.verdict.probabilities.none)}</b>
          </span>
        )}
      </p>

      {(offerReview || reviewing) && lastRejection && (
        <div className="drafts__foot">
          <span>
            Last rejection: {roundSubject(lastRejection).toLowerCase()}, round <span className="mono">{lastRejection.round}</span>,{' '}
            {lastRejection.drafts.length} drafts turned down
          </span>
          <button type="button" className="drafts__review" onClick={() => setReviewing((v) => !v)} aria-pressed={reviewing}>
            {reviewing ? 'Back to live' : 'Show it'}
          </button>
        </div>
      )}
    </section>
  );
});

interface CardProps {
  draft: DraftView;
  position: number;
  state: 'picked' | 'passed' | 'rejected';
  probability: number | undefined;
}

const DraftCard = memo(function DraftCard({ draft, position, state, probability }: CardProps) {
  const stamp = state === 'picked' ? 'Accepted' : state === 'rejected' ? 'Rejected' : 'Passed over';
  const hasChords = Boolean(draft.chords && draft.chords.length > 0);
  const hasFacts = Boolean(draft.facts && draft.facts.length > 0);
  return (
    <li className={`draft is-${state}`} style={{ '--i': position } as CSSProperties}>
      <div className="draft__head">
        <span className="draft__id score-text">{draftName(draft.id, position)}</span>
        <span className="draft__stamp">{stamp}</span>
        {probability !== undefined && <span className="draft__p mono">{pct(probability)}</span>}
      </div>
      <div className="draft__roll">
        <Sparkline notes={draft.notes} />
        <span className="draft__strike" aria-hidden="true" />
      </div>
      <p className="draft__lineage score-text" title={draft.lineage}>{draft.lineage}</p>
      <p className="draft__notation mono" title={draft.notation}>{draft.notation}</p>
      {(hasChords || hasFacts) && (
        <dl className="draft__facts">
          {hasChords && (
            <div>
              <dt>chords</dt>
              <dd className="mono">{draft.chords!.join(' ')}</dd>
            </div>
          )}
          {(draft.facts ?? []).slice(0, 3).map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
});
