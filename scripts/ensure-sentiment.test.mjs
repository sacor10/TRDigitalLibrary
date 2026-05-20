#!/usr/bin/env node
// Parity check between vader-sentiment (JS) and the canonical Python VADER
// numbers from the project's README and the upstream demos. If a vader-sentiment
// upgrade ever drifts, this test makes it loud.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreDocument } from './ensure-sentiment.mjs';

const require = createRequire(import.meta.url);
const { SentimentIntensityAnalyzer } = require('vader-sentiment');

// Single-sentence cases: char-length-weighted aggregation collapses to the
// per-sentence compound for one sentence, so these scores must match
// upstream VADER demo strings exactly.
const SAMPLES = [
  { text: 'VADER is smart, handsome, and funny.', compound: 0.8316 },
  { text: 'VADER is not smart, handsome, nor funny.', compound: -0.7424 },
  { text: 'The book was good.', compound: 0.4404 },
];

test('vader-sentiment JS matches canonical VADER compounds (1e-4)', () => {
  for (const { text, compound } of SAMPLES) {
    const scored = scoreDocument(SentimentIntensityAnalyzer, text);
    assert.ok(
      Math.abs(scored.polarity - compound) < 1e-4,
      `polarity drift for ${JSON.stringify(text)}: got ${scored.polarity}, expected ${compound}`,
    );
    assert.equal(scored.sentenceCount, 1);
  }
});

test('multi-sentence aggregation is character-length-weighted', () => {
  // Two sentences with different lengths; the doc polarity must equal the
  // explicit character-length-weighted mean (matches python/sentiment.py).
  const a = 'VADER is smart, handsome, and funny.';
  const b = 'VADER is not smart, handsome, nor funny.';
  const text = `${a}\n\n${b}`;
  const scored = scoreDocument(SentimentIntensityAnalyzer, text);
  const aPol = SentimentIntensityAnalyzer.polarity_scores(a).compound;
  const bPol = SentimentIntensityAnalyzer.polarity_scores(b).compound;
  const expected = (aPol * a.length + bPol * b.length) / (a.length + b.length);
  assert.ok(
    Math.abs(scored.polarity - expected) < 1e-4,
    `doc polarity ${scored.polarity} did not equal char-weighted mean ${expected}`,
  );
  assert.equal(scored.sentenceCount, 2);
});
