import type { Document } from '@tr/shared';

export const TEST_DOCUMENTS: Document[] = [
  {
    id: 'man-in-the-arena',
    title: 'The Man in the Arena (Citizenship in a Republic)',
    type: 'speech',
    date: '1910-04-23',
    recipient: null,
    location: 'Sorbonne, Paris, France',
    author: 'Theodore Roosevelt',
    transcription:
      'It is not the critic who counts; the credit belongs to the man who is actually in the arena.',
    transcriptionUrl: 'https://example.org/man-in-the-arena.txt',
    transcriptionFormat: 'plain-text',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: 'Test fixture based on a public speech.',
    source: 'Test Fixture',
    sourceUrl: 'https://example.org/man-in-the-arena',
    tags: ['civic-ethics', '1910'],
    mentions: [],
    teiXml: null,
  },
  {
    id: 'letter-to-kermit',
    title: 'Letter from Theodore Roosevelt to Kermit Roosevelt',
    type: 'letter',
    date: '1908-01-15',
    recipient: 'Kermit Roosevelt',
    location: 'Washington, D.C.',
    author: 'Theodore Roosevelt',
    transcription: 'My dear Kermit, this is a fixture letter about conservation.',
    transcriptionUrl: 'https://example.org/letter-to-kermit.txt',
    transcriptionFormat: 'plain-text',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: 'Test fixture correspondence.',
    source: 'Test Fixture',
    sourceUrl: 'https://example.org/letter-to-kermit',
    tags: ['family', 'conservation'],
    mentions: ['Kermit Roosevelt'],
    teiXml: null,
  },
  {
    id: 'loc-mss382990022',
    title:
      'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1901, Nov. 12-Dec. 16',
    type: 'manuscript',
    date: '1901-11-12',
    recipient: null,
    location: null,
    author: 'Theodore Roosevelt',
    transcription: 'Library of Congress manuscript fixture with unique-token-alpenglow.',
    transcriptionUrl:
      'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss38299/mss38299_022/mss38299-022_0001_0926.txt',
    transcriptionFormat: 'plain-text',
    facsimileUrl:
      'https://tile.loc.gov/image-services/iiif/service:mss:mss38299:mss38299_022:0002/full/pct:12.5/0/default.jpg',
    iiifManifestUrl: null,
    provenance: 'Imported from Library of Congress Theodore Roosevelt Papers.',
    source: 'Library of Congress Theodore Roosevelt Papers',
    sourceUrl: 'https://www.loc.gov/item/mss382990022/',
    tags: ['manuscripts', 'theodore roosevelt papers'],
    mentions: [],
    teiXml: null,
  },
];

export function cloneTestDocuments(): Document[] {
  return TEST_DOCUMENTS.map((doc) => ({
    ...doc,
    tags: [...doc.tags],
    mentions: [...(doc.mentions ?? [])],
  }));
}
