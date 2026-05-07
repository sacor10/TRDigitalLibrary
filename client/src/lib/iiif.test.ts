import { describe, expect, it } from 'vitest';

import {
  canvasLabel,
  canvasToInfoJson,
  extractCanvases,
  type IIIFManifest,
} from './iiif';

const SINGLE_CANVAS: IIIFManifest = {
  id: 'https://iiif.archive.org/iiif/3/example/manifest.json',
  label: { en: ['Example Item'] },
  items: [
    {
      id: 'https://iiif.archive.org/iiif/3/example/canvas/p1',
      label: { en: ['Cover'] },
      items: [
        {
          items: [
            {
              body: {
                id: 'https://iiif.archive.org/iiif/3/example/full/full/0/default.jpg',
                type: 'Image',
                service: [
                  {
                    id: 'https://iiif.archive.org/iiif/3/example',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

const MULTI_CANVAS: IIIFManifest = {
  id: 'https://iiif.archive.org/iiif/3/book/manifest.json',
  label: { en: ['A Book'] },
  items: [
    {
      id: 'https://iiif.archive.org/iiif/3/book/canvas/p1',
      label: 'Page 1',
      items: [
        {
          items: [
            {
              body: {
                service: [{ '@id': 'https://iiif.archive.org/iiif/3/book$1/' }],
              },
            },
          ],
        },
      ],
    },
    {
      id: 'https://iiif.archive.org/iiif/3/book/canvas/p2',
      items: [
        {
          items: [
            {
              body: {
                service: [{ id: 'https://iiif.archive.org/iiif/3/book$2' }],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('extractCanvases', () => {
  it('returns the items array for a multi-canvas manifest', () => {
    const canvases = extractCanvases(MULTI_CANVAS);
    expect(canvases).toHaveLength(2);
  });

  it('returns a single-element array for a single-canvas manifest', () => {
    expect(extractCanvases(SINGLE_CANVAS)).toHaveLength(1);
  });

  it('returns empty array when items is missing', () => {
    expect(extractCanvases({})).toEqual([]);
  });
});

describe('canvasToInfoJson', () => {
  it('extracts the IIIF Image API service id and appends /info.json', () => {
    const canvas = SINGLE_CANVAS.items![0]!;
    expect(canvasToInfoJson(canvas)).toBe('https://iiif.archive.org/iiif/3/example/info.json');
  });

  it('strips a trailing slash before appending /info.json', () => {
    const canvas = MULTI_CANVAS.items![0]!;
    expect(canvasToInfoJson(canvas)).toBe('https://iiif.archive.org/iiif/3/book$1/info.json');
  });

  it('supports both id and @id on the service object', () => {
    const a = canvasToInfoJson(MULTI_CANVAS.items![0]!);
    const b = canvasToInfoJson(MULTI_CANVAS.items![1]!);
    expect(a).toContain('book$1');
    expect(b).toContain('book$2');
  });

  it('returns null when no annotation body is present', () => {
    expect(canvasToInfoJson({ id: 'x', items: [] })).toBeNull();
  });
});

describe('canvasLabel', () => {
  it('returns the first language string for a language map', () => {
    expect(canvasLabel(SINGLE_CANVAS.items![0]!, 0)).toBe('Cover');
  });

  it('returns a plain string label as-is', () => {
    expect(canvasLabel(MULTI_CANVAS.items![0]!, 0)).toBe('Page 1');
  });

  it('falls back to "Page N" when no label is present', () => {
    expect(canvasLabel(MULTI_CANVAS.items![1]!, 1)).toBe('Page 2');
  });
});
