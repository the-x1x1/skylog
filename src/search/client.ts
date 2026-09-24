import { subscribeChanges } from '../data/db/changes';
import { spawnWorker, WORKERS } from '../utils/workers';
import { SearchIndex } from './engine';
import type { SearchRequest, SearchResponse } from './protocol';
import type { SearchFilters, SearchResults } from './types';

export interface SearchClient {
  search(query: string, filters?: SearchFilters): Promise<SearchResults>;
}

class WorkerSearchClient implements SearchClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (r: SearchResults) => void; reject: (e: Error) => void }>();

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === 'results') p.resolve(msg.results);
      else if (msg.type === 'error') p.reject(new Error(msg.message));
    };
  }

  search(query: string, filters: SearchFilters = {}): Promise<SearchResults> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'query', id, query, filters } satisfies SearchRequest);
    });
  }
}

class InlineSearchClient implements SearchClient {
  private index = new SearchIndex();
  constructor() {
    subscribeChanges((e) => {
      if (e.reset) void this.index.rebuild();
      else if (e.conversationIds?.length) void this.index.updateConversations(e.conversationIds);
    });
  }
  search(query: string, filters: SearchFilters = {}) {
    return this.index.search(query, filters);
  }
}

let client: SearchClient | null = null;

/** Lazily starts search (worker when possible). Call after the database is open. */
export function getSearchClient(): SearchClient {
  if (!client) {
    const worker = spawnWorker(WORKERS.search, 'search');
    client = worker ? new WorkerSearchClient(worker) : new InlineSearchClient();
  }
  return client;
}
