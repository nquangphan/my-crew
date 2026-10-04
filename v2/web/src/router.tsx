import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useRouter,
  useSearch,
} from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import {
  type AppRuntime,
  authorizeRoute,
  parseDocsSearch,
  parseLoginSearch,
  parseTicketsSearch,
  useRuntime,
} from './app-runtime.ts';
import { LoginScreen } from './auth/login.tsx';
import { SessionBoundary } from './auth/session-boundary.tsx';
import { ComposeServicesProvider } from './compose/composer.tsx';
import { ProjectDocsPage } from './docs-route.tsx';
import { parseMapSearch } from './graph/state.ts';
import { safeReturnPath } from './lib/session.ts';
import { MachineOnboarding } from './machines/onboarding.tsx';
import { ProjectSetup } from './projects/setup.tsx';
import { EmptyPanel, ErrorPanel, LoadingPanel, Shell } from './shell.tsx';
import { ProjectTicketsPage, TicketPage } from './ticket-routes.tsx';
import { TicketDraftStorageProvider } from './tickets/create-request.tsx';

function GuestHome() {
  return (
    <section className="page-stack" aria-labelledby="guest-heading">
      <div className="page-intro">
        <span className="eyebrow">Bản minh họa</span>
        <h1 id="guest-heading">Không gian làm việc</h1>
        <p>Điều hướng dự án và các trạng thái giao diện của Crew v2.</p>
      </div>
      <section className="panel-grid" aria-label="Các trạng thái giao diện">
        <LoadingPanel />
        <ErrorPanel />
        <EmptyPanel />
      </section>
    </section>
  );
}

function ProjectHome() {
  return (
    <section className="page-stack" aria-labelledby="project-heading">
      <div className="page-intro">
        <span className="eyebrow">Bản minh họa</span>
        <h1 id="project-heading">Dự án</h1>
        <p>Thông tin dự án sẽ xuất hiện sau khi đăng nhập.</p>
      </div>
      <EmptyPanel />
    </section>
  );
}

function ProtectedLayout() {
  const { session, pending, client, composeServices } = useRuntime();
  return (
    <SessionBoundary session={session} pending={pending} client={client}>
      <ComposeServicesProvider services={composeServices}>
        <TicketDraftStorageProvider storage={composeServices.storage}>
          <Outlet />
        </TicketDraftStorageProvider>
      </ComposeServicesProvider>
    </SessionBoundary>
  );
}

function LoginRoute() {
  const { session } = useRuntime();
  const router = useRouter();
  const { returnTo } = useSearch({ from: '/login' });
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
  );
  const authenticated = snapshot.state === 'authenticated';
  useEffect(() => {
    void session.bootstrap();
  }, [session]);
  useEffect(() => {
    if (authenticated) router.history.replace(safeReturnPath(returnTo));
  }, [authenticated, returnTo, router]);
  if (authenticated || snapshot.state === 'bootstrapping') return <LoadingPanel />;
  return (
    <section className="page-stack" aria-labelledby="login-heading">
      <div className="page-intro">
        <h1 id="login-heading">Đăng nhập</h1>
      </div>
      <LoginScreen
        session={session}
        mode={snapshot.state === 'expired' ? 'reauth' : 'login'}
        returnTo={returnTo}
        onAuthenticated={(path) => router.history.push(path)}
      />
    </section>
  );
}

export function createAppRouter(runtime: AppRuntime) {
  const rootRoute = createRootRoute({ component: Shell });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    validateSearch: parseLoginSearch,
    component: LoginRoute,
  });
  const protectedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'protected',
    beforeLoad: async ({ location }) => {
      const access = await authorizeRoute(runtime.session, location);
      if (!access.allowed) throw redirect({ to: '/login', search: { returnTo: access.returnTo } });
    },
    component: ProtectedLayout,
  });
  const homeRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/', component: GuestHome });
  const projectRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/projects/$projectId',
    component: ProjectHome,
  });
  const projectTicketsRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/projects/$projectId/tickets',
    validateSearch: parseTicketsSearch,
    component: ProjectTicketsPage,
  });
  // ReactFlow is only needed by the map routes; their entry (with its stylesheet) is a separate chunk.
  const mapEntry = () => import('./graph/ticket-map-route.tsx');
  const requestMapRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/requests/$rootId/map',
    validateSearch: (search: Record<string, unknown>) => {
      const { ticket } = parseMapSearch(search);
      return ticket ? { ticket } : {};
    },
    component: lazyRouteComponent(mapEntry, 'RequestMapPage'),
  });
  // Earlier links used `/projects/<id>/map?root=<uuid>`: those redirect to the request route; without a root
  // the page is the project's request picker.
  const projectMapRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/projects/$projectId/map',
    validateSearch: parseMapSearch,
    beforeLoad: ({ search }) => {
      if (search.root)
        throw redirect({
          to: '/requests/$rootId/map',
          params: { rootId: search.root },
          search: search.ticket ? { ticket: search.ticket } : {},
          replace: true,
        });
    },
    component: lazyRouteComponent(mapEntry, 'ProjectMapPickerPage'),
  });
  const projectDocsRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/projects/$projectId/docs',
    validateSearch: parseDocsSearch,
    component: ProjectDocsPage,
  });
  const machinesRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/machines',
    component: MachineOnboarding,
  });
  const projectSetupRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/setup/projects',
    component: ProjectSetup,
  });
  const ticketRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/tickets/$ticketId',
    component: TicketPage,
  });
  const routeTree = rootRoute.addChildren([
    loginRoute,
    protectedRoute.addChildren([
      homeRoute,
      machinesRoute,
      projectSetupRoute,
      projectRoute,
      projectTicketsRoute,
      projectMapRoute,
      requestMapRoute,
      projectDocsRoute,
      ticketRoute,
    ]),
  ]);
  return createRouter({ routeTree, basepath: '/crew-v2/' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
