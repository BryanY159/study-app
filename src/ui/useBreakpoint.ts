import { useSyncExternalStore } from 'react';

// One place that decides phone / tablet / laptop, so layout logic isn't scattered.
// Breakpoints: phone < 640px · tablet 640–1023px · laptop ≥ 1024px.
// Most layout is plain CSS media queries; this hook is for structure that differs
// (which navigation to render). Without matchMedia (tests) it's 'laptop'.

export type Breakpoint = 'phone' | 'tablet' | 'laptop';

export const PHONE_MAX = 639;
export const TABLET_MAX = 1023;

export function breakpointFor(width: number): Breakpoint {
  return width <= PHONE_MAX ? 'phone' : width <= TABLET_MAX ? 'tablet' : 'laptop';
}

const QUERIES = [`(max-width: ${PHONE_MAX}px)`, `(max-width: ${TABLET_MAX}px)`];

function current(): Breakpoint {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'laptop';
  if (window.matchMedia(QUERIES[0]).matches) return 'phone';
  if (window.matchMedia(QUERIES[1]).matches) return 'tablet';
  return 'laptop';
}

function subscribe(fn: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const lists = QUERIES.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener('change', fn);
  return () => lists.forEach((l) => l.removeEventListener('change', fn));
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => 'laptop');
}
