/**
 * Edge-case export fixtures for parser and pipeline tests. Shapes follow real ChatGPT and
 * Claude exports, including variants seen across export format revisions.
 */

export const T0 = Date.UTC(2026, 3, 2, 9, 0, 0) / 1000; // epoch seconds

type Node = { id: string; message: Record<string, unknown> | null; parent: string | null; children: string[] };

export function gptMessage(id: string, role: string, parts: unknown[], extra: Record<string, unknown> = {}, t = T0) {
  return {
    id,
    author: { role, name: extra.authorName ?? null, metadata: {} },
    create_time: t,
    content: { content_type: extra.contentType ?? 'text', parts },
    metadata: extra.metadata ?? {},
    recipient: extra.recipient ?? 'all',
    status: 'finished_successfully',
    weight: 1,
  };
}

/** A conversation with an edited user message: two branches from the same parent. */
export function branchedConversation() {
  const mapping: Record<string, Node> = {
    root: { id: 'root', message: null, parent: null, children: ['u1'] },
    u1: { id: 'u1', message: gptMessage('u1', 'user', ['First question'], {}, T0), parent: 'root', children: ['a1'] },
    a1: { id: 'a1', message: gptMessage('a1', 'assistant', ['First answer'], {}, T0 + 10), parent: 'u1', children: ['u2-old', 'u2-new'] },
    'u2-old': { id: 'u2-old', message: gptMessage('u2-old', 'user', ['Original follow-up (edited away)'], {}, T0 + 20), parent: 'a1', children: ['a2-old'] },
    'a2-old': { id: 'a2-old', message: gptMessage('a2-old', 'assistant', ['Answer to the old follow-up'], {}, T0 + 30), parent: 'u2-old', children: [] },
    'u2-new': { id: 'u2-new', message: gptMessage('u2-new', 'user', ['Edited follow-up'], {}, T0 + 40), parent: 'a1', children: ['a2-new'] },
    'a2-new': { id: 'a2-new', message: gptMessage('a2-new', 'assistant', ['Answer to the edited follow-up'], {}, T0 + 50), parent: 'u2-new', children: [] },
  };
  return { id: 'conv-branch', conversation_id: 'conv-branch', title: 'Branching', create_time: T0, update_time: T0 + 50, mapping, current_node: 'a2-new' };
}

/** Every content variant we extract text from, plus hidden ones we must skip. */
export function variantsConversation() {
  const ids = ['sys', 'ctx', 'u1', 'think', 'code', 'exec', 'quote', 'browse', 'err', 'u2', 'a2', 'strc'];
  const msgs: Record<string, unknown>[] = [
    { ...gptMessage('sys', 'system', ['']), metadata: { is_visually_hidden_from_conversation: true } },
    { ...gptMessage('ctx', 'user', []), content: { content_type: 'user_editable_context', user_profile: 'secret profile', user_instructions: 'secret' } },
    gptMessage('u1', 'user', ['Plot the data please'], {}, T0 + 1),
    { ...gptMessage('think', 'assistant', [], {}, T0 + 2), content: { content_type: 'thoughts', thoughts: [{ summary: 'hidden', content: 'hidden reasoning' }] } },
    { ...gptMessage('code', 'assistant', [], { recipient: 'python' }, T0 + 3), content: { content_type: 'code', language: 'python', text: 'print(42)' } },
    { ...gptMessage('exec', 'tool', [], { authorName: 'python' }, T0 + 4), content: { content_type: 'execution_output', text: '42' } },
    { ...gptMessage('quote', 'tool', [], {}, T0 + 5), content: { content_type: 'tether_quote', title: 'Doc', text: 'Quoted text', url: 'https://example.com' } },
    { ...gptMessage('browse', 'tool', [], {}, T0 + 6), content: { content_type: 'tether_browsing_display', result: 'Search result text' } },
    { ...gptMessage('err', 'tool', [], {}, T0 + 7), content: { content_type: 'system_error', name: 'Timeout', text: 'The tool timed out' } },
    gptMessage('u2', 'user', ['Line one', { content_type: 'audio_transcription', text: 'spoken words' }], { contentType: 'multimodal_text' }, T0 + 8),
    gptMessage('a2', 'assistant', ['Part A', 'Part B'], {}, T0 + 9),
    { ...gptMessage('strc', 'assistant', [], {}, T0 + 10), content: 'A plain string content variant' },
  ];
  const mapping: Record<string, Node> = { root: { id: 'root', message: null, parent: null, children: ['sys'] } };
  let parent = 'root';
  ids.forEach((id, i) => {
    mapping[id] = { id, message: msgs[i]!, parent, children: ids[i + 1] ? [ids[i + 1]!] : [] };
    parent = id;
  });
  return { id: 'conv-variants', title: '', create_time: T0, update_time: T0 + 10, mapping, current_node: 'strc' };
}

/** Image generation with a DALL·E prompt, a 4o tool-call prompt, a user upload and a missing file. */
export function imagesConversation() {
  const chain: [string, Record<string, unknown>][] = [
    ['u1', gptMessage('u1', 'user', ['Draw a lighthouse at dusk'], {}, T0)],
    ['call1', gptMessage('call1', 'assistant', [JSON.stringify({ prompt: 'ignored because dalle metadata wins' })], { recipient: 'dalle.text2im', contentType: 'code' }, T0 + 1)],
    [
      'img1',
      gptMessage(
        'img1',
        'tool',
        [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-Light01', width: 1024, height: 1024, size_bytes: 10, metadata: { dalle: { prompt: 'A lighthouse at dusk, oil painting' } } }],
        { authorName: 'dalle.text2im', contentType: 'multimodal_text' },
        T0 + 2,
      ),
    ],
    ['u2', gptMessage('u2', 'user', ['Now a night version'], {}, T0 + 3)],
    ['call2', gptMessage('call2', 'assistant', [JSON.stringify({ prompt: 'The lighthouse at night, beam visible', size: '1024x1024' })], { recipient: 't2uay3k.sj1i4kz', contentType: 'code' }, T0 + 4)],
    [
      'img2',
      gptMessage('img2', 'tool', [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_00000000Night02', metadata: { dalle: null } }], { contentType: 'multimodal_text', metadata: { image_gen_title: 'Lighthouse at night' } }, T0 + 5),
    ],
    [
      'u3',
      gptMessage(
        'u3',
        'user',
        [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-Photo03', width: 800, height: 600 }, 'Here is a photo of mine'],
        { contentType: 'multimodal_text', metadata: { attachments: [{ id: 'file-Photo03', name: 'my-photo.png', mime_type: 'image/png', size: 70 }, { id: 'file-Doc04', name: 'notes.pdf', mime_type: 'application/pdf', size: 1200 }] } },
        T0 + 6,
      ),
    ],
    ['img4', gptMessage('img4', 'tool', [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-Missing99' }], { contentType: 'multimodal_text' }, T0 + 7)],
  ];
  const mapping: Record<string, Node> = { root: { id: 'root', message: null, parent: null, children: ['u1'] } };
  let parent = 'root';
  chain.forEach(([id, message], i) => {
    mapping[id] = { id, message, parent, children: chain[i + 1] ? [chain[i + 1]![0]] : [] };
    parent = id;
  });
  return { id: 'conv-images', title: 'Lighthouse', create_time: T0, update_time: T0 + 7, mapping, current_node: 'img4' };
}

export const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
  0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

export function chatgptEdgeCaseFiles(): Record<string, string | Uint8Array> {
  return {
    'conversations.json': JSON.stringify([
      branchedConversation(),
      variantsConversation(),
      imagesConversation(),
      null,
      'not a conversation',
      { id: 'no-mapping', title: 'Broken record' },
      { id: 'empty-conv', title: 'Empty', mapping: { root: { id: 'root', message: null, parent: null, children: [] } }, current_node: 'root' },
    ]),
    'chat.html': '<html></html>',
    'user.json': '{}',
    'file-Light01-aaaa1111.png': PNG_1PX,
    'dalle-generations/file_00000000Night02-bbbb2222.webp': PNG_1PX,
    'file-Photo03-my-photo.png': PNG_1PX,
  };
}

export function claudeConversation(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'claude-1',
    name: 'Kitchen shelves',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:30:00.000Z',
    chat_messages: [
      {
        uuid: 'c-m1',
        text: 'fallback text should not be used',
        content: [{ type: 'text', text: 'How deep should floating shelves be?' }],
        sender: 'human',
        created_at: '2026-05-01T10:00:00.000Z',
        files: [{ file_name: 'wall.jpg', file_uuid: 'uuid-wall' }],
        attachments: [{ file_name: 'measurements.txt', file_size: 120, file_type: 'text/plain', extracted_content: '120cm wide' }],
      },
      {
        uuid: 'c-m2',
        text: '',
        content: [
          { type: 'thinking', thinking: 'secret reasoning' },
          { type: 'text', text: 'About 25 cm deep works for most kitchens.' },
          { type: 'tool_use', name: 'artifacts', input: { id: 'shelf-diagram', command: 'create', type: 'image/svg+xml', title: 'Shelf diagram', content: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="2"/></svg>' } },
          { type: 'tool_use', name: 'web_search', input: { query: 'floating shelf depth' } },
          { type: 'tool_result', name: 'web_search', content: [{ type: 'text', text: 'Most shelves are 20–30 cm.' }] },
        ],
        sender: 'assistant',
        created_at: '2026-05-01T10:01:00.000Z',
      },
      { uuid: 'c-m3', text: 'Make it wider.', content: 'Make it wider.', sender: 'Human', created_at: '2026-05-01T10:05:00.000Z' },
      {
        uuid: 'c-m4',
        text: '',
        content: [
          { type: 'tool_use', name: 'artifacts', input: { id: 'shelf-diagram', command: 'update', old_str: 'width="10"', new_str: 'width="20"' } },
          { type: 'tool_use', name: 'artifacts', input: { id: 'shelf-code', command: 'create', type: 'application/vnd.ant.code', language: 'python', title: 'Cut list', content: 'print("cut")' } },
        ],
        sender: 'assistant',
        created_at: '2026-05-01T10:06:00.000Z',
      },
      { uuid: 'c-m5', text: 'Plain text only message', sender: 'claude', created_at: '2026-05-01T10:07:00.000Z' },
      { uuid: 'c-m6', text: 'Who knows', sender: 'robot', created_at: '2026-05-01T10:08:00.000Z' },
      null,
    ],
    ...overrides,
  };
}

export function claudeEdgeCaseFiles(): Record<string, string | Uint8Array> {
  return {
    'conversations.json': JSON.stringify([
      claudeConversation(),
      claudeConversation({ uuid: 'claude-2', name: '', chat_messages: [{ uuid: 'x1', text: 'Name my sourdough starter', sender: 'human', created_at: '2026-05-02T08:00:00Z' }] }),
      claudeConversation({ uuid: 'claude-3', name: 'Has a present upload', chat_messages: [{ uuid: 'y1', text: 'See photo', sender: 'human', created_at: '2026-05-03T08:00:00Z', files: [{ file_name: 'present.png', file_uuid: 'uuid-present' }] }] }),
      { uuid: 'claude-bad', name: 'No messages array' },
      42,
    ]),
    'users.json': '[]',
    'projects.json': '[]',
    'files/uuid-present.png': PNG_1PX,
  };
}
