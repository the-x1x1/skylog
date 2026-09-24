/**
 * Local LLM adapter. Runs inside the local Node server only, so API keys stay out of
 * browser code. The browser posts {system, prompt} to /api/llm and gets {text} back.
 */

export type LlmVendor = 'anthropic' | 'openai';

export interface LlmRequestBody {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmStatus {
  available: boolean;
  vendor: LlmVendor | null;
  model: string | null;
  reason: string | null;
}

const DEFAULT_MODELS: Record<LlmVendor, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4.1-mini',
};

function resolveVendor(env: Record<string, string | undefined>): { vendor: LlmVendor; key: string; model: string } | { error: string } {
  const requested = (env.LLM_VENDOR ?? '').trim().toLowerCase();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? '';
  const pick = (vendor: LlmVendor) => {
    const key = vendor === 'anthropic' ? anthropicKey : openaiKey;
    if (!key) return { error: `LLM_VENDOR is "${vendor}" but ${vendor === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} is not set in .env.local.` };
    const model = (vendor === 'anthropic' ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL)?.trim() || DEFAULT_MODELS[vendor];
    return { vendor, key, model };
  };
  if (requested === 'anthropic' || requested === 'openai') return pick(requested);
  if (requested) return { error: `Unknown LLM_VENDOR "${requested}". Use "anthropic" or "openai".` };
  if (anthropicKey) return pick('anthropic');
  if (openaiKey) return pick('openai');
  return { error: 'No API key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local and restart the server.' };
}

export function getLlmStatus(env: Record<string, string | undefined>): LlmStatus {
  const resolved = resolveVendor(env);
  if ('error' in resolved) return { available: false, vendor: null, model: null, reason: resolved.error };
  return { available: true, vendor: resolved.vendor, model: resolved.model, reason: null };
}

export class LlmAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function validateLlmBody(body: unknown): LlmRequestBody {
  if (!body || typeof body !== 'object') throw new LlmAdapterError('Request body must be a JSON object.', 400);
  const b = body as Record<string, unknown>;
  if (typeof b.system !== 'string' || typeof b.prompt !== 'string') {
    throw new LlmAdapterError('Request body needs string "system" and "prompt" fields.', 400);
  }
  const maxTokens = typeof b.maxTokens === 'number' ? Math.min(Math.max(Math.round(b.maxTokens), 64), 8192) : 2048;
  const temperature = typeof b.temperature === 'number' ? Math.min(Math.max(b.temperature, 0), 1) : 0.2;
  return { system: b.system, prompt: b.prompt, maxTokens, temperature };
}

export async function callLlm(
  req: LlmRequestBody,
  env: Record<string, string | undefined>,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; vendor: LlmVendor; model: string }> {
  const resolved = resolveVendor(env);
  if ('error' in resolved) throw new LlmAdapterError(resolved.error, 503);
  const { vendor, key, model } = resolved;

  if (vendor === 'anthropic') {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { content?: { type: string; text?: string }[]; error?: { message?: string } }
      | null;
    if (!res.ok) throw new LlmAdapterError(`Anthropic API error (${res.status}): ${data?.error?.message ?? res.statusText}`, 502);
    const text = (data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return { text, vendor, model };
  }

  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    | null;
  if (!res.ok) throw new LlmAdapterError(`OpenAI API error (${res.status}): ${data?.error?.message ?? res.statusText}`, 502);
  return { text: data?.choices?.[0]?.message?.content ?? '', vendor, model };
}
