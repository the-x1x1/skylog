import { useEffect, useRef, useState } from 'react';
import type { EntryView } from '../../data/repositories/entries';
import { downloadText, entryToJson, entryToMarkdown, exportFileName } from '../../export/entry-export';
import { Icon } from '../shared/Icon';

export function ExportMenu(props: { view: EntryView; compact?: boolean }) {
  // Inline build constant (not an imported one) so demo builds drop the download code entirely.
  return typeof __DOWNLOADS_ENABLED__ !== 'boolean' || __DOWNLOADS_ENABLED__ ? <ExportMenuInner {...props} /> : null;
}

function ExportMenuInner({ view, compact }: { view: EntryView; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (kind: 'md' | 'json') => {
    const text = kind === 'md' ? entryToMarkdown(view) : entryToJson(view);
    downloadText(exportFileName(view.entry.title, kind), text, kind === 'md' ? 'text/markdown' : 'application/json');
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={compact ? 'icon-btn' : 'btn btn--ghost btn--sm'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? 'Export entry' : undefined}
        title={compact ? 'Export entry' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="download" size={compact ? 20 : 16} />
        {compact ? null : <span>Export</span>}
      </button>
      {open ? (
        <div className="menu__list" role="menu" aria-label="Export format">
          <button type="button" role="menuitem" className="menu__item" onClick={() => run('md')}>
            <span>Markdown</span>
            <span className="menu__hint">.md · readable, with transcript</span>
          </button>
          <button type="button" role="menuitem" className="menu__item" onClick={() => run('json')}>
            <span>JSON</span>
            <span className="menu__hint">.json · source and derived data</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
