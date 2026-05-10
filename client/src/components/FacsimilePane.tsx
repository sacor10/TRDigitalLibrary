import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

import { IIIFFacsimilePane } from './IIIFFacsimilePane';

interface FacsimilePaneProps {
  iiifManifestUrl: string | null;
  url: string | null;
  alt: string;
}

export function FacsimilePane({ iiifManifestUrl, url, alt }: FacsimilePaneProps) {
  if (iiifManifestUrl) {
    return <IIIFFacsimilePane manifestUrl={iiifManifestUrl} alt={alt} />;
  }
  if (!url) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center rounded-md border border-dashed border-ink-700/20 p-6 text-center text-ink-700/70 dark:border-parchment-50/20 dark:text-parchment-50/70 sm:h-[60vh] sm:p-8">
        No facsimile available for this document. The transcription tab shows the full text.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 overflow-hidden bg-parchment-100 dark:bg-ink-800">
      <TransformWrapper minScale={0.5} maxScale={5} initialScale={1} centerOnInit>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="flex flex-wrap gap-2 border-b border-ink-700/10 bg-parchment-50/60 p-2 dark:border-parchment-50/10 dark:bg-ink-800">
              <button type="button" className="btn" onClick={() => zoomIn()} aria-label="Zoom in">
                +
              </button>
              <button type="button" className="btn" onClick={() => zoomOut()} aria-label="Zoom out">
                −
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => resetTransform()}
                aria-label="Reset zoom"
              >
                Reset
              </button>
            </div>
            <TransformComponent
              wrapperClass="!w-full !h-[50vh] sm:!h-[60vh]"
              contentClass="!w-full !h-full"
            >
              <img
                src={url}
                alt={alt}
                className="max-w-full max-h-full object-contain mx-auto"
                loading="lazy"
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
