import { Component, type ErrorInfo, type ReactNode } from 'react';
import { downloadFile, rescueBackup } from '../../storage/backup';
import { dateStamp } from '../../storage/syncFile';

const describe = (e: unknown): string => {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n\n${e.stack}` : ''}`;
  return String(e);
};

const looksBlocked = (e: unknown) => /SecurityError|InvalidStateError|indexedDB|localStorage|access is denied|storage/i.test(describe(e));

/** Shown instead of a blank page or an endless "Loading…" when something fails. */
export function StartupError({ title = 'Something went wrong', error, onRetry }: { title?: string; error: unknown; onRetry?: () => void }) {
  return (
    <main className="page narrow" data-testid="startup-error">
      <section className="card stack-lg">
        <h1>{title}</h1>
        <p>
          Your answers and flags are not lost: they stay saved on this device. Download a rescue file now to be safe, then try again. If it keeps happening, send the file and
          the error details below. The rescue file can be imported later like any sync file.
        </p>
        {looksBlocked(error) && (
          <div className="banner warn">
            The browser may be blocking site data for this page (for example in a private window, or with site data turned off). Allow this site to save data, then try
            again.
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            onClick={async () => downloadFile(`study-sync-rescue-${dateStamp()}.json`, await rescueBackup())}
          >
            Download rescue file
          </button>
          <button type="button" className="btn" onClick={onRetry ?? (() => window.location.reload())}>
            Try again
          </button>
        </div>
        <details className="error-details">
          <summary>Error details</summary>
          <pre data-testid="error-details">{describe(error)}</pre>
        </details>
      </section>
    </main>
  );
}

/** Any render error shows StartupError instead of unmounting the page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Study app crashed', error, info.componentStack);
  }

  render() {
    if (this.state.error) return <StartupError error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
