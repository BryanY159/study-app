import { useMemo, type ReactNode } from 'react';
import { browserPlatform, type Platform, type PlatformInfo } from '../../pwa/platform';

interface Guide {
  id: Platform;
  title: string;
  steps: ReactNode[];
}

const GUIDES: Guide[] = [
  {
    id: 'ios-safari',
    title: 'iPhone or iPad (Safari)',
    steps: [
      <>Open this page in <strong>Safari</strong>.</>,
      <>Tap the <strong>Share</strong> button (the square with an arrow pointing up).</>,
      <>Scroll down and tap <strong>Add to Home Screen</strong>. If you see an “Open as Web App” switch, leave it on.</>,
      <>Tap <strong>Add</strong>. Open Study from the new icon on your Home Screen. It works offline from then on.</>,
    ],
  },
  {
    id: 'ios-other-browser',
    title: 'iPhone or iPad (another browser)',
    steps: [
      <>Installing works best from <strong>Safari</strong>. Copy this page’s address and open it in Safari.</>,
      <>Then follow the steps for Safari: Share, then <strong>Add to Home Screen</strong>.</>,
    ],
  },
  {
    id: 'desktop-chromium',
    title: 'Laptop (Chrome or Edge)',
    steps: [
      <>Look for the <strong>install icon</strong> at the right end of the address bar (a screen with a down arrow) and click it.</>,
      <>No icon? Open the browser menu (⋮ or …) and choose <strong>Install Study</strong> (in Edge: Apps → Install this site as an app).</>,
      <>Study opens in its own window and gets a Start menu or Dock entry. It works offline from then on.</>,
    ],
  },
  {
    id: 'android',
    title: 'Android (Chrome)',
    steps: [
      <>Open the Chrome menu (⋮).</>,
      <>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</>,
    ],
  },
  {
    id: 'desktop-other',
    title: 'Other browsers',
    steps: [
      <>On a Mac, Safari can add it to the Dock: <strong>File → Add to Dock</strong>.</>,
      <>Firefox can’t install web apps. Use the page in a tab, or install it from Chrome or Edge.</>,
    ],
  },
];

/** Steps for installing the app, with the ones for this device first. */
export function InstallHelp({ info }: { info?: PlatformInfo }) {
  const detected = useMemo(() => info ?? browserPlatform(), [info]);
  const mine = GUIDES.find((g) => g.id === detected.platform)!;
  const others = GUIDES.filter((g) => g !== mine);
  return (
    <main className="page narrow" data-testid="install-help">
      <h1>Install the app</h1>
      {detected.installed ? (
        <div className="banner ok" data-testid="installed">
          You’re using the installed app. Nothing else to do: it works offline and opens from its own icon.
        </div>
      ) : (
        <p className="muted">Installing puts Study on your Home Screen or in your app list. It opens in its own window and works without a connection.</p>
      )}
      <section className="card stack" data-testid="install-mine">
        <h2>{mine.title}</h2>
        <ol className="steps">
          {mine.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>
      <details className="card">
        <summary>Other devices</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          {others.map((g) => (
            <section key={g.id} className="stack">
              <h3>{g.title}</h3>
              <ol className="steps">
                {g.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </details>
      <p className="small muted">Your answers stay on each device. To move them, use Export and Import sync file on the History &amp; data page.</p>
    </main>
  );
}
