import { createRoot } from 'react-dom/client';
import './fonts';
import './ui/styles.css';
import { Boot } from './Boot';
import { browserShareEnv } from './storage/backup';
import { IdbDataStore } from './storage/IdbDataStore';
import { safeLocalStorage } from './storage/legacy';
import { browserStorageManager } from './storage/persist';
import { browserLocks } from './storage/tabLock';
import { ErrorBoundary } from './ui/screens/StartupError';

// The app ships with no pack (bundledPacks: []); packs arrive only through Import.
// The shell renders at once; Boot then opens IndexedDB, takes the one-tab lock,
// moves any pre-v1.5 data over and loads it, showing an error screen if any step fails.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Boot
      deps={{
        bundledPacks: [],
        openStore: () => IdbDataStore.open(),
        legacyStorage: safeLocalStorage,
        locks: browserLocks(),
        storageManager: browserStorageManager(),
        shareEnv: browserShareEnv(),
      }}
    />
  </ErrorBoundary>,
);
