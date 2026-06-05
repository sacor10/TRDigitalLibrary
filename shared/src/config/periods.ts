import { clampRooseveltDocumentDate } from '../schemas/document.js';

/**
 * Named periods of Theodore Roosevelt's life, used to seed the existing
 * `dateFrom`/`dateTo` filters on the browse and search routes. This is pure
 * static data — no database table — so it stays diffable and PR-reviewed.
 *
 * Date bounds are clamped to {@link EARLIEST_ROOSEVELT_DOCUMENT_DATE} so they
 * never violate the document date floor enforced by the Zod schemas.
 */
export interface TrLifePeriod {
  readonly id: string;
  readonly label: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly blurb: string;
}

function period(
  id: string,
  label: string,
  dateFrom: string,
  dateTo: string,
  blurb: string,
): TrLifePeriod {
  return { id, label, dateFrom: clampRooseveltDocumentDate(dateFrom), dateTo, blurb };
}

export const TR_LIFE_PERIODS: ReadonlyArray<TrLifePeriod> = [
  period(
    'dakota',
    'Dakota Years',
    '1883-01-01',
    '1887-12-31',
    'Ranching and writing in the Dakota Territory badlands after personal tragedy.',
  ),
  period(
    'police-commissioner',
    'NYC Police Commissioner',
    '1895-01-01',
    '1897-04-30',
    'Reforming the New York City Police Department as board president.',
  ),
  period(
    'asst-navy',
    'Assistant Secretary of the Navy',
    '1897-04-01',
    '1898-05-31',
    'Building up the Navy on the eve of the Spanish-American War.',
  ),
  period(
    'rough-riders',
    'Rough Riders',
    '1898-05-01',
    '1898-12-31',
    'Commanding the First U.S. Volunteer Cavalry in Cuba.',
  ),
  period(
    'governor',
    'Governor of New York',
    '1899-01-01',
    '1900-12-31',
    'Two reform-minded years as governor before the vice presidency.',
  ),
  period(
    'vice-president',
    'Vice President',
    '1901-03-04',
    '1901-09-13',
    'A brief vice presidency under William McKinley.',
  ),
  period(
    'presidency',
    'Presidency',
    '1901-09-14',
    '1909-03-04',
    'The Square Deal, trust-busting, conservation, and the Panama Canal.',
  ),
  period(
    'african-expedition',
    'African Expedition',
    '1909-03-23',
    '1910-06-30',
    'The Smithsonian-Roosevelt African Expedition following the presidency.',
  ),
  period(
    'bull-moose',
    'Bull Moose Campaign',
    '1912-01-01',
    '1912-12-31',
    'The Progressive ("Bull Moose") Party run for a third term.',
  ),
  period(
    'amazon',
    'Amazon Expedition',
    '1913-10-01',
    '1914-12-31',
    'The perilous Roosevelt–Rondon descent of the River of Doubt.',
  ),
  period(
    'final-years',
    'Final Years',
    '1915-01-01',
    '1919-01-06',
    'Advocacy for preparedness and a return to public life until his death.',
  ),
];

export const TR_LIFE_PERIODS_BY_ID: ReadonlyMap<string, TrLifePeriod> = new Map(
  TR_LIFE_PERIODS.map((p) => [p.id, p]),
);
