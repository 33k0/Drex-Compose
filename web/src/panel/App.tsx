import { useCallback, useEffect, useState } from 'react';
import { controller } from '../controller';
import { store, useSel } from '../store';
import { Backdrop } from './Backdrop';
import { DecisionPanel } from './DecisionPanel';
import { DraftsPanel } from './DraftsPanel';
import { Header } from './Header';
import { LayersPanel } from './LayersPanel';
import { LineagePanel } from './LineagePanel';
import { PromptStage } from './PromptStage';
import { RulesStrip } from './RulesStrip';
import { StatusStrip } from './StatusStrip';
import { Timeline } from './Timeline';
import './app.css';

export function App() {
  const phase = useSel((s) => s.phase);
  const hasPhrases = useSel((s) => s.composedThrough >= 0);
  const [promptOpen, setPromptOpen] = useState(false);

  const idle = phase === 'idle';
  const stageOpen = idle || promptOpen;

  const compose = useCallback((prompt: string) => {
    controller.compose(prompt);
    setPromptOpen(false);
  }, []);
  const openPrompt = useCallback(() => setPromptOpen(true), []);
  const closePrompt = useCallback(() => setPromptOpen(false), []);
  const stop = useCallback(() => controller.stop(), []);

  // Esc closes the prompt overlay if a run is behind it; otherwise it stops the run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const current = store.getState().phase;
      if (promptOpen && current !== 'idle') {
        setPromptOpen(false);
        e.preventDefault();
      } else if (current === 'running' || current === 'starting') {
        controller.stop();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promptOpen]);

  return (
    <div className="app" data-phase={phase}>
      <Backdrop />
      {!idle && (
        <div className="desk" aria-hidden={promptOpen || undefined} inert={promptOpen || undefined}>
          <Header onStop={stop} onNewPrompt={openPrompt} />
          <RulesStrip />
          <main className="desk__main">
            <DecisionPanel />
            <div className={`desk__mid${hasPhrases ? ' has-lineage' : ''}`}>
              <DraftsPanel />
              {hasPhrases && <LineagePanel />}
            </div>
            <LayersPanel onNewPrompt={openPrompt} />
          </main>
          <Timeline />
          <StatusStrip />
        </div>
      )}
      {stageOpen && <PromptStage overlay={!idle} onSubmit={compose} onClose={closePrompt} />}
    </div>
  );
}
