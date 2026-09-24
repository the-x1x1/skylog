import { useEffect, useRef, useState } from 'react';
import { subscribeChanges } from './db/changes';
import { getBlob } from './repositories/entries';

export interface LiveQuery<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Runs an async query and re-runs it when the relevant stores change. Bursts of changes (an
 * import writes one conversation at a time) are coalesced so lists don't re-query hundreds of
 * times per second.
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: readonly unknown[], stores?: readonly string[]): LiveQuery<T> {
  const [state, setState] = useState<LiveQuery<T>>({ data: undefined, error: null, loading: true });
  const queryRef = useRef(query);
  queryRef.current = query;
  const storesKey = stores?.join(',') ?? '*';

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRun = 0;
    let lastDuration = 0;

    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      lastRun = Date.now();
      try {
        const data = await queryRef.current();
        lastDuration = Date.now() - lastRun;
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) setState((s) => ({ data: s.data, error: err instanceof Error ? err : new Error(String(err)), loading: false }));
      } finally {
        running = false;
        if (again && !cancelled) {
          again = false;
          schedule();
        }
      }
    };
    // Re-run at most every 250 ms, and back off further when the query itself is slow, so a
    // long import in a worker isn't competing with constant re-reads of the same stores.
    const schedule = () => {
      if (timer) return;
      const interval = Math.max(250, lastDuration * 6);
      const wait = Math.max(0, interval - (Date.now() - lastRun));
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, wait);
    };

    setState((s) => ({ ...s, loading: true }));
    void run();
    const storeList = storesKey === '*' ? null : storesKey.split(',');
    const unsubscribe = subscribeChanges((e) => {
      if (e.reset || !storeList || e.stores.some((s) => storeList.includes(s))) schedule();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, storesKey]);

  return state;
}

/* ----------------------------- image object URLs ------------------------------------ */

const urlCache = new Map<string, { url: string | null; refs: number; promise: Promise<string | null>; revokeTimer: ReturnType<typeof setTimeout> | null }>();

function acquire(key: string): Promise<string | null> {
  let rec = urlCache.get(key);
  if (!rec) {
    const promise = getBlob(key).then((blob) => {
      const url = blob ? URL.createObjectURL(blob) : null;
      const r = urlCache.get(key);
      if (r) r.url = url;
      return url;
    });
    rec = { url: null, refs: 0, promise, revokeTimer: null };
    urlCache.set(key, rec);
  }
  if (rec.revokeTimer) {
    clearTimeout(rec.revokeTimer);
    rec.revokeTimer = null;
  }
  rec.refs++;
  return rec.promise;
}

function release(key: string) {
  const rec = urlCache.get(key);
  if (!rec) return;
  rec.refs--;
  if (rec.refs <= 0) {
    rec.revokeTimer = setTimeout(() => {
      if (rec.refs <= 0) {
        if (rec.url) URL.revokeObjectURL(rec.url);
        urlCache.delete(key);
      }
    }, 60_000);
  }
}

/** Object URL for a stored image blob; null while loading or when missing. */
export function useBlobUrl(blobKey: string | null | undefined): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; url: string | null }>({ key: null, url: null });
  useEffect(() => {
    if (!blobKey) return;
    let alive = true;
    acquire(blobKey).then(
      (url) => {
        if (alive) setState({ key: blobKey, url });
      },
      () => {
        if (alive) setState({ key: blobKey, url: null });
      },
    );
    return () => {
      alive = false;
      release(blobKey);
    };
  }, [blobKey]);
  if (!blobKey) return { url: null, loading: false };
  return { url: state.key === blobKey ? state.url : null, loading: state.key !== blobKey };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof matchMedia === 'undefined' ? false : matchMedia(query).matches));
  useEffect(() => {
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
