import { useMemo, useRef, useState } from 'react';
import { browserPlatform } from '../../pwa/platform';
import { useApp } from '../../state/AppProvider';
import { navigate } from '../router';

/**
 * First run (no pack yet). The app holds no study content, so the two things to do
 * are: install it (optional, but it's how it works offline), and import a pack file.
 * Also shown on any screen that needs a pack while none is loaded.
 */
export function Welcome() {
  const { importPack } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const { platform, installed } = useMemo(browserPlatform, []);
  const touch = platform === 'ios-safari' || platform === 'ios-other-browser' || platform === 'android';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    const r = await importPack(await file.text());
    if (input.current) input.current.value = '';
    if (r.ok) navigate('#/');
    else setError(r.error);
  };

  return (
    <main className="page narrow" data-testid="welcome">
      <div className="stack">
        <h1>Welcome to Study</h1>
        <p className="muted">The app doesn’t contain any course material. You add it by importing a pack file, and it stays on this device.</p>
      </div>
      <ol className="welcome-steps">
        {!installed && (
          <li className="card stack">
            <h2>{touch ? 'Add it to your Home Screen' : 'Install it (optional)'}</h2>
            <p className="muted">{touch ? 'Then it opens from its own icon and works offline, like an app.' : 'It gets its own window and works offline.'}</p>
            <div className="row">
              <a className="btn" href="#/install">
                Show me how
              </a>
            </div>
          </li>
        )}
        <li className="card stack">
          <h2>Import your pack</h2>
          <p className="muted">Choose the pack file (.json) you were given, from Files, Downloads, AirDrop or a cloud drive.</p>
          <div className="row">
            <button type="button" className="btn primary big" onClick={() => input.current?.click()}>
              Import a pack
            </button>
            <input ref={input} type="file" accept=".json,application/json" hidden data-testid="welcome-pack-input" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {error && (
            <div className="banner error" role="alert" data-testid="welcome-error">
              {error}
            </div>
          )}
        </li>
      </ol>
      <p className="small">
        <a href="#/data">Have a sync file from another device?</a> Import the pack first, then import the sync file on the History &amp; data page.
      </p>
    </main>
  );
}
