export function decideSentimentAnalysis({
  skipAnalysis,
  forceAnalysis,
  totalChanged,
  transcribedCount,
  sentimentCount,
}) {
  if (skipAnalysis) {
    return {
      shouldRun: false,
      reason: 'skip-analysis',
      message: 'SKIP_ANALYSIS=1; not running sentiment.',
    };
  }

  if (transcribedCount === 0) {
    return {
      shouldRun: false,
      reason: 'no-transcribed-documents',
      message: 'No transcribed documents found; skipping sentiment.',
    };
  }

  if (forceAnalysis) {
    return {
      shouldRun: true,
      reason: 'forced',
      message: 'FORCE_ANALYSIS=1; running sentiment.',
    };
  }

  if (totalChanged > 0) {
    return {
      shouldRun: true,
      reason: 'corpus-changed',
      message: `${totalChanged} corpus row(s) changed; running sentiment.`,
    };
  }

  if (sentimentCount !== transcribedCount) {
    return {
      shouldRun: true,
      reason: 'sentiment-mismatch',
      message:
        `Sentiment coverage mismatch (${sentimentCount}/${transcribedCount} ` +
        'transcribed document(s)); running sentiment backfill.',
    };
  }

  return {
    shouldRun: false,
    reason: 'up-to-date',
    message:
      `No new corpus rows and sentiment is up to date ` +
      `(${sentimentCount}/${transcribedCount}); skipping sentiment.`,
  };
}
