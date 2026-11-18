import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { FsAccessDataStore, type DirHandleLike } from './FsAccessDataStore';
import type { MirroredDataStore } from './MirroredDataStore';
import type { DocName } from './DataStore';

// Connecting the data folder (FR-9). Spike result: from file:// in Chrome/Edge
// the folder handle survives in IndexedDB; after a restart the permission may
// be "prompt", which needs one click ("Reconnect data folder").

export type FolderState =
  | 'unsupported' // no File System Access API: browser storage only
  | 'not-set-up' // first run: show "Connect your data folder"
  | 'skipped' // she chose "Skip for now"
  | 'needs-permission' // handle saved, permission is "prompt": show "Reconnect"
  | 'connected'
  | 'newer-version'; // the folder has data from a newer app version: left alone, browser-only saving

/** Everything browser-specific is injected so tests can fake it. */
export interface FolderDeps {
  supported: boolean;
  pickFolder: () => Promise<DirHandleLike>;
  loadHandle: () => Promise<DirHandleLike | undefined>;
  saveHandle: (h: DirHandleLike) => Promise<void>;
  clearHandle: () => Promise<void>;
  getFlag: (key: string) => boolean;
  setFlag: (key: string, on: boolean) => void;
}

const SKIPPED = 'studyapp:folder-skipped';
const BACKUP_OFFERED = 'studyapp:backup-offer-done';

export class FolderConnection {
  state: FolderState = 'unsupported';
  folderName: string | null = null;
  private handle: DirHandleLike | null = null;
  private initDone = false;
  private timedOut = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly mirror: MirroredDataStore,
    private deps: FolderDeps,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(state: FolderState) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

  /** Run once at startup, before the app reads its data: connects silently if permission is still granted. */
  async init(): Promise<void> {
    try {
      await this.initSteps();
    } finally {
      this.initDone = true;
    }
  }

  private async initSteps(): Promise<void> {
    if (!this.deps.supported) return this.set('unsupported');
    const h = await this.deps.loadHandle().catch(() => undefined);
    // Startup already gave up waiting: remember the folder for the reconnect click, don't connect now.
    if (this.timedOut) {
      if (h) {
        this.handle = h;
        this.folderName = h.name;
      }
      return;
    }
    if (!h) return this.set(this.deps.getFlag(SKIPPED) ? 'skipped' : 'not-set-up');
    this.handle = h;
    this.folderName = h.name;
    const perm = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt' as const);
    if (this.timedOut) return;
    if (perm === 'granted') {
      await this.mirror.attach(new FsAccessDataStore(h));
      if (!this.timedOut) this.set(this.stateAfterAttach());
    } else {
      this.set('needs-permission');
    }
  }

  /** First-run / settings: pick a folder (must be called from a click). Returns docs that changed locally. */
  async connect(): Promise<DocName[]> {
    const h = await this.deps.pickFolder();
    await this.deps.saveHandle(h);
    this.deps.setFlag(SKIPPED, false);
    return this.attach(h);
  }

  /** "Reconnect data folder": one permission prompt (must be called from a click). */
  async reconnect(): Promise<DocName[]> {
    if (!this.handle) return this.connect();
    const perm = await this.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      this.set('needs-permission');
      return [];
    }
    return this.attach(this.handle);
  }

  private async attach(h: DirHandleLike): Promise<DocName[]> {
    this.handle = h;
    this.folderName = h.name;
    const changed = await this.mirror.attach(new FsAccessDataStore(h));
    this.set(this.stateAfterAttach());
    return changed;
  }

  private stateAfterAttach(): FolderState {
    if (this.mirror.connected) return 'connected';
    return this.mirror.getStatus().kind === 'newer-version' ? 'newer-version' : 'needs-permission';
  }

  /**
   * Startup gave up waiting for the folder (N-2): carry on saving in the browser and show
   * "Reconnect data folder", whose click retries (or opens the picker if no folder was found yet).
   */
  markTimedOut(): void {
    if (this.initDone || !this.deps.supported) return;
    this.timedOut = true;
    this.mirror.detach();
    this.set('needs-permission');
  }

  /** The mirror found newer-version data mid-session: stop using the folder. */
  markNewerVersion(): void {
    this.set('newer-version');
  }

  skip(): void {
    this.deps.setFlag(SKIPPED, true);
    this.set('skipped');
  }

  async disconnect(): Promise<void> {
    await this.deps.clearHandle();
    this.handle = null;
    this.folderName = null;
    this.mirror.detach();
    this.deps.setFlag(SKIPPED, true);
    this.set('skipped');
  }

  /** The mirror lost access (folder moved, permission revoked): ask for a reconnect. */
  markLostAccess(): void {
    if (this.state === 'connected') this.set('needs-permission');
  }

  /** v1 migration: offer to import a backup once, after the first connect. */
  get backupOfferPending(): boolean {
    return this.state === 'connected' && !this.deps.getFlag(BACKUP_OFFERED);
  }

  dismissBackupOffer(): void {
    this.deps.setFlag(BACKUP_OFFERED, true);
    for (const fn of this.listeners) fn();
  }
}

// ---- Real browser implementations ----

let db: UseStore | undefined;
const handleStore = () => (db ??= createStore('studyapp-folder', 'handles'));

type PickerWindow = Window & { showDirectoryPicker?: (opts: { id?: string; mode?: 'readwrite' }) => Promise<DirHandleLike> };

export function browserFolderDeps(): FolderDeps {
  const w = window as PickerWindow;
  const ls = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  return {
    supported: typeof w.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined',
    pickFolder: () => w.showDirectoryPicker!({ id: 'study-data', mode: 'readwrite' }),
    loadHandle: () => get<DirHandleLike>('data', handleStore()),
    saveHandle: (h) => set('data', h, handleStore()),
    clearHandle: () => del('data', handleStore()),
    getFlag: (k) => ls?.getItem(k) === '1',
    setFlag: (k, on) => (on ? ls?.setItem(k, '1') : ls?.removeItem(k)),
  };
}
