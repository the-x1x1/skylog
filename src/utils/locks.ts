/**
 * Web Locks mark work that is in progress (an import, a summary) so another tab — or the next
 * startup — can tell live work from work that was interrupted by closing the page.
 *
 * Locks are an aid, never a requirement: where the API is missing or denied (sandboxed iframes,
 * insecure origins), work runs without one.
 */
type LockCallback<T> = (lock: unknown) => Promise<T>;
type LockManagerLike = {
  request<T>(name: string, fn: LockCallback<T>): Promise<T>;
  request<T>(name: string, options: { ifAvailable?: boolean }, fn: LockCallback<T>): Promise<T>;
};

function locks(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks ?? null;
}

export function locksAvailable(): boolean {
  return locks() !== null;
}

/** Runs `fn` while holding the named lock; runs it anyway if locks can't be used here. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const lm = locks();
  if (!lm) return fn();
  let started = false;
  try {
    return await lm.request(name, () => {
      started = true;
      return fn();
    });
  } catch (err) {
    // The request itself was refused (e.g. SecurityError in an opaque-origin frame).
    if (started) throw err;
    return fn();
  }
}

/**
 * Runs `fn` only if nobody holds the lock right now (checked and held atomically, so work that
 * starts in another tab meanwhile can't be mistaken for abandoned work).
 * Returns 'ran' | 'busy' | 'unavailable'.
 */
export async function ifLockFree(name: string, fn: () => Promise<void>): Promise<'ran' | 'busy' | 'unavailable'> {
  const lm = locks();
  if (!lm) return 'unavailable';
  let started = false;
  try {
    return await lm.request(name, { ifAvailable: true }, async (lock) => {
      started = true;
      if (!lock) return 'busy' as const;
      await fn();
      return 'ran' as const;
    });
  } catch (err) {
    if (started) throw err;
    return 'unavailable';
  }
}

export const importLockName = (batchId: string) => `cj:import:${batchId}`;
export const summaryLockName = (entryId: string) => `cj:summary:${entryId}`;
