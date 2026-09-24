/**
 * Domain model. Source data (conversations, messages, images) is stored exactly as parsed and is
 * never rewritten by summarization. Derived journal content lives on JournalEntry, and user edits
 * live in EntryEdits so regenerating a summary can never silently destroy them.
 */

export type Source = 'chatgpt' | 'claude';
export const SOURCES: readonly Source[] = ['chatgpt', 'claude'];

export type Role = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

export interface AttachmentRef {
  name: string;
  mimeType: string | null;
  size: number | null;
}

export interface ConversationRecord {
  /** Stable internal id: `${source}:${sourceConversationId}`. */
  id: string;
  source: Source;
  sourceConversationId: string;
  /** Title exactly as found in the export ('' when the export has none). */
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  /** Changes whenever the visible conversation content changes; used for duplicate detection. */
  revision: string;
  importBatchId: string;
  archiveFileName: string;
  rawMetadata?: Record<string, unknown>;
  isSample?: boolean;
}

export interface MessageRecord {
  /** Stable internal id: `${conversationId}:${sourceMessageId}`. */
  id: string;
  conversationId: string;
  sourceMessageId: string;
  index: number;
  role: Role;
  /** Author/tool name when the export provides one (e.g. "dalle.text2im"). */
  authorName: string | null;
  text: string;
  createdAt: string | null;
  imageIds: string[];
  attachments: AttachmentRef[];
}

export type PromptKind = 'generation' | 'tool_call' | 'user_request';
export type ImageOrigin = 'generated' | 'uploaded' | 'artifact' | 'unknown';

export interface ImageAsset {
  id: string;
  entryId: string;
  conversationId: string;
  messageId: string | null;
  /** Position in the entry gallery, in conversation order. */
  index: number;
  title: string | null;
  prompt: string | null;
  promptKind: PromptKind | null;
  mimeType: string | null;
  /** Key into the blobs store; null when the binary was not in the export. */
  blobKey: string | null;
  originalFilename: string | null;
  /** Raw pointer from the export, e.g. "file-service://file-abc" (kept for traceability). */
  sourcePointer: string | null;
  origin: ImageOrigin;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface BlobRecord {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
}

export interface DerivedItem {
  id: string;
  text: string;
  sourceMessageIds: string[];
}

export interface ExtractedListRow {
  label: string;
  value: string;
  sourceMessageIds: string[];
}

export interface ExtractedList {
  id: string;
  heading: string;
  rows: ExtractedListRow[];
}

export type SummaryStatus = 'pending' | 'complete' | 'failed' | 'not_configured';

export interface JournalEntry {
  /** Stable: `entry:${conversationId}` so edits survive re-imports. */
  id: string;
  conversationId: string;
  source: Source;
  title: string;
  subtitle: string;
  /** First meaningful user message, quoted verbatim (derived from source, never AI-written). */
  excerpt: string;
  summary: string;
  tags: string[];
  collectionId: string | null;
  keyDecisions: DerivedItem[];
  nextSteps: DerivedItem[];
  extractedLists: ExtractedList[];
  highlightMessageIds: string[];
  imageIds: string[];
  coverImageId: string | null;
  messageCount: number;
  imageCount: number;
  availableImageCount: number;
  chatDate: string | null;
  importedAt: string;
  updatedAt: string;
  summaryStatus: SummaryStatus;
  summaryError: string | null;
  /** e.g. "anthropic · claude-haiku-4-5" or "sample data". */
  summaryProvider: string | null;
  summaryGeneratedAt: string | null;
  /** The conversation changed after the summary was generated. */
  summaryOutdated: boolean;
  isSample?: boolean;
}

/** User edits, merged over the derived entry at read time. */
export interface EntryEdits {
  entryId: string;
  title?: string;
  subtitle?: string;
  tags?: string[];
  nextSteps?: DerivedItem[];
  collectionId?: string | null;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface ImportIssue {
  level: 'warning' | 'error';
  sourceFile: string;
  /** 1-based position of the record in the source file, when known. */
  recordIndex?: number;
  conversationId: string | null;
  title: string | null;
  reason: string;
}

export interface ImportCounts {
  total: number;
  imported: number;
  updated: number;
  /** Already imported and unchanged. */
  duplicates: number;
  /** Records that can't become an entry (e.g. empty conversations). */
  skipped: number;
  failed: number;
  imagesFound: number;
  imagesStored: number;
  imagesMissing: number;
  summarized: number;
  summaryFailed: number;
}

export type ImportStatus = 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';

export interface ImportOptions {
  generateSummaries: boolean;
  importImages: boolean;
  skipExisting: boolean;
  autoTag: boolean;
}

export interface ImportBatch {
  id: string;
  archiveFileName: string;
  archiveSize: number;
  source: Source;
  startedAt: string;
  finishedAt: string | null;
  status: ImportStatus;
  options: ImportOptions;
  counts: ImportCounts;
  issues: ImportIssue[];
  /** Entry ids created or updated by this batch. */
  entryIds: string[];
  fatalError: string | null;
}

export interface SettingRecord<T = unknown> {
  key: string;
  value: T;
}

/** A journal entry with user edits applied — what the UI renders. */
export interface EffectiveEntry extends JournalEntry {
  edited: {
    title: boolean;
    subtitle: boolean;
    tags: boolean;
    nextSteps: boolean;
    collectionId: boolean;
  };
}

export function emptyCounts(): ImportCounts {
  return {
    total: 0,
    imported: 0,
    updated: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    imagesFound: 0,
    imagesStored: 0,
    imagesMissing: 0,
    summarized: 0,
    summaryFailed: 0,
  };
}
