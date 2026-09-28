import {
  type AppInfo,
  type DaemonRuntime,
  type DaemonStatusView,
  DesktopRoute,
  type Navigate,
} from '@crew/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Lozenge, type Tone } from './components/ui';
import { errorText } from './lib/format';
import { invoke, useDesktopEvent } from './lib/ipc';
import { HealthPage } from './routes/health';
import { JobsPage } from './routes/jobs';
import { LogsPage } from './routes/logs';
import { SettingsPage } from './routes/settings';
import { SettingsProjectsPage } from './routes/settings-projects';
import { SetupWizard } from './routes/setup-wizard';

/** `#/settings-projects?project=WEB` ⇄ `{route, projectKey}`. */
export function parseHash(hash: string): Navigate {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const route = DesktopRoute.safeParse(path);
  const params = new URLSearchParams(query);
  return {
    route: route.success ? route.data : 'health',
    ...(params.get('section') ? { section: params.get('section') as string } : {}),
    ...(params.get('project') ? { projectKey: params.get('project') as string } : {}),
  };
}

export function toHash(to: Navigate): string {
  const params = new URLSearchParams();
  if (to.section) params.set('section', to.section);
  if (to.projectKey) params.set('project', to.projectKey);
  const query = params.toString();
  return `#/${to.route}${query ? `?${query}` : ''}`;
}

const NAV: { route: DesktopRoute; label: string }[] = [
  { route: 'health', label: 'Sức khỏe' },
  { route: 'jobs', label: 'Job' },
  { route: 'logs', label: 'Nhật ký' },
  { route: 'settings-projects', label: 'Project' },
  { route: 'settings', label: 'Cài đặt' },
];

function daemonBadge(runtime: DaemonRuntime, status: DaemonStatusView | null): { text: string; tone: Tone } {
  if (runtime.state !== 'running') {
    return {
      text:
        runtime.state === 'crashed' || runtime.state === 'restarting'
          ? 'Daemon đang khởi động lại'
          : 'Daemon đang khởi động',
      tone: 'warn',
    };
  }
  if (!status?.running) return { text: 'Daemon chưa chạy', tone: 'gray' };
  if (status.paused) return { text: 'Tạm dừng nhận việc', tone: 'warn' };
  return status.connected
    ? { text: 'Đang nhận việc', tone: 'ok' }
    : { text: 'Mất kết nối server', tone: 'bad' };
}

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
            <button type="button" className="btn text-xs" onClick={() => navigate({ route: 'health' })}>
              Đóng trình cài đặt
            </button>
          )}
        </header>
        <SetupWizard
          info={info}
          {...(location.section ? { section: location.section } : {})}
          onFinished={(next) => {
            setInfo(next);
            navigate({ route: 'health' });
          }}
        />
      </div>
    );
  }

  const badge = daemonBadge(runtime, status);
  const paused = status?.paused ?? false;
  const togglePause = async () => {
    try {
      setStatus(await invoke(paused ? 'daemon.resume' : 'daemon.pause', {}));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <div className="px-5 py-4">
          <div className="text-base font-semibold">2P Crew</div>
          <div className="text-xs text-muted">{info.machineName ?? 'máy chưa đặt tên'}</div>
        </div>
        <ul className="flex-1 space-y-0.5 px-2">
          {NAV.map((item) => (
            <li key={item.route}>
              <button
                type="button"
                className={`w-full rounded px-3 py-2 text-left text-sm ${location.route === item.route ? 'bg-accent-bg font-semibold text-accent-ink' : 'hover:bg-soft'}`}
                onClick={() => navigate({ route: item.route })}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t border-line p-4 text-xs">
          <Lozenge tone={badge.tone}>{badge.text}</Lozenge>
          <div className="text-muted">
            {status
              ? `${status.jobs.running} đang chạy · ${status.jobs.queued} chờ · ${status.jobs.backoff} chờ thử lại`
              : '—'}
          </div>
          <button
            type="button"
            className="btn w-full justify-center"
            disabled={!status?.running}
            onClick={() => void togglePause()}
          >
            {paused ? 'Tiếp tục nhận việc' : 'Tạm dừng nhận việc'}
          </button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        {error && (
          <div className="p-4">
            <ErrorBox message={error} />
          </div>
        )}
        {location.route === 'health' && <HealthPage navigate={navigate} />}
        {location.route === 'jobs' && <JobsPage />}
        {location.route === 'logs' && <LogsPage />}
        {location.route === 'settings' && (
          <SettingsPage
            info={info}
            {...(location.section ? { section: location.section } : {})}
            navigate={navigate}
            onInfoChange={() => void refreshInfo()}
          />
        )}
        {location.route === 'settings-projects' && (
          <SettingsProjectsPage {...(location.projectKey ? { initialKey: location.projectKey } : {})} />
        )}
      </main>
    </div>
  );
}
