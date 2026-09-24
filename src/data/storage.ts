/**
 * Browser storage durability. By default browsers may evict site data under storage pressure;
 * asking for persistent storage makes the journal survive that (the browser may still decline).
 */
export interface StorageStatus {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

type StorageManagerLike = {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
};

function manager(): StorageManagerLike | null {
  const nav = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator;
  return nav?.storage ?? null;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const m = manager();
  if (!m) return { persisted: null, usage: null, quota: null };
  type Estimate = { usage?: number; quota?: number };
  const [persisted, estimate] = await Promise.all([
    m.persisted ? m.persisted().catch(() => null) : Promise.resolve(null),
    m.estimate ? m.estimate().catch((): Estimate => ({})) : Promise.resolve<Estimate>({}),
  ]);
  return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  const m = manager();
  if (!m?.persist) return null;
  try {
    return await m.persist();
  } catch {
    return null;
  }
}
