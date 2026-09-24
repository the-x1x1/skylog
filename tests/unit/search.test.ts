import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { deleteEntry, listEntries, saveEntryEdits } from '../../src/data/repositories/entries';
import { loadSampleJournal } from '../../src/fixtures/sample-journal';
import { SearchIndex } from '../../src/search/engine';
import { highlight, makeSnippet } from '../../src/search/snippet';
import type { Segment } from '../../src/search/types';
import { freshDb } from '../helpers/db';

const text = (segs: Segment[]) => segs.map((s) => (s.match ? `[${s.text}]` : s.text)).join('');

describe('search index', () => {
  let index: SearchIndex;
  beforeEach(async () => {
    await freshDb();
    await loadSampleJournal();
    index = new SearchIndex();
    await index.rebuild();
  });

  it('finds entries by title and summary', async () => {
    const r = await index.search('pepper ghost');
    assert.equal(r.entries[0]?.entryTitle, 'Tabletop hologram display');
    assert.match(text(r.entries[0]!.snippet), /\[Pepper/);
  });

  it('finds images by generation prompt and title', async () => {
    const r = await index.search('lamp');
    assert.ok(r.images.some((i) => /lamp/i.test(text(i.snippet))));
    const t = await index.search('walnut box night');
    assert.equal(t.images[0]?.imageTitle, 'Walnut hologram box at night');
    assert.ok(t.images[0]?.imageId);
  });

  it('finds message text and returns the message id and index for deep links', async () => {
    const r = await index.search('perlite 65');
    const hit = r.messages[0]!;
    assert.equal(hit.entryTitle, 'Raised beds for the side yard');
    assert.equal(hit.index, 7);
    assert.match(hit.messageId, /garden-m07$/);
    assert.match(text(hit.snippet), /\[Perlite\]/);
  });

  it('tolerates typos and matches word prefixes', async () => {
    assert.ok((await index.search('holgram')).entries.length > 0);
    assert.ok((await index.search('sourd')).entries.some((e) => /Sourdough/.test(e.entryTitle)));
    assert.ok((await index.search('trelis')).messages.length > 0);
  });

  it('applies source, date and tag filters', async () => {
    assert.equal((await index.search('soil', { source: 'chatgpt' })).messages.length, 0);
    assert.ok((await index.search('soil', { source: 'claude' })).messages.length > 0);
    assert.equal((await index.search('starter', { from: '2026-09-01' })).entries.length, 0);
    assert.equal((await index.search('starter', { to: '2026-08-31' })).entries.length, 1);
    assert.equal((await index.search('walnut', { tag: 'garden' })).entries.length, 0);
    assert.equal((await index.search('walnut', { tag: 'hologram' })).entries.length, 1);
  });

  it('ignores one-character queries', async () => {
    const r = await index.search('a');
    assert.equal(r.entries.length + r.images.length + r.messages.length, 0);
  });

  it('re-indexes a conversation after edits and removes deleted entries', async () => {
    const garden = (await listEntries()).find((e) => e.source === 'claude')!;
    await saveEntryEdits(garden.id, { title: 'Zucchini fortress' });
    await index.updateConversations([garden.conversationId]);
    assert.equal((await index.search('zucchini')).entries[0]?.entryTitle, 'Zucchini fortress');
    await deleteEntry(garden.id);
    await index.updateConversations([garden.conversationId]);
    assert.equal((await index.search('perlite')).messages.length, 0);
  });
});

describe('snippets', () => {
  it('highlights matches at word starts, extending to the whole word', () => {
    assert.equal(text(highlight('Walnut board and walnuts', ['walnut'])), '[Walnut] board and [walnuts]');
    assert.equal(text(highlight('peanut', ['nut'])), 'peanut');
  });

  it('centers a window on the first match with ellipses', () => {
    const long = `${'lorem '.repeat(60)}needle ${'ipsum '.repeat(60)}`;
    const s = text(makeSnippet(long, ['needle'], 40));
    assert.ok(s.startsWith('…') && s.endsWith('…'));
    assert.match(s, /\[needle\]/);
    assert.ok(s.length < 200);
  });
});
