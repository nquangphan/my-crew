import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { EmptyPanel, ErrorPanel, LoadingPanel, Shell } from './shell.tsx';

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

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: GuestHome });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: ProjectHome,
});
const routeTree = rootRoute.addChildren([homeRoute, projectRoute]);

export function createAppRouter() {
  return createRouter({ routeTree, basepath: '/crew-v2/' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
