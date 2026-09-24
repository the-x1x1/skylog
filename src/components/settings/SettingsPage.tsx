import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../../app/providers/data';
import { useTheme, type ThemePreference } from '../../app/providers/theme';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { BRAND } from '../../config/brand';
import { deleteAllData, deleteSampleData } from '../../data/repositories/entries';
import { createClient, createProvider, DEFAULT_OLLAMA, localServerEndpoint, saveSummaryConfig, summarizeEntry } from '../../summarization/service';
import type { ProviderStatus, SummaryProviderConfig } from '../../summarization/types';
import { useSummaryConfig } from '../../summarization/useSummaryConfig';
import { backupFileName, createBackup, restoreBackup } from '../../data/backup';
import { getStorageStatus, requestPersistentStorage, type StorageStatus } from '../../data/storage';
import { formatBytes, pluralize } from '../../utils/text';
import { Icon } from '../shared/Icon';
import { Button, ConfirmDialog, Notice, ProgressBar } from '../shared/ui';

type Kind = SummaryProviderConfig['kind'];

const KINDS: { kind: Kind; title: string; body: string }[] = [
  { kind: 'none', title: 'Off', body: 'No summaries. Importing, browsing and search all work, and nothing leaves this device.' },
  {
    kind: 'local-server',
    title: 'Local server (Anthropic or OpenAI)',
    body: 'Your API key lives in .env.local on this computer and is used by the local server. When you generate a summary, that conversation’s text is sent to the vendor you configured.',
  },
  { kind: 'ollama', title: 'Ollama on this device', body: 'Uses a model running locally in Ollama. Conversation text never leaves this computer.' },
];

function ProviderSettings() {
  const { config } = useSummaryConfig();
  const [draft, setDraft] = useState<SummaryProviderConfig>(config);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(config), [config]);

  const check = async (cfg: SummaryProviderConfig) => {
    const client = createClient(cfg);
    if (!client) {
      setStatus(null);
      return;
    }
    setChecking(true);
    try {
      setStatus(await client.status());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check(config);
  }, [config]);

  const save = async (cfg: SummaryProviderConfig) => {
    await saveSummaryConfig(cfg);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const pick = (kind: Kind) => {
    const next: SummaryProviderConfig =
      kind === 'none'
        ? { kind: 'none' }
        : kind === 'local-server'
          ? { kind: 'local-server', endpoint: localServerEndpoint() }
          : { kind: 'ollama', baseUrl: draft.kind === 'ollama' ? draft.baseUrl : DEFAULT_OLLAMA.baseUrl, model: draft.kind === 'ollama' ? draft.model : DEFAULT_OLLAMA.model };
    setDraft(next);
    setStatus(null);
    void save(next);
  };

  return (
    <section className="settings-section" aria-labelledby="set-summaries">
      <h2 id="set-summaries" className="settings-section__title">
        Summaries
      </h2>
      <p className="muted">Optional. A summarizer writes each entry’s title, summary, decisions and next steps from the transcript. It never changes the transcript.</p>
      <div className="radio-cards" role="radiogroup" aria-label="Summarizer">
        {KINDS.map((k) => (
          <label key={k.kind} className={`radio-card${draft.kind === k.kind ? ' radio-card--on' : ''}`}>
            <input type="radio" name="summarizer" checked={draft.kind === k.kind} onChange={() => pick(k.kind)} />
            <span>
              <span className="radio-card__title">{k.title}</span>
              <span className="radio-card__body">{k.body}</span>
            </span>
          </label>
        ))}
      </div>

      {draft.kind === 'local-server' ? (
        <div className="provider-config">
          <p className="small">
            Add <code>ANTHROPIC_API_KEY</code> (or <code>OPENAI_API_KEY</code>) to <code>.env.local</code> in the app folder and restart <code>npm start</code> / <code>npm run dev</code>. See <code>.env.example</code>.
          </p>
        </div>
      ) : null}

      {draft.kind === 'ollama' ? (
        <form
          className="provider-config provider-config--grid"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft).then(() => check(draft));
          }}
        >
          <label className="field">
            <span className="field__label">Ollama URL</span>
            <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} inputMode="url" />
          </label>
          <label className="field">
            <span className="field__label">Model</span>
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="llama3.1:8b" />
          </label>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      ) : null}

      {draft.kind !== 'none' ? (
        <div className="provider-status">
          {checking ? (
            <span className="muted">Checking connection…</span>
          ) : status ? (
            <Notice tone={status.ok ? 'ok' : 'warn'} title={status.ok ? `Ready — ${status.label}` : 'Not ready'}>
              {status.detail}
            </Notice>
          ) : null}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => check(draft)} disabled={checking}>
            Test connection
          </Button>
          {saved ? <span className="saved-flag" role="status">Saved</span> : null}
        </div>
      ) : null}

      <BackfillSummaries ready={config.kind !== 'none' && !!status?.ok} />
    </section>
  );
}

function BackfillSummaries({ ready }: { ready: boolean }) {
  const { entries } = useAppData();
  const { config } = useSummaryConfig();
  const provider = useMemo(() => createProvider(config), [config]);
  const missing = entries.filter((e) => !e.isSample && (e.summaryStatus === 'not_configured' || e.summaryStatus === 'failed'));
  const [run, setRun] = useState<{ done: number; total: number; failed: number; current: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!provider || (missing.length === 0 && !run) || (!ready && !run)) return null;

  const start = async () => {
    const list = [...missing];
    const ac = new AbortController();
    abortRef.current = ac;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      if (ac.signal.aborted) break;
      setRun({ done: i, total: list.length, failed, current: list[i]!.title });
      try {
        await summarizeEntry(list[i]!.id, provider, { signal: ac.signal, autoTag: true });
      } catch {
        if (ac.signal.aborted) break;
        failed++;
      }
    }
    setRun((r) => (r ? { ...r, done: ac.signal.aborted ? r.done : list.length, failed, current: '' } : r));
    abortRef.current = null;
  };

  return (
    <div className="backfill">
      {run ? (
        <>
          <p className="small">
            {abortRef.current ? `Summarizing ${run.current}` : `Finished: ${run.done - run.failed} written${run.failed ? `, ${run.failed} failed` : ''}.`}
          </p>
          <ProgressBar value={run.done} max={run.total} label="Summaries written" />
          {abortRef.current ? (
            <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setRun(null)}>
              Done
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="small">{pluralize(missing.length, 'entry', 'entries')} don’t have a summary yet.</p>
          <Button size="sm" variant="secondary" icon="sparkPen" onClick={start}>
            Summarize them
          </Button>
        </>
      )}
    </div>
  );
}

function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  const opts: { v: ThemePreference; label: string }[] = [
    { v: 'system', label: 'Match system' },
    { v: 'light', label: 'Light' },
    { v: 'dark', label: 'Dark' },
  ];
  return (
    <section className="settings-section" aria-labelledby="set-appearance">
      <h2 id="set-appearance" className="settings-section__title">
        Appearance
      </h2>
      <div className="segmented" role="group" aria-label="Theme">
        {opts.map((o) => (
          <button key={o.v} type="button" className="segmented__btn" aria-pressed={preference === o.v} onClick={() => setPreference(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function StorageLine() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void getStorageStatus().then(setStatus);
  }, []);
  if (!status || status.persisted === null) return null;
  const usage = status.usage !== null ? `${formatBytes(status.usage)}${status.quota ? ` of about ${formatBytes(status.quota)} available` : ''}` : null;
  return (
    <div className="storage-line">
      <p className="small">
        {status.persisted
          ? 'This browser has agreed to keep your journal until you delete it.'
          : 'This browser may clear your journal if the device runs low on space. Keep a backup, or ask the browser to keep it.'}
        {usage ? <span className="muted"> Using {usage}.</span> : null}
      </p>
      {!status.persisted ? (
        <Button
          size="sm"
          variant="secondary"
          icon="lock"
          busy={asking}
          onClick={async () => {
            setAsking(true);
            await requestPersistentStorage();
            setStatus(await getStorageStatus());
            setAsking(false);
          }}
        >
          Ask the browser to keep it
        </Button>
      ) : null}
    </div>
  );
}

function BackupControls({ empty }: { empty: boolean }) {
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  const backup = async () => {
    setBusy('backup');
    setMessage(null);
    try {
      const { blob, summary } = await createBackup((done, total) => setProgress({ done, total }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage({ tone: 'ok', text: `Backup saved: ${pluralize(summary.entries, 'entry', 'entries')}, ${pluralize(summary.images, 'image')}, ${formatBytes(summary.bytes)}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('restore');
    setMessage(null);
    try {
      const summary = await restoreBackup(file, file.name, (done, total) => setProgress({ done, total }));
      setMessage({ tone: 'ok', text: `Restored ${pluralize(summary.entries, 'entry', 'entries')} and ${pluralize(summary.images, 'image')} from ${file.name}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      setProgress(null);
      setPending(null);
    }
  };

  const canDownload = typeof __DOWNLOADS_ENABLED__ !== 'boolean' || __DOWNLOADS_ENABLED__;
  return (
    <div className="backup">
      <div className="settings-actions">
        {canDownload ? (
          <Button variant="secondary" icon="download" onClick={backup} busy={busy === 'backup'} disabled={busy !== null || empty}>
            Back up journal
          </Button>
        ) : null}
        <input
          id="restore-file"
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          disabled={busy !== null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPending(f);
            e.target.value = '';
          }}
        />
        <label htmlFor="restore-file" className={`btn btn--secondary btn--md${busy ? ' is-disabled' : ''}`}>
          <Icon name="upload" size={18} />
          <span>Restore from backup</span>
        </label>
      </div>
      {progress ? <ProgressBar value={progress.done} max={progress.total} label={busy === 'backup' ? 'Backing up' : 'Restoring'} /> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <p className="small muted">A backup is one .zip with every entry, transcript, image, edit and import report. Restoring merges it into this journal; entries in both are replaced by the backup's copy.</p>
      <ConfirmDialog
        open={pending !== null}
        title="Restore this backup?"
        body={<p>{pending?.name} will be merged into your journal. Entries that exist in both are replaced by the backup's version; nothing else is removed.</p>}
        confirmLabel="Restore"
        busy={busy === 'restore'}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && restore(pending)}
      />
    </div>
  );
}

function DataSettings() {
  const { entries, storageMode } = useAppData();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const samples = entries.filter((e) => e.isSample).length;
  const images = entries.reduce((s, e) => s + e.availableImageCount, 0);
  return (
    <section className="settings-section" aria-labelledby="set-data">
      <h2 id="set-data" className="settings-section__title">
        Your data
      </h2>
      <p className="muted">
        {storageMode === 'persistent'
          ? `Stored in this browser on this device: ${pluralize(entries.length, 'entry', 'entries')} and ${pluralize(images, 'image')}. There is no account and no cloud copy.`
          : 'This browser is blocking local storage, so data only lasts until you close the tab.'}
      </p>
      {storageMode === 'persistent' ? <StorageLine /> : null}
      <BackupControls empty={entries.length === 0} />
      <div className="settings-actions">
        {samples > 0 ? (
          <Button
            variant="secondary"
            onClick={async () => {
              await deleteSampleData();
              setDone('Sample entries removed.');
            }}
          >
            Remove {pluralize(samples, 'sample entry', 'sample entries')}
          </Button>
        ) : null}
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)} disabled={entries.length === 0}>
          Delete all local data
        </Button>
      </div>
      {done ? <p className="small" role="status">{done}</p> : null}
      <ConfirmDialog
        open={confirm}
        title="Delete everything?"
        body={<p>This permanently removes every entry, transcript, image and import report stored by {BRAND.name} in this browser. Your original export files are not affected.</p>}
        confirmLabel="Delete everything"
        danger
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deleteAllData();
            setDone('All local data deleted.');
            setConfirm(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  return (
    <div className="page page--narrow settings">
      <h1 className="page-title">Settings</h1>
      <ProviderSettings />
      <AppearanceSettings />
      <DataSettings />
      <section className="settings-section" aria-labelledby="set-privacy">
        <h2 id="set-privacy" className="settings-section__title">
          <Icon name="lock" size={18} /> Privacy
        </h2>
        <ul className="plain-list small">
          <li>Imports are read in your browser; export files are never uploaded.</li>
          <li>Conversations and images are stored only on this device.</li>
          <li>No accounts, analytics or telemetry.</li>
          <li>Conversation text leaves this device only when you choose a remote summarizer and generate a summary.</li>
        </ul>
        <p className="muted small">
          {BRAND.name} {BRAND.version}
        </p>
      </section>
    </div>
  );
}
