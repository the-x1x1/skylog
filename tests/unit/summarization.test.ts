import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { getEntryView, listEntries } from '../../src/data/repositories/entries';
import { loadSampleJournal } from '../../src/fixtures/sample-journal';
import { deriveFallback } from '../../src/summarization/fallback';
import { LlmSummaryProvider } from '../../src/summarization/llm-provider';
import { chunkTranscript } from '../../src/summarization/prompts';
import { summarizeEntry } from '../../src/summarization/service';
import type { LlmClient, LlmCompletionRequest, SummaryInput } from '../../src/summarization/types';
import { parseJsonLoose, validateSummary } from '../../src/summarization/validate';
import { freshDb } from '../helpers/db';

const refs = new Map([
  ['m0', 'msg-a'],
  ['m1', 'msg-b'],
  ['m2', 'msg-c'],
]);

const valid = {
  title: 'Planning the shelves',
  subtitle: 'Depth and width decided.',
  summary: 'Decided on 25 cm deep shelves.',
  tags: ['Shelves', '#DIY', 'shelves'],
  keyDecisions: [{ text: 'Shelves 25 cm deep', sourceMessageIds: ['m1', 'm9'] }],
  nextSteps: [{ text: 'Buy brackets', sourceMessageIds: [2] }],
  highlights: [{ messageId: 'm1' }, { messageId: 'nope' }],
  extractedLists: [{ heading: 'Parts', rows: [{ label: 'Bracket', value: 4, sourceMessageIds: ['m1'] }] }],
  suggestedCollection: 'Home',
};

class FakeClient implements LlmClient {
  calls: LlmCompletionRequest[] = [];
  constructor(private readonly replies: ((req: LlmCompletionRequest) => string)[]) {}
  label() {
    return 'Fake · model';
  }
  async status() {
    return { ok: true, label: 'Fake', detail: '' };
  }
  async complete(req: LlmCompletionRequest) {
    this.calls.push(req);
    const next = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)]!;
    return next(req);
  }
}

function input(messages: number, textLength = 50): SummaryInput {
  return {
    conversationId: 'c',
    source: 'claude',
    sourceTitle: 'T',
    autoTag: true,
    images: [],
    messages: Array.from({ length: messages }, (_, i) => ({
      id: `id-${i}`,
      index: i,
      role: i % 2 ? 'assistant' : 'user',
      authorName: null,
      text: `message ${i} `.padEnd(textLength, 'x'),
      createdAt: null,
    })),
  };
}

describe('summary schema validation', () => {
  it('maps message refs to ids and drops unknown refs instead of trusting them', () => {
    const r = validateSummary(valid, refs);
    assert.ok(r.ok);
    assert.deepEqual(r.value.keyDecisions[0]?.sourceMessageIds, ['msg-b']);
    assert.deepEqual(r.value.nextSteps[0]?.sourceMessageIds, ['msg-c']);
    assert.deepEqual(r.value.highlights, [{ messageId: 'msg-b' }]);
    assert.deepEqual(r.value.tags, ['shelves', 'diy']);
    assert.equal(r.value.extractedLists[0]?.rows[0]?.value, '4');
    assert.ok(r.warnings.length >= 2);
  });

  it('rejects replies missing required fields or with wrong types', () => {
    assert.equal(validateSummary({ ...valid, title: '' }, refs).ok, false);
    assert.equal(validateSummary({ ...valid, summary: 5 }, refs).ok, false);
    assert.equal(validateSummary({ ...valid, keyDecisions: 'x' }, refs).ok, false);
    assert.equal(validateSummary([], refs).ok, false);
  });

  it('parses JSON wrapped in code fences or prose', () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('Here you go: {"a":2} thanks'), { a: 2 });
    assert.throws(() => parseJsonLoose('no json here'));
  });
});

describe('LLM summary provider', () => {
  it('returns a validated summary from one call for a short conversation', async () => {
    const client = new FakeClient([() => JSON.stringify({ ...valid, keyDecisions: [{ text: 'x', sourceMessageIds: ['m1'] }] })]);
    const s = await new LlmSummaryProvider(client).summarize(input(3));
    assert.equal(client.calls.length, 1);
    assert.deepEqual(s.keyDecisions[0]?.sourceMessageIds, ['id-1']);
    assert.match(client.calls[0]!.prompt, /\[m0\] USER/);
    assert.match(client.calls[0]!.system, /Prefer omission over speculation/);
  });

  it('retries a malformed reply exactly once with a repair instruction', async () => {
    const client = new FakeClient([() => 'Sure! Here is a summary without JSON.', () => JSON.stringify(valid)]);
    const s = await new LlmSummaryProvider(client).summarize(input(2));
    assert.equal(s.title, 'Planning the shelves');
    assert.equal(client.calls.length, 2);
    assert.match(client.calls[1]!.prompt, /could not be used/);
  });

  it('fails after the single repair attempt', async () => {
    const client = new FakeClient([() => '{"title": ""}']);
    await assert.rejects(new LlmSummaryProvider(client).summarize(input(2)), /after one repair attempt/);
    assert.equal(client.calls.length, 2);
  });

  it('chunks long conversations, summarizes each part, then merges', async () => {
    const client = new FakeClient([
      (req) => {
        const part = /part (\d+) of (\d+)/.exec(req.prompt);
        if (part) return JSON.stringify({ ...valid, title: `Part ${part[1]}`, keyDecisions: [{ text: `d${part[1]}`, sourceMessageIds: [`m${Number(part[1]) * 10}`] }] });
        assert.match(req.prompt, /Merge them/);
        const notes = JSON.parse(req.prompt.slice(req.prompt.indexOf('['), req.prompt.lastIndexOf(']') + 1)) as { keyDecisions: { sourceMessageIds: string[] }[] }[];
        return JSON.stringify({ ...valid, title: 'Merged', keyDecisions: notes.map((n, i) => ({ text: `merged ${i}`, sourceMessageIds: n.keyDecisions[0]?.sourceMessageIds ?? [] })) });
      },
    ]);
    const long = input(60, 900);
    const provider = new LlmSummaryProvider(client, { chunkChars: 8000, mergeFanIn: 50 });
    const s = await provider.summarize(long);
    const parts = chunkTranscript(long, 8000).length;
    assert.ok(parts > 1);
    assert.equal(client.calls.length, parts + 1);
    assert.equal(s.title, 'Merged');
    assert.deepEqual(s.keyDecisions[0]?.sourceMessageIds, ['id-10']);

    // With a small fan-in, partial summaries are merged in rounds (groups of 3, then the results).
    client.calls = [];
    await new LlmSummaryProvider(client, { chunkChars: 8000, mergeFanIn: 3 }).summarize(long);
    const firstRound = Math.ceil(parts / 3);
    const merges = firstRound + (firstRound > 3 ? Math.ceil(firstRound / 3) + 1 : firstRound > 1 ? 1 : 0);
    assert.equal(client.calls.length, parts + merges);
  });

  it('trims very long messages instead of sending them whole', () => {
    const big = input(1, 50_000);
    const [chunk] = chunkTranscript(big, 100_000);
    assert.ok(chunk![0]!.length < 4000);
    assert.match(chunk![0]!, /characters trimmed/);
  });
});

describe('fallback without a provider', () => {
  it('uses the source title, or the first meaningful user message', () => {
    assert.equal(deriveFallback('Trip to Kyoto', []).title, 'Trip to Kyoto');
    const fb = deriveFallback('New chat', [
      { role: 'user', text: 'hi' },
      { role: 'user', text: 'How do I descale an espresso machine without vinegar?' },
    ]);
    assert.equal(fb.title, 'How do I descale an espresso machine without vinegar?');
    assert.equal(deriveFallback('', []).title, 'Untitled conversation');
    assert.ok(deriveFallback('', [{ role: 'user', text: 'x'.repeat(300) }]).title.length <= 65);
  });
});

describe('summarizing a stored entry', () => {
  beforeEach(freshDb);

  it('marks failures on the entry and never touches the transcript', async () => {
    await loadSampleJournal();
    const entry = (await listEntries()).find((e) => e.summaryStatus === 'not_configured')!;
    const before = (await getEntryView(entry.id))!;
    await assert.rejects(summarizeEntry(entry.id, { label: 'Broken', summarize: async () => Promise.reject(new Error('rate limited')) }, { autoTag: true }), /rate limited/);
    const after = (await getEntryView(entry.id))!;
    assert.equal(after.entry.summaryStatus, 'failed');
    assert.equal(after.entry.summaryError, 'rate limited');
    assert.deepEqual(after.messages, before.messages);
  });

  it('writes summary, provenance, tags and a collection on success', async () => {
    await loadSampleJournal();
    const entry = (await listEntries()).find((e) => e.summaryStatus === 'not_configured')!;
    const view = (await getEntryView(entry.id))!;
    const target = view.messages[1]!.id;
    await summarizeEntry(
      entry.id,
      {
        label: 'Fake · m',
        summarize: async (inp) => {
          assert.equal(inp.messages.length, view.messages.length);
          return { ...validateOk(), keyDecisions: [{ text: 'Feed 1:3:3', sourceMessageIds: [target] }], suggestedCollection: 'Kitchen' };
        },
      },
      { autoTag: true },
    );
    const after = (await getEntryView(entry.id))!;
    assert.equal(after.entry.summaryStatus, 'complete');
    assert.equal(after.entry.summaryProvider, 'Fake · m');
    assert.deepEqual(after.entry.keyDecisions[0]?.sourceMessageIds, [target]);
    assert.equal(after.collection?.name, 'Kitchen');
  });
});

function validateOk() {
  const r = validateSummary(valid, refs);
  if (!r.ok) throw new Error('fixture invalid');
  return r.value;
}
