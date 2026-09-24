import type { Role, Source } from '../data/types';

export interface SearchFilters {
  source?: Source | null;
  /** Inclusive ISO date bounds (YYYY-MM-DD or full ISO). */
  from?: string | null;
  to?: string | null;
  tag?: string | null;
  collectionId?: string | null;
}

export interface Segment {
  text: string;
  match: boolean;
}

interface BaseHit {
  id: string;
  entryId: string;
  entryTitle: string;
  source: Source;
  date: string | null;
  score: number;
}

export interface EntryHit extends BaseHit {
  kind: 'entry';
  snippet: Segment[];
  tags: string[];
  coverImageId: string | null;
}

export interface ImageHit extends BaseHit {
  kind: 'image';
  imageId: string;
  imageTitle: string | null;
  snippet: Segment[];
  blobKey: string | null;
  available: boolean;
}

export interface MessageHit extends BaseHit {
  kind: 'message';
  messageId: string;
  index: number;
  role: Role;
  snippet: Segment[];
}

export type SearchHit = EntryHit | ImageHit | MessageHit;

export interface SearchResults {
  query: string;
  entries: EntryHit[];
  images: ImageHit[];
  messages: MessageHit[];
  totalMessages: number;
  tookMs: number;
}

export interface SearchStatus {
  ready: boolean;
  building: boolean;
  documents: number;
}
