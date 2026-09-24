import MiniSearch, { type SearchResult } from 'minisearch';
import { getDb } from '../data/db/database';
import { applyEdits } from '../data/repositories/entries';
import type { EntryEdits, ImageAsset, JournalEntry, MessageRecord, Role, Source } from '../data/types';
import { makeSnippet } from './snippet';
import type { EntryHit, ImageHit, MessageHit, SearchFilters, SearchResults, SearchStatus, Segment } from './types';

interface Doc {
  id: string;
  kind: 'entry' | 'image' | 'message';
  conversationId: string;
  entryId: string;
  entryTitle: string;
  source: Source;
  date: string | null;
  tagList: string[];
  collectionId: string | null;
  // indexed text
  title?: string;
  subtitle?: string;
  summary?: string;
  tags?: string;
  derived?: string;
  excerpt?: string;
  imageTitle?: string | null;
  prompt?: string | null;
  filename?: string | null;
  text?: string;
  // stored extras
  imageId?: string;
  messageId?: string;
  index?: number;
  role?: Role;
  available?: boolean;
  blobKey?: string | null;
  coverImageId?: string | null;
}

type Hit = SearchResult & Doc;

/** Long messages are indexed in slices so text beyond any single slice stays searchable. */
const MESSAGE_SLICE_CHARS = 20_000;
const SLICE_OVERLAP = 200;

function createMiniSearch() {
  return new MiniSearch<Doc>({
    idField: 'id',
    fields: ['title', 'subtitle', 'summary', 'tags', 'derived', 'excerpt', 'imageTitle', 'prompt', 'filename', 'text'],
    storeFields: [
      'kind',
      'conversationId',
      'entryId',
      'entryTitle',
      'source',
      'date',
      'tagList',
      'collectionId',
      'summary',
      'subtitle',
      'excerpt',
      'derived',
      'imageId',
      'imageTitle',
      'prompt',
      'filename',
      'messageId',
      'index',
      'role',
      'available',
      'blobKey',
      'coverImageId',
    ],
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0),
      combineWith: 'AND',
      boost: { title: 4, tags: 3, imageTitle: 2.5, subtitle: 2, prompt: 1.6, summary: 1.5, derived: 1.3, excerpt: 1.2, filename: 1, text: 1 },
    },
  });
}

export function buildDocs(entry: JournalEntry, edits: EntryEdits | undefined, images: ImageAsset[], messages: MessageRecord[]): Doc[] {
  const e = applyEdits(entry, edits);
  const base = {
    conversationId: e.conversationId,
    entryId: e.id,
    entryTitle: e.title,
    source: e.source,
    date: e.chatDate,
    tagList: e.tags,
    collectionId: e.collectionId,
  };
  const derived = [
    ...e.keyDecisions.map((d) => d.text),
    ...e.nextSteps.map((d) => d.text),
    ...e.extractedLists.flatMap((l) => [l.heading, ...l.rows.map((r) => `${r.label} ${r.value}`)]),
  ].join(' · ');
  const docs: Doc[] = [
    {
      ...base,
      id: `e|${e.id}`,
      kind: 'entry',
      title: e.title,
      subtitle: e.subtitle,
      summary: e.summary,
      tags: e.tags.join(' '),
      derived,
      excerpt: e.excerpt,
      coverImageId: e.coverImageId,
    },
  ];
  for (const img of images) {
    docs.push({
      ...base,
      id: `i|${img.id}`,
      kind: 'image',
      imageId: img.id,
      imageTitle: img.title,
      prompt: img.prompt,
      filename: img.originalFilename,
      available: img.available,
      blobKey: img.blobKey,
      messageId: img.messageId ?? undefined,
    });
  }
  for (const m of messages) {
    const full = messageSearchText(m);
    if (!full.trim()) continue;
    for (let start = 0, slice = 0; start < full.length; start += MESSAGE_SLICE_CHARS - SLICE_OVERLAP, slice++) {
      docs.push({
        ...base,
        id: slice === 0 ? `m|${m.id}` : `m|${m.id}#${slice}`,
        kind: 'message',
        messageId: m.id,
        index: m.index,
        role: m.role,
        text: full.slice(start, start + MESSAGE_SLICE_CHARS),
      });
      if (start + MESSAGE_SLICE_CHARS >= full.length) break;
    }
  }
  return docs;
}

/** Message text plus any attached/pasted text the export included. */
export function messageSearchText(m: Pick<MessageRecord, 'text' | 'attachments'>): string {
  const extra = m.attachments.map((a) => a.extractedText ?? '').filter(Boolean);
  return extra.length ? [m.text, ...extra].join('\n\n') : m.text;
}

/** Calendar day in the viewer's time zone (date filters are picked in local days). */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function passesFilters(hit: Hit, f: SearchFilters): boolean {
  if (f.source && hit.source !== f.source) return false;
  if (f.from && (!hit.date || localDay(hit.date) < f.from.slice(0, 10))) return false;
  if (f.to && (!hit.date || localDay(hit.date) > f.to.slice(0, 10))) return false;
  if (f.tag && !(hit.tagList ?? []).includes(f.tag)) return false;
  if (f.collectionId && hit.collectionId !== f.collectionId) return false;
  return true;
}

function firstMatching(fields: (string | null | undefined)[], terms: string[]): string {
  for (const f of fields) {
    if (!f) continue;
    const lower = f.toLowerCase();
    if (terms.some((t) => lower.includes(t))) return f;
  }
  return fields.find((f) => !!f) ?? '';
}

/**
 * In-memory full-text index over every entry, image and message. Built from IndexedDB and kept
 * current per conversation, so an import only re-indexes what it touched.
 */
export class SearchIndex {
  private ms = createMiniSearch();
  private docIdsByConversation = new Map<string, string[]>();
  private building: Promise<void> | null = null;
  private ready = false;
  private queue = Promise.resolve();

  status(): SearchStatus {
    return { ready: this.ready, building: this.building !== null, documents: this.ms.documentCount };
  }

  rebuild(): Promise<void> {
    if (this.building) return this.building;
    this.building = (async () => {
      const fresh = createMiniSearch();
      const byConv = new Map<string, string[]>();
      const db = await getDb();
      const [entries, edits] = await db.read(['entries', 'edits'], (tx) =>
        Promise.all([tx.getAll<JournalEntry>('entries'), tx.getAll<EntryEdits>('edits')]),
      );
      const editsById = new Map(edits.map((e) => [e.entryId, e]));
      for (let i = 0; i < entries.length; i += 25) {
        const batch = entries.slice(i, i + 25);
        const loaded = await db.read(['images', 'messages'], (tx) =>
          Promise.all(
            batch.map(async (entry) => {
              const [images, messages] = await Promise.all([
                tx.getAllFromIndex<ImageAsset>('images', 'entryId', entry.id),
                tx.getAllFromIndex<MessageRecord>('messages', 'conversationId', entry.conversationId),
              ]);
              return { entry, images, messages };
            }),
          ),
        );
        for (const { entry, images, messages } of loaded) {
          const docs = buildDocs(entry, editsById.get(entry.id), images, messages);
          fresh.addAll(docs);
          byConv.set(entry.conversationId, docs.map((d) => d.id));
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      this.ms = fresh;
      this.docIdsByConversation = byConv;
      this.ready = true;
    })().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  /** Re-indexes the given conversations (added, changed or deleted). */
  updateConversations(conversationIds: string[]): Promise<void> {
    // A failed update must never stall later ones: recover the chain, and fall back to a full
    // rebuild so no conversation silently drops out of search.
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.applyUpdates(conversationIds))
      .catch((err) => {
        console.error('Search index update failed; rebuilding.', err);
        this.ready = false;
        return this.rebuild();
      });
    return this.queue;
  }

  private async applyUpdates(conversationIds: string[]): Promise<void> {
    {
      if (this.building) await this.building;
      if (!this.ready) return;
      const db = await getDb();
      for (const conversationId of conversationIds) {
        for (const id of this.docIdsByConversation.get(conversationId) ?? []) {
          if (this.ms.has(id)) this.ms.discard(id);
        }
        this.docIdsByConversation.delete(conversationId);
        const loaded = await db.read(['entries', 'edits', 'images', 'messages'], async (tx) => {
          const entry = await tx.getFromIndex<JournalEntry>('entries', 'conversationId', conversationId);
          if (!entry) return null;
          const [edits, images, messages] = await Promise.all([
            tx.get<EntryEdits>('edits', entry.id),
            tx.getAllFromIndex<ImageAsset>('images', 'entryId', entry.id),
            tx.getAllFromIndex<MessageRecord>('messages', 'conversationId', conversationId),
          ]);
          return { entry, edits, images, messages };
        });
        if (!loaded) continue;
        const docs = buildDocs(loaded.entry, loaded.edits, loaded.images, loaded.messages);
        this.ms.addAll(docs);
        this.docIdsByConversation.set(conversationId, docs.map((d) => d.id));
      }
    }
  }

  async search(query: string, filters: SearchFilters = {}, limits = { entries: 20, images: 24, messages: 40 }): Promise<SearchResults> {
    const started = performance.now();
    const q = query.trim();
    const empty: SearchResults = { query: q, entries: [], images: [], messages: [], totalMessages: 0, tookMs: 0 };
    if (q.length < 2) return empty;
    if (!this.ready) await this.rebuild();

    const raw = this.ms.search(q, { filter: (r) => passesFilters(r as Hit, filters) }) as Hit[];
    const entries: EntryHit[] = [];
    const images: ImageHit[] = [];
    const messageHits: Hit[] = [];
    const seenMessages = new Set<string>();
    for (const r of raw) {
      const terms = r.terms;
      if (r.kind === 'entry' && entries.length < limits.entries) {
        entries.push({
          kind: 'entry',
          id: r.id,
          entryId: r.entryId,
          entryTitle: r.entryTitle,
          source: r.source,
          date: r.date,
          score: r.score,
          tags: r.tagList ?? [],
          coverImageId: r.coverImageId ?? null,
          snippet: makeSnippet(firstMatching([r.summary, r.subtitle, r.excerpt, r.derived, r.entryTitle], terms), terms, 110),
        });
      } else if (r.kind === 'image' && images.length < limits.images) {
        images.push({
          kind: 'image',
          id: r.id,
          entryId: r.entryId,
          entryTitle: r.entryTitle,
          source: r.source,
          date: r.date,
          score: r.score,
          imageId: r.imageId!,
          imageTitle: r.imageTitle ?? null,
          blobKey: r.blobKey ?? null,
          available: !!r.available,
          snippet: makeSnippet(firstMatching([r.prompt, r.imageTitle, r.filename], terms), terms, 80),
        });
      } else if (r.kind === 'message' && !seenMessages.has(r.messageId!)) {
        seenMessages.add(r.messageId!);
        messageHits.push(r);
      }
    }

    const top = messageHits.slice(0, limits.messages);
    const texts = await this.messageTexts(top.map((h) => h.messageId!));
    const messages: MessageHit[] = top.map((r) => ({
      kind: 'message',
      id: r.id,
      entryId: r.entryId,
      entryTitle: r.entryTitle,
      source: r.source,
      date: r.date,
      score: r.score,
      messageId: r.messageId!,
      index: r.index ?? 0,
      role: r.role ?? 'unknown',
      snippet: makeSnippet(texts.get(r.messageId!) ?? '', r.terms, 100) as Segment[],
    }));

    return { query: q, entries, images, messages, totalMessages: messageHits.length, tookMs: Math.round(performance.now() - started) };
  }

  private async messageTexts(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const db = await getDb();
    await db.read('messages', async (tx) => {
      const recs = await Promise.all(ids.map((id) => tx.get<MessageRecord>('messages', id)));
      recs.forEach((m) => {
        if (m) out.set(m.id, messageSearchText(m));
      });
    });
    return out;
  }
}
