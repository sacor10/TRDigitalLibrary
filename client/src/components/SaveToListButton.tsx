import { useState } from 'react';

import { useAuth } from '../auth/AuthContext';

import { SaveToListBody } from './SaveToListBody';

/**
 * "Save to list" control on the document page (desktop sidebar). Visible only
 * when signed in. On mobile the document page uses a sticky action bar + sheet
 * that reuses {@link SaveToListBody} instead.
 */
export function SaveToListButton({ documentId }: { documentId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <section className="card">
      <button
        type="button"
        className="btn w-full"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? 'Close' : 'Save to a list'}
      </button>

      {open && (
        <div className="mt-3">
          <SaveToListBody documentId={documentId} />
        </div>
      )}
    </section>
  );
}
