import { memo, useEffect, useState } from 'react';
import { controller } from '../controller';
import { deskView, type DeskView } from '../state';
import { store, useSel } from '../store';
import { ClipStage } from './ClipStage';
import { ClipTimeline } from './ClipTimeline';
import { DecisionPanel } from './DecisionPanel';
import { DraftsPanel } from './DraftsPanel';
import { Header } from './Header';
import { LayersPanel } from './LayersPanel';
import { LineagePanel } from './LineagePanel';
import { RulesStrip } from './RulesStrip';
import { StatusStrip } from './StatusStrip';
import { BeatPanel, SectionsPanel } from './BeatPanel';
import { VideoStage } from './VideoStage';
import { ContactSheet, Watching } from './Watching';
import './app.css';

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  const view = useSel(deskView);

  // Desk keys. The clip stage handles its own (Enter, Space for the preview, T).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const s = store.getState();
      const current = deskView(s);
      if (e.key === 'Escape') {
        // Stop first, back to the clip stage on the second press. During playback "stop" is the
        // video: the composed piece stays playable until you go back.
        if (current === 'playback') {
          if (s.playing) controller.pause();
          else controller.reset();
        } else if (s.phase === 'running' || s.phase === 'starting') {
          controller.stop();
        } else if (current !== 'clip') {
          controller.reset();
        }
        e.preventDefault();
        return;
      }
      if (current !== 'playback') return;
      if (e.key === ' ') {
        controller.togglePlay();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        controller.seekBy(e.key === 'ArrowLeft' ? -5 : 5);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" data-view={view}>
      {view === 'clip' ? <ClipStage /> : <Desk view={view} />}
    </div>
  );
}

const Desk = memo(function Desk({ view }: { view: Exclude<DeskView, 'clip'> }) {
  const hasPhrases = useSel((s) => s.composedThrough >= 0);

  if (view === 'prescan') {
    return (
      <div className="desk desk--prescan">
        <Header />
        <main className="desk__main">
          <Watching />
          <DecisionPanel />
        </main>
        <ContactSheet />
        <StatusStrip />
      </div>
    );
  }

  if (view === 'composing') {
    return (
      <div className="desk desk--composing">
        <Header />
        <RulesStrip />
        <main className="desk__main">
          <DecisionPanel />
          <div className={`desk__mid${hasPhrases ? ' has-lineage' : ''}`}>
            <DraftsPanel />
            {hasPhrases && <LineagePanel />}
          </div>
          <div className="desk__side">
            <BeatPanel />
            <SectionsPanel />
          </div>
        </main>
        <ClipTimeline />
        <StatusStrip />
      </div>
    );
  }

  return (
    <div className="desk desk--playback">
      <Header />
      <main className="desk__main">
        <VideoStage />
        <DecisionPanel />
        <div className="desk__side">
          <LayersPanel />
          <DeskTabs />
        </div>
      </main>
      <ClipTimeline />
      <StatusStrip />
    </div>
  );
});

/** During playback the video and the timeline matter most: lineage and drafts share one slot. */
const DeskTabs = memo(function DeskTabs() {
  const [tab, setTab] = useState<'lineage' | 'drafts'>('lineage');
  return (
    <div className="tabs">
      <div className="tabs__bar" role="tablist" aria-label="Lineage or drafts">
        {(['lineage', 'drafts'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tabs__tab${tab === t ? ' is-on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'lineage' ? 'Lineage' : 'Drafts and the judge'}
          </button>
        ))}
      </div>
      <div className="tabs__body" role="tabpanel">
        {tab === 'lineage' ? <LineagePanel /> : <DraftsPanel />}
      </div>
    </div>
  );
});
