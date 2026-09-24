import { useEffect, useState, type FormEvent } from 'react';
import { ensureCollection, saveEntryEdits, type EntryView } from '../../data/repositories/entries';
import type { Collection, DerivedItem } from '../../data/types';
import { randomId } from '../../utils/hash';
import { Icon } from '../shared/Icon';
import { Button, Dialog, IconButton, Notice } from '../shared/ui';

export function EditEntryDialog({ view, collections, open, onClose }: { view: EntryView; collections: Collection[]; open: boolean; onClose: () => void }) {
  const { entry, derived } = view;
  const [title, setTitle] = useState(entry.title);
  const [subtitle, setSubtitle] = useState(entry.subtitle);
  const [tags, setTags] = useState(entry.tags.join(', '));
  const [collection, setCollection] = useState(view.collection?.name ?? '');
  const [steps, setSteps] = useState<DerivedItem[]>(entry.nextSteps);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(entry.title);
    setSubtitle(entry.subtitle);
    setTags(entry.tags.join(', '));
    setCollection(view.collection?.name ?? '');
    setSteps(entry.nextSteps);
    setError(null);
  }, [open, entry, view.collection]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const collectionName = collection.trim();
      const collectionId = collectionName ? await ensureCollection(collectionName) : null;
      await saveEntryEdits(entry.id, {
        title,
        subtitle,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        nextSteps: steps,
        collectionId,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const revertAll = async () => {
    setSaving(true);
    try {
      await saveEntryEdits(entry.id, {}, ['title', 'subtitle', 'tags', 'nextSteps', 'collectionId']);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const anyEdited = Object.values(entry.edited).some(Boolean);

  return (
    <Dialog open={open} onClose={onClose} title="Edit entry" className="dialog--edit">
      <form onSubmit={submit} className="form">
        <p className="form__intro">Your edits are saved separately and always win over generated content — regenerating the summary won’t overwrite them.</p>
        <label className="field">
          <span className="field__label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} placeholder={derived.title} />
        </label>
        <label className="field">
          <span className="field__label">Subtitle</span>
          <textarea value={subtitle} onChange={(e) => setSubtitle(e.target.value)} rows={2} maxLength={240} />
        </label>
        <label className="field">
          <span className="field__label">Tags</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="garden, planning" />
          <span className="field__hint">Separate with commas.</span>
        </label>
        <label className="field">
          <span className="field__label">Collection</span>
          <input value={collection} onChange={(e) => setCollection(e.target.value)} list="collection-options" placeholder="None" maxLength={48} />
          <datalist id="collection-options">
            {collections.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </label>
        <fieldset className="field">
          <legend className="field__label">Next steps</legend>
          <ul className="steps-edit">
            {steps.map((s, i) => (
              <li key={s.id} className="steps-edit__row">
                <input
                  aria-label={`Next step ${i + 1}`}
                  value={s.text}
                  onChange={(e) => setSteps((prev) => prev.map((p) => (p.id === s.id ? { ...p, text: e.target.value } : p)))}
                />
                <IconButton icon="trash" label={`Remove next step ${i + 1}`} onClick={() => setSteps((prev) => prev.filter((p) => p.id !== s.id))} />
              </li>
            ))}
          </ul>
          <button type="button" className="text-btn" onClick={() => setSteps((prev) => [...prev, { id: randomId('step'), text: '', sourceMessageIds: [] }])}>
            <Icon name="steps" size={15} /> Add a next step
          </button>
        </fieldset>
        {error ? <Notice tone="error" title="Couldn’t save">{error}</Notice> : null}
        <div className="dialog__actions">
          {anyEdited ? (
            <Button variant="ghost" onClick={revertAll} disabled={saving} className="dialog__left">
              Revert to generated
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" busy={saving}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
