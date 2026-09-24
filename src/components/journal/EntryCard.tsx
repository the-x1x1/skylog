import { entryPath, href } from '../../app/router';
import type { EffectiveEntry } from '../../data/types';
import { blobKeyForImage } from '../../importers/core/prepare';
import { formatDate } from '../../utils/dates';
import { Icon } from '../shared/Icon';
import { StoredImage } from '../shared/media';
import { SourceBadge } from '../shared/ui';

export function EntryCard({ entry, collectionName }: { entry: EffectiveEntry; collectionName?: string }) {
  const line = entry.subtitle || entry.excerpt;
  const indicator = collectionName ?? (entry.tags[0] ? `#${entry.tags[0]}` : null);
  return (
    <article className="entry-card">
      <div className="entry-card__cover">
        {entry.coverImageId ? (
          <CoverImage entry={entry} />
        ) : (
          <div className={`entry-card__placeholder entry-card__placeholder--${entry.source}`} aria-hidden="true">
            <span>{entry.title.trim().charAt(0).toUpperCase() || '·'}</span>
          </div>
        )}
        {entry.imageCount > 0 ? (
          <span className="entry-card__count" aria-hidden="true">
            <Icon name="image" size={13} />
            {entry.imageCount}
          </span>
        ) : null}
        {entry.isSample ? <span className="entry-card__sample">Sample</span> : null}
      </div>
      <div className="entry-card__body">
        <h3 className="entry-card__title">
          <a href={href(entryPath(entry.id))} className="entry-card__link">
            {entry.title}
          </a>
        </h3>
        {line ? <p className={`entry-card__sub${entry.subtitle ? '' : ' entry-card__sub--quote'}`}>{line}</p> : null}
        <p className="entry-card__meta">
          <SourceBadge source={entry.source} size="sm" />
          <span aria-hidden="true">·</span>
          <time dateTime={entry.chatDate ?? undefined}>{formatDate(entry.chatDate)}</time>
          <span className="sr-only">
            , {entry.imageCount} {entry.imageCount === 1 ? 'image' : 'images'}
          </span>
          {indicator ? <span className="entry-card__indicator">{indicator}</span> : null}
        </p>
      </div>
    </article>
  );
}

function CoverImage({ entry }: { entry: EffectiveEntry }) {
  return (
    <StoredImage
      image={{
        blobKey: blobKeyForImage(entry.coverImageId!),
        available: true,
        title: '',
        prompt: null,
        origin: 'unknown',
        originalFilename: null,
        index: 0,
        unavailableReason: null,
        mimeType: null,
      }}
      className="entry-card__img"
      alt=""
    />
  );
}
