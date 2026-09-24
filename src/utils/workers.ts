import { getStorageMode } from '../data/db/database';

/**
 * Starts a bundled worker. Returns null when workers can't run here (in-memory storage mode,
 * file:// pages, strict embedding CSPs); callers then run the same code on the main thread.
 */
export function spawnWorker(ref: WorkerRef | undefined, name: string): Worker | null {
  if (typeof Worker === 'undefined' || !ref) return null;
  // In memory mode each context would get its own empty database, so stay on one thread.
  if (getStorageMode() === 'memory') return null;
  try {
    if (ref.kind === 'url') {
      if (!ref.url) return null;
      return new Worker(ref.url, { name });
    }
    const url = URL.createObjectURL(new Blob([ref.source], { type: 'text/javascript' }));
    const w = new Worker(url, { name });
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return w;
  } catch (err) {
    console.warn(`Could not start ${name} worker; running on the main thread.`, err);
    return null;
  }
}

/** Build-time worker references; undefined when running outside the bundle (tests). */
export const WORKERS = {
  import: typeof __IMPORT_WORKER__ !== 'undefined' ? __IMPORT_WORKER__ : undefined,
  search: typeof __SEARCH_WORKER__ !== 'undefined' ? __SEARCH_WORKER__ : undefined,
};

/** Minimal typing for code that runs inside a dedicated worker. */
export interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}
