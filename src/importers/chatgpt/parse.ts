import type { AttachmentRef, Role } from '../../data/types';
import { maxIso, minIso, toIso } from '../../utils/dates';
import { hashParts } from '../../utils/hash';
import { imageMimeFromName, isImageMime } from '../../utils/mime';
import { SkipConversation } from '../core/errors';
import type { ParsedConversation, ParsedImage, ParsedMessage } from '../core/types';

/* ------------------------------------------------------------------------------------------
 * Shapes observed in ChatGPT exports (conversations.json). Everything is optional: exports have
 * changed many times and we tolerate missing or extra fields rather than failing.
 * ---------------------------------------------------------------------------------------- */

interface GptAuthor {
  role?: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

interface GptContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
  result?: string;
  summary?: string;
  language?: string;
  name?: string;
  title?: string;
  url?: string;
  domain?: string;
  thoughts?: unknown[];
  content?: string;
}

interface GptMessage {
  id?: string;
  author?: GptAuthor;
  create_time?: number | string | null;
  update_time?: number | string | null;
  content?: GptContent | string | null;
  status?: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  recipient?: string;
}

interface GptNode {
  id?: string;
  message?: GptMessage | null;
  parent?: string | null;
  children?: string[];
}

export interface GptConversation {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | string | null;
  update_time?: number | string | null;
  mapping?: Record<string, GptNode>;
  current_node?: string | null;
  [key: string]: unknown;
}

/** Content types that ChatGPT never shows in the conversation view. */
const HIDDEN_CONTENT_TYPES = new Set(['user_editable_context', 'model_editable_context', 'thoughts', 'reasoning_recap']);



/* ---------------------------------- ordering ------------------------------------------ */

/**
 * Returns node ids in visible order. Primary: follow `current_node` up the parent chain (this is
 * the branch the user last saw). Fallback: start at the root and follow the most recent child.
 * Last resort: every node with a message, sorted by create_time then id.
 */
export function orderNodes(conv: GptConversation): { ids: string[]; strategy: 'current_node' | 'root_walk' | 'timestamp' } {
  const mapping = conv.mapping ?? {};
  const MAX = Object.keys(mapping).length + 1;

  const current = conv.current_node;
  if (current && mapping[current]) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined = current;
    while (cursor && mapping[cursor] && !seen.has(cursor) && chain.length < MAX) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = mapping[cursor]?.parent ?? null;
    }
    const ordered = chain.reverse();
    if (ordered.some((id) => mapping[id]?.message)) return { ids: ordered, strategy: 'current_node' };
  }

  const roots = Object.keys(mapping).filter((id) => {
    const parent = mapping[id]?.parent;
    return !parent || !mapping[parent];
  });
  if (roots.length > 0) {
    // Prefer the root with the longest descendant walk (handles stray orphan nodes).
    let best: string[] = [];
    for (const root of roots.sort()) {
      const walk: string[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined = root;
      while (cursor && mapping[cursor] && !seen.has(cursor) && walk.length < MAX) {
        seen.add(cursor);
        walk.push(cursor);
        const kids: string[] = (mapping[cursor]?.children ?? []).filter((k) => mapping[k]);
        cursor = latestChild(mapping, kids);
      }
      if (walk.length > best.length) best = walk;
    }
    if (best.some((id) => mapping[id]?.message)) return { ids: best, strategy: 'root_walk' };
  }

  const byTime = Object.keys(mapping)
    .filter((id) => mapping[id]?.message)
    .sort((a, b) => {
      const ta = numericTime(mapping[a]?.message?.create_time);
      const tb = numericTime(mapping[b]?.message?.create_time);
      return ta === tb ? a.localeCompare(b) : ta - tb;
    });
  return { ids: byTime, strategy: 'timestamp' };
}

function numericTime(v: unknown): number {
  const iso = toIso(v);
  return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY;
}

/** The newest child by message time; ties (and missing times) fall back to the last listed child. */
function latestChild(mapping: Record<string, GptNode>, kids: string[]): string | undefined {
  if (kids.length <= 1) return kids[0];
  let best = kids[kids.length - 1];
  let bestTime = -1;
  kids.forEach((k) => {
    const t = numericTime(mapping[k]?.message?.create_time);
    if (Number.isFinite(t) && t >= bestTime) {
      bestTime = t;
      best = k;
    }
  });
  return best;
}

/* ---------------------------------- content ------------------------------------------- */

interface ImagePart {
  pointer: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  dallePrompt: string | null;
}

export interface ExtractedContent {
  text: string;
  images: ImagePart[];
  contentType: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function extractContent(content: GptMessage['content']): ExtractedContent {
  if (content === null || content === undefined) return { text: '', images: [], contentType: 'empty' };
  if (typeof content === 'string') return { text: content, images: [], contentType: 'string' };
  const type = str(content.content_type) || 'unknown';
  const texts: string[] = [];
  const images: ImagePart[] = [];

  const handlePart = (part: unknown) => {
    if (typeof part === 'string') {
      texts.push(part);
      return;
    }
    if (!part || typeof part !== 'object') return;
    const p = part as Record<string, unknown>;
    const pType = str(p.content_type);
    if (pType === 'image_asset_pointer' || (typeof p.asset_pointer === 'string' && pType !== 'audio_asset_pointer')) {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      const dalle = (meta.dalle ?? null) as Record<string, unknown> | null;
      images.push({
        pointer: str(p.asset_pointer),
        width: num(p.width),
        height: num(p.height),
        sizeBytes: num(p.size_bytes),
        dallePrompt: dalle && typeof dalle.prompt === 'string' && dalle.prompt.trim() ? dalle.prompt.trim() : null,
      });
      return;
    }
    if (pType === 'audio_transcription' && typeof p.text === 'string') {
      texts.push(p.text);
      return;
    }
    if (pType === 'audio_asset_pointer' || pType === 'real_time_user_audio_video_asset_pointer') {
      const transcript = (p as { audio_transcription?: { text?: string } }).audio_transcription?.text;
      if (transcript) texts.push(transcript);
      return;
    }
    if (typeof p.text === 'string') texts.push(p.text);
  };

  if (Array.isArray(content.parts)) content.parts.forEach(handlePart);

  switch (type) {
    case 'code':
    case 'execution_output':
    case 'system_error':
      if (content.text) texts.push(type === 'system_error' && content.name ? `${content.name}: ${content.text}` : content.text);
      break;
    case 'tether_quote':
      texts.push([content.title, content.text, content.url].filter(Boolean).join('\n'));
      break;
    case 'tether_browsing_display':
      texts.push(str(content.result) || str(content.summary));
      break;
    default:
      if (!Array.isArray(content.parts)) {
        if (typeof content.text === 'string') texts.push(content.text);
        else if (typeof content.result === 'string') texts.push(content.result);
        else if (typeof content.content === 'string') texts.push(content.content);
      }
  }
  return { text: texts.filter((t) => t.trim().length > 0).join('\n\n'), images, contentType: type };
}

export function normalizeGptRole(role: string | undefined): Role {
  switch ((role ?? '').toLowerCase()) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return 'unknown';
  }
}

/** "file-service://file-AbC123" → "file-AbC123"; "sediment://file_00000000abc" → "file_00000000abc". */
export function pointerFileId(pointer: string): string | null {
  const m = /^[a-z-]+:\/\/(.+)$/i.exec(pointer.trim());
  const id = (m?.[1] ?? pointer).split(/[/?#]/)[0] ?? '';
  return /^file[-_][A-Za-z0-9]+$/.test(id) ? id : id || null;
}

/** Maps file ids (the "file-XXXX" / "file_XXXX" prefix of names in the archive) to archive paths. */
export function buildFileIndex(paths: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  const sorted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const path of sorted) {
    const base = path.split('/').pop() ?? path;
    const m = /^(file[-_][A-Za-z0-9]+)/.exec(base);
    if (m?.[1] && !index.has(m[1])) index.set(m[1], path);
  }
  return index;
}

const IMAGE_TOOL = /dalle|image_gen|text2im|t2uay3k|image/i;

function parsePromptFromToolCall(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['prompt', 'description', 'caption']) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim()) return (obj[key] as string).trim();
    }
    if (Array.isArray(obj.prompts) && typeof obj.prompts[0] === 'string') return obj.prompts[0];
    return null;
  } catch {
    return trimmed.length < 4000 ? trimmed : null;
  }
}

/* ---------------------------------- conversation -------------------------------------- */

export function parseChatGptConversation(raw: unknown, fileIndex: Map<string, string>): ParsedConversation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SkipConversation('Record is not a conversation object.');
  const conv = raw as GptConversation;
  const sourceId = str(conv.conversation_id) || str(conv.id);
  if (!conv.mapping || typeof conv.mapping !== 'object') throw new SkipConversation('Conversation has no message mapping.');
  const warnings: string[] = [];

  const { ids, strategy } = orderNodes(conv);
  if (strategy === 'timestamp') warnings.push('Message order reconstructed from timestamps (no usable message tree).');

  const messages: ParsedMessage[] = [];
  const images: ParsedImage[] = [];
  const seenImageKeys = new Set<string>();
  let lastImageToolPrompt: string | null = null;
  let lastUserText: string | null = null;

  for (const nodeId of ids) {
    const node = conv.mapping[nodeId];
    const msg = node?.message;
    if (!msg) continue;
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    if (meta.is_visually_hidden_from_conversation === true) continue;

    const role = normalizeGptRole(msg.author?.role);
    const content = extractContent(msg.content);
    if (HIDDEN_CONTENT_TYPES.has(content.contentType)) continue;

    const recipient = str(msg.recipient);
    const isToolCall = role === 'assistant' && recipient !== '' && recipient !== 'all';
    const authorName = isToolCall ? `call → ${recipient}` : msg.author?.name ? String(msg.author.name) : null;

    if (isToolCall && IMAGE_TOOL.test(recipient)) {
      lastImageToolPrompt = parsePromptFromToolCall(content.text);
    }

    // Attachments listed on the message (uploaded files). Images among them are matched to pointers.
    const attachments: AttachmentRef[] = [];
    const attachmentNames = new Map<string, { name: string; mime: string | null; size: number | null }>();
    if (Array.isArray(meta.attachments)) {
      for (const a of meta.attachments as Record<string, unknown>[]) {
        if (!a || typeof a !== 'object') continue;
        const name = str(a.name) || str(a.id) || 'attachment';
        const mime = str(a.mime_type) || imageMimeFromName(name);
        const size = num(a.size);
        if (typeof a.id === 'string') attachmentNames.set(a.id, { name, mime: mime || null, size });
        if (!isImageMime(mime)) attachments.push({ name, mimeType: mime || null, size });
      }
    }

    const text = content.text;
    if (!text.trim() && content.images.length === 0 && attachments.length === 0) continue;
    if (role === 'system' && !text.trim()) continue;

    const sourceMessageId = str(msg.id) || nodeId || `idx-${messages.length}`;
    const imageKeys: string[] = [];
    const messageTitle = typeof meta.image_gen_title === 'string' ? meta.image_gen_title : null;

    for (const part of content.images) {
      const fileId = pointerFileId(part.pointer);
      const key = fileId ?? `${sourceMessageId}#${imageKeys.length}`;
      if (seenImageKeys.has(key)) {
        imageKeys.push(key);
        continue;
      }
      seenImageKeys.add(key);
      const attachment = fileId ? attachmentNames.get(fileId) : undefined;
      const archivePath = fileId ? (fileIndex.get(fileId) ?? null) : null;
      const origin = role === 'user' ? 'uploaded' : 'generated';
      let prompt: string | null = null;
      let promptKind: ParsedImage['promptKind'] = null;
      if (origin === 'generated') {
        if (part.dallePrompt) {
          prompt = part.dallePrompt;
          promptKind = 'generation';
        } else if (lastImageToolPrompt) {
          prompt = lastImageToolPrompt;
          promptKind = 'tool_call';
        } else if (lastUserText) {
          prompt = lastUserText;
          promptKind = 'user_request';
        }
      }
      const originalFilename = attachment?.name ?? (archivePath ? (archivePath.split('/').pop() ?? null) : null);
      images.push({
        key,
        messageSourceId: sourceMessageId,
        title: messageTitle ?? null,
        prompt,
        promptKind,
        mimeType: attachment?.mime ?? imageMimeFromName(archivePath) ?? null,
        archivePath,
        inlineContent: null,
        originalFilename,
        sourcePointer: part.pointer || null,
        origin,
        width: part.width,
        height: part.height,
        byteSize: part.sizeBytes ?? attachment?.size ?? null,
        unavailableReason: archivePath
          ? null
          : fileId
            ? `The export references this image (${fileId}) but does not include the file.`
            : 'The export references this image without a file id.',
      });
      imageKeys.push(key);
    }

    messages.push({
      sourceMessageId,
      index: messages.length,
      role: isToolCall ? 'tool' : role,
      authorName,
      text,
      createdAt: toIso(msg.create_time),
      attachments,
      imageKeys,
    });

    if (role === 'user' && text.trim()) {
      lastUserText = text.trim().slice(0, 4000);
      lastImageToolPrompt = null;
    }
  }
  if (messages.length === 0) throw new SkipConversation('Conversation has no visible messages.', 'warning');

  const messageTimes = messages.map((m) => m.createdAt);
  const createdAt = toIso(conv.create_time) ?? minIso(messageTimes);
  const updatedAt = toIso(conv.update_time) ?? maxIso(messageTimes);
  const id = sourceId || `anon-${hashParts([createdAt, messages[0]?.text.slice(0, 200)])}`;
  if (!sourceId) warnings.push('Conversation has no id; a stable id was derived from its content.');

  return {
    source: 'chatgpt',
    sourceConversationId: id,
    title: str(conv.title).trim(),
    createdAt,
    updatedAt,
    messages,
    images,
    rawMetadata: pickMetadata(conv),
    warnings,
  };
}

function pickMetadata(conv: GptConversation): Record<string, unknown> {
  const keep = ['gizmo_id', 'gizmo_type', 'default_model_slug', 'conversation_template_id', 'is_archived', 'safe_urls', 'plugin_ids', 'current_node'];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (conv[k] !== undefined && conv[k] !== null) out[k] = conv[k];
  return out;
}

export function countGptImagePointers(convs: unknown[]): number {
  let n = 0;
  for (const c of convs) {
    const mapping = (c as GptConversation)?.mapping;
    if (!mapping || typeof mapping !== 'object') continue;
    for (const node of Object.values(mapping)) {
      const content = node?.message?.content;
      if (content && typeof content === 'object' && Array.isArray(content.parts)) {
        for (const p of content.parts) {
          if (p && typeof p === 'object' && (p as Record<string, unknown>).content_type === 'image_asset_pointer') n++;
        }
      }
    }
  }
  return n;
}
