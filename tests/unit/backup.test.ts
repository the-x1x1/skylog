import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createBackup, isBackupArchive, restoreBackup } from '../../src/data/backup';
import { getBlob, getEntryView, listEntries, saveEntryEdits } from '../../src/data/repositories/entries';
import { listImportBatches } from '../../src/data/repositories/imports';
import { loadSampleJournal } from '../../src/fixtures/sample-journal';
import { openZipArchive } from '../../src/importers/core/archive';
import { ImportController } from '../../src/importers/core/session';
import { createZip } from '../../src/utils/zip-writer';
import { freshDb } from '../helpers/db';

describe('journal backup', () => {
  beforeEach(freshDb);

  it('round-trips entries, transcripts, image bytes, edits and import history', async () => {
    await loadSampleJournal();
    const holo = (await listEntries()).find((e) => e.title === 'Tabletop hologram display')!;
    await saveEntryEdits(holo.id, { title: 'Hologram (edited)' });
    const before = (await getEntryView(holo.id))!;
    const beforeBytes = await Promise.all(before.images.map(async (i) => new Uint8Array(await (await getBlob(i.blobKey!))!.arrayBuffer())));

    const { blob, summary } = await createBackup();
    assert.equal(summary.entries, 3);
    assert.equal(summary.images, 5);
    assert.ok(isBackupArchive((await openZipArchive(blob, 'b.zip')).files));

    await freshDb();
    assert.equal((await listEntries()).length, 0);
    const restored = await restoreBackup(blob, 'b.zip');
    assert.equal(restored.entries, 3);

    const after = (await getEntryView(holo.id))!;
    assert.equal(after.entry.title, 'Hologram (edited)');
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.images, before.images);
    for (let i = 0; i < after.images.length; i++) {
      const bytes = new Uint8Array(await (await getBlob(after.images[i]!.blobKey!))!.arrayBuffer());
      assert.deepEqual(bytes, beforeBytes[i]);
      assert.equal((await getBlob(after.images[i]!.blobKey!))!.type, before.images[i]!.mimeType);
    }
    assert.equal((await listImportBatches()).length, 2);
  });

  it('restoring merges instead of wiping', async () => {
    await loadSampleJournal();
    const { blob } = await createBackup();
    const garden = (await listEntries()).find((e) => e.source === 'claude')!;
    await saveEntryEdits(garden.id, { title: 'Changed after backup' });
    await restoreBackup(blob, 'b.zip');
    assert.equal((await listEntries()).length, 3);
  });

  it('rejects files that are not backups, and newer schemas, with clear messages', async () => {
    const notBackup = new Blob([(await createZip({ 'conversations.json': '[]' })) as BlobPart]);
    await assert.rejects(restoreBackup(notBackup, 'x.zip'), /not a journal backup/);
    const future = new Blob([(await createZip({ 'backup.json': JSON.stringify({ format: 'conversation-journal-backup', formatVersion: 1, schemaVersion: 999, stores: {} }) })) as BlobPart]);
    await assert.rejects(restoreBackup(future, 'f.zip'), /newer version/);
  });

  it('the importer points people to Settings when they drop a backup', async () => {
    await loadSampleJournal();
    const { blob } = await createBackup();
    await assert.rejects(new ImportController().open(blob, 'journal-backup.zip'), /journal backup.*Settings/);
  });

  it('the import preview counts conversations already in the journal', async () => {
    await loadSampleJournal();
    const { sampleChatGptExportFiles } = await import('../../src/fixtures/sample-exports');
    const zip = new Blob([(await createZip(sampleChatGptExportFiles())) as BlobPart]);
    const { preview } = await new ImportController().open(zip, 'gpt.zip');
    assert.equal(preview?.alreadyInJournal, 2);
    assert.equal(preview?.conversationIds, undefined);
  });
});
