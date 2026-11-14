// Run orchestration: the one place where the socket (or mock feed), the audio engine, the video
// clock and the store meet. Components call scoreClip() / stop() / reset() / play() / pause() /
// seek(); everything else is event plumbing.

import type { ChoreoClientEvent, ChoreoServerEvent } from '../../shared/choreo';
import { clock } from './clock';
import { fetchHealth, rememberMedia } from './clips';
import { engineRef, loadRealEngine, type EngineLike, type SyncClock } from './engineBridge';
import { FakeEngine } from './fakeEngine';
import { scoresInOrder, type Conn } from './state';
import { store } from './store';
import { createMockTransport, createSocketTransport, isMockMode, type Transport } from './transport';

/** How often the live read hears where the video is while it plays. */
const VIDEO_TIME_MS = 1000;

export interface ScoreRequest {
  /** File name in the server's clips folder. */
  clip: string;
  prompt: string;
  tap?: { bpm: number; offsetSec: number } | null;
}

/** What the engine follows: always the current clock source, whatever it is. */
const syncClock: SyncClock = {
  now: () => clock.now(),
  playing: () => clock.playing(),
};

class Controller {
  private transport: Transport | null = null;
  private engine: EngineLike | null = null;
  private engineReady: Promise<EngineLike> | null = null;
  /** Bumped on every new run, stop and reset; engine work queued for an older run is dropped. */
  private run = 0;
  /** The engine has been handed this run's piece (playSynced is called once per run). */
  private synced = false;
  private videoTimer: number | null = null;
  private booted = false;
  readonly mock = isMockMode();

  /** Idempotent: safe under React StrictMode's double mount. */
  boot(): void {
    if (this.booted) return;
    this.booted = true;

    const handlers = {
      onEvent: (e: ChoreoServerEvent) => this.onServerEvent(e),
      onConn: (conn: Conn) => {
        store.dispatch({ type: 'local/conn', conn });
        if (conn === 'open') this.checkHealth();
      },
    };
    this.transport = this.mock ? createMockTransport(handlers) : createSocketTransport(handlers);
    this.checkHealth();

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
        return engine;
      });

    clock.on((e) => this.onClock(e));
  }

  private checkHealth(): void {
    void fetchHealth().then((health) => store.dispatch({ type: 'local/health', health }));
  }

  /** Must be called from the user gesture (click or Enter) so the browser lets audio start. */
  scoreClip(req: ScoreRequest): void {
    if (!req.clip) return;
    const phase = store.getState().phase;
    if (phase === 'running' || phase === 'starting') this.send({ type: 'stop' });
    this.newRun();
    this.unlock();
    const prompt = req.prompt.trim();
    store.dispatch({ type: 'local/start', clip: req.clip, prompt });
    this.send({
      type: 'start_clip',
      clip: req.clip,
      ...(prompt ? { prompt } : {}),
      ...(req.tap ? { tap: req.tap } : {}),
    });
  }

  /** Stop the server's run. A piece that is already composed can still be played. */
  stop(): void {
    const phase = store.getState().phase;
    if (phase !== 'running' && phase !== 'starting') return;
    this.send({ type: 'stop' });
    store.dispatch({ type: 'local/stopped' });
    if (!store.getState().ready) {
      this.run += 1;
      this.halt();
    }
  }

  /** Back to the clip stage: stop everything and forget the run. */
  reset(): void {
    const phase = store.getState().phase;
    if (phase === 'running' || phase === 'starting') this.send({ type: 'stop' });
    this.newRun();
    clock.detach();
    store.dispatch({ type: 'local/reset' });
  }

  private newRun(): void {
    this.run += 1;
    this.halt();
  }

  private halt(): void {
    clock.pause();
    this.stopVideoTimer();
    this.synced = false;
    if (this.engine) this.safely(() => this.engine!.stop());
  }

  private unlock(): void {
    // Unlock inside the gesture when the engine already exists; otherwise as soon as it does.
    if (this.engine) {
      this.engine.unlock().catch((err) => console.warn('[panel] audio unlock failed:', err));
    } else {
      this.engineReady?.then((e) => e.unlock()).catch((err) => console.warn('[panel] audio unlock failed:', err));
    }
  }

  // ───────────────────────────── Playback ─────────────────────────────

  play(): void {
    const s = store.getState();
    if (!s.ready) return;
    this.unlock();
    if (!this.synced) {
      this.synced = true;
      const scores = scoresInOrder(s.phrases);
      this.withEngine((engine) => engine.playSynced(scores, syncClock));
    }
    clock.play();
  }

  pause(): void {
    clock.pause();
  }

  togglePlay(): void {
    if (clock.playing()) this.pause();
    else this.play();
  }

  seek(sec: number): void {
    if (!store.getState().ready) return;
    clock.seek(Math.max(0, Math.min(clock.duration(), sec)));
  }

  seekBy(deltaSec: number): void {
    this.seek(clock.now() + deltaSec);
  }

  private onClock(e: 'play' | 'pause' | 'seeked' | 'ended' | 'source'): void {
    if (e === 'play') {
      store.dispatch({ type: 'local/playing', playing: true });
      this.reportTime();
      this.startVideoTimer();
    } else if (e === 'pause') {
      // The video's own pause also fires at its end; 'ended' follows and settles the state.
      store.dispatch({ type: 'local/playing', playing: false });
      this.stopVideoTimer();
      this.reportTime();
    } else if (e === 'seeked') {
      this.reportTime();
    } else if (e === 'ended') {
      store.dispatch({ type: 'local/ended' });
      this.stopVideoTimer();
      this.reportTime();
    } else if (e === 'source' && !clock.playing()) {
      this.stopVideoTimer();
    }
  }

  private startVideoTimer(): void {
    this.stopVideoTimer();
    this.videoTimer = window.setInterval(() => this.reportTime(), VIDEO_TIME_MS);
  }

  private stopVideoTimer(): void {
    if (this.videoTimer !== null) window.clearInterval(this.videoTimer);
    this.videoTimer = null;
  }

  /** Tell the live read where the picture is. Only meaningful while the server's run is live. */
  private reportTime(): void {
    const s = store.getState();
    if (!s.ready || s.phase !== 'running') return;
    this.send({ type: 'video_time', sec: Math.round(clock.now() * 1000) / 1000, playing: clock.playing() });
  }

  // ───────────────────────────── Plumbing ─────────────────────────────

  private send(event: ChoreoClientEvent): void {
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

  private onServerEvent(event: ChoreoServerEvent): void {
    const before = store.getState();
    store.dispatch(event);
    const after = store.getState();
    // A fatal server error before the piece is ready ends the run.
    if (before.phase === 'running' && after.phase === 'error' && !after.ready) this.newRun();
    // The reducer ignores events that are not part of the live run; so must the engine.
    if (after.phase !== 'running') return;

    switch (event.type) {
      case 'clip': {
        clock.setLength(event.clip.durationSec);
        // The server names the clip by its file name; remember where its video lives so the
        // clip stage can preview it next time.
        if (!this.mock) rememberMedia(event.clip.name, event.clip.videoUrl);
        break;
      }
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
              if (run === this.run) store.dispatch({ type: 'local/instruments', loaded: files, total: files, ready: true });
            });
        });
        break;
      }
      case 'live': {
        if (!this.synced) break;
        const cue = event.cue;
        this.withEngine((engine) => {
          if (cue.accent) engine.scheduleAt?.(cue.atSec, cue.accent.notes, cue.accent.bpm);
          if (cue.nudge) engine.nudge?.(cue.nudge, cue.nudge.overSec);
        });
        break;
      }
      default:
        break;
    }
  }
}

export const controller = new Controller();
