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

subscribeChanges((e) => {
  if (e.reset) void rebuild();
  else if (e.conversationIds?.length) void index.updateConversations(e.conversationIds);
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
