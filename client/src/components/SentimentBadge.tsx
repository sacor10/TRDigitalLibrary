import type { DocumentSentiment } from '@tr/shared';

const LABEL_STYLES: Record<DocumentSentiment['label'], string> = {
  positive:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  neutral:
    'bg-ink-700/10 text-ink-700 dark:text-parchment-100 border-ink-700/20 dark:border-parchment-50/15',
  negative:
    'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};

export function SentimentBadge({ sentiment }: { sentiment: DocumentSentiment }) {
  const polarity = sentiment.polarity >= 0 ? `+${sentiment.polarity.toFixed(2)}` : sentiment.polarity.toFixed(2);
  return (
    <span
      className={`inline-flex items-baseline gap-1 px-2 py-0.5 rounded-sm border text-xs ${LABEL_STYLES[sentiment.label]}`}
      title={`VADER ${sentiment.label} (${sentiment.sentenceCount} sentences) — model ${sentiment.modelVersion}`}
    >
      <span className="capitalize font-medium">{sentiment.label}</span>
      <span className="tabular-nums opacity-80">{polarity}</span>
    </span>
  );
}
