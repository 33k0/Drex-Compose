// One shared requestAnimationFrame loop. Components that follow the playhead or the layer
// levels subscribe here and write straight to the DOM through refs, so nothing per-frame
// passes through React state.

import { useEffect, useRef, useState } from 'react';

type FrameFn = (timeMs: number) => void;

const subscribers = new Set<FrameFn>();
let handle = 0;

function loop(timeMs: number): void {
  for (const fn of subscribers) fn(timeMs);
  handle = subscribers.size > 0 ? requestAnimationFrame(loop) : 0;
}

export function useFrame(callback: FrameFn): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const fn: FrameFn = (t) => latest.current(t);
    subscribers.add(fn);
    if (!handle) handle = requestAnimationFrame(loop);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** prefers-reduced-motion, following the setting if it changes while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
