import type { Role, Source } from '../data/types';

export interface SummaryInputMessage {
  id: string;
  index: number;
  role: Role;
  authorName: string | null;
  text: string;
  createdAt: string | null;
}

export interface SummaryInputImage {
  id: string;
  messageId: string | null;
  title: string | null;
  prompt: string | null;
}

export interface SummaryInput {
  conversationId: string;
  source: Source;
  sourceTitle: string;
  messages: SummaryInputMessage[];
  images: SummaryInputImage[];
  autoTag: boolean;
}

export interface SourcedText {
  text: string;
  sourceMessageIds: string[];
}

export interface JournalSummary {
  title: string;
  subtitle: string;
  summary: string;
  tags: string[];
  keyDecisions: SourcedText[];
  nextSteps: SourcedText[];
  highlights: { messageId: string }[];
  extractedLists: {
    heading: string;
    rows: { label: string; value: string; sourceMessageIds: string[] }[];
  }[];
  suggestedCollection: string | null;
}

export interface SummaryProvider {
  /** Human-readable label stored on entries, e.g. "Anthropic · claude-haiku-4-5". */
  readonly label: string;
  summarize(input: SummaryInput, signal?: AbortSignal): Promise<JournalSummary>;
}

export interface LlmCompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** Transport to a model. Text in, text out; all schema work happens in the provider. */
export interface LlmClient {
  label(): string;
  complete(req: LlmCompletionRequest, signal?: AbortSignal): Promise<string>;
  status(signal?: AbortSignal): Promise<ProviderStatus>;
}

export interface ProviderStatus {
  ok: boolean;
  /** Short description, e.g. "Anthropic · claude-haiku-4-5-20251001". */
  label: string;
  detail: string;
}

export type SummaryProviderConfig =
  | { kind: 'none' }
  | { kind: 'local-server'; endpoint: string }
  | { kind: 'ollama'; baseUrl: string; model: string };

export class SummaryError extends Error {}
