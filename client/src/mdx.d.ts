declare module '*.mdx' {
  import type { ComponentType } from 'react';

  /** Raw frontmatter exported by remark-mdx-frontmatter (validated at runtime). */
  export const frontmatter: Record<string, unknown>;

  /** The compiled MDX content component (accepts a `components` override map). */
  const MDXComponent: ComponentType<{ components?: Record<string, unknown> }>;
  export default MDXComponent;
}
