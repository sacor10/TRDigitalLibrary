import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
import { BrowsePage } from './pages/BrowsePage';
import { DocumentPage } from './pages/DocumentPage';
import { HomePage } from './pages/HomePage';
import { NetworkPage } from './pages/NetworkPage';
import { SearchPage } from './pages/SearchPage';
import { TimelinePage } from './pages/TimelinePage';
import { TopicsPage } from './pages/TopicsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/topics" element={<TopicsPage />} />
            <Route path="/topics/:id" element={<TopicsPage />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route
              path="*"
              element={<p className="text-center py-16">Page not found.</p>}
            />
          </Routes>
        </Layout>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
