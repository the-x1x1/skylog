import type { SearchFilters, SearchResults, SearchStatus } from './types';

export type SearchRequest = { type: 'query'; id: number; query: string; filters: SearchFilters } | { type: 'status'; id: number };

export type SearchResponse =
  | { type: 'results'; id: number; results: SearchResults }
  | { type: 'status'; id: number; status: SearchStatus }
  | { type: 'error'; id: number; message: string };
