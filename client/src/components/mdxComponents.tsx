import type { ComponentProps } from 'react';

/**
 * Styling for elements rendered from MDX essays. The project doesn't ship the
 * Tailwind typography plugin, so we map the common block elements explicitly.
 */
export const mdxComponents = {
  h2: (props: ComponentProps<'h2'>) => (
    <h2 className="mt-8 text-xl font-semibold" {...props} />
  ),
  h3: (props: ComponentProps<'h3'>) => (
    <h3 className="mt-6 text-lg font-semibold" {...props} />
  ),
  p: (props: ComponentProps<'p'>) => (
    <p className="mt-4 leading-relaxed text-ink-800 dark:text-parchment-100" {...props} />
  ),
  ul: (props: ComponentProps<'ul'>) => (
    <ul className="mt-4 list-disc space-y-1 pl-6" {...props} />
  ),
  ol: (props: ComponentProps<'ol'>) => (
    <ol className="mt-4 list-decimal space-y-1 pl-6" {...props} />
  ),
  blockquote: (props: ComponentProps<'blockquote'>) => (
    <blockquote
      className="mt-4 border-l-4 border-accent-500/40 pl-4 italic text-ink-700 dark:text-parchment-100"
      {...props}
    />
  ),
  a: (props: ComponentProps<'a'>) => <a className="text-accent-500 hover:underline" {...props} />,
};
