import { useQuery } from '@tanstack/react-query';
import OpenSeadragon from 'openseadragon';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  canvasLabel,
  canvasToInfoJson,
  extractCanvases,
  fetchManifest,
} from '../lib/iiif';

interface IIIFFacsimilePaneProps {
  manifestUrl: string;
  alt: string;
}

const EMPTY_CLASSES =
  'flex h-[60vh] items-center justify-center rounded-md border border-dashed border-ink-700/20 dark:border-parchment-50/20 text-ink-700/70 dark:text-parchment-50/70 p-8 text-center';

export function IIIFFacsimilePane({ manifestUrl, alt }: IIIFFacsimilePaneProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['iiif-manifest', manifestUrl],
    queryFn: () => fetchManifest(manifestUrl),
    staleTime: 1000 * 60 * 60,
  });

  const canvases = useMemo(() => (data ? extractCanvases(data) : []), [data]);
  const [pageIndex, setPageIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageIndex(0);
  }, [manifestUrl]);

  const currentCanvas = canvases[pageIndex];
  const infoJsonUrl = currentCanvas ? canvasToInfoJson(currentCanvas) : null;

  useEffect(() => {
    if (!viewerRef.current || !infoJsonUrl) return;
    const viewer = OpenSeadragon({
      element: viewerRef.current,
      tileSources: infoJsonUrl,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/images/',
      showNavigationControl: true,
      showFullPageControl: false,
      gestureSettingsMouse: { clickToZoom: false },
      crossOriginPolicy: 'Anonymous',
      ajaxWithCredentials: false,
    });
    return () => {
      viewer.destroy();
    };
  }, [infoJsonUrl]);

  if (isLoading) {
    return <div className={EMPTY_CLASSES}>Loading IIIF manifest…</div>;
  }
  if (error) {
    return (
      <div className={EMPTY_CLASSES}>
        Could not load IIIF manifest:{' '}
        {error instanceof Error ? error.message : 'unknown error'}
      </div>
    );
  }
  if (canvases.length === 0 || !infoJsonUrl) {
    return <div className={EMPTY_CLASSES}>This IIIF manifest has no displayable canvases.</div>;
  }

  const multiPage = canvases.length > 1;
  const handlePrev = () => setPageIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setPageIndex((i) => Math.min(canvases.length - 1, i + 1));
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!multiPage) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlePrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleNext();
    }
  };

  const label = currentCanvas ? canvasLabel(currentCanvas, pageIndex) : '';

  return (
    <div
      className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 overflow-hidden bg-parchment-100 dark:bg-ink-800"
      onKeyDown={onKeyDown}
    >
      {multiPage && (
        <div
          className="flex items-center gap-2 p-2 border-b border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/60 dark:bg-ink-800"
          role="group"
          aria-label="Page navigation"
        >
          <button
            type="button"
            className="btn"
            onClick={handlePrev}
            disabled={pageIndex === 0}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleNext}
            disabled={pageIndex === canvases.length - 1}
            aria-label="Next page"
          >
            Next →
          </button>
          <span
            className="text-sm text-ink-700 dark:text-parchment-100"
            aria-live="polite"
          >
            {label} ({pageIndex + 1} of {canvases.length})
          </span>
        </div>
      )}
      <div
        ref={viewerRef}
        role="img"
        aria-label={alt}
        tabIndex={0}
        className="w-full h-[60vh] focus:outline focus:outline-2 focus:outline-ink-700 dark:focus:outline-parchment-50"
      />
    </div>
  );
}
