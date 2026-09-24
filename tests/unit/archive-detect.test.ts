import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { sampleChatGptExportFiles, sampleClaudeExportFiles } from '../../src/fixtures/sample-exports';
import { chatgptImporter } from '../../src/importers/chatgpt/importer';
import { claudeImporter } from '../../src/importers/claude/importer';
import { openZipArchive } from '../../src/importers/core/archive';
import { detectSource } from '../../src/importers/core/detect';
import { ImportController } from '../../src/importers/core/session';
import { ImportError } from '../../src/importers/core/types';
import { ZipReader } from '../../src/importers/core/zip';
import { IMPORTERS } from '../../src/importers/registry';
import { createZip } from '../../src/utils/zip-writer';
import { chatgptEdgeCaseFiles, claudeEdgeCaseFiles, PNG_1PX } from '../helpers/fixtures';
import { zipArchive } from '../helpers/db';

const FIXTURES = path.join(import.meta.dirname, '../../fixtures/exports');

describe('zip reader', () => {
  it('reads stored and deflated entries with UTF-8 names', async () => {
    for (const compress of [true, false]) {
      const bytes = await createZip({ 'héllo/wörld.txt': 'grüße', 'img.png': PNG_1PX }, { compress });
      const zip = await ZipReader.open(new Blob([bytes as BlobPart]));
      const txt = zip.entries.find((e) => e.name === 'héllo/wörld.txt')!;
      assert.equal(await zip.text(txt), 'grüße');
      const png = await zip.blobOf(zip.entries.find((e) => e.name === 'img.png')!, 'image/png');
      assert.deepEqual(new Uint8Array(await png.arrayBuffer()), PNG_1PX);
    }
  });

  it('reads only the head of an entry for sniffing', async () => {
    const big = 'x'.repeat(200_000);
    const zip = await ZipReader.open(new Blob([(await createZip({ 'big.json': big })) as BlobPart]));
    const head = await zip.head(zip.entries[0]!, 1000);
    assert.equal(head.length, 1000);
  });

  it('rejects files that are not zips with a readable error', async () => {
    await assert.rejects(ZipReader.open(new Blob(['PK not a zip at all, just text padding here....'])), /not a valid \.zip/);
    await assert.rejects(ZipReader.open(new Blob(['tiny'])), /too small/);
  });

  it('treats the folder holding conversations.json as the archive root', async () => {
    const nested = Object.fromEntries(Object.entries(sampleChatGptExportFiles()).map(([k, v]) => [`Export 2026/${k}`, v]));
    const m = await zipArchive('nested.zip', { ...nested, '__MACOSX/._conversations.json': 'junk' });
    assert.ok(m.has('conversations.json'));
    assert.ok(m.has('file-HoloConcept01-9d2b3c1e-concept.svg'));
    assert.ok(!m.files.some((f) => f.path.includes('__MACOSX')));
    assert.match(m.sniffs['conversations.json'] ?? '', /"mapping"/);
  });
});

describe('source detection and preview', () => {
  it('detects ChatGPT and Claude exports from their structure', async () => {
    const gpt = await zipArchive('a.zip', sampleChatGptExportFiles());
    const claude = await zipArchive('b.zip', sampleClaudeExportFiles());
    assert.deepEqual(detectSource(gpt, IMPORTERS).source, 'chatgpt');
    assert.equal(detectSource(gpt, IMPORTERS).ambiguous, false);
    assert.deepEqual(detectSource(claude, IMPORTERS).source, 'claude');
    assert.equal(chatgptImporter.canHandle(gpt), true);
    assert.equal(claudeImporter.canHandle(gpt), false);
  });

  it('is ambiguous when nothing matches, so the user chooses', async () => {
    const m = await zipArchive('x.zip', { 'readme.txt': 'hi' });
    const d = detectSource(m, IMPORTERS);
    assert.equal(d.source, null);
    assert.equal(d.ambiguous, true);
  });

  it('is ambiguous when only weak signals exist', async () => {
    const m = await zipArchive('x.zip', { 'conversations.json': '[]', 'users.json': '[]' });
    const d = detectSource(m, IMPORTERS);
    assert.equal(d.source, 'claude');
    assert.equal(d.ambiguous, true);
  });

  it('previews conversation and image counts with warnings', async () => {
    const gpt = await chatgptImporter.inspect(await zipArchive('e.zip', chatgptEdgeCaseFiles()));
    assert.equal(gpt.source, 'chatgpt');
    assert.equal(gpt.conversationCount, 4);
    assert.equal(gpt.imageCount, 4);
    assert.equal(gpt.imageFilesPresent, 3);
    assert.ok(gpt.warnings.some((w) => /malformed/.test(w)));
    assert.ok(gpt.warnings.some((w) => /not included/.test(w)));
    assert.ok(gpt.dateRange.from && gpt.dateRange.to);

    const claude = await claudeImporter.inspect(await zipArchive('c.zip', claudeEdgeCaseFiles()));
    assert.equal(claude.conversationCount, 3);
    assert.equal(claude.imageCount, 4);
    assert.equal(claude.imageFilesPresent, 3);
    assert.ok(claude.warnings.some((w) => /don't include uploaded image files/.test(w)));
  });

  it('import controller rejects non-zip files and missing conversations.json clearly', async () => {
    const c = new ImportController();
    await assert.rejects(c.open(new Blob(['x']), 'notes.txt'), (e: unknown) => e instanceof ImportError && /not a \.zip/.test(e.message));
    const empty = await createZip({ 'readme.txt': 'x' });
    const r = await c.open(new Blob([empty as BlobPart]), 'empty.zip');
    assert.equal(r.preview, null);
    await assert.rejects(c.preview('chatgpt'), /No conversations\.json/);
  });

  it('opens every committed fixture export (or fails with a readable error)', async () => {
    const expectations: Record<string, 'chatgpt' | 'claude' | 'ambiguous' | 'error'> = {
      'chatgpt-sample-export.zip': 'chatgpt',
      'claude-sample-export.zip': 'claude',
      'chatgpt-edge-cases.zip': 'chatgpt',
      'claude-edge-cases.zip': 'claude',
      'chatgpt-nested-folder.zip': 'chatgpt',
      'not-an-export.zip': 'ambiguous',
      'corrupt.zip': 'error',
    };
    for (const [name, expected] of Object.entries(expectations)) {
      const file = new Blob([fs.readFileSync(path.join(FIXTURES, name))]);
      if (expected === 'error') {
        await assert.rejects(openZipArchive(file, name), ImportError);
        continue;
      }
      const d = detectSource(await openZipArchive(file, name), IMPORTERS);
      assert.equal(d.ambiguous ? 'ambiguous' : d.source, expected, name);
    }
  });
});
