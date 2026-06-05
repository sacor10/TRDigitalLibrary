import path from 'node:path';

import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // MDX must run before the React plugin so emitted JSX is transformed.
    // remark-mdx-frontmatter exposes YAML frontmatter as a `frontmatter` export.
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }]],
      }),
    },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          facsimile: ['openseadragon', 'react-zoom-pan-pinch'],
          network: ['cytoscape', 'react-cytoscapejs'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@tr/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
});
