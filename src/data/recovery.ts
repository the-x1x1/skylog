import { hasGeneratedSummary } from '../importers/core/prepare';
import { heldLockNames, importLockName, summaryLockName } from '../utils/locks';
import { notifyChange } from './db/changes';
import { getDb } from './db/database';
import type { ImportBatch, JournalEntry } from './types';

/**
 * Runs at startup. Work that was in progress when a page closed (an import, a summary) left
 * records in a "running"/"pending" state. Anything not held by a live Web Lock (i.e. not still
 * running in another tab) is settled so nothing stays stuck.
 */
export async function recoverInterruptedWork(): Promise<{ imports: number; summaries: number }> {
  const db = await getDb();
  const held = await heldLockNames();
  const now = new Date().toISOString();
  const changedConversations: string[] = [];
  const result = await db.write(['imports', 'entries'], async (tx) => {
    let imports = 0;
    let summaries = 0;
    for (const b of await tx.getAll<ImportBatch>('imports')) {
      if (b.status !== 'running' || held.has(importLockName(b.id))) continue;
      imports++;
      await tx.put('imports', {
        ...b,
        status: 'interrupted',
        finishedAt: now,
        fatalError:
          b.fatalError ??
          'This import was interrupted before it finished (the page was closed or reloaded). Conversations saved before that are kept. Import the same file again to finish — conversations already imported are skipped.',
      } satisfies ImportBatch);
    }
    for (const e of await tx.getAll<JournalEntry>('entries')) {
      if (e.summaryStatus !== 'pending' || held.has(summaryLockName(e.id))) continue;
      summaries++;
      changedConversations.push(e.conversationId);
      await tx.put('entries', { ...e, summaryStatus: hasGeneratedSummary(e) ? 'complete' : 'not_configured' } satisfies JournalEntry);
    }
    return { imports, summaries };
  });
  if (result.imports) notifyChange({ stores: ['imports'] });
  if (changedConversations.length) notifyChange({ stores: ['entries'], conversationIds: changedConversations });
  return result;
}
