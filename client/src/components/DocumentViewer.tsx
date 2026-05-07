import { useId, useState } from 'react';

import type { Document } from '@tr/shared';

import { FacsimilePane } from './FacsimilePane';
import { TranscriptionPane } from './TranscriptionPane';

type Tab = 'transcription' | 'facsimile';

interface DocumentViewerProps {
  document: Document;
}

export function DocumentViewer({ document }: DocumentViewerProps) {
  const initialTab: Tab = document.facsimileUrl ? 'facsimile' : 'transcription';
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabsId = useId();

  const transcriptionPanelId = `${tabsId}-transcription`;
  const facsimilePanelId = `${tabsId}-facsimile`;

  return (
    <div>
      <div role="tablist" aria-label="Document view" className="inline-flex gap-1 p-1 rounded-md bg-parchment-200/60 dark:bg-ink-800 mb-4">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'transcription'}
          aria-controls={transcriptionPanelId}
          id={`${transcriptionPanelId}-tab`}
          tabIndex={tab === 'transcription' ? 0 : -1}
          onClick={() => setTab('transcription')}
          className={`px-4 py-1.5 rounded text-sm font-medium ${
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
          className={`px-4 py-1.5 rounded text-sm font-medium ${
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
        {tab === 'transcription' && <TranscriptionPane document={document} />}
      </div>
      <div
        role="tabpanel"
        id={facsimilePanelId}
        aria-labelledby={`${facsimilePanelId}-tab`}
        hidden={tab !== 'facsimile'}
      >
        {tab === 'facsimile' && (
          <FacsimilePane url={document.facsimileUrl} alt={`Facsimile of ${document.title}`} />
        )}
      </div>
    </div>
  );
}
