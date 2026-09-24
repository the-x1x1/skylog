/**
 * Regression tests for defects found in the independent code review (docs/REVIEW.md).
 */
import assert from 'node:assert/strict';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getDb } from '../../src/data/db/database';
import { recoverInterruptedWork } from '../../src/data/recovery';
import { getBlob, getEntryView, listEntries, saveEntryEdits } from '../../src/data/repositories/entries';
import { getImportBatch, saveImportBatch } from '../../src/data/repositories/imports';
import { emptyCounts, type ImportBatch, type ImportOptions, type JournalEntry } from '../../src/data/types';
import { sampleChatGptExportFiles, sampleClaudeExportFiles } from '../../src/fixtures/sample-exports';
import { parseClaudeConversation } from '../../src/importers/claude/parse';
import { LIMITS } from '../../src/importers/core/archive';
import { runImport } from '../../src/importers/core/pipeline';
import { conversationIdFor, entryIdFor } from '../../src/importers/core/prepare';
import { importerFor } from '../../src/importers/registry';
import { SearchIndex } from '../../src/search/engine';
import { applySummary, makeEntrySummarizer, summarizeEntry } from '../../src/summarization/service';
import type { JournalSummary } from '../../src/summarization/types';
import { createAppServer } from '../../server/http';
import { claudeConversation } from '../helpers/fixtures';
import { freshDb, zipArchive } from '../helpers/db';

const OPTS: ImportOptions = { generateSummaries: false, importImages: true, skipExisting: true, autoTag: true };
const HOLO = entryIdFor(conversationIdFor('chatgpt', 'sample-6f1c2a9e-hologram'));

async function importGpt(files = sampleChatGptExportFiles(), opts: Partial<ImportOptions> = {}, summarizer?: Parameters<typeof runImport>[0]['summarizer']) {
  return runImport({ manifest: await zipArchive('gpt.zip', files), importer: importerFor('chatgpt'), options: { ...OPTS, ...opts }, summarizer, progressIntervalMs: 0 });
}

function summary(title: string, extra: Partial<JournalSummary> = {}): JournalSummary {
  return { title, subtitle: 's', summary: `Summary: ${title}`, tags: ['alpha', 'beta'], keyDecisions: [], nextSteps: [{ text: 'Generated step', sourceMessageIds: [] }], highlights: [], extractedLists: [], suggestedCollection: 'Workshop', ...extra };
}

/** Sample export with the hologram conversation cut to its first `keep` turns (an "older" copy). */
function olderHologram(keep: number) {
  const files = sampleChatGptExportFiles();
  const convs = JSON.parse(files['conversations.json']!) as { mapping: Record<string, { children: string[]; message: { create_time: number } | null }>; current_node: string; update_time: number }[];
  const holo = convs[0]!;
  const ids = Object.keys(holo.mapping).filter((id) => /holo-m\d\d$/.test(id)).sort();
  const last = ids[keep - 1]!;
  for (const id of ids.slice(keep)) delete holo.mapping[id];
  holo.mapping[last]!.children = [];
  holo.current_node = last;
  holo.update_time = holo.mapping[last]!.message!.create_time;
  files['conversations.json'] = JSON.stringify(convs);
  return files;
}

describe('review regressions', () => {
  beforeEach(freshDb);

  it('#1 summaries are marked pending only while they run, and startup recovery settles interrupted work', async () => {
    const seen: string[] = [];
    await importGpt(undefined, { generateSummaries: true }, async (entryId) => {
      const pending = (await listEntries()).filter((e) => e.summaryStatus === 'pending').map((e) => e.id);
      seen.push(pending.join(','));
      assert.ok(pending.length === 0, `no entry should be pending before its summary starts (${entryId})`);
    });
    assert.equal(seen.length, 2);

    const db = await getDb();
    const entry = (await listEntries())[0]!;
    await db.write('entries', (tx) => tx.put('entries', { ...entry, summaryStatus: 'pending' } as JournalEntry));
    const batch: ImportBatch = {
      id: 'imp_stuck',
      archiveFileName: 'x.zip',
      archiveSize: 1,
      source: 'chatgpt',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      options: OPTS,
      counts: emptyCounts(),
      issues: [],
      entryIds: [],
      fatalError: null,
    };
    await saveImportBatch(batch);
    const r = await recoverInterruptedWork();
    assert.deepEqual(r, { imports: 1, summaries: 1 });
    assert.equal((await getImportBatch('imp_stuck'))?.status, 'interrupted');
    assert.equal((await getEntryView(entry.id))?.entry.summaryStatus, 'not_configured');
  });

  it('#2 a re-import keeps an existing summary even after a failed regeneration', async () => {
    await importGpt();
    await applySummary(HOLO, summary('Generated title'), 'Test', { autoTag: true });
    await assert.rejects(summarizeEntry(HOLO, { label: 'X', summarize: () => Promise.reject(new Error('down')) }, { autoTag: true }));
    assert.equal((await getEntryView(HOLO))!.entry.summaryStatus, 'failed');
    await importGpt(undefined, { skipExisting: false });
    const v = (await getEntryView(HOLO))!;
    assert.equal(v.entry.title, 'Generated title');
    assert.equal(v.entry.summary, 'Summary: Generated title');
    assert.equal(v.entry.summaryStatus, 'failed');
  });

  it('#2 a cancelled summary restores the previous status and error', async () => {
    await importGpt();
    await applySummary(HOLO, summary('Kept'), 'Test', { autoTag: true });
    const ac = new AbortController();
    const provider = {
      label: 'Slow',
      summarize: () => {
        ac.abort();
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
    };
    await assert.rejects(summarizeEntry(HOLO, provider, { autoTag: true, signal: ac.signal }));
    const v = (await getEntryView(HOLO))!;
    assert.equal(v.entry.summaryStatus, 'complete');
    assert.equal(v.entry.summaryError, null);
  });

  it('#3 an older export never overwrites a newer conversation', async () => {
    await importGpt();
    const before = (await getEntryView(HOLO))!;
    const batch = await importGpt(olderHologram(8));
    assert.equal(batch.counts.updated, 0);
    assert.equal(batch.counts.duplicates, 2);
    assert.ok(batch.issues.some((i) => /older copy/.test(i.reason)));
    const after = (await getEntryView(HOLO))!;
    assert.equal(after.messages.length, before.messages.length);
    for (const img of after.images.filter((i) => i.available)) assert.ok(await getBlob(img.blobKey!));
  });

  it('#3 a newer export does update an older one', async () => {
    await importGpt(olderHologram(8));
    assert.equal((await getEntryView(HOLO))!.messages.length, 8);
    const batch = await importGpt();
    assert.equal(batch.counts.updated, 1);
    assert.equal((await getEntryView(HOLO))!.messages.length, 17);
  });

  it('#4 re-importing with images off keeps stored images', async () => {
    await importGpt();
    await importGpt(undefined, { importImages: false, skipExisting: false });
    const v = (await getEntryView(HOLO))!;
    assert.equal(v.images.filter((i) => i.available).length, 3);
    for (const img of v.images) assert.ok(await getBlob(img.blobKey!), `blob for ${img.id}`);
    assert.equal(v.entry.availableImageCount, 3);
    assert.ok(v.entry.coverImageId);
  });

  it('#4 importing again with images on fills in images that were skipped before', async () => {
    await importGpt(undefined, { importImages: false });
    assert.equal((await getEntryView(HOLO))!.images.filter((i) => i.available).length, 0);
    const batch = await importGpt(undefined, { importImages: true, skipExisting: true });
    assert.equal(batch.counts.updated, 1);
    assert.equal(batch.counts.imagesStored, 3);
    assert.equal((await getEntryView(HOLO))!.images.filter((i) => i.available).length, 3);
  });

  it('#5 saving an edit stores only real changes, so later summaries still fill other fields', async () => {
    await importGpt();
    const v = (await getEntryView(HOLO))!;
    await saveEntryEdits(HOLO, { title: 'My title', tags: v.entry.tags, nextSteps: v.entry.nextSteps, collectionId: v.entry.collectionId });
    assert.deepEqual(Object.keys((await getEntryView(HOLO))!.edits ?? {}).sort(), ['entryId', 'title', 'updatedAt']);
    await applySummary(HOLO, summary('AI'), 'Test', { autoTag: true });
    const after = (await getEntryView(HOLO))!;
    assert.equal(after.entry.title, 'My title');
    assert.deepEqual(after.entry.tags, ['alpha', 'beta']);
    assert.deepEqual(
      after.entry.nextSteps.map((s) => s.text),
      ['Generated step'],
    );
    assert.equal(after.collection?.name, 'Workshop');
    assert.equal(after.entry.edited.nextSteps, false);
  });

  it('#7 a failed index update does not stop later updates', async () => {
    await importGpt();
    const index = new SearchIndex();
    await index.rebuild();
    const ms = (index as unknown as { ms: { addAll: (d: unknown[]) => void } }).ms;
    const original = ms.addAll.bind(ms);
    let failures = 1;
    ms.addAll = (docs) => {
      if (failures-- > 0) throw new Error('boom');
      original(docs);
    };
    const originalError = console.error;
    console.error = () => undefined;
    try {
      await index.updateConversations([conversationIdFor('chatgpt', 'sample-6f1c2a9e-hologram')]);
    } finally {
      console.error = originalError;
    }
    await saveEntryEdits(HOLO, { title: 'Zeppelin workshop' });
    await index.updateConversations([conversationIdFor('chatgpt', 'sample-6f1c2a9e-hologram')]);
    assert.equal((await index.search('zeppelin')).entries.length, 1);
    assert.ok((await index.search('jellyfish')).messages.length > 0);
  });

  it('#8 artifact updates keep "$" sequences literally', () => {
    const conv = parseClaudeConversation(
      claudeConversation({
        chat_messages: [
          { uuid: 'a', sender: 'assistant', content: [{ type: 'tool_use', name: 'artifacts', input: { id: 'eq', command: 'create', type: 'image/svg+xml', title: 'Eq', content: '<svg>OLD</svg>' } }] },
          { uuid: 'b', sender: 'assistant', content: [{ type: 'tool_use', name: 'artifacts', input: { id: 'eq', command: 'update', old_str: 'OLD', new_str: "$$E=mc^2$$ and $' and $&" } }] },
        ],
      }),
      new Map(),
    );
    assert.equal(conv.images[1]?.inlineContent, "<svg>$$E=mc^2$$ and $' and $&</svg>");
  });

  it('#9 Claude pasted and attached text is kept, shown and searchable', async () => {
    const files = sampleClaudeExportFiles();
    const convs = JSON.parse(files['conversations.json']!) as { chat_messages: { attachments: unknown[] }[] }[];
    convs[0]!.chat_messages[0]!.attachments = [{ file_name: '', file_size: 40, file_type: 'txt', extracted_content: 'Soil test: pH 6.4, nitrogen low, quokka' }];
    files['conversations.json'] = JSON.stringify(convs);
    await runImport({ manifest: await zipArchive('c.zip', files), importer: importerFor('claude'), options: OPTS });
    const entry = (await listEntries())[0]!;
    const v = (await getEntryView(entry.id))!;
    assert.equal(v.messages[0]?.attachments[0]?.extractedText, 'Soil test: pH 6.4, nitrogen low, quokka');
    assert.equal(v.messages[0]?.attachments[0]?.name, 'Pasted text');
    const index = new SearchIndex();
    await index.rebuild();
    assert.equal((await index.search('quokka')).messages[0]?.index, 0);
  });

  it('#10 text beyond the first 20,000 characters of a message is searchable', async () => {
    const files = sampleClaudeExportFiles();
    const convs = JSON.parse(files['conversations.json']!) as { chat_messages: { content: { type: string; text: string }[] }[] }[];
    convs[0]!.chat_messages[1]!.content = [{ type: 'text', text: `${'lorem ipsum dolor '.repeat(3000)} axolotl ${'sit amet '.repeat(500)}` }];
    files['conversations.json'] = JSON.stringify(convs);
    await runImport({ manifest: await zipArchive('c.zip', files), importer: importerFor('claude'), options: OPTS });
    const index = new SearchIndex();
    await index.rebuild();
    const r = await index.search('axolotl');
    assert.equal(r.messages.length, 1);
    assert.match(r.messages[0]!.snippet.map((s) => s.text).join(''), /axolotl/);
  });

  it('#11 the JSON size limit stays below the browser string-length ceiling', () => {
    assert.ok(LIMITS.maxJsonBytes <= 512 * 1024 ** 2);
  });

  it('#13 an unchanged re-import counts as already imported and keeps its import date', async () => {
    await importGpt();
    const firstImportedAt = (await getEntryView(HOLO))!.entry.importedAt;
    await new Promise((r) => setTimeout(r, 5));
    const batch = await importGpt(undefined, { skipExisting: false });
    assert.equal(batch.counts.duplicates, 2);
    assert.equal(batch.counts.updated, 0);
    assert.equal((await getEntryView(HOLO))!.entry.importedAt, firstImportedAt);
  });

  it('summaries run through the pipeline without leaving entries pending', async () => {
    await importGpt(undefined, { generateSummaries: true }, makeEntrySummarizer({ label: 'T', summarize: async (i) => summary(`S ${i.sourceTitle}`) }));
    assert.ok((await listEntries()).every((e) => e.summaryStatus === 'complete'));
  });
});

describe('#6 local API rejects DNS-rebinding hosts', () => {
  let server: http.Server;
  let port = 0;
  before(async () => {
    server = createAppServer({ root: '/nonexistent', env: {} });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  after(() => server.close());

  async function status(headers: Record<string, string>): Promise<number> {
    const { request } = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/llm/status', headers: { 'x-journal-client': '1', ...headers } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('accepts loopback hosts and rejects others', async () => {
    assert.equal(await status({ host: `127.0.0.1:${port}` }), 200);
    assert.equal(await status({ host: `localhost:${port}`, origin: `http://localhost:${port}` }), 200);
    assert.equal(await status({ host: `attacker.example:${port}` }), 403);
    assert.equal(await status({ host: `attacker.example:${port}`, origin: `http://attacker.example:${port}` }), 403);
    assert.equal(await status({ host: `localhost:${port}`, origin: 'http://attacker.example' }), 403);
  });
});
