import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { getDb } from '../../src/data/db/database';
import { getBlob, getEntryView, listEntries, saveEntryEdits } from '../../src/data/repositories/entries';
import { listImportBatches } from '../../src/data/repositories/imports';
import type { ImportOptions, JournalEntry } from '../../src/data/types';
import { sampleChatGptExportFiles, sampleClaudeExportFiles } from '../../src/fixtures/sample-exports';
import { conversationIdFor, entryIdFor } from '../../src/importers/core/prepare';
import { runImport } from '../../src/importers/core/pipeline';
import type { ImportProgress } from '../../src/importers/core/types';
import { importerFor } from '../../src/importers/registry';
import { applySummary, makeEntrySummarizer } from '../../src/summarization/service';
import type { JournalSummary, SummaryProvider } from '../../src/summarization/types';
import { chatgptEdgeCaseFiles } from '../helpers/fixtures';
import { freshDb, zipArchive } from '../helpers/db';

const OPTS: ImportOptions = { generateSummaries: false, importImages: true, skipExisting: true, autoTag: true };

async function importZip(files: Record<string, string | Uint8Array>, source: 'chatgpt' | 'claude', opts: Partial<ImportOptions> = {}, extra: Partial<Parameters<typeof runImport>[0]> = {}) {
  const manifest = await zipArchive(`${source}.zip`, files);
  const progress: ImportProgress[] = [];
  const batch = await runImport({ manifest, importer: importerFor(source), options: { ...OPTS, ...opts }, onProgress: (p) => progress.push(p), progressIntervalMs: 0, ...extra });
  return { batch, progress };
}

async function snapshot() {
  const db = await getDb();
  return db.read(['conversations', 'messages', 'images', 'blobs', 'entries'], async (tx) => ({
    conversations: await tx.getAll('conversations'),
    messages: await tx.getAll('messages'),
    images: await tx.getAll('images'),
    blobs: (await tx.getAll<{ key: string; size: number }>('blobs')).map((b) => ({ key: b.key, size: b.size })),
    entries: (await tx.getAll<JournalEntry>('entries')).map((e) => ({ ...e, importedAt: 'x', updatedAt: 'x' })),
  }));
}

const fakeSummary = (title: string): JournalSummary => ({
  title,
  subtitle: 'sub',
  summary: 'A summary.',
  tags: ['tag'],
  keyDecisions: [],
  nextSteps: [],
  highlights: [],
  extractedLists: [],
  suggestedCollection: null,
});

describe('import pipeline', () => {
  beforeEach(freshDb);

  it('imports a ChatGPT export: entries, messages, stored images associated with their messages', async () => {
    const { batch } = await importZip(sampleChatGptExportFiles(), 'chatgpt');
    assert.equal(batch.status, 'completed');
    assert.equal(batch.counts.imported, 2);
    assert.equal(batch.counts.imagesFound, 3);
    assert.equal(batch.counts.imagesStored, 3);
    const entries = await listEntries();
    assert.equal(entries.length, 2);
    const holo = entries.find((e) => e.title === 'Tabletop hologram display')!;
    assert.equal(holo.summaryStatus, 'not_configured');
    assert.equal(holo.imageCount, 3);
    const view = (await getEntryView(holo.id))!;
    assert.equal(view.messages.length, 17);
    const [first] = view.images;
    assert.ok(first?.available && first.blobKey);
    assert.equal(view.messages.find((m) => m.id === first.messageId)?.sourceMessageId, 'holo-m06');
    const blob = await getBlob(first.blobKey);
    assert.equal(blob?.type, 'image/svg+xml');
    assert.match(await blob!.text(), /<svg/);
  });

  it('imports a Claude export with an unavailable upload and SVG artifacts', async () => {
    const { batch } = await importZip(sampleClaudeExportFiles(), 'claude');
    assert.equal(batch.counts.imported, 1);
    assert.equal(batch.counts.imagesFound, 3);
    assert.equal(batch.counts.imagesStored, 2);
    assert.equal(batch.counts.imagesMissing, 1);
    const [entry] = await listEntries();
    assert.equal(entry?.coverImageId, (await getEntryView(entry!.id))!.images.find((i) => i.available)?.id);
  });

  it('throttles progress events by default but always delivers the final state', async () => {
    const manifest = await zipArchive('t.zip', chatgptEdgeCaseFiles());
    const events: ImportProgress[] = [];
    await runImport({ manifest, importer: importerFor('chatgpt'), options: OPTS, onProgress: (p) => events.push(p) });
    assert.ok(events.length < 7);
    assert.equal(events.at(-1)?.stage, 'done');
    assert.equal(events.at(-1)?.processed, 7);
  });

  it('reports real, monotonic progress ending in done', async () => {
    const { progress } = await importZip(chatgptEdgeCaseFiles(), 'chatgpt');
    assert.equal(progress[0]?.stage, 'parsing');
    assert.equal(progress.at(-1)?.stage, 'done');
    const processed = progress.map((p) => p.processed);
    assert.deepEqual(processed, [...processed].sort((a, b) => a - b));
    assert.equal(progress.at(-1)?.processed, 7);
    assert.equal(progress.at(-1)?.total, 7);
  });

  it('keeps going past malformed records and reports them', async () => {
    const { batch } = await importZip(chatgptEdgeCaseFiles(), 'chatgpt');
    assert.equal(batch.status, 'completed_with_errors');
    assert.equal(batch.counts.imported, 3);
    assert.equal(batch.counts.failed, 3);
    assert.equal(batch.counts.skipped, 1);
    assert.equal(batch.counts.duplicates, 0);
    assert.equal(batch.issues.find((i) => i.conversationId === null)?.recordIndex, 4);
    assert.equal(batch.counts.imagesFound, 4);
    assert.equal(batch.counts.imagesStored, 3);
    assert.ok(batch.issues.some((i) => i.level === 'error' && i.conversationId === 'no-mapping'));
    const [saved] = await listImportBatches();
    assert.equal(saved?.id, batch.id);
  });

  it('skips duplicates on re-import and leaves the database identical (idempotent)', async () => {
    await importZip(sampleChatGptExportFiles(), 'chatgpt');
    const before = await snapshot();
    const { batch } = await importZip(sampleChatGptExportFiles(), 'chatgpt');
    assert.equal(batch.counts.duplicates, 2);
    assert.equal(batch.counts.skipped, 0);
    assert.equal(batch.counts.imported, 0);
    const after = await snapshot();
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.images, before.images);
    assert.deepEqual(after.blobs, before.blobs);
    assert.equal(after.entries.length, 2);
  });

  it('re-importing without skipping rewrites identical data (still idempotent)', async () => {
    await importZip(sampleChatGptExportFiles(), 'chatgpt');
    const before = await snapshot();
    const { batch } = await importZip(sampleChatGptExportFiles(), 'chatgpt', { skipExisting: false });
    assert.equal(batch.counts.duplicates, 2);
    const after = await snapshot();
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.blobs, before.blobs);
    assert.deepEqual(
      after.conversations.map((c) => (c as { revision: string }).revision),
      before.conversations.map((c) => (c as { revision: string }).revision),
    );
  });

  it('updates a changed conversation, keeps user edits, and flags the old summary as outdated', async () => {
    await importZip(sampleChatGptExportFiles(), 'chatgpt');
    const entryId = entryIdFor(conversationIdFor('chatgpt', 'sample-6f1c2a9e-hologram'));
    await applySummary(entryId, fakeSummary('AI title'), 'Test', { autoTag: true });
    await saveEntryEdits(entryId, { title: 'My own title' });

    const files = sampleChatGptExportFiles();
    const convs = JSON.parse(files['conversations.json']!) as Record<string, unknown>[];
    const holo = convs[0] as { mapping: Record<string, { message: { content: { parts: string[] } } }>; update_time: number };
    holo.mapping['holo-m16']!.message.content.parts = ['Changed my mind: acrylic after all.'];
    holo.update_time += 60;
    files['conversations.json'] = JSON.stringify(convs);

    const { batch } = await importZip(files, 'chatgpt');
    assert.equal(batch.counts.updated, 1);
    assert.equal(batch.counts.duplicates, 1);
    const view = (await getEntryView(entryId))!;
    assert.equal(view.entry.title, 'My own title');
    assert.equal(view.derived.title, 'AI title');
    assert.equal(view.entry.summaryOutdated, true);
    assert.equal(view.messages.at(-1)?.text, 'Changed my mind: acrylic after all.');
  });

  it('marks the batch failed on an unreadable export without touching earlier imports', async () => {
    await importZip(sampleClaudeExportFiles(), 'claude');
    const { batch } = await importZip({ 'conversations.json': '[{"broken":', 'users.json': '[]' }, 'claude');
    assert.equal(batch.status, 'failed');
    assert.match(batch.fatalError ?? '', /not valid JSON/);
    assert.equal((await listEntries()).length, 1);
  });

  it('cancellation stops the batch and keeps what was saved', async () => {
    const controller = new AbortController();
    const manifest = await zipArchive('c.zip', chatgptEdgeCaseFiles());
    let saved = 0;
    const batch = await runImport({
      manifest,
      importer: importerFor('chatgpt'),
      options: OPTS,
      signal: controller.signal,
      progressIntervalMs: 0,
      onProgress: (p) => {
        saved = p.counts.imported;
        if (p.counts.imported === 1) controller.abort();
      },
    });
    assert.equal(batch.status, 'cancelled');
    assert.ok(saved >= 1);
    assert.equal((await listEntries()).length, batch.counts.imported);
    assert.ok(batch.counts.imported < 3);
  });

  it('can skip storing image binaries when asked', async () => {
    const { batch } = await importZip(sampleChatGptExportFiles(), 'chatgpt', { importImages: false });
    assert.equal(batch.counts.imagesStored, 0);
    const holo = (await listEntries()).find((e) => e.imageCount === 3)!;
    const view = (await getEntryView(holo.id))!;
    assert.ok(view.images.every((i) => !i.available && /turned off/.test(i.unavailableReason ?? '')));
  });

  it('runs summaries after saving, and a failing summary never blocks or removes the import', async () => {
    let calls = 0;
    const provider: SummaryProvider = {
      label: 'Fake',
      async summarize(input) {
        calls++;
        if (input.sourceTitle.startsWith('Sourdough')) throw new Error('model unavailable');
        return fakeSummary(`Summary of ${input.sourceTitle}`);
      },
    };
    const { batch, progress } = await importZip(sampleChatGptExportFiles(), 'chatgpt', { generateSummaries: true }, { summarizer: makeEntrySummarizer(provider) });
    assert.equal(calls, 2);
    assert.equal(batch.counts.summarized, 1);
    assert.equal(batch.counts.summaryFailed, 1);
    assert.equal(batch.status, 'completed_with_errors');
    assert.ok(progress.some((p) => p.stage === 'summarizing' && p.summaryTotal === 2));
    const entries = await listEntries();
    const failed = entries.find((e) => e.summaryStatus === 'failed')!;
    assert.match(failed.summaryError ?? '', /model unavailable/);
    const view = (await getEntryView(failed.id))!;
    assert.equal(view.messages.length, 5);
    assert.equal(entries.find((e) => e.summaryStatus === 'complete')?.title, 'Summary of Tabletop hologram display');
  });
});
