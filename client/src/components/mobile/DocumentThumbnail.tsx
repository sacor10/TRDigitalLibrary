import type { Document } from '@tr/shared';
import { useState } from 'react';

import { TYPE_MONOGRAM } from '../../lib/documentDisplay';

interface DocumentThumbnailProps {
  document: Pick<Document, 'facsimileUrl' | 'type' | 'title'>;
  className?: string;
}

/**
 * Leading card thumbnail. Tries the facsimile image when present and falls back
 * to a typed monogram tile on missing/broken images (covers text-only docs and
 * non-image facsimile URLs without needing to sniff extensions).
 */
export function DocumentThumbnail({ document, className = '' }: DocumentThumbnailProps) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(document.facsimileUrl) && !broken;

  return (
    <div
      className={`flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-700/10 bg-parchment-200/60 dark:border-parchment-50/10 dark:bg-ink-700/60 ${className}`}
    >
      {showImage ? (
        <img
          src={document.facsimileUrl ?? ''}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="font-serif text-base font-semibold text-accent-500">
          {TYPE_MONOGRAM[document.type]}
        </span>
      )}
    </div>
  );
}
