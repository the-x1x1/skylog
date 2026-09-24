import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppData } from '../../app/providers/data';
import { entryPath, href, navigate, useLocation, withQuery } from '../../app/router';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { useDebounced, useMediaQuery } from '../../data/hooks';
import type { Source } from '../../data/types';
import { speakerName } from '../../export/entry-export';
import { blobKeyForImage } from '../../importers/core/prepare';
import { getSearchClient } from '../../search/client';
import type { SearchFilters, SearchResults } from '../../search/types';
import { formatDate } from '../../utils/dates';
import { Icon } from '../shared/Icon';
import { StoredImage } from '../shared/media';
import { Highlighted, Notice, SourceBadge, Spinner } from '../shared/ui';

function Thumb({ blobKey, available }: { blobKey: string | null; available: boolean }) {
  return (
    <StoredImage
      image={{ blobKey, available: available && !!blobKey, title: '', prompt: null, origin: 'unknown', originalFilename: null, index: 0, unavailableReason: null, mimeType: null }}
      className="result__thumb-img"
      alt=""
    />
  );
}

function Group({ id, title, count, extra, children }: { id: string; title: string; count: number; extra?: string; children: ReactNode }) {
  return (
    <section className="result-group" aria-labelledby={id}>
      <h2 id={id} className="result-group__title">
        {title}
        <span className="result-group__count">{count}</span>
        {extra ? <span className="result-group__extra">{extra}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function SearchPage() {
  const loc = useLocation();
  const { entries, collections, ready } = useAppData();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const q = loc.query.get('q') ?? '';
  const filters: SearchFilters = useMemo(
    () => ({
      source: (loc.query.get('source') as Source | null) ?? null,
      from: loc.query.get('from'),
      to: loc.query.get('to'),
      tag: loc.query.get('tag'),
      collectionId: loc.query.get('collection'),
    }),
    [loc.query],
  );
  const debounced = useDebounced(q, 120);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const mobileInput = useRef<HTMLInputElement>(null);
  useDocumentTitle(q ? `Search: ${q}` : 'Search');

  const allTags = useMemo(() => Array.from(new Set(entries.flatMap((e) => e.tags))).sort(), [entries]);

  const setParam = (key: string, value: string | null, replace = true) => {
    const next = Object.fromEntries(loc.query.entries());
    if (value) next[key] = value;
    else delete next[key];
    navigate(withQuery('/search', next), { replace });
  };

  // Focus the visible search field when arriving here (⌘K on mobile, links, deep links).
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName !== 'H1' && active.id !== 'main') return;
    const el = isMobile ? mobileInput.current : document.querySelector<HTMLInputElement>('.sidebar [data-global-search]');
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    if (debounced.trim().length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    getSearchClient()
      .search(debounced, filters)
      .then(
        (r) => {
          if (!alive) return;
          setResults(r);
          setError(null);
        },
        (err) => alive && setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, [debounced, filters, ready]);

  // Keyboard: ↓ from the search field into results, ↑/↓ between results, Esc back / clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const inInput = active?.hasAttribute('data-global-search') ?? false;
      const idxAttr = active?.getAttribute('data-result-index');
      const idx = idxAttr !== null && idxAttr !== undefined ? Number(idxAttr) : null;
      if (!inInput && idx === null) return;
      const items = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>('[data-result-index]') ?? []);
      const focusAt = (i: number) => items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
      if (e.key === 'ArrowDown') {
        if (items.length === 0) return;
        e.preventDefault();
        focusAt(idx === null ? 0 : idx + 1);
      } else if (e.key === 'ArrowUp' && idx !== null) {
        e.preventDefault();
        if (idx === 0) (isMobile ? mobileInput.current : document.querySelector<HTMLInputElement>('.sidebar [data-global-search]'))?.focus();
        else focusAt(idx - 1);
      } else if (e.key === 'Enter' && inInput && items[0]) {
        e.preventDefault();
        items[0].click();
      } else if (e.key === 'Escape') {
        if (idx !== null) {
          e.preventDefault();
          (isMobile ? mobileInput.current : document.querySelector<HTMLInputElement>('.sidebar [data-global-search]'))?.focus();
        } else if (inInput && q) {
          e.preventDefault();
          setParam('q', null);
        } else if (inInput) {
          active?.blur();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let n = 0;
  const hasFilters = !!(filters.source || filters.from || filters.to || filters.tag || filters.collectionId);
  const total = results ? results.entries.length + results.images.length + results.messages.length : 0;

  return (
    <div className="page search-page">
      <header className="search-head">
        <h1 className="page-title">Search</h1>
        <div className="search-mobile-field" role="search">
          <Icon name="search" size={18} />
          <input
            ref={mobileInput}
            type="search"
            data-global-search=""
            placeholder="Search your journal"
            aria-label="Search journal"
            value={q}
            onChange={(e) => setParam('q', e.target.value || null)}
            enterKeyHint="search"
          />
        </div>
        <p className="search-head__hint" aria-live="polite">
          {q.trim().length >= 2 && results
            ? total === 0
              ? `No results for “${results.query}”`
              : `${total}${results.totalMessages > results.messages.length ? '+' : ''} results for “${results.query}” · ${results.tookMs} ms`
            : 'Titles, summaries, decisions, image prompts and every message. Typos and partial words are fine.'}
        </p>
      </header>

      <div className="search-filters" aria-label="Filters">
        <div className="segmented" role="group" aria-label="Source">
          {[
            { v: null, label: 'All' },
            { v: 'chatgpt', label: 'ChatGPT' },
            { v: 'claude', label: 'Claude' },
          ].map((o) => (
            <button key={o.label} type="button" className="segmented__btn" aria-pressed={(filters.source ?? null) === o.v} onClick={() => setParam('source', o.v)}>
              {o.label}
            </button>
          ))}
        </div>
        <label className="mini-field">
          <span>From</span>
          <input type="date" value={filters.from ?? ''} onChange={(e) => setParam('from', e.target.value || null)} />
        </label>
        <label className="mini-field">
          <span>To</span>
          <input type="date" value={filters.to ?? ''} onChange={(e) => setParam('to', e.target.value || null)} />
        </label>
        {allTags.length > 0 ? (
          <label className="mini-field">
            <span>Tag</span>
            <select value={filters.tag ?? ''} onChange={(e) => setParam('tag', e.target.value || null)}>
              <option value="">Any</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {collections.length > 0 ? (
          <label className="mini-field">
            <span>Collection</span>
            <select value={filters.collectionId ?? ''} onChange={(e) => setParam('collection', e.target.value || null)}>
              <option value="">Any</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {hasFilters ? (
          <button type="button" className="text-btn" onClick={() => navigate(withQuery('/search', { q }), { replace: true })}>
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? <Notice tone="error" title="Search failed">{error}</Notice> : null}
      {searching && !results ? <Spinner label="Searching…" /> : null}

      {!ready ? null : entries.length === 0 ? (
        <div className="empty-inline">
          <p>Your journal is empty, so there’s nothing to search yet.</p>
          <a className="text-btn" href={href('/import')}>
            Import conversations
          </a>
        </div>
      ) : null}

      <div ref={resultsRef} id="search-results" className={searching ? 'is-refreshing' : undefined}>
        {results && results.entries.length > 0 ? (
          <Group id="rg-entries" title="Entries" count={results.entries.length}>
            <ul className="result-list">
              {results.entries.map((r) => (
                <li key={r.id}>
                  <a className="result result--entry" href={href(entryPath(r.entryId))} data-result-index={n++}>
                    <span className="result__thumb">
                      {r.coverImageId ? <Thumb blobKey={blobKeyForImage(r.coverImageId)} available /> : <span className={`result__thumb-ph result__thumb-ph--${r.source}`}>{r.entryTitle.charAt(0)}</span>}
                    </span>
                    <span className="result__body">
                      <span className="result__title">{r.entryTitle}</span>
                      <span className="result__snippet">
                        <Highlighted segments={r.snippet} />
                      </span>
                      <span className="result__meta">
                        <SourceBadge source={r.source} size="sm" /> · {formatDate(r.date)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Group>
        ) : null}

        {results && results.images.length > 0 ? (
          <Group id="rg-images" title="Images" count={results.images.length}>
            <ul className="result-images">
              {results.images.map((r) => (
                <li key={r.id}>
                  <a className="result result--image" href={href(entryPath(r.entryId, { image: r.imageId }))} data-result-index={n++}>
                    <span className="result__image">
                      <Thumb blobKey={r.blobKey} available={r.available} />
                    </span>
                    <span className="result__body">
                      <span className="result__title">{r.imageTitle ?? r.entryTitle}</span>
                      <span className="result__snippet result__snippet--mono">
                        <Highlighted segments={r.snippet} />
                      </span>
                      <span className="result__meta">{r.imageTitle ? r.entryTitle : formatDate(r.date)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Group>
        ) : null}

        {results && results.messages.length > 0 ? (
          <Group
            id="rg-messages"
            title="Messages"
            count={results.totalMessages}
            extra={results.totalMessages > results.messages.length ? `showing top ${results.messages.length}` : undefined}
          >
            <ul className="result-list">
              {results.messages.map((r) => (
                <li key={r.id}>
                  <a className="result result--message" href={href(entryPath(r.entryId, { message: r.messageId }))} data-result-index={n++}>
                    <span className="result__body">
                      <span className="result__meta result__meta--top">
                        <span className="result__entry">{r.entryTitle}</span>
                        <span>
                          · #{r.index + 1} · {speakerName({ role: r.role, authorName: null }, r.source)}
                        </span>
                      </span>
                      <span className="result__snippet">
                        <Highlighted segments={r.snippet} />
                      </span>
                    </span>
                    <Icon name="arrowRight" size={16} className="result__go" />
                  </a>
                </li>
              ))}
            </ul>
          </Group>
        ) : null}
      </div>
    </div>
  );
}
