import type { ReactNode } from 'react';

import { BottomSheet } from './BottomSheet';

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  /** Result count shown on the apply button, when known. */
  resultCount?: number | undefined;
  children: ReactNode;
}

/** Bottom sheet wrapping a page's filter controls, with Clear/Apply in the thumb zone. */
export function FilterSheet({ open, onClose, onClear, resultCount, children }: FilterSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex items-center gap-3">
          <button type="button" className="btn tap flex-1" onClick={onClear}>
            Clear all
          </button>
          <button type="button" className="btn btn-primary tap flex-1" onClick={onClose}>
            {typeof resultCount === 'number' ? `Show ${resultCount} results` : 'Done'}
          </button>
        </div>
      }
    >
      {children}
    </BottomSheet>
  );
}
