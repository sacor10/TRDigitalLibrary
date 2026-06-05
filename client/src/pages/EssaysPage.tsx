import { Link } from 'react-router-dom';

import { ESSAYS } from '../content/essays/registry';

/** Lists the in-repo MDX essays / exhibits. */
export function EssaysPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Essays &amp; exhibits</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Short, sourced explorations that connect documents across the collection.
        </p>
      </header>

      {ESSAYS.length === 0 ? (
        <p className="text-ink-700 dark:text-parchment-100">No essays yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ESSAYS.map(({ meta }) => (
            <li key={meta.id}>
              <Link
                to={`/essays/${meta.id}`}
                className="card flex h-full flex-col gap-2 transition-shadow hover:shadow-md"
              >
                <h2 className="font-semibold text-lg leading-tight">{meta.title}</h2>
                <p className="text-sm text-ink-700 dark:text-parchment-100">{meta.summary}</p>
                {meta.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {meta.tags.map((t) => (
                      <span key={t} className="chip text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
