import type { AttachmentRef, Role } from '../../data/types';
import { maxIso, minIso, toIso } from '../../utils/dates';
import { hashParts } from '../../utils/hash';
import { imageMimeFromName, isImageMime, isImageName } from '../../utils/mime';
import { SkipConversation } from '../core/errors';
import type { ParsedConversation, ParsedImage, ParsedMessage } from '../core/types';

/* Shapes observed in Claude exports (conversations.json). All optional; tolerate drift. */

interface ClaudeBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
  file_name?: string;
  file_uuid?: string;
}

interface ClaudeFile {
  file_name?: string;
  file_uuid?: string;
  uuid?: string;
  file_kind?: string;
  file_type?: string;
  file_size?: number;
  mime_type?: string;
}

interface ClaudeAttachment {
  file_name?: string;
  file_size?: number;
  file_type?: string;
  extracted_content?: string;
}

interface ClaudeMessage {
  uuid?: string;
  id?: string;
  text?: string;
  content?: ClaudeBlock[] | string;
  sender?: string;
  role?: string;
  created_at?: string;
  updated_at?: string;
  attachments?: ClaudeAttachment[];
  files?: ClaudeFile[];
  files_v2?: ClaudeFile[];
}

export interface ClaudeConversation {
  uuid?: string;
  id?: string;
  name?: string;
  title?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
  messages?: ClaudeMessage[];
  [key: string]: unknown;
}

export function normalizeClaudeSender(sender: string | undefined): Role {
  switch ((sender ?? '').trim().toLowerCase()) {
    case 'human':
    case 'user':
      return 'user';
    case 'assistant':
    case 'claude':
    case 'model':
    case 'ai':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return 'unknown';
  }
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? s((c as ClaudeBlock).text) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Index of archive files by uuid-ish stem and by basename, for matching uploaded files. */
export function buildClaudeFileIndex(paths: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of paths) {
    const base = p.split('/').pop() ?? p;
    if (!isImageName(base)) continue;
    index.set(base.toLowerCase(), p);
    const stem = base.replace(/\.[^.]+$/, '').toLowerCase();
    if (!index.has(stem)) index.set(stem, p);
  }
  return index;
}

interface ArtifactState {
  content: string;
  version: number;
  title: string;
  type: string;
}

export function parseClaudeConversation(raw: unknown, fileIndex: Map<string, string>): ParsedConversation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SkipConversation('Record is not a conversation object.');
  const conv = raw as ClaudeConversation;
  const list = Array.isArray(conv.chat_messages) ? conv.chat_messages : Array.isArray(conv.messages) ? conv.messages : null;
  if (!list) throw new SkipConversation('Conversation has no chat_messages array.');
  const sourceId = s(conv.uuid) || s(conv.id);
  const warnings: string[] = [];

  const messages: ParsedMessage[] = [];
  const images: ParsedImage[] = [];
  const artifacts = new Map<string, ArtifactState>();
  let lastUserText: string | null = null;
  let malformedMessages = 0;

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (!msg || typeof msg !== 'object') {
      malformedMessages++;
      continue;
    }
    const role = normalizeClaudeSender(msg.sender ?? msg.role);
    const sourceMessageId = s(msg.uuid) || s(msg.id) || `idx-${i}-${hashParts([msg.created_at, s(msg.text).slice(0, 120)])}`;
    const texts: string[] = [];
    const imageKeys: string[] = [];
    const attachments: AttachmentRef[] = [];

    const pushImage = (img: Omit<ParsedImage, 'messageSourceId'>) => {
      images.push({ ...img, messageSourceId: sourceMessageId });
      imageKeys.push(img.key);
    };

    if (Array.isArray(msg.content) && msg.content.length > 0) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        switch (block.type) {
          case 'text':
            if (s(block.text).trim()) texts.push(s(block.text));
            break;
          case 'thinking':
          case 'redacted_thinking':
            // Hidden reasoning is not part of the visible conversation.
            break;
          case 'tool_use': {
            const input = block.input ?? {};
            if (block.name === 'artifacts') {
              const artifactId = s(input.id) || `artifact-${artifacts.size}`;
              const command = s(input.command) || 'create';
              const prev = artifacts.get(artifactId);
              let content: string | null = null;
              if (command === 'update' && prev) {
                const oldStr = s(input.old_str);
                const newStr = s(input.new_str);
                // Function replacer: "$&", "$$" etc. in the new text must stay literal.
                content = oldStr && prev.content.includes(oldStr) ? prev.content.replace(oldStr, () => newStr) : null;
                if (content === null) warnings.push(`Could not apply an update to artifact "${prev.title}".`);
              } else if (typeof input.content === 'string') {
                content = input.content;
              }
              const title = s(input.title) || prev?.title || 'Untitled artifact';
              const type = s(input.type) || prev?.type || '';
              if (content !== null) {
                const version = (prev?.version ?? 0) + 1;
                artifacts.set(artifactId, { content, version, title, type });
                if (type === 'image/svg+xml') {
                  pushImage({
                    key: `artifact:${artifactId}:v${version}`,
                    title: version > 1 ? `${title} (v${version})` : title,
                    prompt: lastUserText,
                    promptKind: lastUserText ? 'user_request' : null,
                    mimeType: 'image/svg+xml',
                    archivePath: null,
                    inlineContent: content,
                    originalFilename: `${artifactId}.svg`,
                    sourcePointer: `artifact:${artifactId}`,
                    origin: 'artifact',
                    width: null,
                    height: null,
                    byteSize: content.length,
                    unavailableReason: null,
                  });
                  texts.push(`[Artifact · ${title}${version > 1 ? ` (v${version})` : ''} · SVG image]`);
                } else {
                  const lang = s(input.language) || type.split('/').pop() || '';
                  texts.push(`[Artifact · ${title}${version > 1 ? ` (v${version})` : ''}]\n\`\`\`${lang}\n${content}\n\`\`\``);
                }
              }
            } else {
              const summary = JSON.stringify(input);
              texts.push(`[Tool call · ${s(block.name) || 'tool'}] ${summary.length > 600 ? `${summary.slice(0, 600)}…` : summary}`);
            }
            break;
          }
          case 'tool_result': {
            const t = blockText(block.content);
            if (t.trim()) texts.push(`[Tool result${block.name ? ` · ${block.name}` : ''}${block.is_error ? ' · error' : ''}]\n${t}`);
            break;
          }
          case 'image': {
            const src = block.source;
            const key = `inline:${sourceMessageId}:${imageKeys.length}`;
            const data = src?.type === 'base64' && typeof src.data === 'string' ? src.data : null;
            pushImage({
              key,
              title: null,
              prompt: null,
              promptKind: null,
              mimeType: s(src?.media_type) || null,
              archivePath: null,
              inlineContent: data ? `base64:${data}` : null,
              originalFilename: null,
              sourcePointer: null,
              origin: role === 'user' ? 'uploaded' : 'unknown',
              width: null,
              height: null,
              byteSize: null,
              unavailableReason: data ? null : 'The export lists this image but does not include its data.',
            });
            break;
          }
          default:
            if (s(block.text).trim()) texts.push(s(block.text));
        }
      }
    } else if (typeof msg.content === 'string' && msg.content.trim()) {
      texts.push(msg.content);
    }
    if (texts.length === 0 && s(msg.text).trim()) texts.push(s(msg.text));

    // Uploaded files. Claude exports name them but usually don't include the bytes.
    const files = [...(Array.isArray(msg.files) ? msg.files : []), ...(Array.isArray(msg.files_v2) ? msg.files_v2 : [])];
    const seenFiles = new Set<string>();
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const name = s(f.file_name) || 'file';
      const fileId = s(f.file_uuid) || s(f.uuid);
      const dedupe = fileId || name;
      if (seenFiles.has(dedupe)) continue;
      seenFiles.add(dedupe);
      const mime = s(f.mime_type) || imageMimeFromName(name);
      const isImage = f.file_kind === 'image' || isImageMime(mime) || isImageName(name);
      if (!isImage) {
        attachments.push({ name, mimeType: mime || null, size: typeof f.file_size === 'number' ? f.file_size : null });
        continue;
      }
      const archivePath =
        (fileId && (fileIndex.get(fileId.toLowerCase()) ?? null)) || fileIndex.get(name.toLowerCase()) || null;
      pushImage({
        key: `file:${fileId || `${sourceMessageId}:${name}`}`,
        title: null,
        prompt: null,
        promptKind: null,
        mimeType: mime || imageMimeFromName(archivePath) || null,
        archivePath,
        inlineContent: null,
        originalFilename: name,
        sourcePointer: fileId ? `file:${fileId}` : null,
        origin: 'uploaded',
        width: null,
        height: null,
        byteSize: typeof f.file_size === 'number' ? f.file_size : null,
        unavailableReason: archivePath ? null : `Claude exports list uploaded images by name ("${name}") but don't include the image file.`,
      });
    }
    for (const a of Array.isArray(msg.attachments) ? msg.attachments : []) {
      if (!a || typeof a !== 'object') continue;
      // extracted_content holds pasted long text and the text of uploaded documents: it is
      // part of what the user sent, so keep it (shown with the message and searchable).
      const extracted = s(a.extracted_content);
      attachments.push({
        name: s(a.file_name) || (extracted ? 'Pasted text' : 'attachment'),
        mimeType: s(a.file_type) || null,
        size: typeof a.file_size === 'number' ? a.file_size : null,
        extractedText: extracted || null,
      });
    }

    const text = texts.join('\n\n');
    if (!text.trim() && imageKeys.length === 0 && attachments.length === 0) continue;

    messages.push({
      sourceMessageId,
      index: messages.length,
      role,
      authorName: null,
      text,
      createdAt: toIso(msg.created_at),
      attachments,
      imageKeys,
    });
    if (role === 'user' && text.trim()) lastUserText = text.trim().slice(0, 4000);
  }

  if (malformedMessages > 0) warnings.push(`${malformedMessages} malformed message record(s) were skipped.`);
  if (messages.length === 0) throw new SkipConversation('Conversation has no visible messages.', 'warning');

  const times = messages.map((m) => m.createdAt);
  const createdAt = toIso(conv.created_at) ?? minIso(times);
  const updatedAt = toIso(conv.updated_at) ?? maxIso(times);
  const id = sourceId || `anon-${hashParts([createdAt, messages[0]?.text.slice(0, 200)])}`;
  if (!sourceId) warnings.push('Conversation has no uuid; a stable id was derived from its content.');

  const rawMetadata: Record<string, unknown> = {};
  for (const k of ['project_uuid', 'is_starred', 'model', 'summary']) {
    if (conv[k] !== undefined && conv[k] !== null && conv[k] !== '') rawMetadata[k] = conv[k];
  }

  return {
    source: 'claude',
    sourceConversationId: id,
    title: (s(conv.name) || s(conv.title)).trim(),
    createdAt,
    updatedAt,
    messages,
    images,
    rawMetadata,
    warnings,
  };
}
