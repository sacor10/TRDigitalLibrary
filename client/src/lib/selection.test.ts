import { describe, expect, it } from 'vitest';

import type { AnnotationSelector } from '@tr/shared';

import { locateAnnotationRange } from './selection';

describe('locateAnnotationRange', () => {
  const text =
    'It is not the critic who counts, but the man who is actually in the arena. ' +
    'His face is marred by dust and sweat and blood.';

  it('finds a TextQuoteSelector match', () => {
    const sel: AnnotationSelector = {
      type: 'TextQuoteSelector',
      exact: 'man who is actually in the arena',
    };
    const range = locateAnnotationRange(sel, text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end)).toBe(
      'man who is actually in the arena',
    );
  });

  it('disambiguates between two matches using prefix/suffix', () => {
    const repeated = 'red blue red blue';
    const sel: AnnotationSelector = {
      type: 'TextQuoteSelector',
      exact: 'red',
      prefix: 'blue ',
      suffix: ' blue',
    };
    const range = locateAnnotationRange(sel, repeated);
    expect(range).toEqual({ start: 9, end: 12 });
  });

  it('falls back to TextPositionSelector when no quote match', () => {
    const sel: AnnotationSelector[] = [
      { type: 'TextQuoteSelector', exact: 'absent text' },
      { type: 'TextPositionSelector', start: 0, end: 7 },
    ];
    const range = locateAnnotationRange(sel, text);
    expect(range).toEqual({ start: 0, end: 7 });
  });

  it('extracts selectors from a FragmentSelector wrapper', () => {
    const sel: AnnotationSelector = {
      type: 'FragmentSelector',
      value: 'section=abc',
      refinedBy: [
        { type: 'TextQuoteSelector', exact: 'arena' },
        { type: 'TextPositionSelector', start: 67, end: 72 },
      ],
    };
    const range = locateAnnotationRange(sel, text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end)).toBe('arena');
  });

  it('returns null when nothing matches', () => {
    const sel: AnnotationSelector = {
      type: 'TextQuoteSelector',
      exact: 'this phrase does not appear',
    };
    expect(locateAnnotationRange(sel, text)).toBeNull();
  });
});
