import { maxIso, minIso, toIso } from '../../utils/dates';
import { collectParse, iterateRecords, loadConversationArray } from '../core/iterate';
import type { ArchiveManifest, ConversationImporter, ImportPreview } from '../core/types';
import { buildFileIndex, countGptImagePointers, parseChatGptConversation, pointerFileId, type GptConversation } from './parse';

function score(m: ArchiveManifest) {
  const reasons: string[] = [];
  let s = 0;
  const conv = m.sniffs['conversations.json'] ?? '';
  if (/"mapping"\s*:/.test(conv)) {
    s += 5;
    reasons.push('conversations.json uses the ChatGPT "mapping" message tree');
  }
  if (/"current_node"\s*:/.test(conv)) s += 1;
  for (const f of ['chat.html', 'message_feedback.json', 'user.json', 'shared_conversations.json', 'model_comparisons.json']) {
    if (m.has(f)) {
      s += 1;
      reasons.push(`contains ${f}`);
    }
  }
  if (m.files.some((f) => /(^|\/)(file[-_][A-Za-z0-9]+)[-.]/.test(f.path) || f.path.startsWith('dalle-generations/'))) {
    s += 1;
    reasons.push('contains ChatGPT file assets');
  }
  return { score: s, reasons };
}

export const chatgptImporter: ConversationImporter = {
  source: 'chatgpt',
  label: 'ChatGPT',
  score,
  canHandle: (m) => score(m).score >= 3,

  async inspect(m): Promise<ImportPreview> {
    const { list } = await loadConversationArray(m, 'ChatGPT');
    const fileIndex = buildFileIndex(m.files.map((f) => f.path));
    let present = 0;
    let referenced = 0;
    const created: (string | null)[] = [];
    const updated: (string | null)[] = [];
    const ids: string[] = [];
    let malformed = 0;
    for (const c of list) {
      const conv = c as GptConversation;
      if (!conv || typeof conv !== 'object' || !conv.mapping) {
        malformed++;
        continue;
      }
      created.push(toIso(conv.create_time));
      updated.push(toIso(conv.update_time));
      const id = conv.conversation_id || conv.id;
      if (typeof id === 'string') ids.push(id);
      for (const node of Object.values(conv.mapping)) {
        const content = node?.message?.content;
        if (!content || typeof content !== 'object' || !Array.isArray(content.parts)) continue;
        for (const p of content.parts) {
          if (p && typeof p === 'object' && (p as Record<string, unknown>).content_type === 'image_asset_pointer') {
            referenced++;
            const id = pointerFileId(String((p as Record<string, unknown>).asset_pointer ?? ''));
            if (id && fileIndex.has(id)) present++;
          }
        }
      }
    }
    const warnings: string[] = [];
    if (malformed > 0) warnings.push(`${malformed} record${malformed === 1 ? '' : 's'} in conversations.json ${malformed === 1 ? 'is' : 'are'} malformed and will be skipped.`);
    if (referenced > present) {
      warnings.push(
        `${referenced - present} of ${referenced} referenced image${referenced === 1 ? '' : 's'} ${referenced - present === 1 ? 'is' : 'are'} not included in this export. They will appear as unavailable placeholders.`,
      );
    }
    return {
      source: 'chatgpt',
      fileName: m.fileName,
      archiveSize: m.size,
      conversationCount: list.length - malformed,
      imageCount: countGptImagePointers(list),
      imageFilesPresent: present,
      warnings,
      dateRange: { from: minIso(created), to: maxIso(updated) },
      conversationIds: ids,
    };
  },

  async *iterate(m, signal) {
    const { path, list } = await loadConversationArray(m, 'ChatGPT');
    const fileIndex = buildFileIndex(m.files.map((f) => f.path));
    yield* iterateRecords(list, path, (raw) => parseChatGptConversation(raw, fileIndex), signal);
  },

  parse(m, onProgress) {
    return collectParse(chatgptImporter, m, onProgress);
  },
};
