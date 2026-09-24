import { saveImportBatch } from '../../data/repositories/imports';
import { emptyCounts, type ImportBatch, type ImportIssue, type ImportOptions } from '../../data/types';
import { randomId } from '../../utils/hash';
import { importLockName, withLock } from '../../utils/locks';
import { persistPrepared, prepareConversation } from './prepare';
import type { ArchiveManifest, ConversationImporter, ImportProgress } from './types';

/** Summarizes one stored entry. Provided by the summarization service; throws on failure. */
export type EntrySummarizer = (entryId: string, opts: { signal?: AbortSignal; autoTag: boolean }) => Promise<void>;

export interface RunImportArgs {
  manifest: ArchiveManifest;
  importer: ConversationImporter;
  options: ImportOptions;
  signal?: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
  summarizer?: EntrySummarizer | null;
  batchId?: string;
  isSample?: boolean;
  /** Minimum time between progress events (0 = every step). */
  progressIntervalMs?: number;
}

const MAX_REPORTED_ISSUES = 2000;
const PROGRESS_INTERVAL_MS = 100;

/**
 * Runs a full import: parse → persist (one conversation per transaction, so a failure or cancel
 * never loses conversations already saved) → optional summaries. Progress reflects real work.
 */
export function runImport(args: RunImportArgs): Promise<ImportBatch> {
  const batchId = args.batchId ?? randomId('imp');
  // The lock tells other tabs (and the next startup) that this import is alive.
  return withLock(importLockName(batchId), () => runImportLocked({ ...args, batchId }));
}

async function runImportLocked(args: RunImportArgs & { batchId: string }): Promise<ImportBatch> {
  const { manifest, importer, options, signal, onProgress } = args;
  const summarizer = options.generateSummaries ? (args.summarizer ?? null) : null;
  const batch: ImportBatch = {
    id: args.batchId,
    archiveFileName: manifest.fileName,
    archiveSize: manifest.size,
    source: importer.source,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    options,
    counts: emptyCounts(),
    issues: [],
    entryIds: [],
    fatalError: null,
  };
  const counts = batch.counts;
  let processed = 0;
  let total = 0;
  let currentTitle: string | null = null;
  let summaryTotal = 0;
  let summaryDone = 0;
  let lastIssue: ImportIssue | null = null;

  // Progress is throttled (~10/s) so the UI never falls behind the real state; stage changes
  // and the final state are always delivered.
  const progressInterval = args.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  let lastEmit = 0;
  let lastStage: ImportProgress['stage'] | null = null;
  const emit = (stage: ImportProgress['stage'], message: string | null = null) => {
    const now = Date.now();
    const final = stage === 'done' || stage === 'cancelled' || stage === 'failed';
    if (!final && stage === lastStage && now - lastEmit < progressInterval) return;
    lastEmit = now;
    lastStage = stage;
    onProgress?.({
      stage,
      batchId: batch.id,
      counts: { ...counts },
      processed,
      total,
      currentTitle,
      summaryTotal,
      summaryDone,
      lastIssue,
      message,
    });
  };
  const addIssue = (issue: ImportIssue) => {
    lastIssue = issue;
    if (batch.issues.length < MAX_REPORTED_ISSUES) batch.issues.push(issue);
  };

  await saveImportBatch(batch);
  emit('parsing');

  const toSummarize: string[] = [];
  const touchedEntries = new Set<string>();
  const labels = new Map<string, { conversationId: string; title: string | null }>();
  const importedAt = batch.startedAt;

  try {
    for await (const item of importer.iterate(manifest, signal)) {
      total = item.total;
      counts.total = item.total;
      if (item.kind === 'skipped') {
        processed = item.position + 1;
        currentTitle = item.issue.title;
        if (item.issue.level === 'error') counts.failed++;
        else counts.skipped++;
        addIssue(item.issue);
        emit('parsing');
        continue;
      }
      const conv = item.conversation;
      currentTitle = conv.title || '(untitled)';
      emit('parsing');
      try {
        const prepared = await prepareConversation(conv, {
          batchId: batch.id,
          archiveFileName: manifest.fileName,
          importedAt,
          manifest,
          importImages: options.importImages,
          isSample: args.isSample,
        });
        const result = await persistPrepared(prepared, { skipExisting: options.skipExisting });
        const label = { conversationId: conv.sourceConversationId, title: conv.title || null };
        if (result.note) addIssue({ level: 'warning', sourceFile: manifest.fileName, ...label, reason: result.note });
        if (result.outcome === 'duplicate' || result.outcome === 'older' || result.outcome === 'unchanged') counts.duplicates++;
        else if (result.outcome === 'imported') counts.imported++;
        else counts.updated++;
        if (result.outcome !== 'duplicate' && result.outcome !== 'older') {
          counts.imagesFound += prepared.images.length;
          counts.imagesStored += result.imagesAvailable;
          counts.imagesMissing += prepared.images.length - result.imagesAvailable;
          touchedEntries.add(result.entryId);
          labels.set(result.entryId, label);
          if (result.needsSummary) toSummarize.push(result.entryId);
          for (const w of prepared.warnings) addIssue({ level: 'warning', sourceFile: manifest.fileName, ...label, reason: w });
        }
      } catch (err) {
        counts.failed++;
        addIssue({
          level: 'error',
          sourceFile: manifest.fileName,
          conversationId: conv.sourceConversationId,
          title: conv.title || null,
          reason: `Could not save this conversation: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      processed = item.position + 1;
      emit('parsing');
    }
  } catch (err) {
    // Archive-level failure (unreadable conversations.json, etc.). Anything already saved stays.
    batch.status = 'failed';
    batch.fatalError = err instanceof Error ? err.message : String(err);
    batch.finishedAt = new Date().toISOString();
    batch.entryIds = Array.from(touchedEntries);
    await saveImportBatch(batch);
    emit('failed', batch.fatalError);
    return batch;
  }

  batch.entryIds = Array.from(touchedEntries);
  await saveImportBatch(batch);

  if (summarizer && !signal?.aborted && toSummarize.length > 0) {
    summaryTotal = toSummarize.length;
    emit('summarizing');
    for (const entryId of toSummarize) {
      if (signal?.aborted) break;
      try {
        await summarizer(entryId, { signal, autoTag: options.autoTag });
        counts.summarized++;
      } catch (err) {
        if (signal?.aborted) break;
        counts.summaryFailed++;
        addIssue({
          level: 'warning',
          sourceFile: manifest.fileName,
          conversationId: labels.get(entryId)?.conversationId ?? null,
          title: labels.get(entryId)?.title ?? null,
          reason: `Summary failed (the conversation was imported): ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      summaryDone++;
      emit('summarizing');
    }
  }

  batch.finishedAt = new Date().toISOString();
  batch.status = signal?.aborted ? 'cancelled' : counts.failed > 0 || counts.summaryFailed > 0 ? 'completed_with_errors' : 'completed';
  await saveImportBatch(batch);
  emit(signal?.aborted ? 'cancelled' : 'done');
  return batch;
}
