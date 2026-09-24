import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useBlobUrl } from '../../data/hooks';
import type { ImageAsset, MessageRecord } from '../../data/types';
import { Icon } from '../shared/Icon';
import { imageAlt, StoredImage } from '../shared/media';
import { Dialog, IconButton } from '../shared/ui';

function originLabel(img: ImageAsset): string {
  switch (img.origin) {
    case 'generated':
      return 'Generated image';
    case 'uploaded':
      return 'Uploaded image';
    case 'artifact':
      return 'Artifact';
    default:
      return 'Image';
  }
}

/** Display title: the export's title, the user's own file name for uploads, else what kind of image it is. */
export function imageTitle(img: ImageAsset): string {
  return img.title ?? (img.origin === 'uploaded' ? img.originalFilename : null) ?? originLabel(img);
}

function promptLabel(img: ImageAsset): string {
  switch (img.promptKind) {
    case 'generation':
      return 'Generation prompt';
    case 'tool_call':
      return 'Prompt sent to the image tool';
    case 'user_request':
      return 'Your request before this image';
    default:
      return 'Prompt';
  }
}

export interface GalleryProps {
  images: ImageAsset[];
  messagesById: Map<string, MessageRecord>;
  selected: number;
  onSelect: (index: number) => void;
  onJumpToMessage: (messageId: string) => void;
}

function DownloadImageButton({ image }: { image: ImageAsset }) {
  const { url } = useBlobUrl(image.available ? image.blobKey : null);
  if (!url) return null;
  const ext = image.mimeType?.split('/')[1]?.replace('svg+xml', 'svg').replace('jpeg', 'jpg') ?? 'img';
  const name = image.originalFilename ?? `${(image.title ?? `image-${image.index + 1}`).replace(/[^\w.-]+/g, '-')}.${ext}`;
  return (
    <a className="icon-btn" href={url} download={name} aria-label="Download original image" title="Download original">
      <Icon name="download" size={19} />
    </a>
  );
}

export function Gallery({ images, messagesById, selected, onSelect, onJumpToMessage }: GalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const programmatic = useRef(false);
  const count = images.length;
  const current = images[Math.min(selected, count - 1)];

  const settleTimer = useRef<number | undefined>(undefined);
  const programmaticTimer = useRef<number | undefined>(undefined);
  const firstSync = useRef(true);

  // Timers must never outlive the gallery: a late "scroll settled" callback would otherwise
  // select an image (and rewrite the URL) after the user has navigated away.
  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(programmaticTimer.current);
    },
    [],
  );

  // Keep the scroll-snap track in sync with the selected image.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const target = selected * track.clientWidth;
    if (Math.abs(track.scrollLeft - target) > 4) {
      programmatic.current = true;
      window.clearTimeout(settleTimer.current);
      const instant = firstSync.current || matchMedia('(prefers-reduced-motion: reduce)').matches;
      track.scrollTo({ left: target, behavior: instant ? 'auto' : 'smooth' });
      window.clearTimeout(programmaticTimer.current);
      programmaticTimer.current = window.setTimeout(() => {
        programmatic.current = false;
      }, instant ? 50 : 600);
    }
    firstSync.current = false;
    setPromptExpanded(false);
  }, [selected]);

  // Swipes (touch or trackpad) update the selection once the track settles on a slide.
  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || programmatic.current) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (programmatic.current) return;
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== selected && i >= 0 && i < count) onSelect(i);
    }, 120);
  }, [selected, count, onSelect]);

  const go = (delta: number) => onSelect((selected + delta + count) % count);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSelect(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSelect(count - 1);
    }
  };

  if (!current) return null;
  const msg = current.messageId ? messagesById.get(current.messageId) : undefined;
  const msgNumber = msg ? msg.index + 1 : null;
  const stored = images.filter((i) => i.available).length;

  return (
    <section className="gallery" id="section-images" aria-roledescription="carousel" aria-label={`Images from this conversation (${count})`} onKeyDown={onKeyDown}>
      <div className="gallery__stage">
        <div ref={trackRef} className="gallery__track" onScroll={onScroll} aria-live="polite">
          {images.map((img, i) => (
            <div key={img.id} className="gallery__slide" role="group" aria-roledescription="slide" aria-label={`Image ${i + 1} of ${count}`} aria-hidden={i !== selected}>
              {Math.abs(i - selected) <= 1 ? (
                img.available ? (
                  <button type="button" className="gallery__open" tabIndex={i === selected ? 0 : -1} onClick={() => setLightbox(true)} aria-label={`Open image ${i + 1} full size: ${imageAlt(img)}`}>
                    <StoredImage image={img} fit="contain" className="gallery__img" loading="eager" showReason />
                  </button>
                ) : (
                  <StoredImage image={img} className="gallery__img" showReason />
                )
              ) : (
                <div className="gallery__img img-loading" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        {count > 1 ? (
          <>
            <button type="button" className="gallery__nav gallery__nav--prev" onClick={() => go(-1)} aria-label="Previous image">
              <Icon name="chevronLeft" size={22} />
            </button>
            <button type="button" className="gallery__nav gallery__nav--next" onClick={() => go(1)} aria-label="Next image">
              <Icon name="chevronRight" size={22} />
            </button>
          </>
        ) : null}
        <span className="gallery__counter" aria-hidden="true">
          {selected + 1} / {count}
        </span>
      </div>

      <div className="gallery__caption">
        <div className="gallery__caption-main">
          <p className="gallery__title">{imageTitle(current)}</p>
          <p className="gallery__sub">
            Image {selected + 1} of {count}
            {imageTitle(current) !== originLabel(current) ? ` · ${originLabel(current)}` : ''}
            {msgNumber ? ` · message ${msgNumber}` : ''}
            {stored < count ? ` · ${count - stored} not in export` : ''}
          </p>
        </div>
        <div className="gallery__actions">
          {current.messageId && msg ? (
            <button type="button" className="text-btn text-btn--arrow" onClick={() => onJumpToMessage(current.messageId!)}>
              Jump to message {msgNumber}
              <Icon name="arrowRight" size={16} />
            </button>
          ) : null}
          {typeof __DOWNLOADS_ENABLED__ !== 'boolean' || __DOWNLOADS_ENABLED__ ? <DownloadImageButton image={current} /> : null}
          {current.available ? <IconButton icon="expand" label="View full size" onClick={() => setLightbox(true)} /> : null}
        </div>
      </div>

      {current.prompt ? (
        <div className="prompt-block">
          <p className="prompt-block__label">{promptLabel(current)}</p>
          <p className={`prompt-block__text${promptExpanded ? '' : ' prompt-block__text--clamped'}`}>{current.prompt}</p>
          {current.prompt.length > 220 ? (
            <button type="button" className="text-btn" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((v) => !v)}>
              {promptExpanded ? 'Show less' : 'Show full prompt'}
            </button>
          ) : null}
        </div>
      ) : null}

      {count > 1 ? (
        <div className="gallery__thumbs" aria-label="Choose an image">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              className="gallery__thumb"
              aria-pressed={i === selected}
              aria-label={`Show image ${i + 1}${img.title ? `: ${img.title}` : ''}${img.available ? '' : ' (not in export)'}`}
              onClick={() => onSelect(i)}
            >
              <StoredImage image={img} className="gallery__thumb-img" alt="" />
            </button>
          ))}
        </div>
      ) : null}

      <Lightbox open={lightbox} onClose={() => setLightbox(false)} images={images} selected={selected} onSelect={onSelect} />
    </section>
  );
}

function Lightbox({ open, onClose, images, selected, onSelect }: { open: boolean; onClose: () => void; images: ImageAsset[]; selected: number; onSelect: (i: number) => void }) {
  const img = images[selected];
  const count = images.length;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' && count > 1) {
      e.preventDefault();
      onSelect((selected + 1) % count);
    } else if (e.key === 'ArrowLeft' && count > 1) {
      e.preventDefault();
      onSelect((selected - 1 + count) % count);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={img ? `Image ${selected + 1} of ${count}` : 'Image'} className="lightbox" hideTitle>
      {img ? (
        <div className="lightbox__inner" onKeyDown={onKeyDown}>
          <div className="lightbox__bar">
            <span className="lightbox__count">
              {selected + 1} / {count}
            </span>
            <span className="lightbox__title">{imageTitle(img)}</span>
            <IconButton icon="close" label="Close full-size view" onClick={onClose} autoFocus />
          </div>
          <div className="lightbox__stage">
            {count > 1 ? (
              <button type="button" className="gallery__nav gallery__nav--prev" onClick={() => onSelect((selected - 1 + count) % count)} aria-label="Previous image">
                <Icon name="chevronLeft" size={24} />
              </button>
            ) : null}
            <StoredImage image={img} fit="contain" className="lightbox__img" showReason loading="eager" />
            {count > 1 ? (
              <button type="button" className="gallery__nav gallery__nav--next" onClick={() => onSelect((selected + 1) % count)} aria-label="Next image">
                <Icon name="chevronRight" size={24} />
              </button>
            ) : null}
          </div>
          {img.prompt ? <p className="lightbox__prompt">{img.prompt}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
