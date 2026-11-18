import { Header } from './components/Header';
import { useApp } from '../state/AppProvider';
import { useRoute } from './router';
import { ConnectFolder } from './screens/ConnectFolder';
import { Dashboard } from './screens/Dashboard';
import { DataPage } from './screens/DataPage';
import { DrillRun } from './screens/DrillRun';
import { DrillSetup } from './screens/DrillSetup';
import { Flags } from './screens/Flags';
import { MockRun, MockStart } from './screens/Mock';
import { MockResults } from './screens/MockResults';

export function App() {
  const route = useRoute();
  const { folderState, newerVersionData } = useApp();
  const [a, b, c] = route.parts;
  // Runs (drill, mock) use their own focused header.
  const inRun = (a === 'drill' || a === 'mock') && b === 'run';

  let screen;
  if (a === 'drill' && b === 'run') screen = <DrillRun />;
  else if (a === 'drill') screen = <DrillSetup key={route.query.toString()} route={route} />;
  else if (a === 'mock' && b === 'run') screen = <MockRun />;
  else if (a === 'mock' && b === 'results' && c) screen = <MockResults sessionId={c} />;
  else if (a === 'mock') screen = <MockStart />;
  else if (a === 'flags') screen = <Flags />;
  else if (a === 'data') screen = <DataPage />;
  else screen = <Dashboard />;
  // First run: ask for the data folder before anything else (not mid-exam).
  if (folderState === 'not-set-up' && !inRun) screen = <ConnectFolder />;

  return (
    <>
      {!inRun && <Header route={route} />}
      {newerVersionData && (
        <div className="banner warn page-banner" role="alert" data-testid="newer-version">
          Your data was saved by a newer version of this app; update <code>index.html</code>. Until then, that data is left untouched and this app saves in the
          browser only.
        </div>
      )}
      {screen}
    </>
  );
}
