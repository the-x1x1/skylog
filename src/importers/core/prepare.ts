import { notifyChange } from '../../data/db/changes';
import { getDb } from '../../data/db/database';
import { deleteConversationSourceInTx } from '../../data/repositories/entries';
import type { BlobRecord, ConversationRecord, DerivedItem, ImageAsset, JournalEntry, MessageRecord } from '../../data/types';
import { deriveFallback } from '../../summarization/fallback';
import { maxIso } from '../../utils/dates';
import { hashParts } from '../../utils/hash';
import { isBrowserRenderable, sniffImageMime } from '../../utils/mime';
import { LIMITS } from './archive';
import type { ArchiveManifest, ParsedConversation } from './types';

export interface PrepareContext {
  batchId: string;
  archiveFileName: string;
  importedAt: string;
  manifest: ArchiveManifest;
  importImages: boolean;
  isSample?: boolean;
}

export interface PreparedConversation {
  conversation: ConversationRecord;
  messages: MessageRecord[];
  images: ImageAsset[];
  blobs: BlobRecord[];
  baseEntry: JournalEntry;
  warnings: string[];
}

export function conversationIdFor(source: string, sourceConversationId: string): string {
  return `${source}:${sourceConversationId}`;
}

export function entryIdFor(conversationId: string): string {
  return `entry:${conversationId}`;
}

/** Blob key convention: one blob per available image. */
export function blobKeyForImage(imageId: string): string {
  return `blob:${imageId}`;
}

export function revisionOf(p: ParsedConversation): string {
  const parts: (string | number | null)[] = [p.updatedAt, p.messages.length];
  for (const m of p.messages) parts.push(m.sourceMessageId, m.text.length, m.imageKeys.length);
  for (const i of p.images) parts.push(i.key);
  return `${p.messages.length}:${hashParts(parts)}`;
}

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadImageBlob(
  img: ParsedConversation['images'][number],
  ctx: PrepareContext,
): Promise<{ blob: Blob | null; mime: string | null; reason: string | null }> {
  if (!ctx.importImages) return { blob: null, mime: img.mimeType, reason: 'Image import was turned off for this import.' };
  if (img.inlineContent !== null) {
    if (img.inlineContent.startsWith('base64:')) {
      try {
        const bytes = decodeBase64(img.inlineContent.slice(7));
        const mime = img.mimeType ?? sniffImageMime(bytes) ?? 'application/octet-stream';
        return { blob: new Blob([bytes as BlobPart], { type: mime }), mime, reason: null };
      } catch {
        return { blob: null, mime: img.mimeType, reason: 'The embedded image data is corrupt.' };
      }
    }
    return { blob: new Blob([img.inlineContent], { type: img.mimeType ?? 'image/svg+xml' }), mime: img.mimeType ?? 'image/svg+xml', reason: null };
  }
  if (!img.archivePath) return { blob: null, mime: img.mimeType, reason: img.unavailableReason ?? 'The image file is not in the export.' };
  const size = ctx.manifest.files.find((f) => f.path === img.archivePath)?.size ?? 0;
  if (size > LIMITS.maxImageBytes) {
    return { blob: null, mime: img.mimeType, reason: `The image file is ${(size / 1024 ** 2).toFixed(0)} MB, above the ${LIMITS.maxImageBytes / 1024 ** 2} MB limit.` };
  }
  try {
    const raw = await ctx.manifest.readBlob(img.archivePath);
    const head = new Uint8Array(await raw.slice(0, 512).arrayBuffer());
    const mime = sniffImageMime(head) ?? img.mimeType ?? 'application/octet-stream';
    return { blob: raw.type === mime ? raw : new Blob([raw], { type: mime }), mime, reason: null };
  } catch (err) {
    return { blob: null, mime: img.mimeType, reason: `Could not read the image file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function prepareConversation(p: ParsedConversation, ctx: PrepareContext): Promise<PreparedConversation> {
  const conversationId = conversationIdFor(p.source, p.sourceConversationId);
  const entryId = entryIdFor(conversationId);
  const warnings = [...p.warnings];

  // Message ids must be unique even if an export repeats one.
  const usedIds = new Map<string, number>();
  const messageIdBySource = new Map<string, string>();
  const imageIdByKey = new Map<string, string>();
  for (const img of p.images) imageIdByKey.set(img.key, `${conversationId}:img:${img.key}`);

  const messages: MessageRecord[] = p.messages.map((m, i) => {
    let id = `${conversationId}:${m.sourceMessageId}`;
    const n = usedIds.get(id) ?? 0;
    usedIds.set(id, n + 1);
    if (n > 0) id = `${id}~${n}`;
    if (!messageIdBySource.has(m.sourceMessageId)) messageIdBySource.set(m.sourceMessageId, id);
    return {
      id,
      conversationId,
      sourceMessageId: m.sourceMessageId,
      index: i,
      role: m.role,
      authorName: m.authorName,
      text: m.text,
      createdAt: m.createdAt,
      imageIds: m.imageKeys.map((k) => imageIdByKey.get(k)).filter((x): x is string => !!x),
      attachments: m.attachments,
    };
  });

  const images: ImageAsset[] = [];
  const blobs: BlobRecord[] = [];
  let index = 0;
  for (const img of p.images) {
    const id = imageIdByKey.get(img.key)!;
    const { blob, mime, reason } = await loadImageBlob(img, ctx);
    const blobKey = blob ? blobKeyForImage(id) : null;
    if (blob && blobKey) blobs.push({ key: blobKey, blob, mimeType: mime ?? blob.type, size: blob.size });
    if (blob && mime && !isBrowserRenderable(mime)) warnings.push(`Image ${img.originalFilename ?? img.key} is ${mime}, which most browsers can't display.`);
    images.push({
      id,
      entryId,
      conversationId,
      messageId: img.messageSourceId ? (messageIdBySource.get(img.messageSourceId) ?? null) : null,
      index: index++,
      title: img.title,
      prompt: img.prompt,
      promptKind: img.promptKind,
      mimeType: mime,
      blobKey,
      originalFilename: img.originalFilename,
      sourcePointer: img.sourcePointer,
      origin: img.origin,
      width: img.width,
      height: img.height,
      byteSize: blob?.size ?? img.byteSize,
      available: !!blob,
      unavailableReason: blob ? null : reason,
    });
  }

  const lastMessageAt = maxIso(messages.map((m) => m.createdAt));
  const conversation: ConversationRecord = {
    id: conversationId,
    source: p.source,
    sourceConversationId: p.sourceConversationId,
    title: p.title,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lastMessageAt,
    messageCount: messages.length,
    revision: revisionOf(p),
    importBatchId: ctx.batchId,
    archiveFileName: ctx.archiveFileName,
    rawMetadata: p.rawMetadata,
    ...(ctx.isSample ? { isSample: true } : {}),
  };

  const fb = deriveFallback(p.title, messages);
  const available = images.filter((i) => i.available);
  const baseEntry: JournalEntry = {
    id: entryId,
    conversationId,
    source: p.source,
    title: fb.title,
    subtitle: '',
    excerpt: fb.excerpt,
    summary: '',
    tags: [],
    collectionId: null,
    keyDecisions: [],
    nextSteps: [],
    extractedLists: [],
    highlightMessageIds: [],
    imageIds: images.map((i) => i.id),
    coverImageId: available[0]?.id ?? null,
    messageCount: messages.length,
    imageCount: images.length,
    availableImageCount: available.length,
    chatDate: p.createdAt ?? lastMessageAt,
    importedAt: ctx.importedAt,
    updatedAt: ctx.importedAt,
    summaryStatus: 'not_configured',
    summaryError: null,
    summaryProvider: null,
    summaryGeneratedAt: null,
    summaryOutdated: false,
    ...(ctx.isSample ? { isSample: true } : {}),
  };

  return { conversation, messages, images, blobs, baseEntry, warnings };
}

export type PersistOutcome = 'imported' | 'updated' | 'unchanged' | 'skipped';

export interface PersistResult {
  outcome: PersistOutcome;
  entryId: string;
  /** Whether this entry should (re)generate its summary. */
  needsSummary: boolean;
}

const DERIVED_FIELDS = [
  'title',
  'subtitle',
  'summary',
  'tags',
  'collectionId',
  'keyDecisions',
  'nextSteps',
  'extractedLists',
  'highlightMessageIds',
  'summaryStatus',
  'summaryError',
  'summaryProvider',
  'summaryGeneratedAt',
] as const;

function keepValidRefs(items: DerivedItem[], valid: Set<string>): DerivedItem[] {
  return items.map((it) => ({ ...it, sourceMessageIds: it.sourceMessageIds.filter((id) => valid.has(id)) }));
}

/**
 * Writes one conversation and its entry atomically. Re-importing the same revision is a no-op
 * when `skipExisting` is on, and otherwise rewrites identical data (idempotent). Derived summary
 * content is preserved across updates and flagged outdated when the conversation changed;
 * user edits live in a separate store and are never touched here.
 */
export async function persistPrepared(
  prepared: PreparedConversation,
  opts: { skipExisting: boolean; markPending: boolean },
): Promise<PersistResult> {
  const db = await getDb();
  const { conversation, baseEntry } = prepared;
  const result = await db.write(['conversations', 'messages', 'images', 'blobs', 'entries'], async (tx): Promise<PersistResult> => {
    const existing = await tx.get<ConversationRecord>('conversations', conversation.id);
    const sameRevision = !!existing && existing.revision === conversation.revision;
    if (existing && sameRevision && opts.skipExisting) {
      return { outcome: 'skipped', entryId: baseEntry.id, needsSummary: false };
    }
    if (existing) await deleteConversationSourceInTx(tx, conversation.id);

    await tx.put('conversations', conversation);
    await tx.putAll('messages', prepared.messages);
    await tx.putAll('images', prepared.images);
    await tx.putAll('blobs', prepared.blobs);

    const prev = await tx.get<JournalEntry>('entries', baseEntry.id);
    let entry: JournalEntry = { ...baseEntry };
    if (prev) {
      const valid = new Set(prepared.messages.map((m) => m.id));
      const keep: Partial<JournalEntry> = { collectionId: prev.collectionId, tags: prev.tags };
      if (prev.summaryStatus === 'complete') {
        for (const k of DERIVED_FIELDS) (keep as Record<string, unknown>)[k] = prev[k];
        keep.keyDecisions = keepValidRefs(prev.keyDecisions, valid);
        keep.nextSteps = keepValidRefs(prev.nextSteps, valid);
        keep.extractedLists = prev.extractedLists.map((l) => ({
          ...l,
          rows: l.rows.map((r) => ({ ...r, sourceMessageIds: r.sourceMessageIds.filter((id) => valid.has(id)) })),
        }));
        keep.highlightMessageIds = prev.highlightMessageIds.filter((id) => valid.has(id));
      }
      entry = {
        ...entry,
        ...keep,
        summaryOutdated: prev.summaryStatus === 'complete' && !sameRevision ? true : prev.summaryOutdated && sameRevision,
      };
    }
    const needsSummary = !prev || !sameRevision || prev.summaryStatus !== 'complete';
    if (opts.markPending && needsSummary) entry = { ...entry, summaryStatus: 'pending', summaryError: null };
    await tx.put('entries', entry);
    return { outcome: !existing ? 'imported' : sameRevision ? 'unchanged' : 'updated', entryId: baseEntry.id, needsSummary };
  }, { durability: 'relaxed' });
  if (result.outcome !== 'skipped') {
    notifyChange({ stores: ['conversations', 'messages', 'images', 'entries'], conversationIds: [conversation.id] });
  }
  return result;
}
