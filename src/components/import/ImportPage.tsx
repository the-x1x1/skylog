import { useEffect, useRef, useState, type DragEvent } from 'react';
import { href, navigate, withQuery } from '../../app/router';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import type { ImportBatch, ImportOptions, Source } from '../../data/types';
import type { DetectionResult } from '../../importers/core/detect';
import type { ImportPreview, ImportProgress } from '../../importers/core/types';
import { createImportSession, type ImportSession } from '../../importers/worker/client';
import { createProvider } from '../../summarization/service';
import { useSummaryConfig } from '../../summarization/useSummaryConfig';
import { formatDate } from '../../utils/dates';
import { formatBytes, pluralize } from '../../utils/text';
import { Icon } from '../shared/Icon';
import { Button, Notice, ProgressBar, SourceBadge, Spinner } from '../shared/ui';

type Step =
  | { kind: 'choose'; error?: string }
  | { kind: 'opening'; fileName: string }
  | { kind: 'pick-source'; fileName: string; detection: DetectionResult }
  | { kind: 'previewing'; fileName: string }
  | { kind: 'preview'; preview: ImportPreview; ambiguous: boolean }
  | { kind: 'running'; preview: ImportPreview; progress: ImportProgress | null; cancelling: boolean }
  | { kind: 'done'; batch: ImportBatch };

function DropZone({ onFile, error }: { onFile: (f: File) => void; error?: string }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="dropzone__icon" aria-hidden="true">
        <Icon name="archive" size={28} />
      </div>
      <p className="dropzone__title">Drop your export .zip here</p>
      <p className="dropzone__hint">ChatGPT or Claude — the source is detected automatically.</p>
      <input
        ref={inputRef}
        id="export-file"
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <label htmlFor="export-file" className="btn btn--primary btn--md">
        <Icon name="upload" size={18} />
        <span>Choose file</span>
      </label>
      {error ? (
        <Notice tone="error" title="That file couldn’t be imported">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function stageLabel(p: ImportProgress | null): string {
  if (!p) return 'Starting…';
  switch (p.stage) {
    case 'opening':
      return 'Opening archive…';
    case 'parsing':
      return 'Reading and saving conversations';
    case 'summarizing':
      return 'Writing summaries';
    case 'done':
      return 'Finished';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Stopped';
  }
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' | 'error' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ImportPage() {
  useDocumentTitle('Import');
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const sessionRef = useRef<ImportSession | null>(null);
  const { config } = useSummaryConfig();
  const providerReady = createProvider(config) !== null;
  const [options, setOptions] = useState<ImportOptions>({ generateSummaries: false, importImages: true, skipExisting: true, autoTag: true });

  useEffect(() => {
    setOptions((o) => ({ ...o, generateSummaries: providerReady ? o.generateSummaries : false }));
  }, [providerReady]);

  useEffect(
    () => () => {
      sessionRef.current?.dispose();
    },
    [],
  );

  const session = () => {
    if (!sessionRef.current) sessionRef.current = createImportSession();
    return sessionRef.current;
  };

  const reset = (error?: string) => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setStep({ kind: 'choose', error });
  };

  const onFile = async (file: File) => {
    setStep({ kind: 'opening', fileName: file.name });
    try {
      const { detection, preview } = await session().open(file);
      if (preview && !detection.ambiguous) setStep({ kind: 'preview', preview, ambiguous: false });
      else setStep({ kind: 'pick-source', fileName: file.name, detection });
    } catch (err) {
      reset(err instanceof Error ? err.message : String(err));
    }
  };

  const choose = async (source: Source, fileName: string) => {
    setStep({ kind: 'previewing', fileName });
    try {
      const preview = await session().preview(source);
      setStep({ kind: 'preview', preview, ambiguous: true });
    } catch (err) {
      reset(err instanceof Error ? err.message : String(err));
    }
  };

  const start = async (preview: ImportPreview) => {
    setStep({ kind: 'running', preview, progress: null, cancelling: false });
    try {
      const batch = await session().start({ source: preview.source, options, summaryConfig: config }, (progress) =>
        setStep((s) => (s.kind === 'running' ? { ...s, progress } : s)),
      );
      setStep({ kind: 'done', batch });
    } catch (err) {
      reset(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page page--narrow import-page">
      <h1 className="page-title">Import conversations</h1>
      <p className="lede">Your export is read in this browser and saved on this device. Nothing is uploaded.</p>

      {step.kind === 'choose' ? (
        <>
          <DropZone onFile={onFile} error={step.error} />
          <div className="howto">
            <h2 className="section-label">Getting your export</h2>
            <div className="howto__grid">
              <div>
                <p className="howto__name">
                  <span className="dot dot--chatgpt" aria-hidden="true" /> ChatGPT
                </p>
                <p>Settings → Data controls → Export data. The email link downloads a .zip with conversations.json and your images.</p>
              </div>
              <div>
                <p className="howto__name">
                  <span className="dot dot--claude" aria-hidden="true" /> Claude
                </p>
                <p>Settings → Privacy → Export data. Claude exports include the text and artifacts, but not images you uploaded.</p>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {step.kind === 'opening' || step.kind === 'previewing' ? (
        <div className="import-card">
          <Spinner label={`Reading ${step.fileName}…`} />
        </div>
      ) : null}

      {step.kind === 'pick-source' ? (
        <div className="import-card">
          <h2 className="import-card__title">Which app is this export from?</h2>
          <p className="muted">
            {step.detection.scores.every((s) => s.score === 0)
              ? `${step.fileName} doesn’t look like a ChatGPT or Claude export (no recognizable conversations.json). If it is one, pick the source to try anyway.`
              : `${step.fileName} could be either. Pick the source to continue.`}
          </p>
          <div className="source-choice">
            {(['chatgpt', 'claude'] as const).map((s) => (
              <button key={s} type="button" className="source-choice__btn" onClick={() => choose(s, step.fileName)}>
                <SourceBadge source={s} />
                <span className="muted">{step.detection.scores.find((x) => x.source === s)?.reasons.join(', ') || 'no matching signals'}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => reset()}>
            Choose a different file
          </Button>
        </div>
      ) : null}

      {step.kind === 'preview' ? (
        <div className="import-card">
          <div className="preview-head">
            <SourceBadge source={step.preview.source} />
            <span className="muted">{step.ambiguous ? 'chosen by you' : 'detected automatically'}</span>
          </div>
          <p className="preview-file">
            <Icon name="archive" size={16} /> {step.preview.fileName} <span className="muted">· {formatBytes(step.preview.archiveSize)}</span>
          </p>
          <dl className="stats">
            <Stat label="Conversations" value={step.preview.conversationCount.toLocaleString()} />
            <Stat label="Image references" value={step.preview.imageCount === null ? 'unknown' : step.preview.imageCount.toLocaleString()} />
            <Stat label="Image files in export" value={step.preview.imageFilesPresent === null ? 'unknown' : step.preview.imageFilesPresent.toLocaleString()} />
            <Stat label="Date range" value={step.preview.dateRange.from ? `${formatDate(step.preview.dateRange.from)} – ${formatDate(step.preview.dateRange.to)}` : '—'} />
          </dl>
          {step.preview.warnings.map((w, i) => (
            <Notice key={i} tone="warn">
              {w}
            </Notice>
          ))}
          {step.preview.conversationCount === 0 ? <Notice tone="error" title="No conversations found in this export." /> : null}

          <fieldset className="options">
            <legend className="sr-only">Import options</legend>
            <label className="check">
              <input type="checkbox" checked={options.generateSummaries} disabled={!providerReady} onChange={(e) => setOptions({ ...options, generateSummaries: e.target.checked })} />
              <span>
                <span className="check__label">Generate summaries</span>
                <span className="check__hint">
                  {providerReady ? (
                    'Uses your configured summarizer after the conversations are saved. Also suggests tags.'
                  ) : (
                    <>
                      No summarizer set up. <a href={href('/settings')}>Configure one</a> — or import now and summarize later.
                    </>
                  )}
                </span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={options.importImages} onChange={(e) => setOptions({ ...options, importImages: e.target.checked })} />
              <span>
                <span className="check__label">Import available images</span>
                <span className="check__hint">Stores image files from the export on this device.</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={options.skipExisting} onChange={(e) => setOptions({ ...options, skipExisting: e.target.checked })} />
              <span>
                <span className="check__label">Skip conversations already imported</span>
                <span className="check__hint">Unchanged conversations are skipped; ones that changed since are updated. Your edits are kept either way.</span>
              </span>
            </label>
          </fieldset>
          <div className="import-card__actions">
            <Button variant="ghost" onClick={() => reset()}>
              Choose a different file
            </Button>
            <Button variant="primary" icon="import" disabled={step.preview.conversationCount === 0} onClick={() => start(step.preview)}>
              Import {pluralize(step.preview.conversationCount, 'conversation')}
            </Button>
          </div>
        </div>
      ) : null}

      {step.kind === 'running' ? <Running step={step} onCancel={() => {
        setStep({ ...step, cancelling: true });
        session().cancel();
      }} /> : null}

      {step.kind === 'done' ? <Done batch={step.batch} onAnother={() => reset()} /> : null}
    </div>
  );
}

function Running({ step, onCancel }: { step: Extract<Step, { kind: 'running' }>; onCancel: () => void }) {
  const p = step.progress;
  const c = p?.counts;
  const summarizing = p?.stage === 'summarizing';
  return (
    <div className="import-card" aria-live="polite">
      <div className="run-head">
        <h2 className="import-card__title">{stageLabel(p)}</h2>
        <span className="run-count mono">
          {summarizing ? `${p?.summaryDone ?? 0} / ${p?.summaryTotal ?? 0}` : `${(p?.processed ?? 0).toLocaleString()} / ${(p?.total || step.preview.conversationCount).toLocaleString()}`}
        </span>
      </div>
      <ProgressBar
        label={summarizing ? 'Summaries written' : 'Conversations processed'}
        value={summarizing ? (p?.summaryDone ?? 0) : (p?.processed ?? 0)}
        max={summarizing ? (p?.summaryTotal ?? 0) : p?.total || step.preview.conversationCount}
      />
      <p className="run-current">
        {p?.currentTitle ? (
          <>
            <span className="muted">{summarizing ? 'Summarizing' : 'Now'}:</span> {p.currentTitle}
          </>
        ) : (
          <span className="muted">Preparing…</span>
        )}
      </p>
      <dl className="stats">
        <Stat label="Imported" value={c?.imported ?? 0} />
        <Stat label="Updated" value={c?.updated ?? 0} />
        <Stat label="Skipped" value={c?.skipped ?? 0} />
        <Stat label="Failed" value={c?.failed ?? 0} tone={c?.failed ? 'error' : undefined} />
        <Stat label="Images stored" value={`${c?.imagesStored ?? 0} / ${c?.imagesFound ?? 0}`} />
        {summarizing || c?.summarized ? <Stat label="Summaries" value={`${c?.summarized ?? 0}${c?.summaryFailed ? ` · ${c.summaryFailed} failed` : ''}`} /> : null}
      </dl>
      {p?.lastIssue ? (
        <Notice tone={p.lastIssue.level === 'error' ? 'error' : 'warn'} title={p.lastIssue.title ?? 'A conversation needs attention'}>
          {p.lastIssue.reason}
        </Notice>
      ) : null}
      <div className="import-card__actions">
        <Button variant="ghost" onClick={onCancel} busy={step.cancelling}>
          {step.cancelling ? 'Stopping after the current conversation…' : 'Cancel'}
        </Button>
      </div>
      <p className="muted small">Cancelling keeps every conversation already saved.</p>
    </div>
  );
}

function Done({ batch, onAnother }: { batch: ImportBatch; onAnother: () => void }) {
  const c = batch.counts;
  const failed = batch.status === 'failed';
  return (
    <div className="import-card">
      <div className="done-head">
        <span className={`done-icon done-icon--${failed ? 'error' : batch.status === 'completed' ? 'ok' : 'warn'}`} aria-hidden="true">
          <Icon name={failed ? 'alert' : 'check'} size={22} />
        </span>
        <h2 className="import-card__title">
          {failed ? 'Import stopped' : batch.status === 'cancelled' ? 'Import cancelled' : batch.status === 'completed_with_errors' ? 'Import finished with some problems' : 'Import complete'}
        </h2>
      </div>
      {batch.fatalError ? (
        <Notice tone="error" title="The export couldn’t be read completely">
          {batch.fatalError}
          {c.imported + c.updated > 0 ? ' Conversations saved before the problem are kept.' : ''}
        </Notice>
      ) : null}
      <dl className="stats">
        <Stat label="Imported" value={c.imported} />
        <Stat label="Updated" value={c.updated} />
        <Stat label="Skipped (already imported)" value={c.skipped} />
        <Stat label="Failed" value={c.failed} tone={c.failed ? 'error' : undefined} />
        <Stat label="Images stored" value={`${c.imagesStored} of ${c.imagesFound}`} tone={c.imagesMissing ? 'warn' : undefined} />
        {batch.options.generateSummaries ? <Stat label="Summaries" value={`${c.summarized}${c.summaryFailed ? ` · ${c.summaryFailed} failed` : ''}`} tone={c.summaryFailed ? 'warn' : undefined} /> : null}
      </dl>
      {c.imagesMissing > 0 ? <p className="muted small">{pluralize(c.imagesMissing, 'image')} referenced in conversations weren’t in the export; they show as placeholders.</p> : null}
      <div className="import-card__actions">
        <Button variant="ghost" onClick={onAnother}>
          Import another file
        </Button>
        <a className="btn btn--secondary btn--md" href={href(`/imports/${encodeURIComponent(batch.id)}`)}>
          <Icon name="list" size={18} />
          <span>View import report</span>
        </a>
        <Button variant="primary" icon="journal" onClick={() => navigate(withQuery('/', { sort: 'imported' }))}>
          Open journal
        </Button>
      </div>
    </div>
  );
}
