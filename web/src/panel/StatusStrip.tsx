import { memo } from 'react';
import { stageLabel } from '../format';
import { deskView, rejectedRoundCount } from '../state';
import { useSel } from '../store';
import './status.css';

/** One line: what Drex is doing, and the running counts. */
export const StatusStrip = memo(function StatusStrip() {
  const stage = useSel((s) => s.stage);
  const message = useSel((s) => s.message);
  const error = useSel((s) => s.error);
  const phase = useSel((s) => s.phase);
  const stats = useSel((s) => s.stats);
  const total = useSel((s) => s.plan?.totalPhrases ?? null);
  const composed = useSel((s) => s.composedThrough + 1);
  const seenRejects = useSel(rejectedRoundCount);
  const conn = useSel((s) => s.conn);
  const view = useSel(deskView);
  const prescan = useSel((s) => s.prescan);
  const liveCount = useSel((s) => s.liveCues.length);
  const playing = useSel((s) => s.playing);
  const ended = useSel((s) => s.videoEnded);

  let label = stageLabel(stage);
  let text = message;
  let tone: 'plain' | 'accent' | 'reject' = 'plain';
  if (error) {
    label = 'Error';
    text = error;
    tone = 'reject';
  } else if (phase === 'starting') {
    label = 'Starting';
    text = conn === 'open' || conn === 'mock'
      ? 'Sending the clip to Drex'
      : 'Waiting for the server. The clip will be sent as soon as it connects.';
  } else if (phase === 'stopped') {
    label = 'Stopped';
    text = view === 'playback'
      ? 'Stopped by you. The piece still plays; live reads are off. Esc or New clip to choose another clip.'
      : 'Stopped by you. Esc or New clip to choose another clip.';
  } else if (view === 'playback') {
    label = playing ? 'Playing' : ended ? 'Played' : 'Ready';
    tone = 'accent';
    text = playing
      ? 'The music follows the video clock. The live read looks two to three seconds ahead.'
      : ended ? 'The clip has played out. Play again, or choose a new clip.' : message || 'The whole piece is composed. Press play.';
  } else if (stage === 'composing' || stage === 'prescan') {
    tone = 'accent';
  }

  const rejects = Math.max(stats.rejects, seenRejects);

  return (
    <footer className="status">
      <span className={`tag${tone === 'accent' ? ' tag--accent' : tone === 'reject' ? ' tag--reject' : ''}`}>{label}</span>
      <p key={text} className={`status__msg${tone === 'reject' ? ' is-reject' : ''}`} role="status" aria-live="polite">
        {text}
      </p>
      <dl className="status__stats" aria-label="Run counts">
        {prescan.total > 0 && (
          <div className="stat">
            <dt>Seconds read</dt>
            <dd className="mono">
              {prescan.done}
              <span className="stat__of"> / {prescan.total}</span>
            </dd>
          </div>
        )}
        <Stat label="Calls" value={stats.calls} />
        <Stat label="Per minute" value={stats.callsLastMinute} />
        <Stat label="Rejected" value={rejects} tone={rejects > 0 ? 'reject' : undefined} />
        <div className="stat">
          <dt>Phrases</dt>
          <dd className="mono">
            {Math.max(stats.composed, composed)}
            {total !== null && <span className="stat__of"> / {total}</span>}
          </dd>
        </div>
        {view === 'playback' && <Stat label="Live reads" value={liveCount} />}
      </dl>
    </footer>
  );
});

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'reject' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd key={value} className="mono">{value}</dd>
    </div>
  );
}
