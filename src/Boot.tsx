import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pack } from './pack/schema';
import { AppProvider } from './state/AppProvider';
import type { ShareEnv } from './storage/backup';
import type { DataStore, MetaStore } from './storage/DataStore';
import { migrateLegacy } from './storage/legacy';
import type { StorageManagerLike } from './storage/persist';
import { SafeStore } from './storage/SafeStore';
import { TabLock, type LockManagerLike } from './storage/tabLock';
import { App } from './ui/App';
import { ErrorBoundary, StartupError } from './ui/screens/StartupError';

// Startup, in order, with the page already showing something at each step:
//   1. open the IndexedDB store (fails if the browser blocks it → error screen)
//   2. take the one-tab lock (another tab has it → "already open" screen)
//   3. move pre-v1.5 localStorage data into IndexedDB, once (a failure is logged and retried next start)
//   4. AppProvider loads the data (fails or times out → error screen)

export interface BootDeps {
  bundledPacks: Pack[];
  openStore: () => Promise<DataStore & MetaStore>;
  /** Where v1.4 kept progress and flags; null if blocked. */
  legacyStorage: () => Storage | null;
  locks: LockManagerLike | null;
  storageManager?: StorageManagerLike | null;
  shareEnv?: ShareEnv;
  now?: () => Date;
  /** Tests pass these to skip IndexedDB. */
  loadImported?: () => Promise<Pack[]>;
  saveImported?: (p: Pack) => Promise<void>;
}

type Phase = { kind: 'starting' } | { kind: 'other-tab' } | { kind: 'ready'; store: SafeStore; meta: MetaStore; run: number } | { kind: 'error'; error: unknown };

export function Boot({ deps }: { deps: BootDeps }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const lock = useRef(new TabLock(deps.locks));
  const current = useRef<SafeStore | null>(null);
  const runs = useRef(0);

  const start = useCallback(
    async (steal: boolean) => {
      setPhase({ kind: 'starting' });
      try {
        const raw = await deps.openStore();
        const got = await lock.current.acquire(steal, () => {
          // Another tab took over: stop saving here.
          current.current?.close();
          current.current = null;
          setPhase({ kind: 'other-tab' });
        });
        if (!got) return setPhase({ kind: 'other-tab' });
        const store = new SafeStore(raw);
        current.current = store;
        await migrateLegacy(store, raw, deps.legacyStorage(), deps.now).catch((e) => console.error('Moving the older saved data failed; retrying next start', e));
        setPhase({ kind: 'ready', store, meta: raw, run: ++runs.current });
      } catch (e) {
        setPhase({ kind: 'error', error: e });
      }
    },
    [deps],
  );

  useEffect(() => {
    void start(false);
    const l = lock.current;
    return () => l.releaseLock();
  }, [start]);

  if (phase.kind === 'error') return <StartupError title="The app couldn't start" error={phase.error} onRetry={() => void start(false)} />;
  if (phase.kind === 'other-tab') return <OtherTab onTakeOver={() => void start(true)} />;
  if (phase.kind === 'starting') return <div className="empty">Starting…</div>;
  return (
    <ErrorBoundary key={phase.run}>
      <AppProvider
        store={phase.store}
        meta={phase.meta}
        bundledPacks={deps.bundledPacks}
        loadImported={deps.loadImported}
        saveImported={deps.saveImported}
        storageManager={deps.storageManager}
        shareEnv={deps.shareEnv}
        now={deps.now}
      >
        <App />
      </AppProvider>
    </ErrorBoundary>
  );
}

function OtherTab({ onTakeOver }: { onTakeOver: () => void }) {
  return (
    <main className="page narrow" data-testid="other-tab">
      <section className="card stack-lg">
        <h1>This app is already open in another tab</h1>
        <p>Only one tab can save your answers at a time, so nothing is lost. Switch to the other tab, or use this one instead (the other tab will stop saving).</p>
        <div className="row">
          <button type="button" className="btn primary big" onClick={onTakeOver}>
            Use this tab instead
          </button>
        </div>
      </section>
    </main>
  );
}
