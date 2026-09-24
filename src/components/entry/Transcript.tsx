import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAsset, MessageRecord, Source } from '../../data/types';
import { speakerName } from '../../export/entry-export';
import { highlight } from '../../search/snippet';
import { formatDateTime } from '../../utils/dates';
import { formatBytes } from '../../utils/text';
import { Icon } from '../shared/Icon';
import { StoredImage } from '../shared/media';
import { Highlighted, IconButton } from '../shared/ui';

export function messageAnchorId(m: Pick<MessageRecord, 'index'>): string {
  return `msg-${m.index + 1}`;
}

interface Block {
  kind: 'text' | 'code';
  text: string;
  lang?: string;
}

/** Splits fenced code blocks out for monospace display. The text itself is never altered. */
function splitBlocks(text: string): Block[] {
  const out: Block[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'code', text: m[2] ?? '', lang: (m[1] ?? '').trim() });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.filter((b) => b.text.trim().length > 0 || b.kind === 'code');
}

function MessageText({ text, find }: { text: string; find: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  const terms = find.trim() ? [find.trim().toLowerCase()] : [];
  const render = (s: string) => (terms.length ? <Highlighted segments={highlightLoose(s, find.trim())} /> : s);
  return (
    <div className="msg__text">
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <pre key={i} className="msg__code" data-lang={b.lang || undefined}>
            <code>{render(b.text)}</code>
          </pre>
        ) : (
          <p key={i} className="msg__para">
            {render(b.text.replace(/^\n+|\n+$/g, ''))}
          </p>
        ),
      )}
    </div>
  );
}

/** Case-insensitive substring highlight (in-transcript "find" matches anywhere, like Ctrl+F). */
function highlightLoose(text: string, needle: string) {
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const segs: { text: string; match: boolean }[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(n, i);
    if (at < 0) break;
    if (at > i) segs.push({ text: text.slice(i, at), match: false });
    segs.push({ text: text.slice(at, at + n.length), match: true });
    i = at + n.length;
  }
  if (i < text.length) segs.push({ text: text.slice(i), match: false });
  return segs.length ? segs : highlight(text, []);
}

const Message = memo(function Message({
  message,
  source,
  images,
  find,
  isCurrentMatch,
  onShowImage,
}: {
  message: MessageRecord;
  source: Source;
  images: ImageAsset[];
  find: string;
  isCurrentMatch: boolean;
  onShowImage: (imageId: string) => void;
}) {
  const isTool = message.role === 'tool' || message.role === 'system';
  const [expanded, setExpanded] = useState(!isTool || message.text.length < 400);
  const long = isTool && message.text.length >= 400;
  return (
    <li
      id={messageAnchorId(message)}
      className={`msg msg--${message.role}${isCurrentMatch ? ' msg--match' : ''}`}
      tabIndex={-1}
      data-message-id={message.id}
      aria-label={`Message ${message.index + 1}, ${speakerName(message, source)}`}
    >
      <header className="msg__head">
        <span className="msg__who">{speakerName(message, source)}</span>
        <span className="msg__num">#{message.index + 1}</span>
        {message.createdAt ? <time className="msg__time" dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time> : null}
      </header>
      {message.text ? (
        expanded ? (
          <MessageText text={message.text} find={find} />
        ) : (
          <div className="msg__text msg__text--collapsed">
            <p className="msg__para">{message.text.slice(0, 280)}…</p>
          </div>
        )
      ) : null}
      {long ? (
        <button type="button" className="text-btn msg__toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse' : `Show all ${message.text.length.toLocaleString()} characters`}
        </button>
      ) : null}
      {images.length > 0 ? (
        <div className="msg__images">
          {images.map((img) => (
            <button key={img.id} type="button" className="msg__image" onClick={() => onShowImage(img.id)} aria-label={`Show image ${img.index + 1} in the gallery`}>
              <StoredImage image={img} className="msg__image-img" alt="" />
            </button>
          ))}
        </div>
      ) : null}
      {message.attachments.length > 0 ? (
        <ul className="msg__files" aria-label="Attachments">
          {message.attachments.map((a, i) => (
            <li key={i}>
              <Icon name="file" size={14} />
              {a.name}
              {a.size ? <span className="msg__file-size">{formatBytes(a.size)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
});

export interface TranscriptProps {
  messages: MessageRecord[];
  images: ImageAsset[];
  source: Source;
  open: boolean;
  onToggle: (open: boolean) => void;
  onShowImage: (imageId: string) => void;
  focusMessageId: string | null;
  onFocused: () => void;
}

export function Transcript({ messages, images, source, open, onToggle, onShowImage, focusMessageId, onFocused }: TranscriptProps) {
  const [find, setFind] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const imagesById = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);

  const matches = useMemo(() => {
    const n = find.trim().toLowerCase();
    if (n.length < 2) return [];
    return messages.filter((m) => m.text.toLowerCase().includes(n)).map((m) => m.id);
  }, [find, messages]);

  const matchSet = useMemo(() => new Set(matches), [matches]);
  useEffect(() => setMatchIndex(0), [find]);

  const scrollToMessage = (id: string, focus: boolean) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!el) return false;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    if (focus) {
      el.focus({ preventScroll: true });
      el.classList.remove('msg--flash');
      void el.offsetWidth;
      el.classList.add('msg--flash');
    }
    return true;
  };

  // Deep link / "jump to message": open, scroll, focus and flash the target.
  useEffect(() => {
    if (!focusMessageId) return;
    if (!open) {
      onToggle(true);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (scrollToMessage(focusMessageId, true)) onFocused();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, open]);

  useEffect(() => {
    const id = matches[matchIndex];
    if (id) scrollToMessage(id, false);
  }, [matchIndex, matches]);

  const step = (d: number) => {
    if (matches.length === 0) return;
    setMatchIndex((i) => (i + d + matches.length) % matches.length);
  };

  return (
    <section className="transcript" id="section-transcript" aria-labelledby="transcript-h">
      <div className="transcript__head">
        <h2 id="transcript-h" className="section-title">
          <Icon name="message" size={18} />
          Transcript
          <span className="section-title__count">{messages.length.toLocaleString()} messages</span>
        </h2>
        <button type="button" className="btn btn--secondary btn--sm" aria-expanded={open} aria-controls="transcript-body" onClick={() => onToggle(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
          <span>{open ? 'Hide transcript' : 'Show full transcript'}</span>
        </button>
      </div>
      {!open ? <p className="transcript__note">The original conversation, exactly as exported. Nothing in it is rewritten.</p> : null}
      {open ? (
        <div id="transcript-body">
          <div className="transcript__find" role="search">
            <Icon name="search" size={16} className="transcript__find-icon" />
            <input
              type="search"
              placeholder="Find in this conversation"
              aria-label="Find in this conversation"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="transcript__find-count" aria-live="polite">
              {find.trim().length >= 2 ? (matches.length ? `${matchIndex + 1} of ${matches.length}` : 'No matches') : ''}
            </span>
            <IconButton icon="chevronLeft" label="Previous match" onClick={() => step(-1)} disabled={matches.length === 0} />
            <IconButton icon="chevronRight" label="Next match" onClick={() => step(1)} disabled={matches.length === 0} />
          </div>
          <ol className="transcript__list" ref={listRef}>
            {messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                source={source}
                images={m.imageIds.map((id) => imagesById.get(id)).filter((i): i is ImageAsset => !!i)}
                find={matchSet.has(m.id) ? find : ''}
                isCurrentMatch={matches[matchIndex] === m.id}
                onShowImage={onShowImage}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
