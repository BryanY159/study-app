// New-version handling. A new service worker waits until she taps Reload on the
// update banner. The banner shows only on Home, so a drill, mock exam or card
// session is never interrupted; if an update arrives mid-session it waits there.

/** Where the update state comes from: the real service worker (register.ts) or a fake in tests. */
export interface UpdateSource {
  /** True once a new version is installed and waiting. */
  needRefresh(): boolean;
  subscribe(fn: () => void): () => void;
  /** Activate the waiting version and reload the page. */
  apply(): Promise<void>;
}

/** No service worker (unsupported, or tests that don't care): never an update. */
export const noUpdates: UpdateSource = {
  needRefresh: () => false,
  subscribe: () => () => {},
  apply: async () => {},
};

/** A controllable source for tests and for register.ts. */
export function updateSource(apply: () => Promise<void> = async () => {}): UpdateSource & { setNeedRefresh(v: boolean): void } {
  let need = false;
  const fns = new Set<() => void>();
  return {
    needRefresh: () => need,
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    apply,
    setNeedRefresh(v) {
      need = v;
      for (const fn of fns) fn();
    },
  };
}

/** Show the banner only on Home, and not once she chose "Later" this run. */
export function shouldShowUpdate(a: { needRefresh: boolean; path: string; dismissed: boolean }): boolean {
  return a.needRefresh && !a.dismissed && (a.path === '/' || a.path === '');
}
