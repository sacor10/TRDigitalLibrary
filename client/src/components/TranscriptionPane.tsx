import type { Document } from '@tr/shared';

interface TranscriptionPaneProps {
  document: Document;
}

export function TranscriptionPane({ document }: TranscriptionPaneProps) {
  if (!document.transcription) {
    return (
      <article className="max-w-none p-6 rounded-md border border-dashed border-ink-700/20 dark:border-parchment-50/20 space-y-3">
        <p>
          No cached transcription is available. This document was seeded from a remote source — run
          <code className="mx-1">npm run seed</code> with network access, or read it directly at the
          source:
        </p>
        {document.sourceUrl && (
          <p>
            <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {document.sourceUrl}
            </a>
          </p>
        )}
      </article>
    );
  }
  return (
    <article className="max-w-none leading-relaxed space-y-4 text-base">
      {document.transcription.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </article>
  );
}
