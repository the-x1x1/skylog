import { hasGeneratedSummary } from '../importers/core/prepare';
import { ifLockFree, importLockName, summaryLockName } from '../utils/locks';
import { notifyChange } from './db/changes';
import { getDb } from './db/database';
import type { ImportBatch, JournalEntry } from './types';

/** Without Web Locks we can't see other tabs' work, so only settle records this stale. */
const STALE_IMPORT_MS = 12 * 60 * 60 * 1000;
const STALE_SUMMARY_MS = 60 * 60 * 1000;

const INTERRUPTED_MESSAGE =
  'This import was interrupted before it finished (the page was closed, reloaded, or the import stopped unexpectedly). Conversations saved before that are kept. Import the same file again to finish — conversations already imported are skipped.';

/**
 * Settles work left "running"/"pending" by a page that closed or a worker that crashed.
 * Each record is settled while holding its lock (acquired only if free), so live work in
 * another tab is never touched. Runs at startup and after an import session fails.
 */
export async function recoverInterruptedWork(now = Date.now()): Promise<{ imports: number; summaries: number }> {
  const db = await getDb();
  const [batches, entries] = await db.read(['imports', 'entries'], (tx) =>
    Promise.all([tx.getAll<ImportBatch>('imports'), tx.getAllFromIndex<JournalEntry>('entries', 'importedAt')]),
  );
  let imports = 0;
  let summaries = 0;
  const changedConversations: string[] = [];

  for (const b of batches.filter((x) => x.status === 'running')) {
    const settle = async () => {
      const changed = await db.write('imports', async (tx) => {
        const cur = await tx.get<ImportBatch>('imports', b.id);
        if (!cur || cur.status !== 'running') return false;
        await tx.put('imports', { ...cur, status: 'interrupted', finishedAt: new Date(now).toISOString(), fatalError: cur.fatalError ?? INTERRUPTED_MESSAGE } satisfies ImportBatch);
        return true;
      });
      if (changed) imports++;
    };
    const r = await ifLockFree(importLockName(b.id), settle);
    if (r === 'unavailable' && now - Date.parse(b.startedAt) > STALE_IMPORT_MS) await settle();
  }

  for (const e of entries.filter((x) => x.summaryStatus === 'pending')) {
    const settle = async () => {
      const changed = await db.write('entries', async (tx) => {
        const cur = await tx.get<JournalEntry>('entries', e.id);
        if (!cur || cur.summaryStatus !== 'pending') return false;
        await tx.put('entries', { ...cur, summaryStatus: hasGeneratedSummary(cur) ? 'complete' : 'not_configured', summaryStartedAt: null } satisfies JournalEntry);
        return true;
      });
      if (changed) {
        summaries++;
        changedConversations.push(e.conversationId);
      }
    };
    const r = await ifLockFree(summaryLockName(e.id), settle);
    const startedAt = e.summaryStartedAt ? Date.parse(e.summaryStartedAt) : 0;
    if (r === 'unavailable' && now - startedAt > STALE_SUMMARY_MS) await settle();
  }

  if (imports) notifyChange({ stores: ['imports'] });
  if (changedConversations.length) notifyChange({ stores: ['entries'], conversationIds: changedConversations });
  return { imports, summaries };
}
