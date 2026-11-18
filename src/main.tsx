import { createRoot } from 'react-dom/client';
import './fonts';
import './ui/styles.css';
import { Boot } from './Boot';
import { BrowserDataStore } from './storage/DataStore';
import { browserFolderDeps } from './storage/folderConnection';
import { browserLocks } from './storage/tabLock';
import { ErrorBoundary } from './ui/screens/StartupError';

// The app ships with no pack (bundledPacks: []); packs arrive only through Import.
// The shell renders at once; Boot then opens storage, takes the one-tab lock,
// connects the data folder and loads the data, showing an error screen if any step fails.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Boot deps={{ bundledPacks: [], makeBrowserStore: () => new BrowserDataStore(), folderDeps: browserFolderDeps, locks: browserLocks() }} />
  </ErrorBoundary>,
);
