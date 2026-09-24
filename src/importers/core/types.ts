import type { AttachmentRef, ImageOrigin, ImportCounts, ImportIssue, PromptKind, Role, Source } from '../../data/types';

export interface ArchiveFile {
  /** Path inside the archive, normalized with the export's root folder removed. */
  path: string;
  size: number;
}

/**
 * Read-only view of an export archive. Implementations: ZipArchive (user uploads) and
 * MemoryArchive (bundled sample journal and tests).
 */
export interface ArchiveManifest {
  fileName: string;
  size: number;
  files: ArchiveFile[];
  /** First ~64 KB of top-level JSON files, decompressed, for cheap source detection. */
  sniffs: Record<string, string>;
  has(path: string): boolean;
  readText(path: string): Promise<string>;
  readBlob(path: string, type?: string): Promise<Blob>;
}

export interface ParsedMessage {
  sourceMessageId: string;
  index: number;
  role: Role;
  authorName: string | null;
  text: string;
  createdAt: string | null;
  attachments: AttachmentRef[];
  imageKeys: string[];
}

export interface ParsedImage {
  /** Stable within the conversation (e.g. the asset pointer id). */
  key: string;
  messageSourceId: string | null;
  title: string | null;
  prompt: string | null;
  promptKind: PromptKind | null;
  mimeType: string | null;
  /** Archive path of the binary, when present in the export. */
  archivePath: string | null;
  /** Inline image content (e.g. an SVG artifact's markup), when the image is embedded in the JSON. */
  inlineContent: string | null;
  originalFilename: string | null;
  sourcePointer: string | null;
  origin: ImageOrigin;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  /** Why the binary is unavailable (used when archivePath and inlineContent are both null). */
  unavailableReason: string | null;
}

export interface ParsedConversation {
  source: Source;
  sourceConversationId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: ParsedMessage[];
  images: ParsedImage[];
  rawMetadata: Record<string, unknown>;
  /** Non-fatal problems noticed while parsing this conversation. */
  warnings: string[];
}

export interface ImportPreview {
  source: Source;
  fileName: string;
  archiveSize: number;
  conversationCount: number;
  /** Image references found in the conversations (null when not cheaply determinable). */
  imageCount: number | null;
  /** How many referenced images have a binary in the archive. */
  imageFilesPresent: number | null;
  warnings: string[];
  dateRange: { from: string | null; to: string | null };
  /** Source ids of the conversations in the export (used to count what's already imported). */
  conversationIds?: string[];
  /** How many of the export's conversations are already in the journal. */
  alreadyInJournal?: number;
}

export interface ParseProgress {
  processed: number;
  total: number;
  currentTitle: string | null;
}

export type ProgressCallback = (p: ParseProgress) => void;

export interface ParseResult {
  conversations: ParsedConversation[];
  issues: ImportIssue[];
}

/** One item from an importer's stream: a parsed conversation or a skipped record. */
export type ParsedItem =
  | { kind: 'conversation'; conversation: ParsedConversation; position: number; total: number }
  | { kind: 'skipped'; issue: ImportIssue; position: number; total: number };

export interface ConversationImporter {
  source: Source;
  label: string;
  /** Cheap, synchronous check based on file names and content sniffs. Returns a confidence score (0 = no). */
  score(files: ArchiveManifest): { score: number; reasons: string[] };
  canHandle(files: ArchiveManifest): boolean;
  inspect(files: ArchiveManifest): Promise<ImportPreview>;
  /** Streams conversations one at a time so large exports are persisted incrementally. */
  iterate(files: ArchiveManifest, signal?: AbortSignal): AsyncGenerator<ParsedItem>;
  parse(files: ArchiveManifest, onProgress?: ProgressCallback): Promise<ParseResult>;
}

export interface ImportProgress {
  stage: 'opening' | 'parsing' | 'summarizing' | 'done' | 'cancelled' | 'failed';
  batchId: string;
  counts: ImportCounts;
  processed: number;
  total: number;
  currentTitle: string | null;
  summaryTotal: number;
  summaryDone: number;
  lastIssue: ImportIssue | null;
  message: string | null;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'too_large' | 'malformed' | 'empty' | 'cancelled' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
