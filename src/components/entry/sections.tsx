import { href } from '../../app/router';
import type { DerivedItem, EffectiveEntry, ExtractedList, MessageRecord } from '../../data/types';
import { speakerName } from '../../export/entry-export';
import { formatDate } from '../../utils/dates';
import { Icon, type IconName } from '../shared/Icon';
import { Button, Notice, Spinner } from '../shared/ui';

/** "msg 12" chips that jump to the message supporting a derived item. */
export function Provenance({ ids, messagesById, onJump }: { ids: string[]; messagesById: Map<string, MessageRecord>; onJump: (id: string) => void }) {
  const refs = ids.map((id) => messagesById.get(id)).filter((m): m is MessageRecord => !!m);
  if (refs.length === 0) return null;
  return (
    <span className="prov" aria-label="Sources">
      {refs.map((m) => (
        <button key={m.id} type="button" className="prov__chip" onClick={() => onJump(m.id)} aria-label={`Go to message ${m.index + 1} (${speakerName(m, '')})`} title={`Go to message ${m.index + 1}`}>
          msg {m.index + 1}
        </button>
      ))}
    </span>
  );
}

export function SummaryPanel({
  entry,
  providerConfigured,
  busy,
  onGenerate,
}: {
  entry: EffectiveEntry;
  providerConfigured: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  const status = busy ? 'pending' : entry.summaryStatus;
  const hasText = entry.summary.trim().length > 0;
  return (
    <section className="summary-panel" id="section-summary" aria-labelledby="summary-h" aria-busy={status === 'pending'}>
      <div className="summary-panel__head">
        <h2 id="summary-h" className="section-label">
          Summary
        </h2>
        {hasText && entry.summaryProvider ? (
          <span className="summary-panel__by">
            {entry.summaryProvider === 'Sample data' ? 'Sample data — written example' : `By ${entry.summaryProvider}`}
            {entry.summaryGeneratedAt && entry.summaryProvider !== 'Sample data' ? ` · ${formatDate(entry.summaryGeneratedAt)}` : ''}
          </span>
        ) : null}
      </div>

      {hasText ? (
        <div className="summary-panel__text">
          {entry.summary.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}

      {status === 'pending' ? (
        <div className="summary-panel__state">
          <Spinner label={hasText ? 'Writing a new summary…' : 'Writing summary…'} />
        </div>
      ) : null}

      {status === 'failed' ? (
        <Notice
          tone="error"
          title={hasText ? 'Couldn’t regenerate the summary — showing the previous one' : 'Summary failed'}
          action={
            <Button size="sm" onClick={onGenerate} icon="refresh">
              Try again
            </Button>
          }
        >
          {entry.summaryError ?? 'The summarizer returned an error.'} The conversation itself is unaffected.
        </Notice>
      ) : null}

      {status === 'complete' && entry.summaryOutdated ? (
        <Notice
          tone="warn"
          title="The conversation changed after this summary was written"
          action={
            providerConfigured ? (
              <Button size="sm" onClick={onGenerate} icon="refresh">
                Regenerate
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {status === 'not_configured' && !hasText ? (
        <div className="summary-panel__empty">
          <p className="summary-panel__none">Summary not generated.</p>
          <p className="summary-panel__hint">
            {providerConfigured
              ? 'Write a summary with your configured summarizer. The transcript stays exactly as imported.'
              : 'Summaries are optional. Connect a summarizer in Settings to write one, or read the transcript below.'}
          </p>
          {providerConfigured ? (
            <Button variant="primary" size="sm" icon="sparkPen" onClick={onGenerate}>
              Generate summary
            </Button>
          ) : (
            <a className="btn btn--secondary btn--sm" href={href('/settings')}>
              <Icon name="settings" size={16} />
              <span>Configure summarization</span>
            </a>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DerivedList({
  id,
  title,
  icon,
  items,
  messagesById,
  onJump,
  edited,
}: {
  id: string;
  title: string;
  icon: IconName;
  items: DerivedItem[];
  messagesById: Map<string, MessageRecord>;
  onJump: (id: string) => void;
  edited?: boolean;
}) {
  return (
    <section className="derived" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="section-title">
        <Icon name={icon} size={18} />
        {title}
        {edited ? <span className="edited-mark">edited</span> : null}
      </h2>
      <ul className="derived__list">
        {items.map((item) => (
          <li key={item.id} className="derived__item">
            <span className="derived__text">{item.text}</span>
            <Provenance ids={item.sourceMessageIds} messagesById={messagesById} onJump={onJump} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DecisionsAndSteps({ entry, messagesById, onJump }: { entry: EffectiveEntry; messagesById: Map<string, MessageRecord>; onJump: (id: string) => void }) {
  if (entry.keyDecisions.length === 0 && entry.nextSteps.length === 0) return null;
  return (
    <div className="derived-grid">
      {entry.keyDecisions.length > 0 ? (
        <DerivedList id="section-decisions" title="Key decisions" icon="flag" items={entry.keyDecisions} messagesById={messagesById} onJump={onJump} />
      ) : null}
      {entry.nextSteps.length > 0 ? (
        <DerivedList id="section-steps" title="Next steps" icon="steps" items={entry.nextSteps} messagesById={messagesById} onJump={onJump} edited={entry.edited.nextSteps} />
      ) : null}
    </div>
  );
}

export function ExtractedLists({ lists, messagesById, onJump }: { lists: ExtractedList[]; messagesById: Map<string, MessageRecord>; onJump: (id: string) => void }) {
  if (lists.length === 0) return null;
  return (
    <>
      {lists.map((list) => (
        <section key={list.id} className="extracted" id={`section-${list.id}`} aria-labelledby={`${list.id}-h`}>
          <h2 id={`${list.id}-h`} className="section-title">
            <Icon name="list" size={18} />
            {list.heading}
          </h2>
          <table className="extracted__table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Amount</th>
                <th scope="col">
                  <span className="sr-only">Source</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.label}</td>
                  <td className="extracted__value">{row.value}</td>
                  <td className="extracted__src">
                    <Provenance ids={row.sourceMessageIds} messagesById={messagesById} onJump={onJump} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export function Highlights({ entry, messagesById, onJump }: { entry: EffectiveEntry; messagesById: Map<string, MessageRecord>; onJump: (id: string) => void }) {
  const items = entry.highlightMessageIds.map((id) => messagesById.get(id)).filter((m): m is MessageRecord => !!m);
  if (items.length === 0) return null;
  return (
    <section className="highlights" id="section-highlights" aria-labelledby="highlights-h">
      <h2 id="highlights-h" className="section-title">
        <Icon name="quote" size={18} />
        Highlights
      </h2>
      <div className="highlights__list">
        {items.map((m) => (
          <figure key={m.id} className="highlight">
            <blockquote className="highlight__text">{m.text}</blockquote>
            <figcaption className="highlight__meta">
              <span>
                {speakerName(m, entry.source)} · message {m.index + 1}
              </span>
              <button type="button" className="text-btn text-btn--arrow" onClick={() => onJump(m.id)}>
                Read in context
                <Icon name="arrowRight" size={15} />
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
