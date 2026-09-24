import { maxIso, minIso, toIso } from '../../utils/dates';
import { collectParse, iterateRecords, loadConversationArray } from '../core/iterate';
import type { ArchiveManifest, ConversationImporter, ImportPreview } from '../core/types';
import { buildClaudeFileIndex, parseClaudeConversation, type ClaudeConversation } from './parse';

function score(m: ArchiveManifest) {
  const reasons: string[] = [];
  let s = 0;
  const conv = m.sniffs['conversations.json'] ?? '';
  if (/"chat_messages"\s*:/.test(conv)) {
    s += 5;
    reasons.push('conversations.json uses Claude "chat_messages"');
  }
  if (/"sender"\s*:\s*"(human|assistant)"/.test(conv)) s += 1;
  for (const f of ['users.json', 'projects.json', 'memories.json']) {
    if (m.has(f)) {
      s += 1;
      reasons.push(`contains ${f}`);
    }
  }
  return { score: s, reasons };
}

export const claudeImporter: ConversationImporter = {
  source: 'claude',
  label: 'Claude',
  score,
  canHandle: (m) => score(m).score >= 3,

  async inspect(m): Promise<ImportPreview> {
    const { list } = await loadConversationArray(m, 'Claude');
    const fileIndex = buildClaudeFileIndex(m.files.map((f) => f.path));
    let malformed = 0;
    let referenced = 0;
    let present = 0;
    const created: (string | null)[] = [];
    const updated: (string | null)[] = [];
    const ids: string[] = [];
    for (const c of list) {
      const conv = c as ClaudeConversation;
      const msgs = conv && typeof conv === 'object' ? (conv.chat_messages ?? conv.messages) : null;
      if (!Array.isArray(msgs)) {
        malformed++;
        continue;
      }
      created.push(toIso(conv.created_at));
      updated.push(toIso(conv.updated_at));
      const id = conv.uuid || conv.id;
      if (typeof id === 'string') ids.push(id);
      const svgArtifacts = new Set<string>();
      for (const msg of msgs) {
        if (!msg || typeof msg !== 'object') continue;
        for (const f of [...(msg.files ?? []), ...(msg.files_v2 ?? [])]) {
          if (!f) continue;
          const name = f.file_name ?? '';
          if (f.file_kind === 'image' || /\.(png|jpe?g|webp|gif|heic|avif|svg)$/i.test(name)) {
            referenced++;
            const id = (f.file_uuid ?? f.uuid ?? '').toLowerCase();
            if ((id && fileIndex.has(id)) || fileIndex.has(name.toLowerCase())) present++;
          }
        }
        if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b?.type !== 'tool_use' || b.name !== 'artifacts') continue;
            // Updates don't repeat the artifact type, so remember which ids are SVGs.
            const id = String(b.input?.id ?? '');
            if (b.input?.type === 'image/svg+xml') svgArtifacts.add(id);
            if (svgArtifacts.has(id)) {
              referenced++;
              present++;
            }
          }
        }
      }
    }
    const warnings: string[] = [];
    if (malformed > 0) warnings.push(`${malformed} record${malformed === 1 ? '' : 's'} in conversations.json ${malformed === 1 ? 'is' : 'are'} malformed and will be skipped.`);
    if (referenced > present) {
      warnings.push(
        `${referenced - present} uploaded image${referenced - present === 1 ? ' is' : 's are'} listed by name only — Claude exports don't include uploaded image files. They will appear as unavailable placeholders.`,
      );
    }
    return {
      source: 'claude',
      fileName: m.fileName,
      archiveSize: m.size,
      conversationCount: list.length - malformed,
      imageCount: referenced,
      imageFilesPresent: present,
      warnings,
      dateRange: { from: minIso(created), to: maxIso(updated) },
      conversationIds: ids,
    };
  },

  async *iterate(m, signal) {
    const { path, list } = await loadConversationArray(m, 'Claude');
    const fileIndex = buildClaudeFileIndex(m.files.map((f) => f.path));
    yield* iterateRecords(list, path, (raw) => parseClaudeConversation(raw, fileIndex), signal);
  },

  parse(m, onProgress) {
    return collectParse(claudeImporter, m, onProgress);
  },
};
