import type { AppInfo, HealthCheckResult, ServerCheck } from '@crew/shared';
import { useEffect, useState } from 'react';
import { HealthCheckRow } from '../components/health-check-row';
import { Notice } from '../components/ui';
import { WIZARD_STEPS, WizardStep, type WizardStepId } from '../components/wizard-step';
import { errorText, formatTime } from '../lib/format';
import { invoke } from '../lib/ipc';

export const DEFAULT_SERVER_URL = 'https://crew.2p-solutions.com';

export interface SetupWizardProps {
  info: AppInfo;
  /** Open at this step (e.g. `pairing` from the "Ghép lại máy" fix). */
  section?: string;
  onFinished: (info: AppInfo) => void;
}

/**
 * First-run setup (and "Chạy lại trình cài đặt"): the server, the pairing code and the Claude login, then the
 * finish. Projects, folders, resources and every other setting are set on the web afterwards. Each step
 * validates before "Tiếp".
 */
export function SetupWizard({ info, section, onFinished }: SetupWizardProps) {
  const start = WIZARD_STEPS.some((step) => step.id === section) ? (section as WizardStepId) : 'server';
  const [step, setStep] = useState<WizardStepId>(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiUrl, setApiUrl] = useState(info.apiUrl ?? DEFAULT_SERVER_URL);
  const [server, setServer] = useState<ServerCheck | null>(null);
  const [machineName, setMachineName] = useState(info.machineName ?? '');
  const [code, setCode] = useState('');
  const [paired, setPaired] = useState<{ name: string; expiresAt: string | null } | null>(
    info.paired ? { name: info.machineName ?? '', expiresAt: null } : null,
  );
  const [claude, setClaude] = useState<HealthCheckResult[] | null>(null);

  const index = WIZARD_STEPS.findIndex((item) => item.id === step);
  const go = (offset: number) => {
    setError(null);
    const next = WIZARD_STEPS[index + offset];
    if (next) setStep(next.id);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const checkClaude = () => run(async () => setClaude(await invoke('setup.checkClaude', {})));
  // Each step loads (or re-checks) its data when it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the step only.
  useEffect(() => {
    if (step === 'claude') void checkClaude();
  }, [step]);

  if (step === 'server') {
    return (
      <WizardStep
        step="server"
        description="Địa chỉ server 2P Crew (VPS). App kiểm tra /v1/health: kết nối, chứng chỉ TLS và phiên bản API."
        canNext={server?.ok === true && server.apiUrl === apiUrl.trim().replace(/\/+$/, '')}
        busy={busy}
        error={error}
        onNext={() => go(1)}
      >
        <label className="block">
          <span className="label">URL server</span>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              value={apiUrl}
              onChange={(e) => {
                setApiUrl(e.target.value);
                setServer(null);
              }}
            />
            <button
              type="button"
              className="btn shrink-0"
              disabled={busy || apiUrl.trim() === ''}
              onClick={() =>
                void run(async () => setServer(await invoke('setup.checkServer', { apiUrl: apiUrl.trim() })))
              }
            >
              Kiểm tra
            </button>
          </div>
        </label>
        {server && <Notice tone={server.ok ? 'ok' : 'bad'}>{server.message}</Notice>}
      </WizardStep>
    );
  }

  if (step === 'pairing') {
    return (
      <WizardStep
        step="pairing"
        description="Trên web, mở Máy → Ghép máy mới để lấy mã (có hạn 10 phút). Token của máy được lưu trong Keychain, không hiện ra ở đây."
        canNext={paired !== null}
        busy={busy}
        error={error}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      >
        {paired && (
          <Notice tone="ok">
            Máy đã được ghép{paired.name ? ` với tên "${paired.name}"` : ''}
            {paired.expiresAt ? `, token hết hạn ${formatTime(paired.expiresAt)}` : ''}. Có thể ghép lại bằng
            mã mới.
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Tên máy</span>
            <input
              className="input"
              value={machineName}
              placeholder="Ví dụ: MacBook văn phòng"
              onChange={(e) => setMachineName(e.target.value)}
            />
          </label>
          <label>
            <span className="label">Mã ghép</span>
            <input
              className="input font-mono uppercase"
              value={code}
              placeholder="ABCD-EFGH-IJKL"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || machineName.trim() === '' || code.trim() === ''}
          onClick={() =>
            void run(async () => {
              const result = await invoke('setup.pair', {
                apiUrl: apiUrl.trim(),
                code: code.trim(),
                machineName: machineName.trim(),
              });
              setPaired({ name: result.machineName, expiresAt: result.expiresAt });
              setCode('');
            })
          }
        >
          Ghép máy
        </button>
      </WizardStep>
    );
  }

  if (step === 'claude') {
    const red = claude?.some((item) => item.status === 'red') ?? true;
    const loggedOut = claude?.find((item) => item.id === 'claude.login' && item.status !== 'green');
    return (
      <WizardStep
        step="claude"
        description="Agent chạy bằng gói đăng ký Claude trên máy này. App kiểm tra runtime Claude Code, thử một lượt haiku rất nhỏ và báo nếu có ANTHROPIC_API_KEY."
        canNext={!red}
        busy={busy}
        error={error}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      >
        <div className="card">
          {claude ? (
            claude.map((item) => <HealthCheckRow key={item.id} result={item} />)
          ) : (
            <p className="p-4 text-sm text-muted">Đang kiểm tra…</p>
          )}
        </div>
        <div className="flex gap-2">
          {loggedOut && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void run(() => invoke('setup.openClaudeLogin', {}).then(() => undefined))}
            >
              Đăng nhập Claude
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => void checkClaude()}>
            Kiểm tra lại
          </button>
        </div>
        {loggedOut && (
          <p className="text-sm text-muted">
            Terminal sẽ mở và chạy <code>claude</code>: gõ <code>/login</code>, đăng nhập gói đăng ký, rồi bấm
            "Kiểm tra lại".
          </p>
        )}
      </WizardStep>
    );
  }

  return (
    <WizardStep
      step="finish"
      description="App sẽ bật mở cùng máy, khởi động daemon và mở trang trạng thái."
      canNext
      nextLabel="Hoàn tất"
      busy={busy}
      error={error}
      onBack={() => go(-1)}
      onNext={() => void run(async () => onFinished(await invoke('setup.finish', {})))}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Máy chạy nền từ biểu tượng trên thanh menu, kể cả khi đóng cửa sổ.</li>
        <li>
          Giao dự án cho máy, đặt thư mục dự án, tài nguyên, model và mọi cài đặt khác trên web (trang Máy và
          Cài đặt hệ thống); máy nhận thay đổi mà không cần cài lại app.
        </li>
        <li>Thư mục dự án cũng chọn được trong app (trang Trạng thái máy) để tránh gõ đường dẫn.</li>
      </ul>
    </WizardStep>
  );
}
