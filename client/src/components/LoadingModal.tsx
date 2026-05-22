import clsx from 'clsx';

interface LoadingModalProps {
  message: string;
  subtle?: boolean;
}

export function LoadingModal({ message, subtle = false }: LoadingModalProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
      className={clsx(
        'flex items-center justify-center text-center',
        subtle ? 'min-h-[12rem] p-4' : 'min-h-[18rem] py-12',
      )}
    >
      <div
        className={clsx(
          'inline-flex max-w-sm items-center gap-3 rounded-lg border border-ink-700/10 bg-parchment-50/90 px-5 py-4 text-ink-900 shadow-lg shadow-ink-900/5 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-800/90 dark:text-parchment-50',
          subtle && 'shadow-sm',
        )}
      >
        <span
          data-testid="loading-spinner"
          aria-hidden="true"
          className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent-500/25 border-t-accent-500"
        />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}
