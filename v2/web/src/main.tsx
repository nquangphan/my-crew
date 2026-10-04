import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRuntime, RuntimeContext } from './app-runtime.ts';
import { createAppRouter } from './router.tsx';
import './styles.css';

function mountApp(mount: HTMLElement) {
  const runtime = createAppRuntime({ storage: window.sessionStorage, window });
  const router = createAppRouter(runtime);
  createRoot(mount).render(
    <StrictMode>
      <RuntimeContext.Provider value={runtime}>
        <QueryClientProvider client={runtime.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </RuntimeContext.Provider>
    </StrictMode>,
  );
}

const mount = document.getElementById('app');
if (!mount) throw new Error('WEB_MOUNT_MISSING');
mountApp(mount);
