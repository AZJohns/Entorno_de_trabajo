/**
 * Raíz de la web: rutas, caché de consultas y reacción común a los errores de sesión de la API.
 */
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError, isApiError } from './api/client.ts';
import { Gate } from './auth/Gate.tsx';
import { forgetSession, SESSION_QUERY_KEY } from './auth/session.ts';
import { HomePage, Layout, NotFoundPage } from './pages/Layout.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ReauthPage } from './pages/ReauthPage.tsx';
import { SecondFactorPage } from './pages/SecondFactorPage.tsx';
import { SecuritySettingsPage } from './pages/SecuritySettingsPage.tsx';
import { UnlockPage } from './pages/UnlockPage.tsx';

const router = createBrowserRouter([
  {
    path: '/entrar',
    element: (
      <Gate place="anonymous">
        <LoginPage />
      </Gate>
    ),
  },
  {
    path: '/entrar/segundo-factor',
    element: (
      <Gate place="pending">
        <SecondFactorPage />
      </Gate>
    ),
  },
  {
    path: '/desbloquear',
    element: (
      <Gate place="locked">
        <UnlockPage />
      </Gate>
    ),
  },
  {
    path: '/reautenticar',
    element: (
      <Gate place="active">
        <ReauthPage />
      </Gate>
    ),
  },
  {
    path: '/',
    element: (
      <Gate place="active">
        <Layout />
      </Gate>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'ajustes/seguridad', element: <SecuritySettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/**
 * Reacción común a los errores de sesión de cualquier petición:
 * - `UNAUTHENTICATED` (sin sesión, caducada o revocada): se olvida todo y se vuelve al login.
 * - `SESSION_LOCKED` (1 h sin uso): se vuelve a pedir la sesión; la guarda lleva al desbloqueo.
 * - `REAUTH_REQUIRED`: se lleva a la reautenticación y, después, de vuelta a la pantalla actual.
 */
function handleSessionError(error: unknown): void {
  if (isApiError(error, 'UNAUTHENTICATED')) {
    forgetSession(queryClient);
  } else if (isApiError(error, 'SESSION_LOCKED')) {
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  } else if (isApiError(error, 'REAUTH_REQUIRED')) {
    const here = router.state.location.pathname;
    void router.navigate(`/reautenticar?volver=${encodeURIComponent(here)}`);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleSessionError }),
  mutationCache: new MutationCache({ onError: handleSessionError }),
  defaultOptions: {
    queries: {
      // Un error 4xx no se arregla reintentando; solo se reintentan los fallos de red y los 5xx.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
