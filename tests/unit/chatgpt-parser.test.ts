import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatgptImporter } from '../../src/importers/chatgpt/importer';
import { buildFileIndex, extractContent, orderNodes, parseChatGptConversation, pointerFileId } from '../../src/importers/chatgpt/parse';
import { SkipConversation } from '../../src/importers/core/errors';
import { branchedConversation, chatgptEdgeCaseFiles, gptMessage, imagesConversation, T0, variantsConversation } from '../helpers/fixtures';
import { createMemoryArchive } from '../helpers/db';

const noFiles = new Map<string, string>();

describe('ChatGPT mapping-tree ordering', () => {
  it('follows current_node up the parent chain (the branch the user last saw)', () => {
    const conv = parseChatGptConversation(branchedConversation(), noFiles);
    assert.deepEqual(
      conv.messages.map((m) => m.text),
      ['First question', 'First answer', 'Edited follow-up', 'Answer to the edited follow-up'],
    );
    assert.deepEqual(
      conv.messages.map((m) => m.index),
      [0, 1, 2, 3],
    );
  });

  it('falls back to walking from the root along the newest child when current_node is missing', () => {
    const raw = branchedConversation();
    delete (raw as { current_node?: string }).current_node;
    const { ids, strategy } = orderNodes(raw);
    assert.equal(strategy, 'root_walk');
    assert.deepEqual(ids, ['root', 'u1', 'a1', 'u2-new', 'a2-new']);
  });

  it('uses timestamps when the tree is unusable (cyclic parents) and says so', () => {
    const raw = {
      id: 'cyc',
      mapping: {
        a: { id: 'a', parent: 'b', children: ['b'], message: gptMessage('a', 'user', ['second'], {}, T0 + 5) },
        b: { id: 'b', parent: 'a', children: ['a'], message: gptMessage('b', 'user', ['first'], {}, T0) },
      },
    };
    const conv = parseChatGptConversation(raw, noFiles);
    assert.deepEqual(
      conv.messages.map((m) => m.text),
      ['first', 'second'],
    );
    assert.ok(conv.warnings.some((w) => /timestamps/.test(w)));
  });

  it('keeps the original message ids for traceability', () => {
    const conv = parseChatGptConversation(branchedConversation(), noFiles);
    assert.deepEqual(
      conv.messages.map((m) => m.sourceMessageId),
      ['u1', 'a1', 'u2-new', 'a2-new'],
    );
  });
});

describe('ChatGPT content variants', () => {
  const conv = parseChatGptConversation(variantsConversation(), noFiles);
  const byId = new Map(conv.messages.map((m) => [m.sourceMessageId, m]));

  it('skips hidden system messages, custom-instruction context and hidden reasoning', () => {
    assert.equal(byId.has('sys'), false);
    assert.equal(byId.has('ctx'), false);
    assert.equal(byId.has('think'), false);
    assert.ok(!conv.messages.some((m) => m.text.includes('secret')));
  });

  it('extracts text from code, execution output, quotes, browsing, errors and audio transcripts', () => {
    assert.equal(byId.get('code')?.text, 'print(42)');
    assert.equal(byId.get('code')?.role, 'tool');
    assert.equal(byId.get('code')?.authorName, 'call → python');
    assert.equal(byId.get('exec')?.text, '42');
    assert.match(byId.get('quote')?.text ?? '', /Quoted text/);
    assert.equal(byId.get('browse')?.text, 'Search result text');
    assert.equal(byId.get('err')?.text, 'Timeout: The tool timed out');
    assert.equal(byId.get('u2')?.text, 'Line one\n\nspoken words');
    assert.equal(byId.get('a2')?.text, 'Part A\n\nPart B');
    assert.equal(byId.get('strc')?.text, 'A plain string content variant');
  });

  it('returns an empty title (fallback happens later) and ISO timestamps', () => {
    assert.equal(conv.title, '');
    assert.equal(byId.get('u1')?.createdAt, new Date((T0 + 1) * 1000).toISOString());
    assert.equal(conv.createdAt, new Date(T0 * 1000).toISOString());
  });

  it('extractContent tolerates null and unknown shapes', () => {
    assert.equal(extractContent(null).text, '');
    assert.equal(extractContent({ content_type: 'mystery', result: 'r' }).text, 'r');
    assert.equal(extractContent({ content_type: 'text', parts: [null, 5, 'ok'] }).text, 'ok');
  });
});

describe('ChatGPT images', () => {
  const index = buildFileIndex(['file-Light01-aaaa1111.png', 'dalle-generations/file_00000000Night02-bbbb2222.webp', 'file-Photo03-my-photo.png', 'chat.html']);
  const conv = parseChatGptConversation(imagesConversation(), index);
  const img = (key: string) => conv.images.find((i) => i.key === key);

  it('maps asset pointers to archive files (file-service and sediment pointers)', () => {
    assert.equal(pointerFileId('file-service://file-Light01'), 'file-Light01');
    assert.equal(pointerFileId('sediment://file_00000000Night02'), 'file_00000000Night02');
    assert.equal(img('file-Light01')?.archivePath, 'file-Light01-aaaa1111.png');
    assert.equal(img('file_00000000Night02')?.archivePath, 'dalle-generations/file_00000000Night02-bbbb2222.webp');
  });

  it('prefers the DALL·E metadata prompt, then the image tool call, then the user request', () => {
    assert.equal(img('file-Light01')?.prompt, 'A lighthouse at dusk, oil painting');
    assert.equal(img('file-Light01')?.promptKind, 'generation');
    assert.equal(img('file_00000000Night02')?.prompt, 'The lighthouse at night, beam visible');
    assert.equal(img('file_00000000Night02')?.promptKind, 'tool_call');
    assert.equal(img('file_00000000Night02')?.title, 'Lighthouse at night');
  });

  it('marks user uploads as uploaded, with their attachment name and no invented prompt', () => {
    const photo = img('file-Photo03');
    assert.equal(photo?.origin, 'uploaded');
    assert.equal(photo?.originalFilename, 'my-photo.png');
    assert.equal(photo?.prompt, null);
    const u3 = conv.messages.find((m) => m.sourceMessageId === 'u3');
    assert.deepEqual(u3?.imageKeys, ['file-Photo03']);
    assert.deepEqual(
      u3?.attachments.map((a) => a.name),
      ['notes.pdf'],
    );
  });

  it('keeps a record for images whose binary is not in the export, with an honest reason', () => {
    const missing = img('file-Missing99');
    assert.ok(missing);
    assert.equal(missing.archivePath, null);
    assert.match(missing.unavailableReason ?? '', /does not include the file/);
    // No tool call or DALL·E metadata: the nearest user request is used and labelled as such.
    assert.equal(missing.promptKind, 'user_request');
  });

  it('associates each image with the message that contains it', () => {
    const tool = conv.messages.find((m) => m.sourceMessageId === 'img1');
    assert.deepEqual(tool?.imageKeys, ['file-Light01']);
    assert.equal(img('file-Light01')?.messageSourceId, 'img1');
  });
});

describe('ChatGPT malformed records', () => {
  it('rejects non-objects and records without a mapping as errors', () => {
    assert.throws(() => parseChatGptConversation(null, noFiles), SkipConversation);
    assert.throws(() => parseChatGptConversation({ id: 'x' }, noFiles), (e: unknown) => e instanceof SkipConversation && e.level === 'error');
  });

  it('skips conversations with no visible messages as a warning, not an error', () => {
    const empty = { id: 'e', mapping: { root: { id: 'root', message: null, parent: null, children: [] } } };
    assert.throws(() => parseChatGptConversation(empty, noFiles), (e: unknown) => e instanceof SkipConversation && e.level === 'warning');
  });

  it('streams every record and reports skipped ones without failing the batch', async () => {
    const archive = await createMemoryArchive('edge.zip', chatgptEdgeCaseFiles());
    const result = await chatgptImporter.parse(archive);
    assert.equal(result.conversations.length, 3);
    assert.equal(result.issues.length, 4);
    assert.deepEqual(
      result.issues.map((i) => i.level),
      ['error', 'error', 'error', 'warning'],
    );
    assert.ok(result.issues.every((i) => i.sourceFile === 'conversations.json' && i.reason.length > 0));
    assert.equal(result.issues[2]?.conversationId, 'no-mapping');
    assert.equal(result.issues[2]?.title, 'Broken record');
  });

  it('derives a stable id for a conversation without one', () => {
    const raw = branchedConversation() as Record<string, unknown>;
    delete raw.id;
    delete raw.conversation_id;
    const a = parseChatGptConversation(raw, noFiles);
    const b = parseChatGptConversation(structuredClone(raw), noFiles);
    assert.match(a.sourceConversationId, /^anon-/);
    assert.equal(a.sourceConversationId, b.sourceConversationId);
  });
});
