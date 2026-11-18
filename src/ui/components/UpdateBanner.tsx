import { useState, useSyncExternalStore } from 'react';
import { shouldShowUpdate } from '../../pwa/updates';
import { useApp } from '../../state/AppProvider';

/**
 * "A new version is ready". Only on Home, never mid-drill, mid-exam or mid-card-session:
 * if the update arrives during one, it waits until she's back on Home.
 * Nothing reloads unless she taps Reload. "Later" hides it until the next start.
 */
export function UpdateBanner({ path }: { path: string }) {
  const { updates } = useApp();
  const needRefresh = useSyncExternalStore(updates.subscribe, updates.needRefresh, updates.needRefresh);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!shouldShowUpdate({ needRefresh, path, dismissed })) return null;
  return (
    <div className="banner ok page-banner reminder" role="status" data-testid="update-banner">
      <span>A new version of the app is ready. Reload to use it; your answers are saved.</span>
      <span className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn small primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void updates.apply();
          }}
        >
          Reload
        </button>
        <button type="button" className="btn small" onClick={() => setDismissed(true)}>
          Later
        </button>
      </span>
    </div>
  );
}
