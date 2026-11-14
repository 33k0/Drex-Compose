// The video clock. The music follows it (engine.playSynced reads now() and playing()), the panel
// follows it per frame (now marker, frame strip, readings readout) and the live read follows it
// once a second. Normally it is the <video> element; when there is no playable video (mock mode
// without the server, or the video fails to load) a wall-clock stand-in takes its place so the
// views still move.

type ClockEvent = 'play' | 'pause' | 'seeked' | 'ended' | 'source';

export interface MediaClock {
  now(): number;
  playing(): boolean;
  duration(): number;
  play(): void;
  pause(): void;
  seek(sec: number): void;
}

class FakeClock implements MediaClock {
  private base = 0;
  private startedAt: number | null = null;
  private timer: number | null = null;
  constructor(private length: number, private onEnded: () => void) {}

  now(): number {
    if (this.startedAt === null) return this.base;
    return Math.min(this.length, this.base + (performance.now() - this.startedAt) / 1000);
  }
  playing(): boolean {
    return this.startedAt !== null;
  }
  duration(): number {
    return this.length;
  }
  play(): void {
    if (this.startedAt !== null) return;
    if (this.base >= this.length - 0.05) this.base = 0;
    this.startedAt = performance.now();
    this.arm();
  }
  pause(): void {
    if (this.startedAt === null) return;
    this.base = this.now();
    this.startedAt = null;
    this.disarm();
  }
  seek(sec: number): void {
    const playing = this.playing();
    this.base = Math.max(0, Math.min(this.length, sec));
    if (playing) {
      this.startedAt = performance.now();
      this.arm();
    }
  }
  dispose(): void {
    this.disarm();
    this.startedAt = null;
  }
  private arm(): void {
    this.disarm();
    const left = Math.max(0, this.length - this.now());
    this.timer = window.setTimeout(() => {
      this.base = this.length;
      this.startedAt = null;
      this.timer = null;
      this.onEnded();
    }, left * 1000);
  }
  private disarm(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

class VideoClock implements MediaClock {
  constructor(readonly el: HTMLVideoElement, private fallbackDuration: number) {}
  now(): number {
    return this.el.currentTime;
  }
  playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }
  duration(): number {
    const d = this.el.duration;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }
  play(): void {
    if (this.el.ended) this.el.currentTime = 0;
    this.el.play().catch((err) => console.warn('[panel] video would not play:', err));
  }
  pause(): void {
    this.el.pause();
  }
  seek(sec: number): void {
    this.el.currentTime = Math.max(0, Math.min(this.duration(), sec));
  }
}

const VIDEO_EVENTS: ClockEvent[] = ['play', 'pause', 'seeked', 'ended'];

/** The one clock everything reads. Its source can change (video attached, video failed). */
class ClockHub implements MediaClock {
  private source: MediaClock | null = null;
  private fake: FakeClock | null = null;
  private detachVideo: (() => void) | null = null;
  private listeners = new Set<(e: ClockEvent) => void>();
  /** Clip length, used by the stand-in clock and before the video knows its own duration. */
  private length = 0;

  /** 'video' when a real <video> drives the clock, 'fake' for the wall-clock stand-in. */
  kind(): 'video' | 'fake' | 'none' {
    if (!this.source) return 'none';
    return this.source === this.fake ? 'fake' : 'video';
  }

  setLength(sec: number): void {
    this.length = sec;
  }

  attachVideo(el: HTMLVideoElement): void {
    this.release();
    const clock = new VideoClock(el, this.length);
    const handlers = VIDEO_EVENTS.map((type) => {
      const fn = (): void => this.emit(type);
      el.addEventListener(type, fn);
      return [type, fn] as const;
    });
    this.detachVideo = () => handlers.forEach(([type, fn]) => el.removeEventListener(type, fn));
    this.source = clock;
    this.emit('source');
  }

  /** No playable video: run a silent wall clock over the clip's length instead. */
  useFake(startAt = 0): void {
    this.release();
    this.fake = new FakeClock(this.length || 60, () => this.emit('ended'));
    this.fake.seek(startAt);
    this.source = this.fake;
    this.emit('source');
  }

  detach(): void {
    const was = this.source !== null;
    this.release();
    if (was) this.emit('source');
  }

  private release(): void {
    this.detachVideo?.();
    this.detachVideo = null;
    this.fake?.dispose();
    this.fake = null;
    this.source = null;
  }

  on(cb: (e: ClockEvent) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(e: ClockEvent): void {
    for (const cb of [...this.listeners]) cb(e);
  }

  now(): number {
    return this.source?.now() ?? 0;
  }
  playing(): boolean {
    return this.source?.playing() ?? false;
  }
  duration(): number {
    return this.source?.duration() ?? this.length;
  }
  play(): void {
    if (!this.source) return;
    this.source.play();
    if (this.source === this.fake) this.emit('play');
  }
  pause(): void {
    if (!this.source) return;
    this.source.pause();
    if (this.source === this.fake) this.emit('pause');
  }
  seek(sec: number): void {
    if (!this.source) return;
    this.source.seek(sec);
    if (this.source === this.fake) this.emit('seeked');
  }
}

export const clock = new ClockHub();
