import type { Annotation } from '@tr/shared';

interface AnnotationsSidePanelProps {
  annotations: Annotation[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function AnnotationsSidePanel({
  annotations,
  activeId,
  onSelect,
}: AnnotationsSidePanelProps) {
  if (annotations.length === 0) {
    return (
      <aside className="card">
        <h2 className="font-semibold mb-2">Annotations</h2>
        <p className="text-sm text-ink-700/70 dark:text-parchment-50/70">
          No annotations yet. Sign in and select any passage to add a highlight or note.
        </p>
      </aside>
    );
  }
  return (
    <aside className="card">
      <h2 className="font-semibold mb-2">
        Annotations <span className="text-xs text-ink-700/70">({annotations.length})</span>
      </h2>
      <ul className="space-y-3 text-sm">
        {annotations.map((a) => {
          const exact = findExact(a);
          const note = a.body?.[0]?.value;
          const isActive = a.id === activeId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className={`w-full text-left rounded-md border p-2 transition ${
                  isActive
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-ink-700/10 dark:border-parchment-50/10 hover:bg-parchment-200/50 dark:hover:bg-ink-700'
                }`}
              >
                {exact && (
                  <p className="italic text-ink-700 dark:text-parchment-100">
                    “{truncate(exact, 80)}”
                  </p>
                )}
                {note && <p className="mt-1">{truncate(note, 120)}</p>}
                <p className="mt-1 text-xs text-ink-700/60 dark:text-parchment-50/60">
                  {a.creator.name} · {new Date(a.created).toLocaleDateString()}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function findExact(a: Annotation): string | null {
  const sel = a.target.selector;
  const flat = Array.isArray(sel) ? sel : [sel];
  for (const s of flat) {
    if (s.type === 'TextQuoteSelector') return s.exact;
    if (s.type === 'FragmentSelector' && s.refinedBy) {
      const inner = Array.isArray(s.refinedBy) ? s.refinedBy : [s.refinedBy];
      for (const r of inner) {
        if (r.type === 'TextQuoteSelector') return r.exact;
      }
    }
  }
  return null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
