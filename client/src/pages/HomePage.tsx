import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div className="max-w-none">
      <section className="py-8 text-center sm:py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          The works and correspondence of Theodore Roosevelt
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-ink-700 dark:text-parchment-100">
          A scholarly, accessible, open archive of TR’s speeches, letters, diaries, and books —
          searchable end-to-end and linked back to its public-domain sources.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          <Link to="/browse" className="btn btn-primary">
            Browse the collection
          </Link>
          <Link to="/search" className="btn">
            Full-text search
          </Link>
          <Link to="/timeline" className="btn">
            Timeline
          </Link>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="card">
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-ink-700 dark:text-parchment-100 mt-2">
            Speeches, letters, diary entries, articles, and autobiography excerpts — each with
            metadata, provenance, and a link to its public-domain source.
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold">Search</h2>
          <p className="text-sm text-ink-700 dark:text-parchment-100 mt-2">
            SQLite FTS5 over transcriptions and titles. Filter by type, date, and recipient.
            Production will swap in Meilisearch and semantic search.
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold">Open</h2>
          <p className="text-sm text-ink-700 dark:text-parchment-100 mt-2">
            Code is MIT. Content is public-domain TR text imported from Library of Congress records —
            never re-bundled, always linkable to the canonical record.
          </p>
        </div>
      </section>
    </div>
  );
}
