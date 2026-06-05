import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoadingModal } from './components/LoadingModal';
import { ThemeProvider } from './context/ThemeContext';

const AnnotationPage = lazy(() => import('./pages/AnnotationPage').then((m) => ({ default: m.AnnotationPage })));
const BrowsePage = lazy(() => import('./pages/BrowsePage').then((m) => ({ default: m.BrowsePage })));
const DocumentPage = lazy(() => import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const NetworkPage = lazy(() => import('./pages/NetworkPage').then((m) => ({ default: m.NetworkPage })));
const PeriodsPage = lazy(() => import('./pages/PeriodsPage').then((m) => ({ default: m.PeriodsPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const SentimentPage = lazy(() => import('./pages/SentimentPage').then((m) => ({ default: m.SentimentPage })));
const TimelinePage = lazy(() => import('./pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const TopicsPage = lazy(() => import('./pages/TopicsPage').then((m) => ({ default: m.TopicsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Layout>
            <Suspense fallback={<LoadingModal message="Loading page..." />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/browse" element={<BrowsePage />} />
                <Route path="/periods" element={<PeriodsPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/timeline" element={<TimelinePage />} />
                <Route path="/network" element={<NetworkPage />} />
                <Route path="/topics" element={<TopicsPage />} />
                <Route path="/topics/:id" element={<TopicsPage />} />
                <Route path="/sentiment" element={<SentimentPage />} />
                <Route path="/documents/:id" element={<DocumentPage />} />
                <Route path="/annotations/:id" element={<AnnotationPage />} />
                <Route
                  path="*"
                  element={<p className="text-center py-16">Page not found.</p>}
                />
              </Routes>
            </Suspense>
          </Layout>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
