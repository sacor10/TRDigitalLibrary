import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { fetchOnThisDay } from '../api/client';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonthDay(monthDay: string): string {
  const [mm, dd] = monthDay.split('-');
  const monthIndex = Number(mm) - 1;
  const month = MONTHS[monthIndex] ?? '';
  return `${month} ${Number(dd)}`;
}

/** Homepage widget: documents written on today's month-day across the years. */
export function OnThisDay() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['on-this-day'],
    queryFn: () => fetchOnThisDay({ limit: 6 }),
  });

  if (isLoading || error || !data || data.items.length === 0) {
    // Stay quiet on empty/error — this is a supplementary discovery surface.
    return null;
  }

  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">On this day &mdash; {formatMonthDay(data.monthDay)}</h2>
      <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
        Documents written on this date across the years.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((doc) => (
          <li key={doc.id}>
            <Link to={`/documents/${doc.id}`} className="card block h-full transition-shadow hover:shadow-md">
              <p className="text-xs text-ink-700/70 dark:text-parchment-100/60">{doc.date}</p>
              <h3 className="mt-1 font-medium leading-tight">{doc.title}</h3>
              {doc.recipient && (
                <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">To {doc.recipient}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
