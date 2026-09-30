import type { Machine, MachineRuntimeState, RuntimeRelease } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime } from '../lib/format';
import { keys, useRuntimeReleases } from '../lib/queries';
import { Button } from './ui/button';
import { Select } from './ui/field';
import { useToast } from './ui/toast';

/** What a machine's runtime update is doing, in one Vietnamese phrase, and whether it needs attention. */
export function runtimeStateText(state: MachineRuntimeState): { text: string; attention: boolean } {
  const target = state.target ?? '';
  switch (state.state) {
    case 'idle':
      return { text: 'đang chạy bản cần chạy', attention: false };
    case 'checking':
      return { text: 'đang hỏi server', attention: false };
    case 'downloading':
      return { text: `đang tải ${target}`, attention: false };
    case 'installing':
      return { text: `đang kiểm tra chữ ký và cài ${target}`, attention: false };
    case 'waiting':
      return { text: state.message ?? `chờ job xong để chuyển sang ${target}`, attention: false };
    case 'switching':
      return { text: `đang chuyển sang ${target}`, attention: false };
    case 'disabled':
      return { text: 'bản chạy thử, không cập nhật', attention: false };
    case 'shell_update_required':
      return { text: state.message ?? `bản ${target} cần app mới (dmg)`, attention: true };
    case 'rolled_back':
      return { text: state.message ?? `bản ${target} không chạy được, đã quay lại`, attention: true };
    case 'refused':
      return { text: state.message ?? `bản ${target} bị từ chối (chữ ký hoặc hash sai)`, attention: true };
    default:
      return { text: state.message ?? 'cập nhật gặp lỗi', attention: true };
  }
}

/**
 * One machine's app (shell) and runtime versions, its update state, and the pin: the owner picks a published
 * release (an older one rolls the machine back) or lets it follow the newest release its app can run.
 */
export function MachineRuntime({ machine }: { machine: Machine }) {
  const releases = useRuntimeReleases();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState(machine.runtime.pinnedVersion ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reported = machine.runtime.reported;
  const pinned = machine.runtime.pinnedVersion;
  const status = reported ? runtimeStateText(reported) : null;

  const pin = async (version: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.pinMachineRuntime(machine.id, version);
      toast(
        version ? `${machine.name} ghim runtime ${version}` : `${machine.name} theo bản runtime mới nhất`,
        'success',
      );
      await queryClient.invalidateQueries({ queryKey: keys.machines });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-runtime={reported?.version ?? ''}>
      <span className="text-[13px]">
        {reported ? (
          <>
            app <code>{reported.shellVersion}</code> · runtime <code>{reported.version}</code>{' '}
            {reported.source === 'builtin' ? '(đi kèm app)' : '(cập nhật nóng)'}
            {status && (
              <span className={cn(status.attention ? 'text-bad' : 'text-muted')}> · {status.text}</span>
            )}
          </>
        ) : (
          <span className="text-muted">
            {machine.appVersion ? `app ${machine.appVersion} · ` : ''}máy chưa báo runtime (app chưa có cập
            nhật nóng)
          </span>
        )}
        {pinned && <span className="text-warn-ink"> · ghim bản {pinned}</span>}
      </span>
      {machine.revokedAt === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={`Bản runtime cho ${machine.name}`}
            className="w-auto"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Theo bản mới nhất</option>
            {(releases.data?.items ?? []).map((release) => (
              <option key={release.version} value={release.version}>
                {release.version} · app {release.shellRange.app}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={busy || choice === (pinned ?? '')}
            onClick={() => void pin(choice === '' ? null : choice)}
          >
            {choice === '' ? 'Bỏ ghim' : 'Ghim bản này'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** The signed runtime bundles on this server and the import of new ones from GitHub Releases. */
export function RuntimeReleases() {
  const releases = useRuntimeReleases();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items: RuntimeRelease[] = releases.data?.items ?? [];
  const repo = releases.data?.githubRepo ?? null;

  const importNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.importRuntimeReleases();
      const skipped = result.skipped.map((item) => `${item.tag}: ${item.reason}`).join('; ');
      toast(
        result.imported.length > 0
          ? `Đã nhập runtime ${result.imported.join(', ')}`
          : `Không có bản runtime mới${skipped ? ` (bỏ qua ${skipped})` : ''}`,
        result.imported.length > 0 ? 'success' : 'info',
      );
      await queryClient.invalidateQueries({ queryKey: keys.runtimeReleases });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Bản runtime"
      className="flex flex-col gap-2 rounded-md border border-line bg-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 grow text-base font-semibold">Bản runtime</h2>
        {repo && (
          <Button size="sm" disabled={busy} onClick={() => void importNow()}>
            Nhập bản mới từ GitHub
          </Button>
        )}
      </div>
      <p className="m-0 text-[13px] text-muted">
        Daemon, host và giao diện app cập nhật nóng từ server: CI ký mỗi bản (tag <code>runtime-v…</code>),
        máy kiểm chữ ký và hash trước khi chạy, chờ job đang chạy rồi chuyển, và tự quay lại bản trước nếu bản
        mới không khởi động được. Ghim một máy vào bản cũ hơn để quay lui.
      </p>
      {releases.isError && (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {errorMessage(releases.error)}
        </p>
      )}
      {items.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">
          Chưa có bản runtime nào trên server
          {repo ? `; CI đăng lên GitHub ${repo}, server nhập mỗi giờ.` : '.'}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {items.slice(0, 5).map((release, index) => (
            <li key={release.version} data-release={release.version}>
              <code className="font-semibold">{release.version}</code>
              {index === 0 && <span className="text-ok-ink"> · mới nhất</span>} · app {release.shellRange.app}{' '}
              · commit <code>{release.commit.slice(0, 8)}</code> ·{' '}
              {release.source === 'github' ? 'từ GitHub' : 'tải lên'} ·{' '}
              {formatFullDateTime(release.publishedAt)}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
