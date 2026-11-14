import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CallView, QuestionView } from '../../../shared/types';
import { atClock, callLabel, isJudgeCall } from '../format';
import { useSel } from '../store';
import { QuestionCompact, QuestionFull, questionCost } from './Questions';
import './decision.css';

/** Fallback room for questions, in rem, until the panel has been measured. */
const DEFAULT_BUDGET = 17.5;
const MAX_FULL = 3;
const COMPACT_ROW = 1.7;
const MORE_BUTTON = 1.9;

interface Split {
  full: QuestionView[];
  rest: QuestionView[];
  /** How many of `rest` fit as one-line summaries without scrolling. */
  preview: number;
}

/**
 * Decide which questions get bars and which get a one-line summary. The first question is
 * always full size; later ones only if they fit with room left to summarise the remainder.
 */
function splitQuestions(questions: QuestionView[], budget: number): Split {
  if (questions.length === 0) return { full: [], rest: [], preview: 0 };
  const full: QuestionView[] = [questions[0]];
  let used = questionCost(questions[0]);
  for (let i = 1; i < questions.length && full.length < MAX_FULL; i++) {
    const remaining = questions.length - i - 1;
    const reserve = remaining === 0 ? 0 : COMPACT_ROW * Math.min(2, remaining) + (remaining > 2 ? MORE_BUTTON : 0);
    const cost = questionCost(questions[i]) + 0.95;
    if (used + cost + reserve > budget) break;
    full.push(questions[i]);
    used += cost;
  }
  const rest = questions.slice(full.length);
  const room = budget - used - 0.95;
  let preview = Math.floor(room / COMPACT_ROW);
  if (preview < rest.length) preview = Math.floor((room - MORE_BUTTON) / COMPACT_ROW);
  return { full, rest, preview: Math.max(1, Math.min(rest.length, preview)) };
}

/** Height available to a call's questions, in rem, tracked as the window changes. */
function useBudget(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // Minus the call's own header line and the body padding.
      const next = Math.round((el.clientHeight / rem - 3.6) * 2) / 2;
      if (next > 4) setBudget(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, budget];
}

/** The question Drex is answering now, at reading size, and a log of the calls around it. */
export const DecisionPanel = memo(function DecisionPanel() {
  const live = useSel((s) => s.featured);
  const calls = useSel((s) => s.calls);
  const [pinnedId, setPinnedId] = useState<number | null>(null);

  const pinned = pinnedId === null ? null : calls.find((c) => c.id === pinnedId) ?? null;
  useEffect(() => {
    // The pinned call scrolled out of the log, or a new run began.
    if (pinnedId !== null && !pinned) setPinnedId(null);
  }, [pinnedId, pinned]);

  const call = pinned ?? live;
  const [slot, budget] = useBudget();
  const recent = useMemo(() => calls.slice(-40).reverse(), [calls]);

  return (
    <section className="panel decision" aria-label="Drex decisions">
      <div className="panel__head">
        <h2 className="panel__title">Drex is deciding</h2>
        {pinned ? (
          <button type="button" className="tag tag--accent decision__unpin" onClick={() => setPinnedId(null)}>
            Pinned: back to live
          </button>
        ) : (
          call && <span className="panel__meta mono">call {call.id}</span>
        )}
      </div>

      <div ref={slot} className="decision__slot">
        {call ? (
          <CallCard key={call.id} call={call} budget={budget} onHold={setPinnedId} />
        ) : (
          <div className="panel__empty">
            <strong>Waiting for the first question</strong>
            <span>Each question Drex answers appears here with the probability it gave every option.</span>
          </div>
        )}
      </div>

      <div className="ticker">
        <div className="ticker__head">
          <span className="panel__title">Recent calls</span>
          <span className="panel__meta">select one to hold it on screen</span>
        </div>
        <ol className="ticker__list scroll">
          {recent.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`tick${c.id === call?.id ? ' is-shown' : ''}${isJudgeCall(c.callType) ? ' is-judge' : ''}`}
                aria-pressed={c.id === pinnedId}
                onClick={() => setPinnedId(c.id === pinnedId ? null : c.id)}
              >
                <span className="tick__at mono">{atClock(c.at)}</span>
                <span className="tick__type">{callLabel(c.callType)}</span>
                <span className="tick__title">{c.title}</span>
                <span className="tick__ms mono">{c.ms} ms</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
});

interface CallCardProps {
  call: CallView;
  budget: number;
  onHold(id: number): void;
}

const CallCard = memo(function CallCard({ call, budget, onHold }: CallCardProps) {
  const [expanded, setExpanded] = useState(false);
  // In a real-Drex session, a call the local stand-in answered must say so.
  const flagStandin = useSel((s) => call.standin && s.session?.standin === false);
  const toggle = (): void => {
    // Opening the full list holds this call on screen; otherwise the next call would replace it.
    if (!expanded) onHold(call.id);
    setExpanded((v) => !v);
  };
  const { full, rest, preview } = useMemo(() => splitQuestions(call.questions, budget), [call, budget]);
  const shownRest = expanded ? rest : rest.slice(0, preview);
  const hiddenCount = rest.length - shownRest.length;

  return (
    <div className="call">
      <div className="call__head">
        <span className={`tag${isJudgeCall(call.callType) ? ' tag--accent' : ''}`}>{callLabel(call.callType)}</span>
        <h3 className="call__title" title={call.title}>{call.title}</h3>
        <span className="call__meta mono">
          {flagStandin && <span className="tag tag--reject call__standin">stand-in answer</span>}
          {call.questions.length} {call.questions.length === 1 ? 'question' : 'questions'}, {call.ms} ms
        </span>
      </div>

      <div className="call__body scroll">
        {full.map((q) => (
          <QuestionFull key={q.id} q={q} />
        ))}
        {rest.length > 0 && (
          <div className="call__rest">
            <ul className="qc-list">
              {shownRest.map((q) => (
                <QuestionCompact key={q.id} q={q} />
              ))}
            </ul>
            {(hiddenCount > 0 || expanded) && (
              <button type="button" className="call__more" onClick={toggle} aria-expanded={expanded}>
                {expanded ? 'Show fewer' : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'question' : 'questions'} from this call`}
              </button>
            )}
          </div>
        )}
        {call.questions.length === 0 && <p className="call__none">This call carried no questions.</p>}
      </div>
    </div>
  );
});
