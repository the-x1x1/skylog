import { chunkTranscript, mergePrompt, messageRef, partPrompt, repairPrompt, singlePrompt, SUMMARY_SYSTEM_PROMPT } from './prompts';
import { SummaryError, type JournalSummary, type LlmClient, type SummaryInput, type SummaryProvider } from './types';
import { parseJsonLoose, validateSummary } from './validate';

export interface LlmProviderOptions {
  /** Max characters of transcript per model call. */
  chunkChars: number;
  /** Chunks beyond this trigger tighter per-message trimming before splitting further. */
  maxChunks: number;
  /** How many partial summaries one merge call combines. */
  mergeFanIn: number;
}

const DEFAULTS: LlmProviderOptions = { chunkChars: 24_000, maxChunks: 12, mergeFanIn: 6 };

/**
 * SummaryProvider backed by any text-in/text-out model. Long conversations are chunked,
 * each chunk summarized, then merged hierarchically. Every reply is schema-validated; a
 * malformed reply gets exactly one repair attempt before the summary is marked failed.
 */
export class LlmSummaryProvider implements SummaryProvider {
  private readonly opts: LlmProviderOptions;

  constructor(
    private readonly client: LlmClient,
    opts: Partial<LlmProviderOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  get label(): string {
    return this.client.label();
  }

  async summarize(input: SummaryInput, signal?: AbortSignal): Promise<JournalSummary> {
    const refToId = new Map<string, string>();
    const idToRef = new Map<string, string>();
    for (const m of input.messages) {
      const ref = messageRef(m.index);
      refToId.set(ref, m.id);
      idToRef.set(m.id, ref);
    }
    const refOf = (id: string | null) => (id ? (idToRef.get(id) ?? null) : null);

    let chunks = chunkTranscript(input, this.opts.chunkChars);
    if (chunks.length > this.opts.maxChunks) chunks = chunkTranscript(input, this.opts.chunkChars, 0.35);
    if (chunks.length === 0) throw new SummaryError('The conversation has no text to summarize.');

    if (chunks.length === 1) {
      return this.callValidated(singlePrompt(input, chunks[0]!, refOf), refToId, signal);
    }

    let partials: JournalSummary[] = [];
    for (let i = 0; i < chunks.length; i++) {
      signal?.throwIfAborted();
      partials.push(await this.callValidated(partPrompt(input, chunks[i]!, i + 1, chunks.length, refOf), refToId, signal));
    }
    while (partials.length > 1) {
      const next: JournalSummary[] = [];
      for (let i = 0; i < partials.length; i += this.opts.mergeFanIn) {
        const group = partials.slice(i, i + this.opts.mergeFanIn);
        next.push(group.length === 1 ? group[0]! : await this.callValidated(mergePrompt(input, group, idToRef), refToId, signal));
      }
      partials = next;
    }
    return partials[0]!;
  }

  private async callValidated(prompt: string, refToId: ReadonlyMap<string, string>, signal?: AbortSignal): Promise<JournalSummary> {
    const first = await this.client.complete({ system: SUMMARY_SYSTEM_PROMPT, prompt, maxTokens: 2048 }, signal);
    const firstError = this.tryValidate(first, refToId);
    if (typeof firstError !== 'string') return firstError;

    signal?.throwIfAborted();
    const second = await this.client.complete({ system: SUMMARY_SYSTEM_PROMPT, prompt: repairPrompt(prompt, first, firstError), maxTokens: 2048 }, signal);
    const secondError = this.tryValidate(second, refToId);
    if (typeof secondError !== 'string') return secondError;
    throw new SummaryError(`The model's reply did not match the summary format after one repair attempt (${secondError}).`);
  }

  private tryValidate(reply: string, refToId: ReadonlyMap<string, string>): JournalSummary | string {
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(reply);
    } catch (err) {
      return err instanceof Error ? err.message : 'Reply was not valid JSON.';
    }
    const result = validateSummary(parsed, refToId);
    return result.ok ? result.value : result.error;
  }
}
