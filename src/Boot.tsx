import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pack } from './pack/schema';
import { AppProvider } from './state/AppProvider';
import type { DataStore } from './storage/DataStore';
import { FolderConnection, type FolderDeps } from './storage/folderConnection';
import { MirroredDataStore, type MirrorOptions } from './storage/MirroredDataStore';
import { TabLock, type LockManagerLike } from './storage/tabLock';
import { App } from './ui/App';
import { ErrorBoundary, StartupError } from './ui/screens/StartupError';

// Startup, in order, with the page already showing something at each step:
//   1. open browser storage (fails if the browser blocks it → error screen)
//   2. take the one-tab lock (another tab has it → "already open" screen)
//   3. connect the data folder, with a timeout (slow or stuck → carry on in the browser)
//   4. AppProvider loads the data (fails or times out → error screen)

export interface BootDeps {
  bundledPacks: Pack[];
  makeBrowserStore: () => DataStore;
  folderDeps: () => FolderDeps;
  locks: LockManagerLike | null;
  folderTimeoutMs?: number;
  mirrorOptions?: MirrorOptions;
  /** Tests pass these to skip IndexedDB. */
  loadImported?: () => Promise<Pack[]>;
  saveImported?: (p: Pack) => Promise<void>;
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'other-tab' }
  | { kind: 'ready'; store: MirroredDataStore; folder: FolderConnection; run: number }
  | { kind: 'error'; error: unknown };

export function Boot({ deps }: { deps: BootDeps }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const lock = useRef(new TabLock(deps.locks));
  const current = useRef<MirroredDataStore | null>(null);
  const runs = useRef(0);

  const start = useCallback(
    async (steal: boolean) => {
      setPhase({ kind: 'starting' });
      try {
        const browser = deps.makeBrowserStore();
        const got = await lock.current.acquire(steal, () => {
          // Another tab took over: stop saving here.
          current.current?.detach();
          current.current = null;
          setPhase({ kind: 'other-tab' });
        });
        if (!got) return setPhase({ kind: 'other-tab' });
        const store = new MirroredDataStore(browser, deps.mirrorOptions);
        const folder = new FolderConnection(store, deps.folderDeps());
        current.current = store;
        // Connect silently if the permission is still granted. If that hangs, start without it.
        const ms = deps.folderTimeoutMs ?? 8000;
        const finished = await Promise.race([
          folder
            .init()
            .catch((e) => console.error('Data folder init failed', e))
            .then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
        ]);
        if (!finished) folder.markTimedOut();
        setPhase({ kind: 'ready', store, folder, run: ++runs.current });
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

  // Give pending folder writes a chance to run before the tab closes. The browser copy is already saved either way.
  useEffect(() => {
    const onHide = () => void current.current?.flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  if (phase.kind === 'error') return <StartupError title="The app couldn't start" error={phase.error} onRetry={() => void start(false)} />;
  if (phase.kind === 'other-tab') return <OtherTab onTakeOver={() => void start(true)} />;
  if (phase.kind === 'starting') return <div className="empty">Starting…</div>;
  return (
    <ErrorBoundary key={phase.run}>
      <AppProvider store={phase.store} folder={phase.folder} bundledPacks={deps.bundledPacks} loadImported={deps.loadImported} saveImported={deps.saveImported}>
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
