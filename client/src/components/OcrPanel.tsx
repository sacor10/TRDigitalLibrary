import type { Document } from '@tr/shared';

interface OcrPanelProps {
  document: Document;
}

type OcrEngine = 'tesseract' | 'transkribus';

function engineForDocument(doc: Document): OcrEngine {
  return doc.type === 'letter' ? 'transkribus' : 'tesseract';
}

const ENGINE_LABELS: Record<OcrEngine, string> = {
  tesseract: 'Tesseract (typewritten)',
  transkribus: 'Transkribus (handwriting)',
};

const ENGINE_COST: Record<OcrEngine, string> = {
  tesseract: 'Free',
  transkribus: '~€0.05 / page',
};

export function OcrPanel({ document }: OcrPanelProps) {
  const hasFacsimile = Boolean(document.iiifManifestUrl ?? document.facsimileUrl);
  const engine = engineForDocument(document);

  return (
    <section aria-labelledby="ocr-heading" className="card">
      <h3 id="ocr-heading" className="text-sm font-semibold uppercase tracking-wide">
        OCR Transcription
      </h3>

      {hasFacsimile ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-700/70 dark:text-parchment-100/70">Engine</dt>
              <dd className="font-medium">{ENGINE_LABELS[engine]}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-700/70 dark:text-parchment-100/70">Cost</dt>
              <dd className="font-medium">{ENGINE_COST[engine]}</dd>
            </div>
          </dl>

          <button
            type="button"
            disabled
            aria-disabled="true"
            className="btn w-full opacity-50 cursor-not-allowed"
            title="OCR pipeline not yet implemented"
          >
            Run OCR
          </button>
          <p className="text-xs text-ink-700/60 dark:text-parchment-100/60 text-center">
            Coming soon — not yet implemented
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-700/70 dark:text-parchment-100/70">
          No image source available for OCR.
        </p>
      )}
    </section>
  );
}
