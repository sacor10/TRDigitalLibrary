#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { decideSentimentAnalysis } from './sentiment-analysis-decision.mjs';

const base = {
  skipAnalysis: false,
  forceAnalysis: false,
  totalChanged: 0,
  transcribedCount: 16,
  sentimentCount: 16,
};

test('changed corpus runs analysis', () => {
  const decision = decideSentimentAnalysis({ ...base, totalChanged: 3 });
  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reason, 'corpus-changed');
});

test('no changed corpus with missing sentiment rows runs analysis', () => {
  const decision = decideSentimentAnalysis({ ...base, sentimentCount: 0 });
  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reason, 'sentiment-mismatch');
});

test('no changed corpus with complete sentiment rows skips analysis', () => {
  const decision = decideSentimentAnalysis(base);
  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, 'up-to-date');
});

test('zero transcribed documents skips analysis', () => {
  const decision = decideSentimentAnalysis({
    ...base,
    transcribedCount: 0,
    sentimentCount: 0,
  });
  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, 'no-transcribed-documents');
});

test('SKIP_ANALYSIS=1 skips analysis', () => {
  const decision = decideSentimentAnalysis({
    ...base,
    skipAnalysis: true,
    totalChanged: 3,
    sentimentCount: 0,
  });
  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, 'skip-analysis');
});

test('FORCE_ANALYSIS=1 runs analysis when documents exist', () => {
  const decision = decideSentimentAnalysis({ ...base, forceAnalysis: true });
  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reason, 'forced');
});
