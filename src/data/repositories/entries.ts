import { normalizeWhitespace, uniqueTags } from '../../utils/text';
import { notifyChange } from '../db/changes';
import { getDb } from '../db/database';
import type { Tx } from '../db/idb';
import type {
  BlobRecord,
  Collection,
  ConversationRecord,
  DerivedItem,
  EffectiveEntry,
  EntryEdits,
  ImageAsset,
  JournalEntry,
  MessageRecord,
} from '../types';

export function applyEdits(entry: JournalEntry, edits?: EntryEdits | null): EffectiveEntry {
  const has = <K extends keyof EntryEdits>(k: K) => !!edits && edits[k] !== undefined;
  return {
    ...entry,
    title: has('title') ? (edits!.title as string) : entry.title,
    subtitle: has('subtitle') ? (edits!.subtitle as string) : entry.subtitle,
    tags: has('tags') ? (edits!.tags as string[]) : entry.tags,
    nextSteps: has('nextSteps') ? (edits!.nextSteps as DerivedItem[]) : entry.nextSteps,
    collectionId: has('collectionId') ? (edits!.collectionId ?? null) : entry.collectionId,
    edited: {
      title: has('title'),
      subtitle: has('subtitle'),
      tags: has('tags'),
      nextSteps: has('nextSteps'),
      collectionId: has('collectionId'),
    },
  };
}

export async function listEntries(): Promise<EffectiveEntry[]> {
  const db = await getDb();
  return db.read(['entries', 'edits'], async (tx) => {
    const [entries, edits] = await Promise.all([tx.getAll<JournalEntry>('entries'), tx.getAll<EntryEdits>('edits')]);
    const byId = new Map(edits.map((e) => [e.entryId, e]));
    return entries.map((e) => applyEdits(e, byId.get(e.id)));
  });
}

export async function countEntries(): Promise<number> {
  const db = await getDb();
  return db.read('entries', (tx) => tx.count('entries'));
}

export interface EntryView {
  entry: EffectiveEntry;
  derived: JournalEntry;
  edits: EntryEdits | null;
  conversation: ConversationRecord | null;
  messages: MessageRecord[];
  images: ImageAsset[];
  collection: Collection | null;
}

export async function getEntryView(entryId: string): Promise<EntryView | null> {
  const db = await getDb();
  return db.read(['entries', 'edits', 'conversations', 'messages', 'images', 'collections'], async (tx) => {
    const derived = await tx.get<JournalEntry>('entries', entryId);
    if (!derived) return null;
    const [edits, conversation, messages, images] = await Promise.all([
      tx.get<EntryEdits>('edits', entryId),
      tx.get<ConversationRecord>('conversations', derived.conversationId),
      tx.getAllFromIndex<MessageRecord>('messages', 'conversationId', derived.conversationId),
      tx.getAllFromIndex<ImageAsset>('images', 'entryId', entryId),
    ]);
    const entry = applyEdits(derived, edits);
    const collection = entry.collectionId ? ((await tx.get<Collection>('collections', entry.collectionId)) ?? null) : null;
    messages.sort((a, b) => a.index - b.index);
    images.sort((a, b) => a.index - b.index);
    return { entry, derived, edits: edits ?? null, conversation: conversation ?? null, messages, images, collection };
  });
}

export async function getImagesForEntries(entryIds: string[]): Promise<Map<string, ImageAsset>> {
  const db = await getDb();
  return db.read('images', async (tx) => {
    const out = new Map<string, ImageAsset>();
    for (const id of entryIds) {
      const imgs = await tx.getAllFromIndex<ImageAsset>('images', 'entryId', id);
      for (const img of imgs) out.set(img.id, img);
    }
    return out;
  });
}

export async function getImage(imageId: string): Promise<ImageAsset | null> {
  const db = await getDb();
  return (await db.read('images', (tx) => tx.get<ImageAsset>('images', imageId))) ?? null;
}

export async function getBlob(key: string): Promise<Blob | null> {
  const db = await getDb();
  const rec = await db.read('blobs', (tx) => tx.get<BlobRecord>('blobs', key));
  return rec?.blob ?? null;
}

export type EditPatch = Partial<Pick<EntryEdits, 'title' | 'subtitle' | 'tags' | 'nextSteps' | 'collectionId'>>;

/**
 * Saves user edits. A field set to `undefined` in `clear` reverts to the derived value.
 * Tags are normalized; empty titles are rejected (the derived title is used instead).
 */
export async function saveEntryEdits(entryId: string, patch: EditPatch, clear: (keyof EditPatch)[] = []): Promise<void> {
  const db = await getDb();
  let conversationId = '';
  await db.write(['edits', 'entries'], async (tx) => {
    const entry = await tx.get<JournalEntry>('entries', entryId);
    if (!entry) throw new Error('Entry not found.');
    conversationId = entry.conversationId;
    const current = (await tx.get<EntryEdits>('edits', entryId)) ?? { entryId, updatedAt: '' };
    const next: EntryEdits = { ...current, updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) {
      const t = normalizeWhitespace(patch.title);
      if (t && t !== entry.title) next.title = t;
      else delete next.title;
    }
    if (patch.subtitle !== undefined) {
      const s = normalizeWhitespace(patch.subtitle);
      if (s !== entry.subtitle) next.subtitle = s;
      else delete next.subtitle;
    }
    if (patch.tags !== undefined) next.tags = uniqueTags(patch.tags, 12);
    if (patch.nextSteps !== undefined) {
      next.nextSteps = patch.nextSteps
        .map((s) => ({ ...s, text: normalizeWhitespace(s.text) }))
        .filter((s) => s.text.length > 0);
    }
    if (patch.collectionId !== undefined) next.collectionId = patch.collectionId;
    for (const k of clear) delete next[k];
    const hasAny = (['title', 'subtitle', 'tags', 'nextSteps', 'collectionId'] as const).some((k) => next[k] !== undefined);
    if (hasAny) await tx.put('edits', next);
    else await tx.delete('edits', entryId);
  });
  notifyChange({ stores: ['edits'], conversationIds: [conversationId] });
}

export function collectionNameKey(name: string): string {
  return normalizeWhitespace(name).toLowerCase();
}

export async function ensureCollectionInTx(tx: Tx, name: string): Promise<string | null> {
  const clean = normalizeWhitespace(name).slice(0, 48);
  if (!clean) return null;
  const nameKey = collectionNameKey(clean);
  const existing = await tx.getFromIndex<Collection & { nameKey: string }>('collections', 'nameKey', nameKey);
  if (existing) return existing.id;
  const id = `col_${nameKey.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}_${Date.now().toString(36)}`;
  await tx.put('collections', { id, name: clean, nameKey, createdAt: new Date().toISOString() });
  return id;
}

export async function ensureCollection(name: string): Promise<string | null> {
  const db = await getDb();
  const id = await db.write('collections', (tx) => ensureCollectionInTx(tx, name));
  notifyChange({ stores: ['collections'] });
  return id;
}

export async function listCollections(): Promise<Collection[]> {
  const db = await getDb();
  const all = await db.read('collections', (tx) => tx.getAll<Collection>('collections'));
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** Removes an entry and all of its source data (conversation, messages, images, blobs, edits). */
export async function deleteEntry(entryId: string): Promise<void> {
  const db = await getDb();
  let conversationId = '';
  await db.write(['entries', 'edits', 'conversations', 'messages', 'images', 'blobs'], async (tx) => {
    const entry = await tx.get<JournalEntry>('entries', entryId);
    if (!entry) return;
    conversationId = entry.conversationId;
    await deleteConversationSourceInTx(tx, entry.conversationId);
    await tx.delete('entries', entryId);
    await tx.delete('edits', entryId);
    await tx.delete('conversations', entry.conversationId);
  });
  if (conversationId) notifyChange({ stores: ['entries', 'conversations', 'messages', 'images'], conversationIds: [conversationId] });
}

/** Deletes messages, images and image blobs for a conversation (used by delete and re-import). */
export async function deleteConversationSourceInTx(tx: Tx, conversationId: string): Promise<void> {
  const [messageKeys, images] = await Promise.all([
    tx.getAllKeysFromIndex('messages', 'conversationId', conversationId),
    tx.getAllFromIndex<ImageAsset>('images', 'conversationId', conversationId),
  ]);
  await tx.deleteAll('messages', messageKeys);
  await tx.deleteAll(
    'images',
    images.map((i) => i.id),
  );
  const blobKeys = images.map((i) => i.blobKey).filter((k): k is string => !!k);
  await tx.deleteAll('blobs', blobKeys);
}

export async function updateEntryDerived(entryId: string, patch: Partial<JournalEntry>): Promise<JournalEntry | null> {
  const db = await getDb();
  const updated = await db.write('entries', async (tx) => {
    const entry = await tx.get<JournalEntry>('entries', entryId);
    if (!entry) return null;
    const next = { ...entry, ...patch, updatedAt: new Date().toISOString() };
    await tx.put('entries', next);
    return next;
  });
  if (updated) notifyChange({ stores: ['entries'], conversationIds: [updated.conversationId] });
  return updated;
}

/** Wipes every store. Used by Settings → "Delete all local data". */
export async function deleteAllData(): Promise<void> {
  const db = await getDb();
  const stores = ['entries', 'edits', 'conversations', 'messages', 'images', 'blobs', 'collections', 'imports'];
  await db.write(stores, async (tx) => {
    for (const s of stores) await tx.clear(s);
  });
  notifyChange({ stores, reset: true });
}

export async function deleteSampleData(): Promise<number> {
  const entries = await listEntries();
  const samples = entries.filter((e) => e.isSample);
  for (const e of samples) await deleteEntry(e.id);
  return samples.length;
}
