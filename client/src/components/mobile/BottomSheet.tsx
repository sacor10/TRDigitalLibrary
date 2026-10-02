import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Pinned footer (e.g. Apply / Clear all) kept in the thumb zone. */
  footer?: ReactNode;
  children: ReactNode;
  /** Caps the panel height; content scrolls within. Default 85vh. */
  maxHeight?: string;
}

const DISMISS_THRESHOLD = 80; // px dragged down before we close

/**
 * Reusable mobile bottom sheet: backdrop, slide-up, scroll lock, focus trap,
 * Esc-to-close, drag-down-to-dismiss, rounded top + drag handle, safe-area pad.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  footer,
  children,
  maxHeight = '85vh',
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to close + focus trap within the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Move initial focus into the panel.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const onHandlePointerDown = (e: ReactPointerEvent): void => {
    dragStart.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: ReactPointerEvent): void => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  };
  const onHandlePointerUp = useCallback(() => {
    if (dragStart.current === null) return;
    if (dragY > DISMISS_THRESHOLD) onClose();
    dragStart.current = null;
    setDragY(0);
  }, [dragY, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="animate-sheet-fade absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{ maxHeight, transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className="animate-sheet-up safe-bottom relative flex flex-col overflow-hidden rounded-t-2xl border border-ink-700/10 bg-parchment-50 shadow-2xl outline-none dark:border-parchment-50/10 dark:bg-ink-900"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <span className="h-1.5 w-10 rounded-full bg-ink-700/25 dark:bg-parchment-50/25" />
        </div>
        {title && (
          <div className="shrink-0 px-5 pb-2 text-lg font-semibold">{title}</div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-ink-700/10 bg-parchment-50 px-5 py-3 dark:border-parchment-50/10 dark:bg-ink-900">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
