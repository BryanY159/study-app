import { Header } from './components/Header';
import { UpdateBanner } from './components/UpdateBanner';
import { useApp } from '../state/AppProvider';
import { useRoute } from './router';
import { Dashboard } from './screens/Dashboard';
import { DataPage } from './screens/DataPage';
import { DrillRun } from './screens/DrillRun';
import { DrillSetup } from './screens/DrillSetup';
import { Flags } from './screens/Flags';
import { MockRun, MockStart } from './screens/Mock';
import { MockResults } from './screens/MockResults';

export function App() {
  const route = useRoute();
  const { newerVersionData } = useApp();
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

  return (
    <>
      {!inRun && <Header route={route} />}
      <UpdateBanner path={route.path} />
      {newerVersionData && (
        <div className="banner warn page-banner" role="alert" data-testid="newer-version">
          Some of your data was saved by a newer version of this app, so this version leaves it untouched. Reload the page to get the latest version.
        </div>
      )}
      {screen}
    </>
  );
}
