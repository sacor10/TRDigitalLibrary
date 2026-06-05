import { describe, expect, it } from 'vitest';

import { compileAdvancedQuery } from './AdvancedSearchForm';

describe('compileAdvancedQuery', () => {
  it('returns an empty string when no fields are filled', () => {
    expect(
      compileAdvancedQuery({
        keywords: '',
        title: '',
        recipient: '',
        tag: '',
        collection: '',
        year: '',
      }),
    ).toBe('');
  });

  it('compiles single-word scopes without quotes', () => {
    expect(
      compileAdvancedQuery({
        keywords: 'conservation',
        title: '',
        recipient: 'Lodge',
        tag: '',
        collection: '',
        year: '',
      }),
    ).toBe('conservation recipient:Lodge');
  });

  it('quotes multi-word scope values', () => {
    expect(
      compileAdvancedQuery({
        keywords: '',
        title: 'annual message',
        recipient: '',
        tag: '',
        collection: 'Library of Congress',
        year: '',
      }),
    ).toBe('title:"annual message" collection:"Library of Congress"');
  });

  it('emits a date scope only for a 4-digit year', () => {
    expect(
      compileAdvancedQuery({
        keywords: '',
        title: '',
        recipient: '',
        tag: '',
        collection: '',
        year: '1905',
      }),
    ).toBe('date:1905');
    expect(
      compileAdvancedQuery({
        keywords: 'x',
        title: '',
        recipient: '',
        tag: '',
        collection: '',
        year: '19',
      }),
    ).toBe('x');
  });
});
