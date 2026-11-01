import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as RTooltip from '@radix-ui/react-tooltip';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { Spinner } from './components/ui';
import { useIsDark } from './lib/theme';
import { useMe } from './lib/queries';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvitePage } from './pages/InvitePage';
import { NotFoundPage } from './pages/NotFoundPage';

const EditorPage = lazy(() => import('./editor/EditorPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
});

export const FullPageSpinner = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner />
  </div>
);

/** Redirects to sign-in (remembering where to come back to) when there is no session. */
function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <FullPageSpinner />;
  if (!me.data)
    return (
      <Navigate
        to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return <>{children}</>;
}

function Toasts() {
  const dark = useIsDark();
  return (
    <Toaster position="bottom-center" theme={dark ? 'dark' : 'light'} richColors closeButton />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RTooltip.Provider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/invite/:token"
              element={
                <RequireAuth>
                  <InvitePage />
                </RequireAuth>
              }
            />
            <Route
              path="/p/:projectId"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner />}>
                    <EditorPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
        <Toasts />
      </RTooltip.Provider>
    </QueryClientProvider>
  );
}
