/**
 * Web Locks mark work that is in progress (an import, a summary) so another tab — or the next
 * startup — can tell live work from work that was interrupted by closing the page.
 */
type LockManagerLike = {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
  query(): Promise<{ held?: { name?: string }[] }>;
};

function locks(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks ?? null;
}

export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const lm = locks();
  return lm ? lm.request(name, fn) : fn();
}

export async function heldLockNames(): Promise<Set<string>> {
  const lm = locks();
  if (!lm) return new Set();
  try {
    const state = await lm.query();
    return new Set((state.held ?? []).map((l) => l.name ?? '').filter(Boolean));
  } catch {
    return new Set();
  }
}

export const importLockName = (batchId: string) => `cj:import:${batchId}`;
export const summaryLockName = (entryId: string) => `cj:summary:${entryId}`;
