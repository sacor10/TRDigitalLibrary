import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div className="max-w-none">
      <section className="text-center py-12">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          The works and correspondence of Theodore Roosevelt
        </h1>
        <p className="mt-4 max-w-2xl mx-auto text-ink-700 dark:text-parchment-100">
          A scholarly, accessible, open archive of TR’s speeches, letters, diaries, and books — searchable
          end-to-end and linked back to its public-domain sources.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
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

      <section className="grid md:grid-cols-3 gap-4 mt-8">
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
            Code is MIT. Content is public-domain TR text fetched at seed time from Wikisource —
            never re-bundled, always linkable to the canonical record.
          </p>
        </div>
      </section>
    </div>
  );
}
