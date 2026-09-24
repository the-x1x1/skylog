import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDb, getStorageMode, type StorageMode } from '../../data/db/database';
import { useLiveQuery } from '../../data/hooks';
import { listCollections, listEntries } from '../../data/repositories/entries';
import type { Collection, EffectiveEntry } from '../../data/types';

interface AppData {
  ready: boolean;
  fatal: string | null;
  storageMode: StorageMode;
  entries: EffectiveEntry[];
  collections: Collection[];
  entriesLoading: boolean;
}

const DataContext = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('persistent');

  useEffect(() => {
    getDb().then(
      () => {
        setStorageMode(getStorageMode());
        setReady(true);
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
