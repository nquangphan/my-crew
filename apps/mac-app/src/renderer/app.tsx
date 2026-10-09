import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { PageHeader } from './components/ui';
import { invoke } from './lib/ipc';
import { HealthScreen } from './routes/health';
import { LogsScreen } from './routes/logs';
import { ProjectsScreen } from './routes/projects';
import { RunsScreen } from './routes/runs';
import { SetupScreen } from './routes/setup';

export interface RouteDef {
  id: string;
  label: string;
  render: () => ReactNode;
}

function Soon({ title, ticket }: { title: string; ticket: string }) {
  return <PageHeader title={title} subtitle={`Màn hình này được thêm ở ticket ${ticket}.`} />;
}

/**
 * Danh sách màn hình của thanh bên. Mỗi ticket sau thay đúng một dòng của mình bằng route thật
 * (AP-3: health/runs/logs, AP-5: setup, PJ-2: projects, UPD-1: update).
 */
export const ROUTES: RouteDef[] = [
  { id: 'health', label: 'Sức khỏe', render: () => <HealthScreen /> },
  { id: 'runs', label: 'Run đang chạy', render: () => <RunsScreen /> },
  { id: 'logs', label: 'Log', render: () => <LogsScreen /> },
  { id: 'projects', label: 'Project', render: () => <ProjectsScreen /> },
  { id: 'update', label: 'Cập nhật', render: () => <Soon title="Cập nhật" ticket="UPD-1" /> },
  { id: 'setup', label: 'Cài đặt', render: () => <SetupScreen /> },
];

/** `#/health` → `health`; hash lạ về màn hình đầu. */
export function routeFromHash(hash: string): string {
  const id = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return ROUTES.some((route) => route.id === id) ? id : (ROUTES[0]?.id ?? 'health');
}

export function App() {
  const [routeId, setRouteId] = useState(() => routeFromHash(window.location.hash));
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRouteId(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    invoke('app:info')
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(null));
  }, []);

  const go = useCallback((id: string) => {
    window.location.hash = `#/${id}`;
    setRouteId(id);
  }, []);
  const current = ROUTES.find((route) => route.id === routeId) ?? ROUTES[0];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Màn hình">
        <div className="brand">2P Crew</div>
        {ROUTES.map((route) => (
          <button
            key={route.id}
            type="button"
            className={route.id === routeId ? 'nav active' : 'nav'}
            aria-current={route.id === routeId ? 'page' : undefined}
            onClick={() => go(route.id)}
          >
            {route.label}
          </button>
        ))}
        <div className="version muted">{version ? `Phiên bản ${version}` : ''}</div>
      </nav>
      <main className="content">{current?.render()}</main>
    </div>
  );
}
