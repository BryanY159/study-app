import { Header, TabBar } from './components/Header';
import { useBreakpoint } from './useBreakpoint';
import { UpdateBanner } from './components/UpdateBanner';
import { useApp } from '../state/AppProvider';
import { useRoute } from './router';
import { Dashboard } from './screens/Dashboard';
import { DataPage } from './screens/DataPage';
import { DrillRun } from './screens/DrillRun';
import { DrillSetup } from './screens/DrillSetup';
import { CardRun } from './screens/CardRun';
import { CardSetup } from './screens/CardSetup';
import { Flags } from './screens/Flags';
import { InstallHelp } from './screens/InstallHelp';
import { MockRun, MockStart } from './screens/Mock';
import { MockResults } from './screens/MockResults';

export function App() {
  const route = useRoute();
  const { newerVersionData } = useApp();
  const phone = useBreakpoint() === 'phone';
  const [a, b, c] = route.parts;
  // Runs (drill, mock, card session) use their own focused header.
  const inRun = (a === 'drill' || a === 'mock' || a === 'cards') && b === 'run';

  let screen;
  if (a === 'drill' && b === 'run') screen = <DrillRun />;
  else if (a === 'drill') screen = <DrillSetup key={route.query.toString()} route={route} />;
  else if (a === 'mock' && b === 'run') screen = <MockRun />;
  else if (a === 'mock' && b === 'results' && c) screen = <MockResults sessionId={c} />;
  else if (a === 'mock') screen = <MockStart />;
  else if (a === 'cards' && b === 'run') screen = <CardRun />;
  else if (a === 'cards') screen = <CardSetup key={route.query.toString()} route={route} />;
  else if (a === 'flags') screen = <Flags />;
  else if (a === 'data') screen = <DataPage />;
  else if (a === 'install') screen = <InstallHelp />;
  else screen = <Dashboard />;

  return (
    <>
      {!inRun && <Header route={route} />}
      <UpdateBanner path={route.path} />
      {newerVersionData && (
        <div className="banner warn page-banner" role="alert" data-testid="newer-version">
          This device’s data was saved by a newer version of the app, so saving is paused to protect it. Reload to update the app.
        </div>
      )}
      {screen}
      {phone && !inRun && <TabBar route={route} />}
    </>
  );
}
