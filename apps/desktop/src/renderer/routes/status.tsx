import type {
  AppInfo,
  DaemonRuntime,
  DaemonStatusView,
  FolderValidation,
  HealthCheckResult,
  HealthReport,
  Navigate,
  ProjectStatus,
  SettingsSource,
  StatusView,
  UpdateStatus,
} from '@crew/shared';
import { useCallback, useEffect, useState } from 'react';
import { FolderPicker } from '../components/folder-picker';
import { HealthCheckRow } from '../components/health-check-row';
import {
  ErrorBox,
  HEALTH_LABEL,
  Lozenge,
  Notice,
  PageHeader,
  StatusDot,
  Toggle,
  type Tone,
} from '../components/ui';
import { errorText, formatTime } from '../lib/format';
import { invoke, useDesktopEvent } from '../lib/ipc';

const UPDATE_TEXT: Record<UpdateStatus['state'], string> = {
  disabled: 'Bản chạy thử: không kiểm tra cập nhật.',
  idle: 'Chưa kiểm tra bản mới.',
  checking: 'Đang kiểm tra bản mới…',
  none: 'Đang dùng bản mới nhất.',
  unpublished: 'Chưa có bản phát hành nào; đang dùng bản hiện tại.',
  available: 'Có bản mới.',
  downloaded: 'Bản mới đã tải xong, sẽ cài khi không còn job chạy.',
  error: 'Không kiểm tra được bản mới.',
};

const SETTINGS_SOURCE: Record<SettingsSource, string> = {
  server: 'từ server',
  cache: 'bản lưu trên máy, server chưa trả lời',
  bundled: 'mặc định của app',
};

const OWNER_TEXT: Record<ProjectStatus['ownerState'], { text: string; tone: Tone }> = {
  mine: { text: 'của máy này', tone: 'ok' },
  unowned: { text: 'chưa có máy', tone: 'gray' },
  other: { text: 'máy khác', tone: 'warn' },
};

/**
 * What a fix button does in the app: most fixes run here (the same whitelisted fixes the web can ask for);
 * a few open another place instead.
 */
export function localFixFor(
  fixId: string,
): Navigate | 'api-key-help' | 'web-settings' | 'pick-folder' | null {
  const [action] = fixId.split(':');
  if (action === 'repair') return { route: 'setup', section: 'pairing' };
  if (action === 'repick-folder') return 'pick-folder';
  if (action === 'adjust-limits') return 'web-settings';
  if (action === 'api-key-help') return 'api-key-help';
  return null;
}

export function daemonBadge(
  runtime: DaemonRuntime,
  status: DaemonStatusView | null,
): { text: string; tone: Tone } {
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

function WebLink({ url, children }: { url: string | null; children: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={!url}
        onClick={() => {
          if (!url) return;
          invoke('app.openExternal', { url }).catch((caught) => setError(errorText(caught)));
        }}
      >
        {children}
      </button>
      {error && <ErrorBox message={error} />}
    </>
  );
}

/** One project of this machine: its folder here and the folder picker that saves it to the server. */
function ProjectRow({ project, onChanged }: { project: ProjectStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<FolderValidation | null>(null);
  const owner = OWNER_TEXT[project.ownerState];
  const pick = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      setValidation(await invoke('projects.setFolder', { key: project.key, path }));
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 px-4 py-3" data-project={project.key}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{project.key}</span>
        <span className="text-sm text-muted">{project.name}</span>
        <Lozenge tone={owner.tone}>{owner.text}</Lozenge>
        <span className="flex-1" />
        <WebLink url={project.webUrl}>Mở trên web</WebLink>
      </div>
      <FolderPicker
        value={project.localPath}
        onPick={(path) => void pick(path)}
        label={project.localPath ? 'Đổi thư mục…' : 'Chọn thư mục…'}
        disabled={busy}
      />
      {project.folderProblem && (
        <Notice tone="bad">Máy không dùng được thư mục đặt trên server: {project.folderProblem}.</Notice>
      )}
      {validation && (
        <div className="card">
          {validation.checks.map((check) => (
            <HealthCheckRow key={check.id} result={check} />
          ))}
        </div>
      )}
      {validation?.ok && (
        <Notice tone="ok">Đã lưu thư mục lên server; daemon dùng nó cho job kế tiếp.</Notice>
      )}
      <ErrorBox message={error} />
    </li>
  );
}

export interface StatusPageProps {
  info: AppInfo;
  status: DaemonStatusView | null;
  runtime: DaemonRuntime;
  navigate: (to: Navigate) => void;
  onInfoChange: () => void;
}

/**
 * The gateway: whether this machine is connected and running jobs, its health summary, the projects it holds
 * and their folders here, the macOS permission prompts waiting for an answer, links to its pages on the web
 * (where every setting and remote action lives), and the actions only this machine can do.
 */
export function StatusPage({ info, status, runtime, navigate, onInfoChange }: StatusPageProps) {
  const [view, setView] = useState<StatusView | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [update, setUpdate] = useState(info.update);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await invoke('status.view', {}));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
    void invoke('health.get', {}).then(setHealth, () => undefined);
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);
  useDesktopEvent('health.report', setHealth);
  useDesktopEvent('update.status', setUpdate);

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const badge = daemonBadge(runtime, status);
  const failing = health?.results.filter((item) => item.status !== 'green') ?? [];
  const recheck = async () => {
    setChecking(true);
    await run(async () => setHealth(await invoke('health.run', {})));
    setChecking(false);
  };
  const fix = async (result: HealthCheckResult) => {
    if (!result.fix) return;
    const target = localFixFor(result.fix.id);
    if (target === 'api-key-help') return setHelp(true);
    if (target === 'pick-folder') {
      document.querySelector('[aria-label="Dự án của máy này"]')?.scrollIntoView();
      return;
    }
    if (target === 'web-settings') {
      if (view?.links.machineSettings)
        await run(() => invoke('app.openExternal', { url: view.links.machineSettings ?? '' }));
      return;
    }
    if (target) return navigate(target);
    setFixing(result.id);
    await run(async () =>
      setHealth(await invoke('health.fix', { group: result.group, fixId: result.fix?.id ?? '' })),
    );
    setFixing(null);
    void load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-8">
      <PageHeader
        title="Trạng thái máy"
        subtitle={`2P Crew ${info.version}${info.machineName ? ` · máy ${info.machineName}` : ''}`}
      />
      <ErrorBox message={error} />

      <section aria-label="Kết nối" className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Lozenge tone={badge.tone}>{badge.text}</Lozenge>
          <span className="text-sm text-muted">
            {status
              ? `${status.jobs.running} job đang chạy · ${status.jobs.queued} chờ · ${status.jobs.backoff} chờ thử lại`
              : '—'}
          </span>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Server</dt>
          <dd className="m-0 font-mono text-xs">{info.apiUrl ?? '—'}</dd>
          <dt className="text-muted">Phiên bản app</dt>
          <dd className="m-0">{info.version}</dd>
          <dt className="text-muted">Cài đặt đang dùng</dt>
          <dd className="m-0">
            {view?.settings ? (
              <>
                bản <code>{view.settings.revision}</code> ({SETTINGS_SOURCE[view.settings.source]})
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted">Trợ lý</dt>
          <dd className="m-0">{view?.assistant === 'mine' ? 'máy này là máy trợ lý' : 'không'}</dd>
        </dl>
      </section>

      {view && view.folderAccessWaiting.length > 0 && (
        <Notice tone="warn">
          macOS đang hỏi quyền cho 2P Crew đọc {view.folderAccessWaiting.join(', ')}: bấm "Allow" (Cho phép)
          trong hộp thoại trên máy này. Job của các dự án đó chờ đến khi được phép.
        </Notice>
      )}

      <section aria-label="Sức khỏe" className="card space-y-3 p-5">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Sức khỏe</h2>
          {health && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <StatusDot status={health.summary.status} /> {HEALTH_LABEL[health.summary.status]} · kiểm tra
              lúc {formatTime(health.generatedAt)}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={checking}
            onClick={() => void recheck()}
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra ngay'}
          </button>
          <WebLink url={view?.links.machines ?? null}>Xem trên web</WebLink>
        </div>
        {help && (
          <Notice tone="warn">
            <p className="font-semibold">Gỡ ANTHROPIC_API_KEY khỏi môi trường</p>
            <p className="mt-1">
              Tìm dòng <code>export ANTHROPIC_API_KEY=…</code> trong <code>~/.zshrc</code>,{' '}
              <code>~/.zprofile</code> hoặc <code>~/.bash_profile</code>, xoá dòng đó, rồi thoát hẳn và mở lại
              2P Crew. Nếu biến được đặt bằng <code>launchctl setenv</code>, chạy{' '}
              <code>launchctl unsetenv ANTHROPIC_API_KEY</code>. Agent chỉ dùng gói đăng ký Claude, không tính
              phí API.
            </p>
            <button type="button" className="btn mt-2" onClick={() => setHelp(false)}>
              Đã hiểu
            </button>
          </Notice>
        )}
        {failing.length > 0 ? (
          <div className="card">
            {failing.map((item) => (
              <HealthCheckRow
                key={item.id}
                result={item}
                busy={fixing === item.id}
                onFix={(r) => void fix(r)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {health ? 'Mọi kiểm tra đều ổn.' : 'Chưa có kết quả kiểm tra.'}
          </p>
        )}
        <p className="text-xs text-muted">
          App tự kiểm tra khi mở và mỗi 5 phút. Toàn bộ kết quả, sửa lỗi từ xa, job và log: trên web, trang
          Máy → Điều khiển.
        </p>
      </section>

      <section aria-label="Dự án của máy này" className="card">
        <div className="flex items-center gap-3 border-b border-line2 px-4 py-3">
          <h2 className="font-semibold">Dự án của máy này</h2>
          <span className="flex-1" />
          <WebLink url={view?.links.machines ?? null}>Giao dự án trên web</WebLink>
        </div>
        {view && view.projects.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            Máy chưa giữ dự án nào: giao dự án cho máy này trên web (trang Dự án hoặc Máy).
          </p>
        )}
        <ul className="divide-y divide-line2">
          {view?.projects.map((project) => (
            <ProjectRow key={project.key} project={project} onChanged={() => void load()} />
          ))}
        </ul>
      </section>

      <section aria-label="Mở trên web" className="card space-y-3 p-5">
        <h2 className="font-semibold">Mở trên web</h2>
        <p className="text-sm text-muted">
          Prompt, quy tắc, model, tài nguyên, thư mục dự án, MCP, ngân sách và các thao tác từ xa đều nằm trên
          web; máy nhận thay đổi cho job kế tiếp mà không cần cài lại app.
        </p>
        <div className="flex flex-wrap gap-2">
          <WebLink url={view?.links.machineSettings ?? null}>Cài đặt máy này</WebLink>
          <WebLink url={view?.links.systemSettings ?? null}>Cài đặt hệ thống</WebLink>
          <WebLink url={view?.links.machines ?? null}>Máy</WebLink>
        </div>
      </section>

      <section aria-label="Trên máy này" className="card space-y-4 p-5">
        <h2 className="font-semibold">Trên máy này</h2>
        <Toggle
          checked={info.loginItem}
          label="Mở 2P Crew khi đăng nhập macOS (chạy nền trên thanh menu)"
          onChange={(enabled) => void run(() => invoke('app.setLoginItem', { enabled }).then(onInfoChange))}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div>
              {UPDATE_TEXT[update.state]}
              {update.version && ` Phiên bản ${update.version}.`}
            </div>
            {update.message && <div className="text-xs text-bad-ink">{update.message}</div>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              disabled={update.state === 'disabled'}
              onClick={() => void run(async () => setUpdate(await invoke('app.checkUpdate', {})))}
            >
              Kiểm tra bản mới
            </button>
            {(update.state === 'available' || update.state === 'downloaded') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void run(async () => setUpdate(await invoke('app.installUpdate', {})))}
              >
                {update.canAutoInstall ? 'Cài bản mới' : 'Tải bản mới'}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => invoke('app.openLogFolder', {}))}
          >
            Mở thư mục log
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => invoke('setup.openClaudeLogin', {}))}
          >
            Mở Terminal đăng nhập Claude
          </button>
          <button type="button" className="btn" onClick={() => navigate({ route: 'setup' })}>
            Chạy lại trình cài đặt
          </button>
        </div>
        <p className="text-xs text-muted">
          Thư mục log <code>~/.crew/logs</code>: <code>app.log</code> ghi thao tác của app,{' '}
          <code>daemon.log</code> ghi hoạt động job. Thoát app từ menu 2P Crew trên thanh menu.
        </p>
      </section>
    </div>
  );
}
