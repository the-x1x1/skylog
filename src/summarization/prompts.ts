import type { JournalSummary, SummaryInput, SummaryInputMessage } from './types';

export const SUMMARY_SYSTEM_PROMPT = `You turn a chat transcript into a short personal journal entry for the person who had the conversation.

Hard rules:
- Use only facts stated in the transcript. Never invent facts, parts, decisions, numbers or next steps.
- When something is unclear or absent, leave it out. Prefer omission over speculation.
- Every key decision, next step and list row must cite the message refs that support it (e.g. ["m4", "m7"]).
- Output exactly one JSON object and nothing else — no prose, no code fences.

JSON shape:
{
  "title": string,                 // at most 8 words, specific and human (not "Conversation about ...")
  "subtitle": string,              // one sentence, at most 20 words
  "summary": string,               // 2-4 sentences of plain prose: what was explored and where it landed
  "tags": string[],                // 2-5 short lowercase topic tags, or [] when told not to tag
  "keyDecisions": [{ "text": string, "sourceMessageIds": string[] }],  // decisions actually made or agreed; [] if none
  "nextSteps": [{ "text": string, "sourceMessageIds": string[] }],     // follow-ups explicitly stated; [] if none
  "highlights": [{ "messageId": string }],                              // up to 3 messages worth rereading
  "extractedLists": [{ "heading": string, "rows": [{ "label": string, "value": string, "sourceMessageIds": string[] }] }],
                                   // only when the transcript clearly contains an itemized list with values
                                   // (e.g. parts with quantities or prices); otherwise []
  "suggestedCollection": string | null  // a short project or life-area name if obvious, else null
}`;

const PER_MESSAGE_CHARS = { primary: 3000, secondary: 500 };

export function messageRef(index: number): string {
  return `m${index}`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return `${text.slice(0, head)}\n[… ${text.length - max} characters trimmed …]\n${text.slice(text.length - tail)}`;
}

/** Formats one message for the prompt, trimming very long turns and tool noise. */
export function formatMessage(m: SummaryInputMessage, scale = 1): string {
  const speaker =
    m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ASSISTANT' : m.role === 'tool' ? `TOOL${m.authorName ? ` (${m.authorName})` : ''}` : m.role.toUpperCase();
  const limit = Math.round((m.role === 'user' || m.role === 'assistant' ? PER_MESSAGE_CHARS.primary : PER_MESSAGE_CHARS.secondary) * scale);
  const date = m.createdAt ? ` ${m.createdAt.slice(0, 10)}` : '';
  return `[${messageRef(m.index)}] ${speaker}${date}:\n${clip(m.text.trim(), Math.max(limit, 200))}`;
}

/** Splits the transcript into chunks under `budget` characters, never splitting a message. */
export function chunkTranscript(input: SummaryInput, budget: number, scale = 1): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const m of input.messages) {
    if (!m.text.trim()) continue;
    const block = formatMessage(m, scale);
    if (size + block.length > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.length + 2;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function imageLines(input: SummaryInput, refOf: (messageId: string | null) => string | null): string {
  if (input.images.length === 0) return 'Images: none.';
  const lines = input.images.slice(0, 40).map((img, i) => {
    const where = refOf(img.messageId);
    const bits = [img.title ? `title "${img.title}"` : null, img.prompt ? `prompt "${clip(img.prompt, 300)}"` : null].filter(Boolean).join(', ');
    return `- image ${i + 1}${where ? ` in ${where}` : ''}${bits ? `: ${bits}` : ''}`;
  });
  return `Images (${input.images.length}):\n${lines.join('\n')}`;
}

function header(input: SummaryInput, refOf: (id: string | null) => string | null): string {
  return [
    `Source app: ${input.source === 'chatgpt' ? 'ChatGPT' : 'Claude'}`,
    `Original title: ${input.sourceTitle ? JSON.stringify(input.sourceTitle) : '(none)'}`,
    input.autoTag ? 'Tagging: include 2-5 tags.' : 'Tagging: return "tags": [].',
    imageLines(input, refOf),
  ].join('\n');
}

export function singlePrompt(input: SummaryInput, chunk: string[], refOf: (id: string | null) => string | null): string {
  return `${header(input, refOf)}\n\nTranscript (message refs in brackets):\n\n${chunk.join('\n\n')}\n\nWrite the JSON journal entry now.`;
}

export function partPrompt(input: SummaryInput, chunk: string[], part: number, parts: number, refOf: (id: string | null) => string | null): string {
  return `${header(input, refOf)}\n\nThis is part ${part} of ${parts} of one long conversation. Produce the JSON for THIS PART ONLY, using the same shape and rules; it will be merged with the other parts later.\n\nTranscript part ${part}/${parts}:\n\n${chunk.join('\n\n')}\n\nWrite the JSON for this part now.`;
}

/** Serializes partial summaries back into ref form so the merge step can cite messages. */
export function mergePrompt(input: SummaryInput, partials: JournalSummary[], idToRef: ReadonlyMap<string, string>): string {
  const toRefs = (ids: string[]) => ids.map((id) => idToRef.get(id)).filter(Boolean);
  const notes = partials.map((p, i) => ({
    part: i + 1,
    title: p.title,
    subtitle: p.subtitle,
    summary: p.summary,
    tags: p.tags,
    keyDecisions: p.keyDecisions.map((d) => ({ text: d.text, sourceMessageIds: toRefs(d.sourceMessageIds) })),
    nextSteps: p.nextSteps.map((d) => ({ text: d.text, sourceMessageIds: toRefs(d.sourceMessageIds) })),
    highlights: p.highlights.map((h) => ({ messageId: idToRef.get(h.messageId) })).filter((h) => h.messageId),
    extractedLists: p.extractedLists.map((l) => ({
      heading: l.heading,
      rows: l.rows.map((r) => ({ label: r.label, value: r.value, sourceMessageIds: toRefs(r.sourceMessageIds) })),
    })),
    suggestedCollection: p.suggestedCollection,
  }));
  return `${header(input, () => null)}\n\nBelow are JSON notes for consecutive parts of ONE conversation, in order. Merge them into a single final journal entry with the same JSON shape and rules. Later parts can supersede earlier decisions. Keep only message refs that appear in the notes. Deduplicate.\n\n${JSON.stringify(notes, null, 1)}\n\nWrite the final merged JSON now.`;
}

export function repairPrompt(original: string, badReply: string, error: string): string {
  const shown = badReply.length > 4000 ? `${badReply.slice(0, 4000)}…` : badReply;
  return `${original}\n\n---\nYour previous reply could not be used: ${error}\nPrevious reply:\n${shown}\n\nReply again with ONLY one valid JSON object in the required shape.`;
}
