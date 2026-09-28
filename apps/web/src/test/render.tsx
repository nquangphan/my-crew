import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ToastProvider } from '../components/ui/toast';

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * Renders a component inside the providers the app uses (TanStack Query, the toaster and a memory router,
 * so `Link` works). Every path renders the same element.
 */
export function renderWithApp(ui: ReactElement, queryClient = testQueryClient()) {
  const rootRoute = createRootRoute({ component: Outlet });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => ui });
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, catchAll]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}

export interface MockCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: MockCall) => { status?: number; body?: unknown } | undefined;

/**
 * Stubs `fetch` with a list of `[METHOD path-prefix, handler]` routes; unmatched requests get 404. Returns
 * the recorded calls.
 */
export function mockFetch(routes: [string, Handler][]): MockCall[] {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const path = String(input);
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method, path, headers, body };
      calls.push(call);
      for (const [pattern, handler] of routes) {
        const [m, prefix] = pattern.split(' ');
        if (m === method && prefix && path.startsWith(prefix)) {
          const result = handler(call) ?? {};
          const status = result.status ?? 200;
          const text = result.body === undefined ? '' : JSON.stringify(result.body);
          return new Response(status === 204 ? null : text, { status });
        }
      }
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not mocked' } }), {
        status: 404,
      });
    }),
  );
  return calls;
}
