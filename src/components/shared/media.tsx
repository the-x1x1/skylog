import { useState } from 'react';
import { BRAND } from '../../config/brand';
import { useBlobUrl } from '../../data/hooks';
import type { ImageAsset } from '../../data/types';
import { Icon } from './Icon';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="logo">
      <svg className="logo__mark" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="logo__bg" />
        <path d="M8 10.5c2.8-1.3 5.6-1.3 8 .6 2.4-1.9 5.2-1.9 8-.6v12c-2.8-1.3-5.6-1.3-8 .6-2.4-1.9-5.2-1.9-8-.6z" fill="none" className="logo__stroke" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 11.1v12" className="logo__stroke" strokeWidth="1.8" />
      </svg>
      {compact ? null : <span className="logo__name">{BRAND.name}</span>}
    </span>
  );
}

/** Accessible description of an image, built from what the export tells us. */
export function imageAlt(img: Pick<ImageAsset, 'title' | 'prompt' | 'origin' | 'originalFilename' | 'index'>): string {
  if (img.title) return img.title;
  if (img.prompt && img.origin !== 'uploaded') return `Generated image: ${img.prompt.length > 180 ? `${img.prompt.slice(0, 180)}…` : img.prompt}`;
  if (img.origin === 'uploaded') return img.originalFilename ? `Uploaded image ${img.originalFilename}` : 'Uploaded image';
  if (img.origin === 'artifact') return 'Image artifact';
  return `Image ${img.index + 1}`;
}

/**
 * Renders a stored image, or an honest placeholder when the export had no binary
 * or the browser cannot decode the format.
 */
export function StoredImage({
  image,
  className,
  fit = 'cover',
  showReason,
  loading = 'lazy',
  alt,
}: {
  image: Pick<ImageAsset, 'blobKey' | 'available' | 'title' | 'prompt' | 'origin' | 'originalFilename' | 'index' | 'unavailableReason' | 'mimeType'>;
  className?: string;
  fit?: 'cover' | 'contain';
  showReason?: boolean;
  loading?: 'lazy' | 'eager';
  /** Overrides the generated alt text ("" marks a decorative image). */
  alt?: string;
}) {
  const { url, loading: pending } = useBlobUrl(image.available ? image.blobKey : null);
  const [broken, setBroken] = useState(false);
  if (!image.available || broken || (!pending && !url)) {
    const reason = !image.available
      ? (image.unavailableReason ?? 'This image was not included in the export.')
      : `This image (${image.mimeType ?? 'unknown format'}) can't be displayed in this browser.`;
    return (
      <div className={`img-missing${className ? ` ${className}` : ''}`} role="img" aria-label={`${imageAlt(image)} — not available`}>
        <Icon name="imageOff" size={showReason ? 28 : 20} />
        {showReason ? (
          <>
            <span className="img-missing__title">{image.available ? 'Can’t display this image' : 'Image not in export'}</span>
            <span className="img-missing__reason">{reason}</span>
          </>
        ) : null}
      </div>
    );
  }
  if (!url) return <div className={`img-loading${className ? ` ${className}` : ''}`} aria-hidden="true" />;
  return (
    <img
      src={url}
      alt={alt ?? imageAlt(image)}
      className={`${className ?? ''} img--${fit}`}
      loading={loading}
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}
