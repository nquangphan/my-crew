import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './router.tsx';
import './styles.css';

function mountApp(mount: HTMLElement) {
  const queryClient = new QueryClient();
  const router = createAppRouter();
  createRoot(mount).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

const mount = document.getElementById('app');
if (!mount) throw new Error('WEB_MOUNT_MISSING');
mountApp(mount);
