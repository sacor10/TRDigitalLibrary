/**
 * Curator-picked "featured" searches surfaced on the homepage. Each `query`
 * uses the existing search syntax understood by `buildFtsQuery`
 * (`server/src/routes/search.ts`) — free-text tokens plus `field:value`
 * scopes such as `tag:`, `recipient:`, `type:`, `date:YYYY`, `collection:`.
 *
 * Static in-repo config keeps these diffable and PR-reviewed; promote to a
 * writable table later only if non-developers need to edit them.
 */
export interface CuratedSearch {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly query: string;
}

export const CURATED_SEARCHES: ReadonlyArray<CuratedSearch> = [
  {
    id: 'conservation',
    title: 'Conservation & National Parks',
    description: "TR's campaign to protect forests, wildlife, and public lands.",
    query: 'conservation forests national parks',
  },
  {
    id: 'rough-riders',
    title: 'The Rough Riders',
    description: 'The Spanish-American War and the charge up San Juan Heights.',
    query: 'Rough Riders Cuba San Juan',
  },
  {
    id: 'panama-canal',
    title: 'The Panama Canal',
    description: 'Building the canal that joined two oceans.',
    query: 'Panama canal isthmus',
  },
  {
    id: 'trusts',
    title: 'Trust-Busting & the Square Deal',
    description: 'Regulating corporations and championing the common citizen.',
    query: 'trust corporation Square Deal regulation',
  },
  {
    id: 'lodge-letters',
    title: 'Letters to Henry Cabot Lodge',
    description: "Correspondence with TR's closest political confidant.",
    query: 'recipient:Lodge',
  },
  {
    id: 'naval-power',
    title: 'Naval Power & the Great White Fleet',
    description: "TR's vision of American sea power.",
    query: 'navy fleet battleship',
  },
];
