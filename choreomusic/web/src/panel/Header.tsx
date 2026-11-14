import { memo } from 'react';
import { controller } from '../controller';
import { modelBadge } from '../format';
import { useSel } from '../store';
import './header.css';

/** Brand, the clip and prompt being scored, who is answering, and the run controls. */
export const Header = memo(function Header() {
  const clipName = useSel((s) => s.clip?.name ?? s.pending?.clip ?? '');
  const prompt = useSel((s) => s.session?.prompt ?? s.pending?.prompt ?? '');
  const phase = useSel((s) => s.phase);
  const ready = useSel((s) => s.ready !== null);
  const playing = useSel((s) => s.playing);
  const live = phase === 'running' || phase === 'starting';
  const stoppable = live && !ready;

  return (
    <header className="top">
      <div className="top__brand">
        Drex <span>Choreomusic</span>
      </div>
      <p className="top__prompt" title={prompt ? `${clipName}: ${prompt}` : clipName}>
        <span className="visually-hidden">Clip: </span>
        <span className="top__clip score-text">{clipName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}</span>
        {prompt && <span className="top__steer score-text">“{prompt}”</span>}
      </p>
      <div className="top__right">
        <ModelBadge />
        <AudioBadge />
        <ConnBadge />
        {ready && (
          <button type="button" className={`btn${playing ? '' : ' btn--primary'}`} onClick={() => controller.togglePlay()}>
            {playing ? 'Pause' : 'Play'} <kbd>Space</kbd>
          </button>
        )}
        {stoppable && (
          <button type="button" className="btn" onClick={() => controller.stop()}>
            Stop <kbd>Esc</kbd>
          </button>
        )}
        <button type="button" className="btn" onClick={() => controller.reset()}>
          New clip
        </button>
      </div>
    </header>
  );
});

/** Who is answering. A stand-in is never dressed up as the real model. */
export const ModelBadge = memo(function ModelBadge() {
  const session = useSel((s) => s.session);
  const health = useSel((s) => s.health);
  const mock = useSel((s) => s.conn === 'mock');
  if (mock) {
    return (
      <span className="badge badge--standin" role="status">
        <strong>Scripted</strong>
        <span>mock run, not Drex</span>
      </span>
    );
  }
  // Before a run, the server's health check says who will answer.
  const standin = session ? session.standin : health?.ok ? health.standin : null;
  const model = session?.model ?? health?.model ?? '';
  if (standin === null) return null;
  if (standin) {
    return (
      <span className="badge badge--standin" role="status">
        <strong>Stand-in</strong>
        <span>— no Drex key</span>
      </span>
    );
  }
  return (
    <span className="badge badge--model">
      <strong>{modelBadge(model)}</strong>
    </span>
  );
});

const AudioBadge = memo(function AudioBadge() {
  const mode = useSel((s) => s.audio.mode);
  if (mode === 'real') return null;
  if (mode === 'pending') {
    return (
      <span className="badge">
        <span>Audio loading</span>
      </span>
    );
  }
  return (
    <span className="badge badge--standin" role="status" title="The audio engine could not start. The playhead is running on a timer.">
      <strong>Silent</strong>
      <span>no audio engine</span>
    </span>
  );
});

export const ConnBadge = memo(function ConnBadge() {
  const conn = useSel((s) => s.conn);
  const label = conn === 'open' ? 'Live' : conn === 'mock' ? 'Mock feed' : conn === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className={`conn conn--${conn}`} role="status">
      <i aria-hidden="true" />
      {label}
    </span>
  );
});
