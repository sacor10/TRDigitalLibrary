import type { Document } from '@tr/shared';
import { useId, useState, type ReactNode } from 'react';


import { FacsimilePane } from './FacsimilePane';
import { TranscriptionPane } from './TranscriptionPane';

type Tab = 'transcription' | 'facsimile';

interface DocumentViewerProps {
  document: Document;
  onAnnotationSidebarChange?: (sidebar: ReactNode | null) => void;
}

export function DocumentViewer({ document, onAnnotationSidebarChange }: DocumentViewerProps) {
  const hasFacsimile = Boolean(document.iiifManifestUrl || document.facsimileUrl);
  const initialTab: Tab = 'transcription';
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabsId = useId();

  const transcriptionPanelId = `${tabsId}-transcription`;
  const facsimilePanelId = `${tabsId}-facsimile`;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Document view"
        className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-parchment-200/60 p-1 dark:bg-ink-800 sm:inline-grid"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'transcription'}
          aria-controls={transcriptionPanelId}
          id={`${transcriptionPanelId}-tab`}
          tabIndex={tab === 'transcription' ? 0 : -1}
          onClick={() => setTab('transcription')}
          className={`min-h-10 rounded px-3 py-2 text-sm font-medium sm:px-4 ${
            tab === 'transcription'
              ? 'bg-white dark:bg-ink-700 shadow-sm'
              : 'text-ink-700 dark:text-parchment-100'
          }`}
        >
          Transcription
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'facsimile'}
          aria-controls={facsimilePanelId}
          id={`${facsimilePanelId}-tab`}
          tabIndex={tab === 'facsimile' ? 0 : -1}
          onClick={() => setTab('facsimile')}
          className={`min-h-10 rounded px-3 py-2 text-sm font-medium sm:px-4 ${
            tab === 'facsimile'
              ? 'bg-white dark:bg-ink-700 shadow-sm'
              : 'text-ink-700 dark:text-parchment-100'
          }`}
        >
          Facsimile
        </button>
      </div>

      <div
        role="tabpanel"
        id={transcriptionPanelId}
        aria-labelledby={`${transcriptionPanelId}-tab`}
        hidden={tab !== 'transcription'}
      >
        {tab === 'transcription' && (
          <TranscriptionPane
            document={document}
            {...(onAnnotationSidebarChange
              ? { onSidebarChange: onAnnotationSidebarChange }
              : {})}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={facsimilePanelId}
        aria-labelledby={`${facsimilePanelId}-tab`}
        hidden={tab !== 'facsimile'}
      >
        {tab === 'facsimile' && (
          <FacsimilePane
            iiifManifestUrl={document.iiifManifestUrl}
            url={document.facsimileUrl}
            alt={`Facsimile of ${document.title}`}
          />
        )}
      </div>
    </div>
  );
}
