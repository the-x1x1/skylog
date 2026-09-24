import { notifyChange } from '../data/db/changes';
import { getDb } from '../data/db/database';
import { ensureCollectionInTx, getEntryView, type EntryView } from '../data/repositories/entries';
import { getSetting, setSetting } from '../data/repositories/settings';
import type { DerivedItem, ExtractedList, JournalEntry } from '../data/types';
import type { EntrySummarizer } from '../importers/core/pipeline';
import { OllamaClient, LocalServerClient } from './clients';
import { LlmSummaryProvider } from './llm-provider';
import type { JournalSummary, LlmClient, SummaryInput, SummaryProvider, SummaryProviderConfig } from './types';

const CONFIG_KEY = 'summary.provider';

export const DEFAULT_OLLAMA = { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' };

export async function loadSummaryConfig(): Promise<SummaryProviderConfig> {
  return getSetting<SummaryProviderConfig>(CONFIG_KEY, { kind: 'none' });
}

export async function saveSummaryConfig(cfg: SummaryProviderConfig): Promise<void> {
  await setSetting(CONFIG_KEY, cfg);
}

/** Absolute URL of the local adapter (absolute so it also resolves inside workers). */
export function localServerEndpoint(): string {
  const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : 'http://localhost:4173';
  return `${origin}/api/llm`;
}

export function createClient(cfg: SummaryProviderConfig): LlmClient | null {
  switch (cfg.kind) {
    case 'local-server':
      return new LocalServerClient(cfg.endpoint || localServerEndpoint());
    case 'ollama':
      return new OllamaClient(cfg.baseUrl || DEFAULT_OLLAMA.baseUrl, cfg.model || DEFAULT_OLLAMA.model);
    default:
      return null;
  }
}

export function createProvider(cfg: SummaryProviderConfig): SummaryProvider | null {
  const client = createClient(cfg);
  return client ? new LlmSummaryProvider(client) : null;
}

export function buildSummaryInput(view: EntryView, autoTag: boolean): SummaryInput {
  return {
    conversationId: view.derived.conversationId,
    source: view.derived.source,
    sourceTitle: view.conversation?.title ?? '',
    autoTag,
    messages: view.messages.map((m) => ({ id: m.id, index: m.index, role: m.role, authorName: m.authorName, text: m.text, createdAt: m.createdAt })),
    images: view.images.map((i) => ({ id: i.id, messageId: i.messageId, title: i.title, prompt: i.prompt })),
  };
}

let itemSeq = 0;
function derivedItems(items: JournalSummary['keyDecisions'], prefix: string): DerivedItem[] {
  return items.map((it) => ({ id: `${prefix}_${Date.now().toString(36)}_${(itemSeq++).toString(36)}`, text: it.text, sourceMessageIds: it.sourceMessageIds }));
}

/**
 * Writes a validated summary onto the entry's derived fields. Source data is untouched and user
 * edits (stored separately) keep overriding whatever the summary says.
 */
export async function applySummary(entryId: string, summary: JournalSummary, providerLabel: string, opts: { autoTag: boolean }): Promise<void> {
  const db = await getDb();
  let conversationId = '';
  await db.write(['entries', 'collections'], async (tx) => {
    const entry = await tx.get<JournalEntry>('entries', entryId);
    if (!entry) throw new Error('Entry no longer exists.');
    conversationId = entry.conversationId;
    let collectionId = entry.collectionId;
    if (!collectionId && summary.suggestedCollection) collectionId = await ensureCollectionInTx(tx, summary.suggestedCollection);
    const lists: ExtractedList[] = summary.extractedLists.map((l, i) => ({ id: `list_${i}`, heading: l.heading, rows: l.rows }));
    const now = new Date().toISOString();
    const next: JournalEntry = {
      ...entry,
      title: summary.title,
      subtitle: summary.subtitle,
      summary: summary.summary,
      tags: opts.autoTag ? summary.tags : entry.tags,
      collectionId,
      keyDecisions: derivedItems(summary.keyDecisions, 'dec'),
      nextSteps: derivedItems(summary.nextSteps, 'step'),
      extractedLists: lists,
      highlightMessageIds: summary.highlights.map((h) => h.messageId),
      summaryStatus: 'complete',
      summaryError: null,
      summaryProvider: providerLabel,
      summaryGeneratedAt: now,
      summaryOutdated: false,
      updatedAt: now,
    };
    await tx.put('entries', next);
  });
  notifyChange({ stores: ['entries', 'collections'], conversationIds: [conversationId] });
}

async function setStatus(entryId: string, patch: Pick<JournalEntry, 'summaryStatus' | 'summaryError'>): Promise<void> {
  const db = await getDb();
  let conversationId = '';
  await db.write('entries', async (tx) => {
    const e = await tx.get<JournalEntry>('entries', entryId);
    if (!e) return;
    conversationId = e.conversationId;
    await tx.put('entries', { ...e, ...patch });
  });
  if (conversationId) notifyChange({ stores: ['entries'], conversationIds: [conversationId] });
}

/**
 * Summarizes one stored entry. On failure the entry is marked failed with a readable error and
 * the error is rethrown; the conversation itself is never modified or hidden.
 */
export async function summarizeEntry(entryId: string, provider: SummaryProvider, opts: { signal?: AbortSignal; autoTag: boolean }): Promise<void> {
  const view = await getEntryView(entryId);
  if (!view) throw new Error('Entry not found.');
  await setStatus(entryId, { summaryStatus: 'pending', summaryError: null });
  try {
    const summary = await provider.summarize(buildSummaryInput(view, opts.autoTag), opts.signal);
    await applySummary(entryId, summary, provider.label, { autoTag: opts.autoTag });
  } catch (err) {
    const aborted = opts.signal?.aborted || (err as Error)?.name === 'AbortError';
    const previous = view.derived.summaryStatus === 'complete' ? 'complete' : 'not_configured';
    await setStatus(entryId, aborted ? { summaryStatus: previous, summaryError: null } : { summaryStatus: 'failed', summaryError: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function makeEntrySummarizer(provider: SummaryProvider): EntrySummarizer {
  return (entryId, opts) => summarizeEntry(entryId, provider, opts);
}
