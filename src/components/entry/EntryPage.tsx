import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../app/providers/data';
import { entryPath, href, navigate, useLocation, withQuery } from '../../app/router';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { useLiveQuery } from '../../data/hooks';
import { deleteEntry, getEntryView } from '../../data/repositories/entries';
import { createProvider, summarizeEntry } from '../../summarization/service';
import { useSummaryConfig } from '../../summarization/useSummaryConfig';
import { formatDate, formatDateTime, monthKey, monthLabel } from '../../utils/dates';
import { pluralize } from '../../utils/text';
import { Icon } from '../shared/Icon';
import { Button, ConfirmDialog, IconButton, Notice, SourceBadge, Spinner, TagPill } from '../shared/ui';
import { EditEntryDialog } from './EditEntryDialog';
import { ExportMenu } from './ExportMenu';
import { Gallery } from './Gallery';
import { DecisionsAndSteps, ExtractedLists, Highlights, SummaryPanel } from './sections';
import { Transcript } from './Transcript';

const TOC: { id: string; label: string }[] = [
  { id: 'section-images', label: 'Images' },
  { id: 'section-summary', label: 'Summary' },
  { id: 'section-decisions', label: 'Key decisions' },
  { id: 'section-steps', label: 'Next steps' },
  { id: 'section-highlights', label: 'Highlights' },
  { id: 'section-transcript', label: 'Transcript' },
];

function OnThisPage() {
  const [present, setPresent] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setPresent(TOC.filter((s) => document.getElementById(s.id))), 50);
    return () => clearTimeout(t);
  });
  if (present.length < 3) return null;
  return (
    <nav className="toc" aria-label="On this page">
      <p className="toc__label">On this page</p>
      <ul>
        {present.map((s) => (
          <li key={s.id}>
            <button type="button" className="toc__link" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function EntryPage({ entryId }: { entryId: string }) {
  const loc = useLocation();
  const { collections } = useAppData();
  const q = useLiveQuery(() => getEntryView(entryId), [entryId], ['entries', 'edits', 'images', 'messages', 'conversations', 'collections']);
  const view = q.data;
  const { config } = useSummaryConfig();
  const provider = useMemo(() => createProvider(config), [config]);

  const imageParam = loc.query.get('image');
  const messageParam = loc.query.get('message');
  const [selected, setSelected] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(!!messageParam);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(messageParam);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(view?.entry.title ?? 'Entry');

  // Deep links: ?image=… selects that image; ?message=… opens the transcript at that message.
  // Without a deep link, open on the first image the export actually contains.
  const initialised = useRef(false);
  useEffect(() => {
    if (!view) return;
    if (imageParam) {
      const i = view.images.findIndex((img) => img.id === imageParam);
      if (i >= 0) {
        setSelected(i);
        if (!initialised.current) requestAnimationFrame(() => galleryRef.current?.scrollIntoView({ block: 'start' }));
      }
    } else if (!initialised.current) {
      setSelected(Math.max(0, view.images.findIndex((img) => img.available)));
    }
    initialised.current = true;
  }, [view?.images, imageParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messageParam) {
      setFocusMessageId(messageParam);
      setTranscriptOpen(true);
    }
  }, [messageParam]);

  const messagesById = useMemo(() => new Map((view?.messages ?? []).map((m) => [m.id, m])), [view?.messages]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      setTranscriptOpen(true);
      setFocusMessageId(messageId);
      navigate(entryPath(entryId, { message: messageId }), { replace: true });
    },
    [entryId],
  );

  const selectImage = useCallback(
    (i: number) => {
      setSelected(i);
      const img = view?.images[i];
      if (img) navigate(entryPath(entryId, { image: img.id }), { replace: true });
    },
    [entryId, view?.images],
  );

  const showImage = useCallback(
    (imageId: string) => {
      const i = view?.images.findIndex((img) => img.id === imageId) ?? -1;
      if (i >= 0) {
        selectImage(i);
        galleryRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    },
    [view?.images, selectImage],
  );

  const generate = async () => {
    if (!view) return;
    if (!provider) {
      navigate('/settings');
      return;
    }
    setSummarizing(true);
    setActionError(null);
    try {
      await summarizeEntry(view.entry.id, provider, { autoTag: true });
    } catch {
      /* the entry records the error; the summary panel shows it */
    } finally {
      setSummarizing(false);
    }
  };

  if (q.loading && !view) {
    return (
      <div className="page">
        <Spinner label="Opening entry…" />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="page page--narrow">
        <h1 className="page-title">Entry not found</h1>
        <p className="lede">It may have been deleted, or the link is from another device.</p>
        <a className="btn btn--secondary btn--md" href={href('/')}>
          <Icon name="journal" size={18} />
          <span>Back to journal</span>
        </a>
      </div>
    );
  }

  const { entry, conversation, messages, images } = view;
  const month = monthKey(entry.chatDate);

  return (
    <div className="entry-layout">
      <article className="page entry" aria-labelledby="entry-title">
        <div className="entry__top">
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href={href('/')}>Journal</a>
            <span aria-hidden="true">/</span>
            <span>{monthLabel(month)}</span>
          </nav>
          <div className="entry__actions">
            <Button size="sm" variant="ghost" icon="message" onClick={() => {
              setTranscriptOpen(true);
              requestAnimationFrame(() => document.getElementById('section-transcript')?.scrollIntoView({ block: 'start' }));
            }} className="hide-sm">
              Transcript
            </Button>
            <ExportMenu view={view} />
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)} className="hide-sm">
              Edit
            </Button>
            <IconButton icon="edit" label="Edit entry" onClick={() => setEditing(true)} className="show-sm" />
            <IconButton
              icon="refresh"
              label={entry.summaryStatus === 'complete' || entry.summary ? 'Regenerate summary' : 'Generate summary'}
              onClick={generate}
              disabled={summarizing || entry.summaryStatus === 'pending'}
              className="show-sm"
            />
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={generate}
              busy={summarizing || entry.summaryStatus === 'pending'}
              title={provider ? 'Write a new summary from the transcript' : 'Set up a summarizer in Settings first'}
              className="hide-sm"
            >
              {entry.summaryStatus === 'complete' || entry.summary ? 'Regenerate summary' : 'Generate summary'}
            </Button>
          </div>
        </div>

        <p className="entry__meta">
          <SourceBadge source={entry.source} />
          <span aria-hidden="true">·</span>
          <time dateTime={entry.chatDate ?? undefined}>{formatDate(entry.chatDate)}</time>
          <span aria-hidden="true">·</span>
          <span>{pluralize(entry.messageCount, 'message')}</span>
          <span aria-hidden="true">·</span>
          <span>{pluralize(entry.imageCount, 'image')}</span>
          {entry.isSample ? <span className="pill pill--sample">Sample</span> : null}
        </p>

        <header className="entry__header">
          <h1 id="entry-title" className="entry__title">
            {entry.title}
          </h1>
          {entry.subtitle ? <p className="entry__subtitle">{entry.subtitle}</p> : null}
          {entry.tags.length > 0 || view.collection ? (
            <div className="entry__tags">
              {view.collection ? (
                <a className="pill pill--collection" href={href(withQuery('/', { collection: view.collection.id }))}>
                  <Icon name="layers" size={14} />
                  {view.collection.name}
                </a>
              ) : null}
              {entry.tags.map((t) => (
                <TagPill key={t} tag={t} href={href(withQuery('/', { tag: t }))} />
              ))}
            </div>
          ) : null}
        </header>

        {images.length > 0 ? (
          <div ref={galleryRef} className="entry__gallery">
            <Gallery images={images} messagesById={messagesById} selected={Math.min(selected, images.length - 1)} onSelect={selectImage} onJumpToMessage={jumpToMessage} />
          </div>
        ) : null}

        {actionError ? <Notice tone="error">{actionError}</Notice> : null}

        <SummaryPanel entry={entry} providerConfigured={!!provider} busy={summarizing} onGenerate={generate} />

        <DecisionsAndSteps entry={entry} messagesById={messagesById} onJump={jumpToMessage} />
        <ExtractedLists lists={entry.extractedLists} messagesById={messagesById} onJump={jumpToMessage} />
        <Highlights entry={entry} messagesById={messagesById} onJump={jumpToMessage} />

        <Transcript
          messages={messages}
          images={images}
          source={entry.source}
          open={transcriptOpen}
          onToggle={setTranscriptOpen}
          onShowImage={showImage}
          focusMessageId={focusMessageId}
          onFocused={() => setFocusMessageId(null)}
        />

        <details className="entry-details">
          <summary>Entry details</summary>
          <dl className="entry-details__grid">
            <dt>Source</dt>
            <dd>{entry.source === 'chatgpt' ? 'ChatGPT export' : 'Claude export'}</dd>
            <dt>Conversation ID</dt>
            <dd className="mono">{conversation?.sourceConversationId ?? '—'}</dd>
            <dt>Original title</dt>
            <dd>{conversation?.title || <em>none</em>}</dd>
            <dt>Started</dt>
            <dd>{formatDateTime(conversation?.createdAt)}</dd>
            <dt>Last message</dt>
            <dd>{formatDateTime(conversation?.lastMessageAt)}</dd>
            <dt>Imported</dt>
            <dd>
              {formatDateTime(entry.importedAt)}
              {conversation ? (
                <>
                  {' '}
                  from <a href={href(`/imports/${encodeURIComponent(conversation.importBatchId)}`)}>{conversation.archiveFileName}</a>
                </>
              ) : null}
            </dd>
            <dt>Images</dt>
            <dd>
              {entry.imageCount} referenced · {entry.availableImageCount} stored
            </dd>
            <dt>Summary</dt>
            <dd>
              {entry.summaryStatus === 'complete'
                ? `${entry.summaryProvider ?? 'Generated'} · ${formatDateTime(entry.summaryGeneratedAt)}`
                : entry.summaryStatus === 'failed'
                  ? 'Failed'
                  : entry.summaryStatus === 'pending'
                    ? 'In progress'
                    : 'Not generated'}
            </dd>
          </dl>
          <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
            Delete entry
          </Button>
        </details>
      </article>
      <OnThisPage />

      <EditEntryDialog view={view} collections={collections} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this entry?"
        body={<p>This removes the entry, its transcript and its stored images from this device. Your original export file is not affected, so you can import it again later.</p>}
        confirmLabel="Delete entry"
        danger
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await deleteEntry(entry.id);
            setConfirmDelete(false);
            navigate('/');
          } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
