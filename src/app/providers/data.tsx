import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDb, getStorageMode, type StorageMode } from '../../data/db/database';
import { useLiveQuery } from '../../data/hooks';
import { countEntries, listCollections, listEntries } from '../../data/repositories/entries';
import type { Collection, EffectiveEntry } from '../../data/types';
import { AUTOLOAD_SAMPLE } from '../../config/features';
import { recoverInterruptedWork } from '../../data/recovery';
import { loadSampleJournal } from '../../fixtures/sample-journal';
import { warmSearchWhenIdle } from '../../search/client';

interface AppData {
  ready: boolean;
  fatal: string | null;
  storageMode: StorageMode;
  entries: EffectiveEntry[];
  collections: Collection[];
  entriesLoading: boolean;
}

const DataContext = createContext<AppData | null>(null);

/** Demo builds open with the sample journal, once (removing the samples keeps them removed). */
async function autoloadSampleOnce(): Promise<void> {
  const KEY = 'cj:demo-sample-loaded';
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    /* storage blocked: fall through and load */
  }
  if ((await countEntries()) === 0) await loadSampleJournal().catch((err) => console.warn('Sample journal failed to load', err));
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('persistent');

  useEffect(() => {
    getDb()
      .then(() => recoverInterruptedWork().catch((err) => console.warn('Recovery check failed', err)))
      .then(() => (AUTOLOAD_SAMPLE ? autoloadSampleOnce() : undefined))
      .then(
      () => {
        setStorageMode(getStorageMode());
        setReady(true);
        warmSearchWhenIdle();
      },
      (err) => setFatal(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  const entries = useLiveQuery(() => (ready ? listEntries() : Promise.resolve([])), [ready], ['entries', 'edits']);
  const collections = useLiveQuery(() => (ready ? listCollections() : Promise.resolve([])), [ready], ['collections']);

  const value = useMemo<AppData>(
    () => ({
      ready,
      fatal,
      storageMode,
      entries: entries.data ?? [],
      collections: collections.data ?? [],
      entriesLoading: !ready || entries.loading && entries.data === undefined,
    }),
    [ready, fatal, storageMode, entries.data, entries.loading, collections.data],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useAppData outside DataProvider');
  return ctx;
}
