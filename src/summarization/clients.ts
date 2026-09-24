import { SummaryError, type LlmClient, type LlmCompletionRequest, type ProviderStatus } from './types';

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error === 'object' && typeof (data.error as { message?: unknown }).message === 'string') {
      return (data.error as { message: string }).message;
    }
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`.trim();
}

/**
 * Talks to this app's own local server (/api/llm). The server holds the API key; the browser
 * never sees it. See server/llm-adapter.ts.
 */
export class LocalServerClient implements LlmClient {
  private cachedLabel = 'Local server';

  constructor(private readonly endpoint: string) {}

  label(): string {
    return this.cachedLabel;
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      const res = await fetch(`${this.endpoint}/status`, { headers: { 'x-journal-client': '1' }, signal });
      if (!res.ok) return { ok: false, label: 'Local server', detail: `The local server did not answer (${res.status}). Start the app with npm run dev or npm start.` };
      const data = (await res.json()) as { available: boolean; vendor: string | null; model: string | null; reason: string | null };
      if (!data.available) return { ok: false, label: 'Local server', detail: data.reason ?? 'No API key configured.' };
      this.cachedLabel = `${data.vendor === 'openai' ? 'OpenAI' : 'Anthropic'} · ${data.model}`;
      return { ok: true, label: this.cachedLabel, detail: 'Requests go from this device to the model vendor through the local server. The key never reaches the browser.' };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      return { ok: false, label: 'Local server', detail: 'No local server found. Summaries through the local adapter need the app to run via npm run dev or npm start.' };
    }
  }

  async complete(req: LlmCompletionRequest, signal?: AbortSignal): Promise<string> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-journal-client': '1' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) throw new SummaryError(`Summary request failed: ${await readError(res)}`);
    const data = (await res.json()) as { text?: string; vendor?: string; model?: string };
    if (data.model) this.cachedLabel = `${data.vendor === 'openai' ? 'OpenAI' : 'Anthropic'} · ${data.model}`;
    return data.text ?? '';
  }
}

/** Calls a local Ollama server directly. Nothing leaves the device. */
export class OllamaClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  private get base(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  label(): string {
    return `Ollama · ${this.model}`;
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      const res = await fetch(`${this.base}/api/tags`, { signal });
      if (!res.ok) return { ok: false, label: this.label(), detail: `Ollama answered ${res.status}.` };
      const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
      const names = (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
      const found = names.some((n) => n === this.model || n.split(':')[0] === this.model.split(':')[0]);
      if (!found) {
        return {
          ok: false,
          label: this.label(),
          detail: names.length ? `Model "${this.model}" is not installed. Installed: ${names.slice(0, 6).join(', ')}.` : `No models installed. Run: ollama pull ${this.model}`,
        };
      }
      return { ok: true, label: this.label(), detail: 'Runs entirely on this device.' };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      return {
        ok: false,
        label: this.label(),
        detail: `Could not reach Ollama at ${this.base}. Is it running? If it is, allow this page's origin with OLLAMA_ORIGINS.`,
      };
    }
  }

  async complete(req: LlmCompletionRequest, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw new SummaryError(`Ollama request failed: ${await readError(res)}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
}
