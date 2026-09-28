import './styles/app.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './components/ui/toast';
import { onUnauthorized, setCsrfToken } from './lib/api-client';
import { keys } from './lib/queries';
import { initialTheme } from './lib/ui-state';
import { createAppQueryClient, createAppRouter } from './router';

document.documentElement.classList.toggle('dark', initialTheme() === 'dark');

const queryClient = createAppQueryClient();
const router = createAppRouter(queryClient);

// Any 401 means the session is gone: forget it and go to the login page, coming back afterwards.
onUnauthorized(() => {
  setCsrfToken(null);
  queryClient.setQueryData(keys.session, null);
  const { pathname, searchStr } = router.state.location;
  if (pathname !== '/login') {
    void router.navigate({ to: '/login', search: { redirect: `${pathname}${searchStr}` } });
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
