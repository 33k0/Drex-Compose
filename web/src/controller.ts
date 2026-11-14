// Run orchestration: the one place where the socket (or mock feed), the audio engine and the
// store meet. Components call compose() / stop(); everything else is event plumbing.

import type { ClientEvent, ServerEvent } from '../../shared/types';
import { engineRef, loadRealEngine, type EngineLike } from './engineBridge';
import { FakeEngine } from './fakeEngine';
import type { Conn, EngineEvent } from './state';
import { store } from './store';
import { createMockTransport, createReplayTransport, createSocketTransport, isMockMode, replayName, type Transport } from './transport';

class Controller {
  private transport: Transport | null = null;
  private engine: EngineLike | null = null;
  private engineReady: Promise<EngineLike> | null = null;
  /** Bumped on every compose() and stop(); engine work queued for an older run is dropped. */
  private run = 0;
  private queued = 0;
  private finalQueued = false;
  private instrumentsReady = false;
  private started = false;
  private booted = false;

  /** Idempotent: safe under React StrictMode's double mount. */
  boot(): void {
    if (this.booted) return;
    this.booted = true;

    const handlers = {
      onEvent: (e: ServerEvent) => this.onServerEvent(e),
      onConn: (conn: Conn) => store.dispatch({ type: 'local/conn', conn }),
    };
    const replay = replayName();
    this.transport = replay
      ? createReplayTransport(replay, handlers)
      : isMockMode() ? createMockTransport(handlers) : createSocketTransport(handlers);

    this.engineReady = loadRealEngine()
      .then((engine) => {
        store.dispatch({ type: 'local/audio', mode: 'real' });
        return engine;
      })
      .catch((err: unknown) => {
        console.warn('[panel] audio engine unavailable, running a silent playhead instead:', err);
        store.dispatch({ type: 'local/audio', mode: 'silent' });
        return new FakeEngine() as EngineLike;
      })
      .then((engine) => {
        this.engine = engine;
        engineRef.current = engine;
        engine.on((e) => this.onEngineEvent(e));
        return engine;
      });
  }

  /** Must be called from the user gesture (click or Enter) so the browser lets audio start. */
  compose(prompt: string): void {
    const text = prompt.trim();
    if (!text) return;
    const phase = store.getState().phase;
    if (phase === 'running' || phase === 'starting') this.send({ type: 'stop' });

    this.run += 1;
    this.resetRunFlags();
    // Unlock inside the gesture when the engine already exists; otherwise as soon as it does.
    if (this.engine) {
      this.safely(() => this.engine!.stop());
      this.engine.unlock().catch((err) => console.warn('[panel] audio unlock failed:', err));
    } else {
      this.engineReady?.then((e) => e.unlock()).catch((err) => console.warn('[panel] audio unlock failed:', err));
    }
    store.dispatch({ type: 'local/compose', prompt: text });
    this.send({ type: 'start', prompt: text });
  }

  stop(): void {
    const phase = store.getState().phase;
    if (phase !== 'running' && phase !== 'starting') return;
    this.run += 1;
    this.resetRunFlags();
    this.send({ type: 'stop' });
    if (this.engine) this.safely(() => this.engine!.stop());
    store.dispatch({ type: 'local/stopped' });
  }

  private resetRunFlags(): void {
    this.queued = 0;
    this.finalQueued = false;
    this.instrumentsReady = false;
    this.started = false;
  }

  private send(event: ClientEvent): void {
    this.transport?.send(event);
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn('[panel] audio engine call failed:', err);
    }
  }

  /** Run an engine call now, or once the engine exists, unless the run has moved on. */
  private withEngine(fn: (engine: EngineLike) => void): void {
    const run = this.run;
    if (this.engine) {
      this.safely(() => fn(this.engine!));
      return;
    }
    this.engineReady?.then((engine) => {
      if (run === this.run) this.safely(() => fn(engine));
    });
  }

  private onServerEvent(event: ServerEvent): void {
    const before = store.getState().phase;
    store.dispatch(event);
    const phase = store.getState().phase;
    // A fatal server error ends the run: stop the music rather than play on unobserved.
    if (before === 'running' && phase === 'error') {
      this.run += 1;
      if (this.engine) this.safely(() => this.engine!.stop());
    }
    // The reducer ignores events that are not part of the live run; so must the engine.
    if (phase !== 'running') return;

    switch (event.type) {
      case 'rules': {
        const run = this.run;
        const palette = event.rules.palette;
        // The engine reports progress in sample files, and only once it knows how many.
        let files = 0;
        store.dispatch({ type: 'local/instruments', loaded: 0, total: 0, ready: false });
        this.withEngine((engine) => {
          engine.setSoundWorld(event.rules.soundWorld);
          engine
            .loadInstruments(palette, (loaded, total) => {
              files = total;
              if (run === this.run) store.dispatch({ type: 'local/instruments', loaded, total, ready: false });
            })
            .catch((err) => {
              // Missing samples should not strand the run: play with whatever did load.
              console.warn('[panel] instrument loading failed:', err);
            })
            .then(() => {
              if (run !== this.run) return;
              this.instrumentsReady = true;
              store.dispatch({ type: 'local/instruments', loaded: files, total: files, ready: true });
              this.maybeStart();
            });
        });
        break;
      }
      case 'phrase':
        this.queued += 1;
        if (event.score.final) this.finalQueued = true;
        this.withEngine((engine) => {
          engine.enqueue(event.score);
          this.maybeStart();
        });
        break;
      case 'hold_update':
        this.withEngine((engine) => engine.applyHold(event.update));
        break;
      default:
        break;
    }
  }

  /** Playback begins once the instruments are in and two phrases (or the only one) are queued. */
  private maybeStart(): void {
    if (this.started || !this.engine || !this.instrumentsReady) return;
    if (this.queued < 2 && !this.finalQueued) return;
    this.started = true;
    this.safely(() => this.engine!.start());
    store.dispatch({ type: 'local/playback_started' });
  }

  private onEngineEvent(event: EngineEvent): void {
    if (store.getState().phase !== 'running') return;
    store.dispatch({ type: 'local/engine', event });
    if (event.type === 'phrase_started') this.send({ type: 'phrase_started', index: event.index });
    else if (event.type === 'hold_started') this.send({ type: 'hold_started', afterIndex: event.afterIndex });
    else if (event.type === 'hold_ended') this.send({ type: 'hold_ended' });
  }
}

export const controller = new Controller();
