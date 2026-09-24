import { EntryPage } from '../components/entry/EntryPage';
import { ImportHistoryPage, ImportReportPage } from '../components/import/ImportHistory';
import { ImportPage } from '../components/import/ImportPage';
import { JournalPage } from '../components/journal/JournalPage';
import { AppShell } from '../components/layout/AppShell';
import { SearchPage } from '../components/search/SearchPage';
import { SettingsPage } from '../components/settings/SettingsPage';
import { href, matchPath, useLocation } from './router';
import { DataProvider, useAppData } from './providers/data';
import { ThemeProvider } from './providers/theme';

function Routes() {
  const { path } = useLocation();
  const { fatal } = useAppData();
  if (fatal) {
    return (
      <div className="page page--narrow">
        <h1 className="page-title">Local storage couldn’t be opened</h1>
        <p className="lede">{fatal}</p>
        <p className="muted">Try reloading. If it keeps happening, check that this site is allowed to store data in your browser settings.</p>
      </div>
    );
  }
  if (path === '/') return <JournalPage />;
  const entry = matchPath('/entry/:id', path);
  if (entry?.id) return <EntryPage key={entry.id} entryId={entry.id} />;
  if (path === '/search') return <SearchPage />;
  if (path === '/import') return <ImportPage />;
  if (path === '/imports') return <ImportHistoryPage />;
  const report = matchPath('/imports/:id', path);
  if (report?.id) return <ImportReportPage batchId={report.id} />;
  if (path === '/settings') return <SettingsPage />;
  return (
    <div className="page page--narrow">
      <h1 className="page-title">Page not found</h1>
      <a className="text-btn" href={href('/')}>
        Back to journal
      </a>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <AppShell>
          <Routes />
        </AppShell>
      </DataProvider>
    </ThemeProvider>
  );
}
