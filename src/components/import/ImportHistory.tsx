import { useMemo, useState } from 'react';
import { entryPath, href } from '../../app/router';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { useAppData } from '../../app/providers/data';
import { useLiveQuery } from '../../data/hooks';
import { getImportBatch, listImportBatches } from '../../data/repositories/imports';
import type { ImportBatch, ImportStatus } from '../../data/types';
import { formatDateTime } from '../../utils/dates';
import { formatBytes, pluralize } from '../../utils/text';
import { Icon } from '../shared/Icon';
import { LinkButton, Notice, SourceBadge, Spinner } from '../shared/ui';

const STATUS: Record<ImportStatus, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  completed_with_errors: { label: 'Completed with problems', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
  failed: { label: 'Stopped', tone: 'error' },
};

function StatusPill({ status }: { status: ImportStatus }) {
  const s = STATUS[status];
  return <span className={`pill pill--${s.tone}`}>{s.label}</span>;
}

function summaryLine(b: ImportBatch): string {
  const c = b.counts;
  const parts = [`${c.imported} imported`];
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.duplicates) parts.push(`${c.duplicates} already imported`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  if (c.failed) parts.push(`${c.failed} failed`);
  parts.push(`${c.imagesStored}/${c.imagesFound} images`);
  return parts.join(' · ');
}

export function ImportHistoryPage() {
  useDocumentTitle('Import history');
  const q = useLiveQuery(listImportBatches, [], ['imports']);
  const batches = q.data ?? [];
  return (
    <div className="page page--narrow">
      <div className="page-head">
        <h1 className="page-title">Import history</h1>
        <LinkButton href={href('/import')} variant="primary" icon="import">
          Import
        </LinkButton>
      </div>
      {q.loading && !q.data ? <Spinner /> : null}
      {q.data && batches.length === 0 ? (
        <div className="empty-inline">
          <p>No imports yet.</p>
          <a className="text-btn" href={href('/import')}>
            Import conversations
          </a>
        </div>
      ) : null}
      <ul className="batch-list">
        {batches.map((b) => (
          <li key={b.id}>
            <a className="batch" href={href(`/imports/${encodeURIComponent(b.id)}`)}>
              <span className="batch__main">
                <span className="batch__file">{b.archiveFileName}</span>
                <span className="batch__meta">
                  <SourceBadge source={b.source} size="sm" /> · {formatDateTime(b.startedAt)}
                </span>
                <span className="batch__counts">{summaryLine(b)}</span>
              </span>
              <StatusPill status={b.status} />
              <Icon name="chevronRight" size={18} className="batch__go" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportReportPage({ batchId }: { batchId: string }) {
  const q = useLiveQuery(() => getImportBatch(batchId), [batchId], ['imports']);
  const { entries } = useAppData();
  const [level, setLevel] = useState<'all' | 'error' | 'warning'>('all');
  const batch = q.data;
  useDocumentTitle('Import report');
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  if (q.loading && !batch) return <div className="page"><Spinner /></div>;
  if (!batch) {
    return (
      <div className="page page--narrow">
        <h1 className="page-title">Report not found</h1>
        <a className="text-btn" href={href('/imports')}>
          Back to import history
        </a>
      </div>
    );
  }
  const issues = batch.issues.filter((i) => level === 'all' || i.level === level);
  const errors = batch.issues.filter((i) => i.level === 'error').length;
  const warnings = batch.issues.length - errors;
  const c = batch.counts;
  const importedEntries = batch.entryIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <div className="page page--narrow report">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={href('/imports')}>Import history</a>
        <span aria-hidden="true">/</span>
        <span>Report</span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title--sm">{batch.archiveFileName}</h1>
        <StatusPill status={batch.status} />
      </div>
      <p className="muted">
        <SourceBadge source={batch.source} size="sm" /> · {formatBytes(batch.archiveSize)} · started {formatDateTime(batch.startedAt)}
        {batch.finishedAt ? ` · finished ${formatDateTime(batch.finishedAt)}` : ''}
      </p>
      {batch.fatalError ? <Notice tone="error" title="The import stopped early">{batch.fatalError}</Notice> : null}

      <dl className="stats stats--wide">
        {[
          ['In export', c.total],
          ['Imported', c.imported],
          ['Updated', c.updated],
          ['Already imported', c.duplicates ?? 0],
          ['Skipped', c.skipped],
          ['Failed', c.failed],
          ['Images found', c.imagesFound],
          ['Images stored', c.imagesStored],
          ['Images missing', c.imagesMissing],
          ...(batch.options.generateSummaries ? [['Summaries', c.summarized] as const, ['Summaries failed', c.summaryFailed] as const] : []),
        ].map(([label, value]) => (
          <div key={label} className="stat">
            <dt>{label}</dt>
            <dd>{Number(value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <section className="report__section" aria-labelledby="issues-h">
        <div className="page-head">
          <h2 id="issues-h" className="section-title">
            Issues <span className="section-title__count">{batch.issues.length}</span>
          </h2>
          {batch.issues.length > 0 ? (
            <div className="segmented" role="group" aria-label="Show">
              {(
                [
                  ['all', `All ${batch.issues.length}`],
                  ['error', `Errors ${errors}`],
                  ['warning', `Warnings ${warnings}`],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className="segmented__btn" aria-pressed={level === v} onClick={() => setLevel(v)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {batch.issues.length === 0 ? <p className="muted">No problems were recorded for this import.</p> : null}
        <ul className="issue-list">
          {issues.map((i, n) => (
            <li key={n} className={`issue issue--${i.level}`}>
              <Icon name={i.level === 'error' ? 'alert' : 'info'} size={16} />
              <div>
                <p className="issue__title">
                  {i.title ?? (i.recordIndex ? `Record #${i.recordIndex}` : 'Untitled conversation')}
                  {i.conversationId ? <span className="issue__id mono"> {i.conversationId}</span> : null}
                </p>
                <p className="issue__reason">{i.reason}</p>
                <p className="issue__file mono">{i.sourceFile}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {importedEntries.length > 0 ? (
        <section className="report__section" aria-labelledby="entries-h">
          <h2 id="entries-h" className="section-title">
            Entries from this import <span className="section-title__count">{pluralize(importedEntries.length, 'entry', 'entries')}</span>
          </h2>
          <ul className="report__entries">
            {importedEntries.slice(0, 300).map((e) => (
              <li key={e.id}>
                <a href={href(entryPath(e.id))}>{e.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
