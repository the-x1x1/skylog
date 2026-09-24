/// Search worker: holds the full-text index and keeps it current as data changes.
import { subscribeChanges } from '../data/db/changes';
import type { WorkerScope } from '../utils/workers';
import { SearchIndex } from './engine';
import type { SearchRequest, SearchResponse } from './protocol';

const scope = self as unknown as WorkerScope;
const index = new SearchIndex();

let rebuildRequested = false;
let rebuilding = false;
async function rebuild() {
  if (rebuilding) {
    rebuildRequested = true;
    return;
  }
  rebuilding = true;
  do {
    rebuildRequested = false;
    await index.rebuild().catch((err) => console.error('search rebuild failed', err));
  } while (rebuildRequested);
  rebuilding = false;
}

// Imports change conversations one at a time; collect ids and re-index in batches once writes
// pause, instead of competing with the import for the database on every conversation.
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  flushTimer = null;
  const ids = Array.from(pending);
  pending.clear();
  if (ids.length) void index.updateConversations(ids);
}

subscribeChanges((e) => {
  if (e.reset) {
    pending.clear();
    void rebuild();
    return;
  }
  for (const id of e.conversationIds ?? []) pending.add(id);
  if (pending.size >= 250) flush();
  else if (pending.size > 0) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }
});

void rebuild();

scope.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const req = event.data;
  if (req.type === 'query') {
    index.search(req.query, req.filters).then(
      (results) => scope.postMessage({ type: 'results', id: req.id, results } satisfies SearchResponse),
      (err) => scope.postMessage({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) } satisfies SearchResponse),
    );
  } else if (req.type === 'status') {
    scope.postMessage({ type: 'status', id: req.id, status: index.status() } satisfies SearchResponse);
  }
});
