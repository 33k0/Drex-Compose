// The clip library and the media URLs: listing and uploading video files, the preview source for
// a clip on the clip stage, and frame URLs.

import type { ClipInfo, ClipListing } from '../../shared/choreo';
import type { Health } from './state';

/** Used by ?mock=1 when the server is not running. */
const MOCK_CLIPS: ClipListing[] = [{ name: 'firestarter choreo', file: 'firestarter-choreo.mp4', sizeMb: 12.7 }];

export const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.webm,.mkv,.m4v,.avi';
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name);
}

export async function fetchClips(mock: boolean): Promise<ClipListing[]> {
  try {
    const res = await fetch('/api/clips');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as ClipListing[];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (mock) return MOCK_CLIPS;
    throw err;
  }
}

export async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { standin?: boolean; model?: string };
    return { ok: true, standin: Boolean(body.standin), model: String(body.model ?? '') };
  } catch {
    return { ok: false, standin: true, model: '' };
  }
}

/** POST the raw file; resolves with the file name the server stored it under. */
export function uploadClip(file: File, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/clips?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { file?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) resolve(body.file);
      else reject(new Error(body.error ?? `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: the server did not answer'));
    xhr.send(file);
  });
}

// ───────────────────────────── Preview sources ─────────────────────────────
// The server only serves a clip's video once a run has prepared it (/media/<id>/video). So the
// preview on the clip stage uses, in order: the file itself when it was dropped in this browser
// session, or the media URL remembered from an earlier run of that file on this server.

const STORE_KEY = 'drex-choreomusic.media';
const objectUrls = new Map<string, string>();

function remembered(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function keepLocalFile(serverFile: string, file: File): void {
  const old = objectUrls.get(serverFile);
  if (old) URL.revokeObjectURL(old);
  objectUrls.set(serverFile, URL.createObjectURL(file));
}

export function rememberMedia(serverFile: string, videoUrl: string): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...remembered(), [serverFile]: videoUrl }));
  } catch { /* storage unavailable: the preview just will not be remembered */ }
}

export function forgetMedia(serverFile: string): void {
  try {
    const all = remembered();
    delete all[serverFile];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function previewSource(serverFile: string): { url: string; kind: 'local' | 'server' } | null {
  const local = objectUrls.get(serverFile);
  if (local) return { url: local, kind: 'local' };
  // The server streams any listed file directly, so a preview (and the tempo tap) never depends on
  // an earlier run. In mock mode there is no server and no preview.
  if (new URLSearchParams(location.search).has('mock')) {
    const url = remembered()[serverFile];
    return url ? { url, kind: 'server' } : null;
  }
  return { url: `/api/clips/${encodeURIComponent(serverFile)}`, kind: 'server' };
}

// ───────────────────────────── Frames ─────────────────────────────

/** URL of frame i, or null when there is no server to fetch it from (placeholders instead). */
export function frameSrc(clip: ClipInfo | null, i: number, mediaOk: boolean): string | null {
  if (!clip || !mediaOk || i < 0 || i >= clip.frameCount) return null;
  return clip.frameUrl.replace('{i}', String(i));
}

/** Frame i shows time (i + 0.5) / 6 s. */
export const FPS = 6;
export const middleFrame = (second: number): number => second * FPS + 3;
