import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../../app/providers/data';
import { useImport } from '../../app/providers/import';
import { entryPath, href, navigate, useLocation, withQuery } from '../../app/router';
import type { EffectiveEntry, Source } from '../../data/types';
import { monthKey, monthLabel } from '../../utils/dates';
import { Icon } from '../shared/Icon';
import { Logo } from '../shared/media';
import { ProgressBar } from '../shared/ui';
import { ThemeToggle } from './ThemeToggle';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function SidebarSearch() {
  const loc = useLocation();
  const onSearch = loc.path === '/search';
  const urlValue = onSearch ? (loc.query.get('q') ?? '') : '';
  // Local state keeps typing smooth; the URL stays the source of truth for results.
  const [value, setValue] = useState(urlValue);
  useEffect(() => setValue(urlValue), [urlValue]);
  return (
    <div className="sidebar-search" role="search">
      <Icon name="search" size={17} className="sidebar-search__icon" />
      <input
        type="search"
        data-global-search=""
        className="sidebar-search__input"
        placeholder="Search journal"
        aria-label="Search journal"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        value={value}
        onChange={(e) => {
          const q = e.target.value;
          setValue(q);
          const next = new URLSearchParams(onSearch ? loc.query : undefined);
          if (q) next.set('q', q);
          else next.delete('q');
          const qs = next.toString();
          navigate(qs ? `/search?${qs}` : '/search', { replace: onSearch });
        }}
      />
      <kbd className="sidebar-search__kbd" aria-hidden="true">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </div>
  );
}

/** Shown while an import runs in the background (the user may be on any page). */
function ImportStatus() {
  const { step } = useImport();
  const loc = useLocation();
  if (step.kind !== 'running' || loc.path === '/import') return null;
  const p = step.progress;
  const summarizing = p?.stage === 'summarizing';
  const value = summarizing ? (p?.summaryDone ?? 0) : (p?.processed ?? 0);
  const max = summarizing ? (p?.summaryTotal ?? 0) : p?.total || step.preview.conversationCount;
  return (
    <a className="import-status" href={href('/import')}>
      <span className="import-status__label">
        <span className="spinner" aria-hidden="true" />
        {summarizing ? 'Writing summaries' : 'Importing'}
        <span className="import-status__count">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </span>
      <ProgressBar value={value} max={max} label="Import progress" />
    </a>
  );
}

function RecentList({ entries }: { entries: EffectiveEntry[] }) {
  const groups = useMemo(() => {
    const recent = [...entries].sort((a, b) => (b.chatDate ?? '').localeCompare(a.chatDate ?? '')).slice(0, 10);
    const map = new Map<string, EffectiveEntry[]>();
    for (const e of recent) {
      const k = monthKey(e.chatDate);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return Array.from(map);
  }, [entries]);
  const loc = useLocation();
  const activeId = loc.path.startsWith('/entry/') ? decodeURIComponent(loc.path.slice(7)) : null;
  if (groups.length === 0) return null;
  return (
    <section className="sidebar__section" aria-labelledby="sb-recent">
      <h2 id="sb-recent" className="sidebar__heading">
        Recent
      </h2>
      {groups.map(([key, list]) => (
        <div key={key} className="sidebar-recent">
          <p className="sidebar-recent__month">{monthLabel(key)}</p>
          <ul className="sidebar-list">
            {list.map((e) => (
              <li key={e.id}>
                <a className="sidebar-link sidebar-link--entry" href={href(entryPath(e.id))} aria-current={activeId === e.id ? 'page' : undefined}>
                  <span className={`dot dot--${e.source}`} aria-hidden="true" />
                  <span className="truncate">{e.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function Sidebar() {
  const { entries, collections } = useAppData();
  const loc = useLocation();
  const onJournal = loc.path === '/';
  const source = onJournal ? loc.query.get('source') : null;
  const tag = onJournal ? loc.query.get('tag') : null;
  const collection = onJournal ? loc.query.get('collection') : null;

  const counts = useMemo(() => {
    const c = { all: entries.length, chatgpt: 0, claude: 0 };
    for (const e of entries) c[e.source]++;
    return c;
  }, [entries]);

  const topTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const e of entries) for (const t of e.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return Array.from(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [entries]);

  const collectionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.collectionId) m.set(e.collectionId, (m.get(e.collectionId) ?? 0) + 1);
    return m;
  }, [entries]);

  const sourceLink = (s: Source | null) => withQuery('/', { source: s });
  const sources: { key: Source | null; label: string; count: number }[] = [
    { key: null, label: 'All', count: counts.all },
    { key: 'chatgpt', label: 'ChatGPT', count: counts.chatgpt },
    { key: 'claude', label: 'Claude', count: counts.claude },
  ];

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar__top">
        <a href={href('/')} className="sidebar__brand" aria-label="Journal home">
          <Logo />
        </a>
        <SidebarSearch />
        <a className="btn btn--primary btn--md sidebar__import" href={href('/import')}>
          <Icon name="import" size={18} />
          <span>Import</span>
        </a>
        <ImportStatus />
      </div>

      <nav className="sidebar__scroll" aria-label="Journal">
        <ul className="sidebar-list sidebar-list--nav">
          <li>
            <a className="sidebar-link" href={href('/')} aria-current={onJournal && !source && !tag && !collection ? 'page' : undefined}>
              <Icon name="journal" size={18} />
              <span>Journal</span>
              <span className="sidebar-link__count">{counts.all || ''}</span>
            </a>
          </li>
          <li>
            <a className="sidebar-link" href={href('/imports')} aria-current={loc.path.startsWith('/imports') ? 'page' : undefined}>
              <Icon name="history" size={18} />
              <span>Import history</span>
            </a>
          </li>
        </ul>

        {entries.length > 0 ? (
          <section className="sidebar__section" aria-labelledby="sb-sources">
            <h2 id="sb-sources" className="sidebar__heading">
              Sources
            </h2>
            <ul className="sidebar-list">
              {sources.map((s) => (
                <li key={s.label}>
                  <a className="sidebar-link" href={href(sourceLink(s.key))} aria-current={onJournal && (source ?? null) === s.key && !tag && !collection ? 'true' : undefined}>
                    <span className={`dot ${s.key ? `dot--${s.key}` : 'dot--all'}`} aria-hidden="true" />
                    <span>{s.label}</span>
                    <span className="sidebar-link__count">{s.count}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {collections.length > 0 ? (
          <section className="sidebar__section" aria-labelledby="sb-collections">
            <h2 id="sb-collections" className="sidebar__heading">
              Collections
            </h2>
            <ul className="sidebar-list">
              {collections
                .filter((c) => collectionCounts.has(c.id))
                .map((c) => (
                  <li key={c.id}>
                    <a className="sidebar-link" href={href(withQuery('/', { collection: c.id }))} aria-current={collection === c.id ? 'true' : undefined}>
                      <Icon name="layers" size={16} />
                      <span className="truncate">{c.name}</span>
                      <span className="sidebar-link__count">{collectionCounts.get(c.id)}</span>
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        {topTags.length > 0 ? (
          <section className="sidebar__section" aria-labelledby="sb-tags">
            <h2 id="sb-tags" className="sidebar__heading">
              Tags
            </h2>
            <div className="sidebar-tags">
              {topTags.map(([t]) => (
                <a key={t} className="tag" href={href(withQuery('/', { tag: t }))} aria-current={tag === t ? 'true' : undefined}>
                  #{t}
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <RecentList entries={entries} />
      </nav>

      <div className="sidebar__footer">
        <a className="sidebar-link" href={href('/settings')} aria-current={loc.path === '/settings' ? 'page' : undefined}>
          <Icon name="settings" size={18} />
          <span>Settings</span>
        </a>
        <ThemeToggle />
      </div>
    </aside>
  );
}
