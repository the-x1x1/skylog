import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { DB_NAME, getDb, setIndexedDbFactory } from '../../src/data/db/database';
import { Db } from '../../src/data/db/idb';
import { ALL_STORES, MIGRATIONS, SCHEMA_VERSION } from '../../src/data/migrations';
import { applyEdits, deleteAllData, deleteEntry, getBlob, getEntryView, listEntries, saveEntryEdits } from '../../src/data/repositories/entries';
import type { JournalEntry } from '../../src/data/types';
import { loadSampleJournal } from '../../src/fixtures/sample-journal';
import { applySummary } from '../../src/summarization/service';
import { freshDb } from '../helpers/db';

describe('schema', () => {
  beforeEach(freshDb);

  it('creates every store and index at the current version', async () => {
    const db = await getDb();
    assert.equal(db.version, SCHEMA_VERSION);
    assert.deepEqual([...db.storeNames].sort(), [...ALL_STORES].sort());
    const indexes = await db.read('entries', async (tx) => Array.from(tx.store('entries').indexNames).sort());
    assert.deepEqual(indexes, ['chatDate', 'collectionId', 'conversationId', 'importedAt', 'source', 'tags', 'updatedAt']);
  });

  it('uses a database name that does not depend on the product name', () => {
    assert.equal(DB_NAME, 'conversation-journal');
  });
});

describe('migrations', () => {
  it('upgrades a v1 database to the current version without losing data', async () => {
    const factory = new IDBFactory();
    const v1 = await Db.open({ name: DB_NAME, migrations: MIGRATIONS.filter((m) => m.version === 1), factory });
    await v1.write('entries', (tx) =>
      tx.put('entries', { id: 'entry:legacy', conversationId: 'c', importedAt: '2026-01-01T00:00:00.000Z', title: 'Legacy', tags: ['a'], source: 'claude', chatDate: null, collectionId: null }),
    );
    v1.close();

    setIndexedDbFactory(factory);
    const db = await getDb();
    assert.equal(db.version, SCHEMA_VERSION);
    const entry = await db.read('entries', (tx) => tx.get<JournalEntry>('entries', 'entry:legacy'));
    assert.equal(entry?.title, 'Legacy');
    assert.equal(entry?.summaryOutdated, false);
    assert.equal(entry?.updatedAt, '2026-01-01T00:00:00.000Z');
    const byUpdated = await db.read('entries', (tx) => tx.getAllFromIndex<JournalEntry>('entries', 'updatedAt'));
    assert.equal(byUpdated.length, 1);
  });

  it('rolls back the version bump when a data upgrade fails', async () => {
    const factory = new IDBFactory();
    const good = MIGRATIONS.filter((m) => m.version === 1);
    (await Db.open({ name: 't', migrations: good, factory })).close();
    const bad = [...good, { version: 2, description: 'boom', upgrade: async () => { throw new Error('upgrade failed'); } }];
    await assert.rejects(Db.open({ name: 't', migrations: bad, factory }), /upgrade failed/);
    const reopened = await Db.open({ name: 't', migrations: good, factory });
    assert.equal(reopened.version, 1);
    reopened.close();
  });
});

describe('persistence', () => {
  beforeEach(freshDb);

  it('persists image blobs and reads back the exact bytes', async () => {
    await loadSampleJournal();
    const entries = await listEntries();
    const view = (await getEntryView(entries.find((e) => e.imageCount === 3 && e.source === 'chatgpt')!.id))!;
    for (const img of view.images) {
      const blob = await getBlob(img.blobKey!);
      assert.ok(blob && blob.size > 100, `blob for ${img.id}`);
      assert.equal(blob.size, img.byteSize);
    }
  });

  it('user edits survive summary regeneration', async () => {
    await loadSampleJournal();
    const entry = (await listEntries()).find((e) => e.source === 'claude')!;
    await saveEntryEdits(entry.id, { title: 'Garden plan (mine)', tags: ['Garden', ' #beds ', 'garden'], nextSteps: [{ id: 's1', text: 'Buy cedar', sourceMessageIds: [] }] });
    await applySummary(
      entry.id,
      { title: 'Regenerated', subtitle: 'New subtitle', summary: 'New summary', tags: ['x'], keyDecisions: [], nextSteps: [{ text: 'AI step', sourceMessageIds: [] }], highlights: [], extractedLists: [], suggestedCollection: null },
      'Test',
      { autoTag: true },
    );
    const view = (await getEntryView(entry.id))!;
    assert.equal(view.entry.title, 'Garden plan (mine)');
    assert.deepEqual(view.entry.tags, ['garden', 'beds']);
    assert.deepEqual(
      view.entry.nextSteps.map((s) => s.text),
      ['Buy cedar'],
    );
    assert.equal(view.entry.subtitle, 'New subtitle');
    assert.equal(view.entry.summary, 'New summary');
    assert.equal(view.derived.title, 'Regenerated');
    assert.equal(view.entry.edited.title, true);
    assert.equal(view.entry.edited.subtitle, false);
  });

  it('clearing an edit reverts to the derived value', async () => {
    await loadSampleJournal();
    const entry = (await listEntries()).find((e) => e.source === 'claude')!;
    await saveEntryEdits(entry.id, { title: 'Temp' });
    await saveEntryEdits(entry.id, {}, ['title']);
    assert.equal((await getEntryView(entry.id))!.entry.title, entry.title);
    assert.equal((await getEntryView(entry.id))!.edits, null);
  });

  it('deleting an entry removes its source data and blobs', async () => {
    await loadSampleJournal();
    const entry = (await listEntries()).find((e) => e.imageCount === 3 && e.source === 'chatgpt')!;
    const view = (await getEntryView(entry.id))!;
    await deleteEntry(entry.id);
    assert.equal(await getEntryView(entry.id), null);
    assert.equal(await getBlob(view.images[0]!.blobKey!), null);
    const db = await getDb();
    const leftovers = await db.read('messages', (tx) => tx.getAllFromIndex('messages', 'conversationId', entry.conversationId));
    assert.equal(leftovers.length, 0);
    assert.equal((await listEntries()).length, 2);
  });

  it('delete all data empties every store', async () => {
    await loadSampleJournal();
    await deleteAllData();
    const db = await getDb();
    for (const s of ['entries', 'messages', 'images', 'blobs', 'imports', 'conversations']) {
      assert.equal(await db.read(s, (tx) => tx.count(s)), 0, s);
    }
  });

  it('applyEdits only overrides edited fields', () => {
    const base = { title: 'A', subtitle: 'B', tags: ['t'], nextSteps: [], collectionId: 'c1' } as unknown as JournalEntry;
    const e = applyEdits(base, { entryId: 'x', title: 'Mine', collectionId: null, updatedAt: '' });
    assert.equal(e.title, 'Mine');
    assert.equal(e.subtitle, 'B');
    assert.equal(e.collectionId, null);
    assert.deepEqual(e.edited, { title: true, subtitle: false, tags: false, nextSteps: false, collectionId: true });
  });
});
