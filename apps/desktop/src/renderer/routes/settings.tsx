import type { AppInfo, Navigate, ResourcesView, UpdateStatus } from '@crew/shared';
import { useEffect, useRef, useState } from 'react';
import { type ResourceDraft, ResourceForm, resourceDraftError } from '../components/resource-form';
import { ErrorBox, Notice, PageHeader, Toggle } from '../components/ui';
import { errorText } from '../lib/format';
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

export interface SettingsPageProps {
  info: AppInfo;
  section?: string;
  navigate: (to: Navigate) => void;
  onInfoChange: () => void;
}

/** General settings (start at login, updates, setup wizard) and the resource and model limits. */
export function SettingsPage({ info, section, navigate, onInfoChange }: SettingsPageProps) {
  const [update, setUpdate] = useState(info.update);
  const [view, setView] = useState<ResourcesView | null>(null);
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resourcesRef = useRef<HTMLElement>(null);

  useDesktopEvent('update.status', setUpdate);
  useEffect(() => {
    invoke('config.resources', {}).then(
      (loaded) => {
        setView(loaded);
        setDraft({ resources: loaded.resources, models: loaded.models });
      },
      (caught) => setError(errorText(caught)),
    );
  }, []);
  useEffect(() => {
    if (section === 'resources' && view) resourcesRef.current?.scrollIntoView();
  }, [section, view]);

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const problem = draft ? resourceDraftError(draft) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-8">
      <PageHeader
        title="Cài đặt"
        subtitle={`2P Crew ${info.version}${info.machineName ? ` · máy ${info.machineName}` : ''}`}
      />
      <ErrorBox message={error} />
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Chung</h2>
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
            {!update.canAutoInstall && update.state === 'available' && (
              <div className="text-xs text-muted">
                Bản chưa ký: bấm "Tải bản mới" để tải file dmg đúng kiến trúc của máy này (arm64 cho Apple
                Silicon, x64 cho Intel) rồi cài thủ công.
              </div>
            )}
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
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => navigate({ route: 'setup' })}>
            Chạy lại trình cài đặt
          </button>
          <button type="button" className="btn" onClick={() => navigate({ route: 'settings-projects' })}>
            Project của máy này
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => invoke('app.openLogFolder', {}))}
          >
            Mở thư mục log
          </button>
        </div>
        <p className="text-xs text-muted">
          Thư mục log <code>~/.crew/logs</code>: <code>app.log</code> ghi thao tác của app, lỗi gọi server,
          thay đổi sức khỏe và lỗi của app; <code>daemon.log</code> ghi hoạt động job. Log không chứa token,
          mật khẩu hay mã ghép.
        </p>
      </section>
      <section ref={resourcesRef} className="card space-y-4 p-5">
        <h2 className="font-semibold">Tài nguyên và model</h2>
        {view && draft ? (
          <ResourceForm
            view={view}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setSaved(false);
            }}
          />
        ) : (
          <p className="text-sm text-muted">Đang tải…</p>
        )}
        {problem && <ErrorBox message={problem} />}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft || problem !== null}
            onClick={() =>
              void run(async () => {
                if (!draft) return;
                setView(await invoke('config.saveResources', draft));
                setSaved(true);
              })
            }
          >
            Lưu
          </button>
          {saved && <Notice tone="ok">Đã lưu; daemon áp dụng ngay, không cần khởi động lại.</Notice>}
        </div>
      </section>
    </div>
  );
}
