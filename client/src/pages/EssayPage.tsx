import { useQuery } from '@tanstack/react-query';
import type { Document } from '@tr/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchDocument } from '../api/client';
import { LoadingModal } from '../components/LoadingModal';
import { mdxComponents } from '../components/mdxComponents';
import { getEssay, type MdxComponent } from '../content/essays/registry';

export function EssayPage() {
  const { id } = useParams<{ id: string }>();
  const entry = id ? getEssay(id) : undefined;
  const [Body, setBody] = useState<MdxComponent | null>(null);

  useEffect(() => {
    let active = true;
    setBody(null);
    if (entry) {
      void entry.load().then((component) => {
        if (active) setBody(() => component);
      });
    }
    return () => {
      active = false;
    };
  }, [entry]);

  const relatedIds = entry?.meta.relatedDocumentIds ?? [];
  const relatedQuery = useQuery({
    queryKey: ['essay-related', id, relatedIds],
    enabled: relatedIds.length > 0,
    queryFn: async (): Promise<Document[]> => {
      const settled = await Promise.allSettled(relatedIds.map((docId) => fetchDocument(docId)));
      return settled
        .filter((r): r is PromiseFulfilledResult<Document> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
  });

  if (!entry) {
    return (
      <div>
        <p className="text-ink-700 dark:text-parchment-100">Essay not found.</p>
        <Link to="/essays" className="mt-3 inline-block text-accent-500 hover:underline">
          ← Back to essays
        </Link>
      </div>
    );
  }

  const { meta } = entry;

  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/essays" className="text-sm text-accent-500 hover:underline">
        ← Essays
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">{meta.title}</h1>
        <p className="mt-2 text-sm text-ink-700/80 dark:text-parchment-100/70">
          {meta.author}
          {meta.date ? ` · ${meta.date}` : ''}
        </p>
      </header>

      {Body ? <Body components={mdxComponents} /> : <LoadingModal message="Loading essay..." />}

      {relatedQuery.data && relatedQuery.data.length > 0 && (
        <section className="mt-10 border-t border-ink-700/10 pt-6 dark:border-parchment-50/10">
          <h2 className="text-lg font-semibold">Referenced documents</h2>
          <ul className="mt-3 grid gap-2">
            {relatedQuery.data.map((doc) => (
              <li key={doc.id}>
                <Link
                  to={`/documents/${doc.id}`}
                  className="card block transition-shadow hover:shadow-md"
                >
                  <span className="font-medium">{doc.title}</span>
                  <span className="ml-2 text-sm text-ink-700/70 dark:text-parchment-100/60">
                    {doc.date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
