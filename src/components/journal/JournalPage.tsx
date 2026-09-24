import { useMemo, useState } from 'react';
import { useAppData } from '../../app/providers/data';
import { href, navigate, useLocation, withQuery } from '../../app/router';
import { BRAND } from '../../config/brand';
import { deleteSampleData } from '../../data/repositories/entries';
import type { EffectiveEntry, Source } from '../../data/types';
import { loadSampleJournal } from '../../fixtures/sample-journal';
import { monthKey, monthLabel } from '../../utils/dates';
import { pluralize } from '../../utils/text';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { Icon } from '../shared/Icon';
import { Button, LinkButton, Notice, Spinner } from '../shared/ui';
import { EntryCard } from './EntryCard';

type SortKey = 'newest' | 'oldest' | 'imported';

function sortEntries(list: EffectiveEntry[], sort: SortKey): EffectiveEntry[] {
  const copy = [...list];
  if (sort === 'imported') return copy.sort((a, b) => b.importedAt.localeCompare(a.importedAt) || (b.chatDate ?? '').localeCompare(a.chatDate ?? ''));
  copy.sort((a, b) => (a.chatDate ?? '').localeCompare(b.chatDate ?? '') || a.title.localeCompare(b.title));
  return sort === 'oldest' ? copy : copy.reverse();
}

export function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="page page--narrow welcome">
      <div className="welcome__mark" aria-hidden="true">
        <Icon name="journal" size={30} />
      </div>
      <h1 className="welcome__title">Start your journal</h1>
      <p className="welcome__lede">
        {BRAND.name} turns your ChatGPT and Claude data exports into journal entries — one per conversation, with its images up front, a short summary, and the full
        transcript one click away. Everything stays on this device.
      </p>
      <div className="welcome__actions">
        <LinkButton href={href('/import')} variant="primary" icon="import">
          Import conversations
        </LinkButton>
      </div>
      <div className="welcome__sources">
        <div className="welcome__source">
          <span className="dot dot--chatgpt" aria-hidden="true" />
          <div>
            <p className="welcome__source-name">ChatGPT export</p>
            <p className="welcome__source-how">Settings → Data controls → Export data. You’ll get a .zip by email.</p>
          </div>
        </div>
        <div className="welcome__source">
          <span className="dot dot--claude" aria-hidden="true" />
          <div>
            <p className="welcome__source-name">Claude export</p>
            <p className="welcome__source-how">Settings → Privacy → Export data. You’ll get a .zip by email.</p>
          </div>
        </div>
      </div>
      <p className="welcome__sample">
        Just looking?{' '}
        <button
          type="button"
          className="text-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await loadSampleJournal();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Loading sample journal…' : 'Use sample journal'}
        </button>
      </p>
      {error ? <Notice tone="error" title="Could not load the sample journal">{error}</Notice> : null}
    </div>
  );
}

export function JournalPage() {
  const { entries, collections, entriesLoading } = useAppData();
  const loc = useLocation();
  const source = loc.query.get('source') as Source | null;
  const tag = loc.query.get('tag');
  const collectionId = loc.query.get('collection');
  const sort = (loc.query.get('sort') as SortKey | null) ?? 'newest';
  const [removingSamples, setRemovingSamples] = useState(false);
  useDocumentTitle('Journal');

  const filtered = useMemo(
    () =>
      sortEntries(
        entries.filter((e) => (!source || e.source === source) && (!tag || e.tags.includes(tag)) && (!collectionId || e.collectionId === collectionId)),
        sort,
      ),
    [entries, source, tag, collectionId, sort],
  );

  const groups = useMemo(() => {
    const map = new Map<string, EffectiveEntry[]>();
    for (const e of filtered) {
      const k = monthKey(sort === 'imported' ? e.importedAt : e.chatDate);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return Array.from(map);
  }, [filtered, sort]);

  if (entriesLoading) {
    return (
      <div className="page">
        <Spinner label="Opening your journal…" />
      </div>
    );
  }
  if (entries.length === 0) return <Welcome />;

  const collectionName = collectionId ? collections.find((c) => c.id === collectionId)?.name : null;
  const activeFilters = [
    source ? { key: 'source', label: source === 'chatgpt' ? 'ChatGPT' : 'Claude' } : null,
    tag ? { key: 'tag', label: `#${tag}` } : null,
    collectionId ? { key: 'collection', label: collectionName ?? 'Collection' } : null,
  ].filter((f): f is { key: string; label: string } => !!f);
  const setParam = (key: string, value: string | null) => {
    const next = Object.fromEntries(loc.query.entries());
    if (value) next[key] = value;
    else delete next[key];
    navigate(withQuery('/', next));
  };
  const sampleCount = entries.filter((e) => e.isSample).length;
  const imageTotal = filtered.reduce((s, e) => s + e.imageCount, 0);

  return (
    <div className="page">
      <header className="journal-head">
        <div>
          <h1 className="page-title">Journal</h1>
          <p className="journal-head__meta">
            {pluralize(filtered.length, 'entry', 'entries')} · {pluralize(imageTotal, 'image')}
          </p>
        </div>
        <label className="select-field">
          <span className="sr-only">Sort entries</span>
          <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'newest' ? null : e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="imported">Recently imported</option>
          </select>
          <Icon name="chevronDown" size={16} />
        </label>
      </header>

      {activeFilters.length > 0 ? (
        <div className="filter-chips" aria-label="Active filters">
          {activeFilters.map((f) => (
            <button key={f.key} type="button" className="filter-chip" onClick={() => setParam(f.key, null)} aria-label={`Remove filter ${f.label}`}>
              {f.label}
              <Icon name="close" size={14} />
            </button>
          ))}
          <a className="text-btn" href={href('/')}>
            Clear all
          </a>
        </div>
      ) : null}

      {sampleCount > 0 ? (
        <Notice
          tone="info"
          title="You’re looking at sample entries"
          action={
            <Button
              size="sm"
              variant="ghost"
              busy={removingSamples}
              onClick={async () => {
                setRemovingSamples(true);
                try {
                  await deleteSampleData();
                } finally {
                  setRemovingSamples(false);
                }
              }}
            >
              Remove samples
            </Button>
          }
        >
          They were imported from bundled example exports so you can try the journal. Their summaries are written examples, not AI output.
        </Notice>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-inline">
          <p>No entries match these filters.</p>
          <a className="text-btn" href={href('/')}>
            Show all entries
          </a>
        </div>
      ) : (
        groups.map(([key, list]) => (
          <section key={key} className="month-group" aria-labelledby={`month-${key}`}>
            <h2 id={`month-${key}`} className="month-group__label">
              {monthLabel(key)}
              <span className="month-group__count">{list.length}</span>
            </h2>
            <div className="entry-grid">
              {list.map((e) => (
                <EntryCard key={e.id} entry={e} collectionName={e.collectionId ? collections.find((c) => c.id === e.collectionId)?.name : undefined} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
