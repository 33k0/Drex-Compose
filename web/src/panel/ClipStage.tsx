import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ClipListing } from '../../../shared/choreo';
import {
  VIDEO_ACCEPT, fetchClips, forgetMedia, isVideoFile, keepLocalFile, previewSource, uploadClip,
} from '../clips';
import { controller } from '../controller';
import { useSel } from '../store';
import { ConnBadge, ModelBadge } from './Header';
import './clipStage.css';

/** A tap sequence restarts after a pause this long, or when the preview loops back. */
const TAP_GAP_SEC = 2.5;
const MIN_TAPS = 4;

interface Tap { bpm: number; offsetSec: number }

/** BPM from the median interval between taps, offset at the first tap. Null under four taps. */
function tapTempo(times: number[]): Tap | null {
  if (times.length < MIN_TAPS) return null;
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0.15).sort((a, b) => a - b);
  if (gaps.length < MIN_TAPS - 1) return null;
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return { bpm: Math.round(600 / median) / 10, offsetSec: Math.round(times[0] * 1000) / 1000 };
}

/** What was chosen last, so "New clip" comes back with it still selected. */
let lastChoice: { clip: string | null; prompt: string } = { clip: null, prompt: '' };

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Choose a clip (or drop one in), optionally steer the style, and send it to Drex. */
export const ClipStage = memo(function ClipStage() {
  const conn = useSel((s) => s.conn);
  const audio = useSel((s) => s.audio.mode);
  const [clips, setClips] = useState<ClipListing[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(lastChoice.clip);
  const [prompt, setPrompt] = useState(lastChoice.prompt);
  const [upload, setUpload] = useState<{ name: string; fraction: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  /** Bumped after an upload, so the preview picks up the dropped file even under the same name. */
  const [uploads, setUploads] = useState(0);
  const preview = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async (select?: string) => {
    try {
      const list = await fetchClips(controller.mock);
      setClips(list);
      setListError(null);
      setSelected((cur) => select ?? (cur && list.some((c) => c.file === cur) ? cur : list[0]?.file ?? null));
    } catch {
      setListError('The server did not answer. Start it with npm run dev, then this list fills in.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Retry the listing once the socket connects (the server may have started after the page).
  useEffect(() => {
    if (conn === 'open' && listError) void refresh();
  }, [conn, listError, refresh]);

  // A different clip: its own taps.
  useEffect(() => setTaps([]), [selected]);

  const tap = tapTempo(taps);

  const score = useCallback(() => {
    if (!selected || upload) return;
    lastChoice = { clip: selected, prompt };
    controller.scoreClip({ clip: selected, prompt, tap });
  }, [selected, prompt, tap, upload]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    score();
  };

  const accept = useCallback(async (file: File) => {
    setUploadError(null);
    if (!isVideoFile(file)) {
      setUploadError(`${file.name} is not a video file.`);
      return;
    }
    if (controller.mock) {
      setUploadError('Mock mode: uploads go to the real server only.');
      return;
    }
    setUpload({ name: file.name, fraction: 0 });
    try {
      const stored = await uploadClip(file, (fraction) => setUpload({ name: file.name, fraction }));
      keepLocalFile(stored, file);
      setUploads((n) => n + 1);
      await refresh(stored);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUpload(null);
    }
  }, [refresh]);

  // Keys on the clip stage: Enter scores, Space plays the preview, T taps the tempo (hidden).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const video = preview.current;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (e.shiftKey) {
          setTaps([]);
          return;
        }
        if (!video || video.paused) return;
        const t = video.currentTime;
        setTaps((prev) => {
          const last = prev[prev.length - 1];
          if (last === undefined || t - last > TAP_GAP_SEC || t <= last) return [t];
          return [...prev, t].slice(-16);
        });
      } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLVideoElement)) {
        // (A focused button or the video's own controls handle Space themselves.)
        e.preventDefault();
        if (video) {
          if (video.paused) void video.play().catch(() => {});
          else video.pause();
        }
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        score();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [score]);

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void accept(file);
  };

  const note = conn === 'mock'
    ? 'Mock feed: a scripted replay of a real run, not the real Drex.'
    : conn === 'open'
      ? null
      : 'Waiting for the server. The clip will be sent as soon as it connects.';
  const current = clips?.find((c) => c.file === selected) ?? null;

  return (
    <div
      className={`stage${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="stage__main">
        <div className="stage__brand">
          Drex <span>Choreomusic</span>
        </div>
        <h1 className="stage__title">What should Drex score?</h1>
        <p className="stage__lede">
          Drex cannot write a word or hear a sound. It watches a muted clip one second at a time, answers multiple-choice questions about it, and every answer becomes a rule, a note or a rejected draft.
        </p>

        <div className="stage__clips">
          <span className="stage__label" id="clips-label">Clip</span>
          {listError && <p className="stage__warn">{listError}</p>}
          <ul className="cards scroll" aria-labelledby="clips-label">
            {(clips ?? []).map((c) => (
              <li key={c.file}>
                <button
                  type="button"
                  className={`card${c.file === selected ? ' is-selected' : ''}`}
                  aria-pressed={c.file === selected}
                  onClick={() => setSelected(c.file)}
                >
                  <span className="card__name score-text">{c.name}</span>
                  <span className="card__meta">
                    <span className="mono">{c.file}</span>
                    <span className="mono">{c.sizeMb} MB</span>
                  </span>
                </button>
              </li>
            ))}
            <li>
              <label className={`card card--drop${upload ? ' is-busy' : ''}`}>
                <input
                  type="file"
                  accept={VIDEO_ACCEPT}
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void accept(file);
                  }}
                />
                {upload ? (
                  <>
                    <span className="card__name score-text">Uploading</span>
                    <span className="card__meta">
                      <span className="mono">{upload.name}</span>
                      <span className="mono">{Math.round(upload.fraction * 100)}%</span>
                    </span>
                    <span className="card__progress" aria-hidden="true">
                      <span style={{ transform: `scaleX(${upload.fraction})` }} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="card__name score-text">Another clip</span>
                    <span className="card__meta">drop a video file here, or choose one</span>
                  </>
                )}
              </label>
            </li>
          </ul>
          {uploadError && <p className="stage__warn">{uploadError}</p>}
        </div>

        <form className="stage__form" onSubmit={submit}>
          <label htmlFor="prompt" className="stage__label">Style <span>optional</span></label>
          <div className="stage__row">
            <input
              id="prompt"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="optional: steer the style"
              autoComplete="off"
              spellCheck={false}
              maxLength={240}
            />
            <button type="submit" className="btn btn--primary stage__go" disabled={!selected || Boolean(upload)}>
              Score it <kbd>Enter</kbd>
            </button>
          </div>
        </form>

        <div className="stage__foot">
          <ConnBadge />
          <ModelBadge />
          {audio === 'pending' && <span>Audio engine loading</span>}
          {audio === 'silent' && <span className="stage__warn">Audio engine unavailable: the panel will run silently</span>}
          {note && <span>{note}</span>}
        </div>
      </div>

      <aside className="stage__side" aria-label="Preview">
        <Preview key={`${selected ?? 'none'}-${uploads}`} file={selected} name={current?.name ?? null} videoRef={preview} taps={taps.length} tap={tap} />
      </aside>
    </div>
  );
});

interface PreviewProps {
  file: string | null;
  name: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  taps: number;
  tap: Tap | null;
}

/** The selected clip, muted, small. Also where the tempo tap listens (T, while it plays): the override for a beat Drex cannot find. */
const Preview = memo(function Preview({ file, name, videoRef, taps, tap }: PreviewProps) {
  const [source] = useState(() => (file ? previewSource(file) : null));
  const [failed, setFailed] = useState(false);

  const usable = source && !failed;
  return (
    <div className="preview">
      <div className="preview__screen">
        {usable ? (
          <video
            ref={videoRef}
            src={source.url}
            muted
            loop
            playsInline
            controls
            preload="metadata"
            onError={() => {
              setFailed(true);
              // A remembered server URL that no longer loads (the server restarted) is dropped.
              if (file && source.kind === 'server' && !controller.mock) forgetMedia(file);
            }}
          />
        ) : (
          <div className="preview__none">
            <span className="score-text">{file ? 'No preview yet' : 'No clip selected'}</span>
            {file && <span>The server shows a clip once it has prepared it. Drop the file here to preview it now, or just score it.</span>}
          </div>
        )}
        {taps > 0 && (
          <span className="preview__tap mono" aria-hidden="true">
            tap {tap ? Math.round(tap.bpm) : '·'.repeat(Math.min(3, taps))}
          </span>
        )}
      </div>
      <p className="preview__caption">
        <span className="score-text">{name ?? ''}</span>
        {usable && <span>muted preview · <kbd>T</kbd> while it plays taps the beat</span>}
      </p>
    </div>
  );
});
