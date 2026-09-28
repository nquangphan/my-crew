import { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { AppShell } from './layout/app-shell';
import { ApiRequestError, setCsrfToken } from './lib/api-client';
import { sessionQuery } from './lib/queries';
import { BoardSearch, DocsSearch, ListSearch, LoginSearch, searchOf } from './lib/search-params';
import { BoardPage } from './routes/board';
import { DocsPage } from './routes/docs';
import { HomeRedirect } from './routes/home';
import { InboxPage } from './routes/inbox';
import { ListPage } from './routes/list';
import { LoginPage } from './routes/login';
import { MachinesPage } from './routes/machines';
import { MyRequestsPage } from './routes/my-requests';
import { ProjectSettingsPage } from './routes/project-settings';
import { ProjectsPage } from './routes/projects';
import { TicketDetailPage } from './routes/ticket-detail';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Không tìm thấy trang</h1>
      <Link to="/" className="mt-2 inline-block">
        Về trang chủ
      </Link>
    </div>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: searchOf(LoginSearch),
  component: LoginView,
});

/** Every page except login requires an owner session (401 → login, then back). */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
    setCsrfToken(session.csrfToken);
    return { session };
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomeRedirect });
const requestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/requests',
  validateSearch: searchOf(BoardSearch),
  component: RequestsView,
});
const boardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectKey/board',
  validateSearch: searchOf(BoardSearch),
  component: BoardView,
});
const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectKey/list',
  validateSearch: searchOf(ListSearch),
  component: ListView,
});
/** Slot for the Confluence-like docs space (built in the docs phase). */
export const docsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectKey/docs',
  validateSearch: searchOf(DocsSearch),
  component: DocsView,
});
const projectSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectKey/settings',
  component: ProjectSettingsView,
});
const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: ProjectsPage,
});
const ticketRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tickets/$ticketKey',
  component: TicketView,
});
const inboxRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox', component: InboxPage });
const machinesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/machines',
  component: MachinesPage,
});

// Route views bind URL params and search to the page props (explicit return types break the inference cycle).
function LoginView(): ReactElement {
  return <LoginPage redirectTo={loginRoute.useSearch().redirect} />;
}
function RequestsView(): ReactElement {
  return <MyRequestsPage search={requestsRoute.useSearch()} />;
}
function BoardView(): ReactElement {
  return <BoardPage projectKey={boardRoute.useParams().projectKey} search={boardRoute.useSearch()} />;
}
function ListView(): ReactElement {
  return <ListPage projectKey={listRoute.useParams().projectKey} search={listRoute.useSearch()} />;
}
function DocsView(): ReactElement {
  return <DocsPage projectKey={docsRoute.useParams().projectKey} search={docsRoute.useSearch()} />;
}
function ProjectSettingsView(): ReactElement {
  return <ProjectSettingsPage projectKey={projectSettingsRoute.useParams().projectKey} />;
}
function TicketView(): ReactElement {
  return <TicketDetailPage ticketKey={ticketRoute.useParams().ticketKey} />;
}

export const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    homeRoute,
    requestsRoute,
    boardRoute,
    listRoute,
    docsRoute,
    projectSettingsRoute,
    projectsRoute,
    ticketRoute,
    inboxRoute,
    machinesRoute,
  ]),
]);

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) =>
          count < 2 && !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500),
      },
    },
  });
}

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
