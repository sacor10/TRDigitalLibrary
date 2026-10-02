import { CURATED_SEARCHES } from '@tr/shared';
import { Link } from 'react-router-dom';

/** Curator-picked "featured" searches surfaced on the homepage. */
export function CuratedSearches() {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">Curated explorations</h2>
      <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
        Start from a theme hand-picked from across the collection.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CURATED_SEARCHES.map((search) => (
          <li key={search.id}>
            <Link
              to={`/search?q=${encodeURIComponent(search.query)}`}
              className="card block h-full transition-shadow hover:shadow-md"
            >
              <h3 className="font-medium leading-tight">{search.title}</h3>
              <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
                {search.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
