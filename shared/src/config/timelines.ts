/**
 * Named themed timelines. Each is a filter spec over existing document data
 * (no new storage): the client fetches the matching documents via the existing
 * `/api/documents` route (using `tag`/`type`/`dateFrom`/`dateTo`) and feeds the
 * existing `Timeline` component.
 */
export interface ThemedTimeline {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tag?: string;
  readonly type?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

export const THEMED_TIMELINES: ReadonlyArray<ThemedTimeline> = [
  {
    id: 'all',
    label: 'All documents',
    description: "The full span of TR's correspondence and writings.",
  },
  {
    id: 'presidency-speeches',
    label: 'Presidential speeches',
    description: 'Speeches delivered during the presidency (1901–1909).',
    type: 'speech',
    dateFrom: '1901-09-14',
    dateTo: '1909-03-04',
  },
  {
    id: 'conservation',
    label: 'Conservation',
    description: 'Documents touching on forests, wildlife, and public lands.',
    tag: 'Conservation',
  },
  {
    id: 'letters',
    label: 'Correspondence',
    description: "TR's letters, charted across his life.",
    type: 'letter',
  },
  {
    id: 'diaries',
    label: 'Diaries',
    description: 'Diary entries and personal notes.',
    type: 'diary',
  },
];
