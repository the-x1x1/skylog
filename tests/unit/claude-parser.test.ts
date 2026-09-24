import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claudeImporter } from '../../src/importers/claude/importer';
import { buildClaudeFileIndex, normalizeClaudeSender, parseClaudeConversation } from '../../src/importers/claude/parse';
import { SkipConversation } from '../../src/importers/core/errors';
import { claudeConversation, claudeEdgeCaseFiles } from '../helpers/fixtures';
import { createMemoryArchive } from '../helpers/db';

const noFiles = new Map<string, string>();

describe('Claude sender normalization', () => {
  it('maps sender variants to internal roles', () => {
    assert.equal(normalizeClaudeSender('human'), 'user');
    assert.equal(normalizeClaudeSender('Human'), 'user');
    assert.equal(normalizeClaudeSender('user'), 'user');
    assert.equal(normalizeClaudeSender('assistant'), 'assistant');
    assert.equal(normalizeClaudeSender('claude'), 'assistant');
    assert.equal(normalizeClaudeSender('robot'), 'unknown');
    assert.equal(normalizeClaudeSender(undefined), 'unknown');
  });
});

describe('Claude content', () => {
  const conv = parseClaudeConversation(claudeConversation(), noFiles);
  const byId = new Map(conv.messages.map((m) => [m.sourceMessageId, m]));

  it('prefers structured content blocks over the flat text field', () => {
    assert.equal(byId.get('c-m1')?.text, 'How deep should floating shelves be?');
    assert.equal(byId.get('c-m1')?.role, 'user');
  });

  it('accepts string content and falls back to the text field', () => {
    assert.equal(byId.get('c-m3')?.text, 'Make it wider.');
    assert.equal(byId.get('c-m5')?.text, 'Plain text only message');
    assert.equal(byId.get('c-m5')?.role, 'assistant');
    assert.equal(byId.get('c-m6')?.role, 'unknown');
  });

  it('drops hidden thinking but keeps tool calls and results visible', () => {
    const m2 = byId.get('c-m2')?.text ?? '';
    assert.ok(!m2.includes('secret reasoning'));
    assert.match(m2, /About 25 cm deep/);
    assert.match(m2, /\[Tool call · web_search\]/);
    assert.match(m2, /\[Tool result · web_search\]\nMost shelves are 20–30 cm\./);
  });

  it('turns SVG artifacts into images, applying updates as new versions', () => {
    const svgs = conv.images.filter((i) => i.origin === 'artifact');
    assert.equal(svgs.length, 2);
    assert.equal(svgs[0]?.title, 'Shelf diagram');
    assert.equal(svgs[1]?.title, 'Shelf diagram (v2)');
    assert.match(svgs[1]?.inlineContent ?? '', /width="20"/);
    assert.equal(svgs[0]?.prompt, 'How deep should floating shelves be?');
    assert.equal(svgs[0]?.promptKind, 'user_request');
    assert.equal(svgs[1]?.messageSourceId, 'c-m4');
  });

  it('keeps non-image artifacts as text in the transcript', () => {
    assert.match(byId.get('c-m4')?.text ?? '', /\[Artifact · Cut list\]\n```python\nprint\("cut"\)\n```/);
  });

  it('records uploaded images as unavailable when the export lacks the file', () => {
    const upload = conv.images.find((i) => i.origin === 'uploaded');
    assert.equal(upload?.originalFilename, 'wall.jpg');
    assert.equal(upload?.archivePath, null);
    assert.match(upload?.unavailableReason ?? '', /don't include the image file/);
  });

  it('preserves text attachments and warns about malformed message records', () => {
    assert.deepEqual(
      byId.get('c-m1')?.attachments.map((a) => a.name),
      ['measurements.txt'],
    );
    assert.ok(conv.warnings.some((w) => /malformed message/.test(w)));
  });

  it('keeps title, timestamps and source ids', () => {
    assert.equal(conv.title, 'Kitchen shelves');
    assert.equal(conv.sourceConversationId, 'claude-1');
    assert.equal(conv.createdAt, '2026-05-01T10:00:00.000Z');
    assert.equal(byId.get('c-m2')?.createdAt, '2026-05-01T10:01:00.000Z');
  });

  it('matches an uploaded image when the archive does include it', () => {
    const index = buildClaudeFileIndex(['files/uuid-present.png']);
    const c = parseClaudeConversation(
      claudeConversation({ chat_messages: [{ uuid: 'y1', text: 'See', sender: 'human', files: [{ file_name: 'present.png', file_uuid: 'uuid-present' }] }] }),
      index,
    );
    assert.equal(c.images[0]?.archivePath, 'files/uuid-present.png');
  });
});

describe('Claude malformed records', () => {
  it('rejects conversations without chat_messages', () => {
    assert.throws(() => parseClaudeConversation({ uuid: 'x' }, noFiles), (e: unknown) => e instanceof SkipConversation && e.level === 'error');
    assert.throws(() => parseClaudeConversation(42, noFiles), SkipConversation);
  });

  it('streams a whole export, skipping bad records with reasons', async () => {
    const archive = await createMemoryArchive('claude.zip', claudeEdgeCaseFiles());
    const result = await claudeImporter.parse(archive);
    assert.equal(result.conversations.length, 3);
    assert.equal(result.issues.length, 2);
    assert.equal(result.issues[0]?.conversationId, 'claude-bad');
    const untitled = result.conversations.find((c) => c.sourceConversationId === 'claude-2');
    assert.equal(untitled?.title, '');
    const present = result.conversations.find((c) => c.sourceConversationId === 'claude-3');
    assert.equal(present?.images[0]?.archivePath, 'files/uuid-present.png');
  });
});
