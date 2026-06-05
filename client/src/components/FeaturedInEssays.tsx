import { Link } from 'react-router-dom';

import { essaysReferencing } from '../content/essays/registry';

/** Sidebar block listing essays that reference the current document. */
export function FeaturedInEssays({ documentId }: { documentId: string }) {
  const essays = essaysReferencing(documentId);
  if (essays.length === 0) return null;

  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
        Featured in essays
      </h2>
      <ul className="mt-3 grid gap-2">
        {essays.map((essay) => (
          <li key={essay.id}>
            <Link to={`/essays/${essay.id}`} className="text-accent-500 hover:underline">
              {essay.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
