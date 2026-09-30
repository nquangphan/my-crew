import {
  type AppInfo,
  type DaemonRuntime,
  type DaemonStatusView,
  DesktopRoute,
  type Navigate,
} from '@crew/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox } from './components/ui';
import { errorText } from './lib/format';
import { invoke, useDesktopEvent } from './lib/ipc';
import { SetupWizard } from './routes/setup-wizard';
import { StatusPage } from './routes/status';

/** `#/setup?section=pairing` ⇄ `{route, section}`. Any other hash opens the status view. */
export function parseHash(hash: string): Navigate {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const route = DesktopRoute.safeParse(path);
  const params = new URLSearchParams(query);
  return {
    route: route.success ? route.data : 'status',
    ...(params.get('section') ? { section: params.get('section') as string } : {}),
  };
}

export function toHash(to: Navigate): string {
  const params = new URLSearchParams();
  if (to.section) params.set('section', to.section);
  const query = params.toString();
  return `#/${to.route}${query ? `?${query}` : ''}`;
}

/**
 * The app window: the setup wizard until the machine is set up (or when opened again), then the status view.
 * Everything else (settings, projects, health fixes, jobs, logs) is on the web.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [location, setLocation] = useState<Navigate>(() => parseHash(window.location.hash));
  const [status, setStatus] = useState<DaemonStatusView | null>(null);
  const [runtime, setRuntime] = useState<DaemonRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshInfo = useCallback(async () => {
    try {
      const loaded = await invoke('app.info', {});
      setInfo(loaded);
      setStatus(loaded.status);
      setRuntime(loaded.daemon);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  const navigate = useCallback((to: Navigate) => {
    window.location.hash = toHash(to);
    setLocation(to);
  }, []);

  useEffect(() => {
    void refreshInfo();
    const onHash = () => setLocation(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [refreshInfo]);

  useDesktopEvent('app.navigate', navigate);
  useDesktopEvent('daemon.status', setStatus);
  useDesktopEvent('daemon.runtime', setRuntime);

  if (!info || !runtime) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {error ? <ErrorBox message={error} /> : 'Đang mở 2P Crew…'}
      </div>
    );
  }

  const showWizard = !info.setupComplete || location.route === 'setup';
  if (showWizard) {
    return (
      <div className="h-full overflow-auto">
        <header className="flex items-center justify-between border-b border-line bg-panel px-6 py-3">
          <span className="font-semibold">2P Crew · Cài đặt máy</span>
          {info.setupComplete && (
            <button type="button" className="btn text-xs" onClick={() => navigate({ route: 'status' })}>
              Đóng trình cài đặt
            </button>
          )}
        </header>
        <SetupWizard
          info={info}
          {...(location.section ? { section: location.section } : {})}
          onFinished={(next) => {
            setInfo(next);
            navigate({ route: 'status' });
          }}
        />
      </div>
    );
  }

  return (
    <main className="h-full overflow-auto">
      {error && (
        <div className="p-4">
          <ErrorBox message={error} />
        </div>
      )}
      <StatusPage
        info={info}
        status={status}
        runtime={runtime}
        navigate={navigate}
        onInfoChange={() => void refreshInfo()}
      />
    </main>
  );
}
