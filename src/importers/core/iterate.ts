import type { ImportIssue, Source } from '../../data/types';
import { findFile, readJson } from './archive';
import { SkipConversation } from './errors';
import { ImportError, type ArchiveManifest, type ConversationImporter, type ParsedConversation, type ParsedItem, type ParseResult, type ProgressCallback } from './types';

/** Loads the conversations array from an export, accepting `[...]` or `{ conversations: [...] }`. */
export async function loadConversationArray(manifest: ArchiveManifest, label: string): Promise<{ path: string; list: unknown[] }> {
  const path = findFile(manifest, 'conversations.json');
  if (!path) {
    throw new ImportError(`No conversations.json found in ${manifest.fileName}. Is this a ${label} data export?`, 'unsupported');
  }
  const data = await readJson(manifest, path);
  if (Array.isArray(data)) return { path, list: data };
  if (data && typeof data === 'object' && Array.isArray((data as { conversations?: unknown }).conversations)) {
    return { path, list: (data as { conversations: unknown[] }).conversations };
  }
  throw new ImportError(`${path} does not contain a list of conversations.`, 'malformed');
}

export function recordLabel(raw: unknown): { id: string | null; title: string | null } {
  if (!raw || typeof raw !== 'object') return { id: null, title: null };
  const r = raw as Record<string, unknown>;
  const id = [r.conversation_id, r.uuid, r.id].find((v) => typeof v === 'string') as string | undefined;
  const title = [r.title, r.name].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  return { id: id ?? null, title: title ?? null };
}

/** Shared per-record loop: one malformed conversation never fails the batch. */
export async function* iterateRecords(
  list: unknown[],
  sourceFile: string,
  parseOne: (raw: unknown) => ParsedConversation,
  signal?: AbortSignal,
): AsyncGenerator<ParsedItem> {
  const total = list.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) return;
    const raw = list[i];
    try {
      yield { kind: 'conversation', conversation: parseOne(raw), position: i, total };
    } catch (err) {
      const { id, title } = recordLabel(raw);
      const issue: ImportIssue = {
        level: err instanceof SkipConversation ? err.level : 'error',
        sourceFile,
        recordIndex: i + 1,
        conversationId: id,
        title,
        reason: err instanceof Error ? err.message : String(err),
      };
      yield { kind: 'skipped', issue, position: i, total };
    }
    // Let the event loop breathe on huge exports (keeps progress messages flowing).
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, 0));
  }
}

export async function collectParse(importer: ConversationImporter, manifest: ArchiveManifest, onProgress?: ProgressCallback): Promise<ParseResult> {
  const conversations: ParsedConversation[] = [];
  const issues: ImportIssue[] = [];
  for await (const item of importer.iterate(manifest)) {
    if (item.kind === 'conversation') conversations.push(item.conversation);
    else issues.push(item.issue);
    onProgress?.({
      processed: item.position + 1,
      total: item.total,
      currentTitle: item.kind === 'conversation' ? item.conversation.title : item.issue.title,
    });
  }
  return { conversations, issues };
}

export function sourceLabel(source: Source): string {
  return source === 'chatgpt' ? 'ChatGPT' : 'Claude';
}
