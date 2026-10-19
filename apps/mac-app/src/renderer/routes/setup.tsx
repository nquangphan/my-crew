import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, SetupStep } from '../../main/app-state';
import type { ExistingMachine } from '../../main/setup/import-existing';
import type { V2Action, V2Detection } from '../../main/setup/v2-removal';
import type { MachineReport } from '../../main/setup/wizard';
import type { StepResult } from '../../shared/ipc-contract';
import { LOGIN_POLL_MS, ReloginButton } from '../components/relogin';
import { ErrorBox, Notice, PageHeader } from '../components/ui';
import { type StepFeedback, WizardStep } from '../components/wizard-step';
import { invoke, useStateChanged } from '../lib/ipc';

export const DEFAULT_PAPERCLIP_ORIGIN = 'https://crew.2p-solutions.com';

interface StepMeta {
  title: string;
  description: string;
  action: string;
  /** Chữ trên nút khi bước đang chạy (mặc định "Đang chạy..."). */
  busy?: string;
}

/** Tên bước và nút bấm; thứ tự khớp `STEP_ORDER` ở Main. */
export const STEP_META: Record<SetupStep, StepMeta> = {
  check: {
    title: 'Kiểm tra máy',
    description:
      'Cần macOS 15 trở lên, Tailscale đang chạy, Claude Code đã đăng nhập và Node 22+ (app tự tải Node LTS nếu thiếu).',
    action: 'Kiểm tra',
    busy: 'Đang kiểm tra (thiếu Node thì đang tải Node LTS…)',
  },
  v2: {
    title: 'Gỡ app 2P Crew cũ',
    description:
      'Gỡ app phiên bản 2 nếu có. Chỉ gỡ app: dữ liệu cũ trong thư mục ~/.crew (cấu hình, log, bộ nhớ trợ lý) được giữ nguyên, không xóa, không sửa.',
    action: 'Tiếp',
  },
  move: {
    title: 'Chuyển vào Applications',
    description: 'App nằm trong thư mục Applications để cập nhật và mở cùng máy hoạt động đúng.',
    action: 'Chuyển vào Applications',
  },
  paperclip: {
    title: 'Đăng nhập Paperclip',
    description: 'Đăng nhập tài khoản board trên trình duyệt rồi chọn company của máy này.',
    action: 'Tiếp',
  },
  machine: {
    title: 'Máy này',
    description:
      'Ghép máy với Paperclip: cài crew-mac, tạo environment SSH của máy, nhận key máy vào Keychain rồi gửi thử một bản tin. Không phải dán gì.',
    action: 'Ghép máy',
    busy: 'Đang ghép...',
  },
  'disk-access': {
    title: 'Quyền ổ đĩa',
    description:
      'Cấp cho 2P Crew quyền "Truy cập toàn bộ ổ đĩa" một lần. Chưa cấp thì lần đầu agent đụng thư mục được bảo vệ, macOS hỏi trên màn hình và run treo cho tới khi có người bấm.',
    action: 'Tiếp',
  },
  sshd: {
    title: 'Chuyển sshd sang 2P Crew',
    description:
      'Từ giờ 2P Crew giữ cổng sshd của agent. Nếu listener không lên trong 15 giây, app tự chuyển về LaunchAgent như cũ. Chỉ chuyển khi không còn run nào đang chạy.',
    action: 'Chuyển sshd',
  },
  doctor: {
    title: 'Kiểm tra cuối',
    description: 'Chạy kiểm tra sức khỏe có thử claude qua sshd. Mất tới vài chục giây.',
    action: 'Chạy kiểm tra',
  },
  done: {
    title: 'Hoàn tất',
    description: 'Bật mở 2P Crew cùng máy.',
    action: 'Hoàn tất',
  },
};

const STEP_IDS = Object.keys(STEP_META) as SetupStep[];
const RERUNNABLE: SetupStep[] = ['disk-access', 'sshd', 'doctor'];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Chạy một bước qua `setup:step`; xong `ok` thì báo lên để màn hình nạp lại tiến độ. */
function useStepRunner(step: SetupStep, onResult: (result: StepResult) => void) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<StepFeedback | null>(null);
  const run = useCallback(
    async (input: unknown = {}) => {
      setBusy(true);
      setFeedback(null);
      try {
        const result = await invoke('setup:step', step, input);
        setFeedback({ ok: result.ok, message: result.message });
        if (result.ok) onResult(result);
        return result;
      } catch (error) {
        setFeedback({ ok: false, message: errorText(error) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [step, onResult],
  );
  return { busy, feedback, run, setFeedback };
}

interface PanelProps {
  setup: AppState['setup'];
  machine: ExistingMachine | null;
  reloadMachine: () => void;
  onResult: (result: StepResult) => void;
}

function SimplePanel({ step, onResult }: { step: SetupStep; onResult: PanelProps['onResult'] }) {
  const meta = STEP_META[step];
  const { busy, feedback, run } = useStepRunner(step, onResult);
  return (
    <WizardStep
      title={meta.title}
      description={meta.description}
      feedback={feedback}
      actions={
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? (meta.busy ?? 'Đang chạy...') : meta.action}
        </button>
      }
    />
  );
}

type LoginState = 'idle' | 'waiting' | 'approved' | 'expired' | 'cancelled';

function PaperclipPanel({ setup, machine, onResult }: PanelProps) {
  const meta = STEP_META.paperclip;
  const [origin, setOrigin] = useState(
    setup.paperclipOrigin ??
      (machine?.kind === 'existing' ? machine.statusUrl : null) ??
      DEFAULT_PAPERCLIP_ORIGIN,
  );
  const [login, setLogin] = useState<LoginState>(setup.paperclipOrigin ? 'approved' : 'idle');
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  // Owner luôn tự chọn company: không chọn sẵn theo status.json hay company đầu danh sách (dễ gắn nhầm company).
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, feedback, run } = useStepRunner('paperclip', onResult);

  useEffect(() => {
    if (login !== 'approved') return;
    let live = true;
    invoke('paperclip:companies')
      .then((list) => {
        if (!live) return;
        setCompanies(list);
        setError(null);
        setCompanyId((current) => (list.some((c) => c.id === current) ? current : ''));
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(errorText(e));
        setLogin('idle');
      });
    return () => {
      live = false;
    };
  }, [login]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );
  const poll = useCallback(() => {
    invoke('paperclip:loginStatus')
      .then((status) => {
        if (status === 'pending') {
          pollTimer.current = setTimeout(poll, LOGIN_POLL_MS);
          return;
        }
        setLogin(status);
        if (status !== 'approved') setError('Đăng nhập chưa xong (hết hạn hoặc bị hủy). Thử lại.');
      })
      .catch((e: unknown) => {
        setError(errorText(e));
        setLogin('idle');
      });
  }, []);
  const startLogin = () => {
    setError(null);
    setLogin('waiting');
    invoke('paperclip:login', origin.trim())
      .then(poll)
      .catch((e: unknown) => {
        setError(errorText(e));
        setLogin('idle');
      });
  };

  return (
    <WizardStep
      title={meta.title}
      description={meta.description}
      feedback={feedback}
      actions={
        login === 'approved' ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy || companyId === ''}
            onClick={() => void run({ companyId })}
          >
            {busy ? 'Đang lưu...' : meta.action}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={login === 'waiting'} onClick={startLogin}>
            {login === 'waiting' ? 'Đang chờ duyệt trên trình duyệt...' : 'Đăng nhập'}
          </button>
        )
      }
    >
      <ErrorBox message={error} />
      <label className="field">
        Địa chỉ Paperclip
        <input
          value={origin}
          disabled={login === 'waiting'}
          onChange={(event) => {
            setOrigin(event.target.value);
            if (login === 'approved') setLogin('idle');
          }}
        />
      </label>
      {login === 'approved' && (
        <label className="field">
          Company
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="" disabled>
              Chọn company của máy này
            </option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </WizardStep>
  );
}

const V2_ACTION_LABELS: Record<V2Action, string> = {
  'login-item': 'Gỡ mục đăng nhập kiểu cũ của app 2P Crew cũ',
  trash: 'Chuyển app 2P Crew cũ vào Thùng rác (khôi phục được)',
  tcc: 'Xóa quyền macOS đã cấp cho app 2P Crew cũ',
};

/** Bước gỡ app v2: mỗi việc có ô tích; chỉ việc nào được tích mới gửi lên Main. */
function V2Panel({ onResult }: PanelProps) {
  const meta = STEP_META.v2;
  const { busy, feedback, run } = useStepRunner('v2', onResult);
  const [found, setFound] = useState<V2Detection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<V2Action, boolean>>({
    'login-item': true,
    trash: true,
    tcc: true,
  });

  const detect = useCallback(() => {
    invoke('setup:v2Detect')
      .then((result) => {
        setFound(result ?? null);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(detect, [detect]);

  const actions: V2Action[] = found?.isV2 ? ['login-item', 'trash', 'tcc'] : found?.isSelf ? ['tcc'] : [];
  const chosen = actions.filter((action) => picked[action]);
  const remove = async () => {
    await run({ confirm: chosen });
    detect();
  };
  const openLoginItems = () =>
    invoke('health:action', 'open-login-items').catch((e: unknown) => setError(errorText(e)));

  let buttons: ReactNode;
  if (found === null) {
    buttons = null;
  } else if (found.isV2 && found.running) {
    buttons = (
      <button type="button" className="btn primary" onClick={detect}>
        Thử lại
      </button>
    );
  } else {
    buttons = (
      <>
        {(found.isV2 || feedback !== null) && (
          <button type="button" className="btn" onClick={() => void openLoginItems()}>
            Mở Mục đăng nhập
          </button>
        )}
        {actions.length > 0 && (
          <button
            type="button"
            className={found.isV2 ? 'btn primary' : 'btn'}
            disabled={busy || chosen.length === 0}
            onClick={() => void remove()}
          >
            {busy ? 'Đang gỡ...' : 'Gỡ các mục đã chọn'}
          </button>
        )}
        {!found.isV2 && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run({})}>
            {meta.action}
          </button>
        )}
      </>
    );
  }

  return (
    <WizardStep title={meta.title} description={meta.description} feedback={feedback} actions={buttons}>
      <ErrorBox message={error} />
      {found === null && <p>Đang dò app 2P Crew cũ...</p>}
      {found?.isV2 && found.running && (
        <Notice tone="warn">
          Thoát app 2P Crew cũ (menu → Thoát) rồi bấm Thử lại. App mới không tự đóng app cũ.
        </Notice>
      )}
      {found !== null && !found.isV2 && !found.isSelf && (
        <Notice tone="ok">Không thấy app 2P Crew cũ trong Applications.</Notice>
      )}
      {found !== null && !(found.isV2 && found.running) && actions.length > 0 && (
        <fieldset className="field">
          <legend>Việc sẽ làm, chỉ khi bạn bấm Gỡ</legend>
          {actions.map((action) => (
            <label key={action} className="check">
              <input
                type="checkbox"
                checked={picked[action]}
                onChange={(event) => setPicked((now) => ({ ...now, [action]: event.target.checked }))}
              />{' '}
              {V2_ACTION_LABELS[action]}
            </label>
          ))}
        </fieldset>
      )}
    </WizardStep>
  );
}

function MovePanel({ onResult }: PanelProps) {
  const meta = STEP_META.move;
  const { busy, feedback, run } = useStepRunner('move', onResult);
  return (
    <WizardStep
      title={meta.title}
      description={meta.description}
      feedback={feedback}
      actions={
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void run({ confirm: true })}
        >
          {busy ? 'Đang chuyển...' : meta.action}
        </button>
      }
    >
      <Notice>Bấm nút để chuyển. Sau khi chuyển xong app tự mở lại từ thư mục Applications.</Notice>
    </WizardStep>
  );
}

/** Tên company đã chọn (để owner nhìn lại trước khi ghép); chưa đọc được thì hiện id. */
function useCompanyName(companyId: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    invoke('paperclip:companies')
      .then((list) => {
        if (live) setName(list.find((company) => company.id === companyId)?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [companyId]);
  return companyId ? (name ?? companyId) : null;
}

function MachinePanel({ setup, machine, reloadMachine, onResult }: PanelProps) {
  const meta = STEP_META.machine;
  const { busy, feedback, run, setFeedback } = useStepRunner('machine', onResult);
  const companyName = useCompanyName(setup.companyId);
  const [paperclipKey, setPaperclipKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [port, setPort] = useState('2222');
  const [worktreeRoot, setWorktreeRoot] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);

  if (machine === null) return <WizardStep title={meta.title} description="Đang đọc cài đặt có sẵn..." />;

  if (machine.kind === 'broken') {
    return (
      <WizardStep
        title={meta.title}
        description="Cài đặt crew-mac có sẵn trên máy này bị hỏng."
        feedback={{ ok: false, message: machine.message }}
        actions={
          <button type="button" className="btn" onClick={reloadMachine}>
            Đã xử lý, kiểm tra lại
          </button>
        }
      />
    );
  }

  const fresh = machine.kind === 'fresh';
  const location = fresh ? { port, worktreeRoot } : {};
  const pair = async (input: Record<string, unknown>) => {
    const result = await run(input);
    setRevoked(result?.state === 'revoked');
    if (result?.state === 'manual') setManualOpen(true);
  };
  const submitManual = async () => {
    const result = await run({ manual: true, paperclipKey, webhookSecret, ...location });
    // Main đã xóa secret khỏi input; ô nhập cũng xóa dù kết quả thế nào.
    setWebhookSecret('');
    if (result?.ok) setFeedback({ ok: true, message: result.message });
    if (result?.state === 'manual') setManualOpen(true);
  };

  return (
    <WizardStep
      title={meta.title}
      description={
        fresh
          ? meta.description
          : 'Máy đã cài crew-mac: gửi thử một bản tin. Server nhận thì giữ nguyên cài đặt, không ghép; server từ chối thì ghép lại máy.'
      }
      feedback={feedback}
      actions={
        <>
          {revoked && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void pair({ repair: true, ...location })}
            >
              Ghép lại máy này
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void pair({ ...location })}
          >
            {busy ? meta.busy : meta.action}
          </button>
        </>
      }
    >
      <Notice>
        Ghép vào company: <strong>{companyName ?? 'chưa chọn'}</strong>
      </Notice>
      {!fresh && (
        <dl className="kv">
          <dt>Cổng sshd</dt>
          <dd>{machine.port}</dd>
          <dt>Thư mục worktree</dt>
          <dd className="mono">{machine.worktreeRoot}</dd>
          <dt>Địa chỉ báo trạng thái</dt>
          <dd>{machine.statusUrl ?? 'chưa có'}</dd>
          <dt>Secret webhook</dt>
          <dd>{machine.hasWebhookSecret ? 'đã có trong Keychain' : 'chưa thấy trong Keychain'}</dd>
        </dl>
      )}
      {fresh && (
        <details className="field">
          <summary>Cổng sshd và thư mục worktree (tùy chọn)</summary>
          <label className="field">
            Cổng sshd
            <input value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <label className="field">
            Thư mục worktree (để trống: ~/crew-agents)
            <input value={worktreeRoot} onChange={(event) => setWorktreeRoot(event.target.value)} />
          </label>
        </details>
      )}
      <details
        className="field"
        open={manualOpen}
        onToggle={(event) => setManualOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Nhập tay (dự phòng)</summary>
        <p>
          Chỉ dùng khi không ghép tự động được. Secret chỉ đi một lần tới Keychain, không lưu trong app.
          {fresh ? '' : ' Máy có sẵn: key Paperclip để trống thì giữ key đang có.'}
        </p>
        <label className="field">
          Key Paperclip (ssh-ed25519)
          <textarea
            rows={3}
            className="mono"
            value={paperclipKey}
            onChange={(event) => setPaperclipKey(event.target.value)}
          />
        </label>
        <label className="field">
          Secret webhook
          <input
            type="password"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || webhookSecret === '' || (fresh && paperclipKey.trim() === '')}
          onClick={() => void submitManual()}
        >
          Cài bằng key và secret đã dán
        </button>
      </details>
    </WizardStep>
  );
}

function DiskAccessPanel({ onResult }: PanelProps) {
  const meta = STEP_META['disk-access'];
  const { busy, feedback, run } = useStepRunner('disk-access', onResult);
  const [status, setStatus] = useState<StepFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recheck = useCallback(() => {
    invoke('setup:step', 'disk-access', { recheck: true })
      .then((result) => setStatus({ ok: result.ok, message: result.message }))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    recheck();
    // Owner bật quyền trong Cài đặt hệ thống rồi quay lại app: dò lại.
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  return (
    <WizardStep
      title={meta.title}
      description={meta.description}
      feedback={feedback}
      actions={
        <>
          <button
            type="button"
            className="btn"
            onClick={() =>
              invoke('health:action', 'open-privacy').catch((e: unknown) => setError(errorText(e)))
            }
          >
            Mở Cài đặt hệ thống
          </button>
          <button type="button" className="btn" onClick={recheck}>
            Kiểm tra lại
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !status?.ok}
            onClick={() => void run({})}
          >
            {meta.action}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      {status && <Notice tone={status.ok ? 'ok' : 'warn'}>{status.message}</Notice>}
    </WizardStep>
  );
}

/** Bước sshd: nút chỉ mở khi Full Disk Access đang `granted` (dò lúc mở và mỗi lần cửa sổ focus lại). */
function SshdPanel({ onResult }: PanelProps) {
  const meta = STEP_META.sshd;
  const { busy, feedback, run } = useStepRunner('sshd', onResult);
  const [disk, setDisk] = useState<StepFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recheck = useCallback(() => {
    invoke('setup:step', 'disk-access', { recheck: true })
      .then((result) => setDisk({ ok: result.ok, message: result.message }))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  const locked = !disk?.ok;
  return (
    <WizardStep
      title={meta.title}
      description={meta.description}
      feedback={feedback}
      actions={
        <>
          {locked && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  invoke('health:action', 'open-privacy').catch((e: unknown) => setError(errorText(e)))
                }
              >
                Mở Cài đặt hệ thống
              </button>
              <button type="button" className="btn" onClick={recheck}>
                Kiểm tra lại
              </button>
            </>
          )}
          <button type="button" className="btn primary" disabled={busy || locked} onClick={() => void run()}>
            {busy ? 'Đang chạy...' : meta.action}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      {locked && (
        <Notice tone="warn">
          {disk?.message ?? 'Đang kiểm tra quyền ổ đĩa...'} Chưa chuyển sshd được khi 2P Crew chưa có quyền
          "Truy cập toàn bộ ổ đĩa".
        </Notice>
      )}
    </WizardStep>
  );
}

const REOPEN_LABEL = 'Đổi company / Ghép lại máy';

/** Câu cảnh báo cho lần gửi bản tin máy gần nhất bị từ chối hay không tới được server. */
function reportProblem(report: MachineReport): string {
  const how =
    report.httpStatus === null
      ? 'không gửi được tới server'
      : `server từ chối (HTTP ${report.httpStatus}${report.httpStatus === 401 || report.httpStatus === 403 ? ', máy có thể đã bị gỡ trên web hoặc key không còn đúng' : ''})`;
  return `Máy này không báo trạng thái lên Paperclip: lần gửi gần nhất ${how}.`;
}

function DonePanel({
  origin,
  onResult,
  onReopen,
}: {
  origin: string | null;
  onResult: PanelProps['onResult'];
  onReopen: () => void;
}) {
  const meta = STEP_META.done;
  const { busy, feedback, run } = useStepRunner('done', onResult);
  const [report, setReport] = useState<MachineReport | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  const loadReport = useCallback(() => {
    invoke('setup:machineReport')
      .then((value) => setReport(value ?? null))
      .catch(() => setReport(null));
  }, []);
  useEffect(() => {
    loadReport();
    window.addEventListener('focus', loadReport);
    return () => window.removeEventListener('focus', loadReport);
  }, [loadReport]);

  const reopen = () => {
    setReopening(true);
    setReopenError(null);
    invoke('setup:reopenMachine')
      .then(onReopen)
      .catch((e: unknown) => setReopenError(errorText(e)))
      .finally(() => setReopening(false));
  };
  const reopenButton = (
    <button type="button" className="btn" disabled={reopening} onClick={reopen}>
      {reopening ? 'Đang quay lại...' : REOPEN_LABEL}
    </button>
  );
  const [rerun, setRerun] = useState<{ step: SetupStep; feedback: StepFeedback } | null>(null);
  const [rerunning, setRerunning] = useState<SetupStep | null>(null);

  const again = (step: SetupStep) => {
    setRerunning(step);
    invoke('setup:step', step, {})
      .then((result) => setRerun({ step, feedback: { ok: result.ok, message: result.message } }))
      .catch((e: unknown) => setRerun({ step, feedback: { ok: false, message: errorText(e) } }))
      .finally(() => setRerunning(null));
  };

  return (
    <>
      {report?.ok === false && (
        <Notice tone="warn">
          {reportProblem(report)} Bấm "{REOPEN_LABEL}" để chọn lại company và ghép lại máy.
          <div>{reopenButton}</div>
        </Notice>
      )}
      <WizardStep
        title="Cài đặt đã xong"
        description="Mọi bước đã chạy xong. Bấm Hoàn tất để 2P Crew tự mở cùng máy."
        feedback={feedback}
        actions={
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run({})}>
            {meta.action}
          </button>
        }
      />
      <WizardStep
        title="Chạy lại một bước"
        description="Dùng khi màn Sức khỏe báo lỗi quyền ổ đĩa, sshd hoặc cần kiểm lại."
        feedback={rerun?.feedback ?? null}
        actions={RERUNNABLE.map((step) => (
          <button
            key={step}
            type="button"
            className="btn"
            disabled={rerunning !== null}
            onClick={() => again(step)}
          >
            {rerunning === step ? 'Đang chạy...' : STEP_META[step].title}
          </button>
        ))}
      />
      <WizardStep
        title="Company và máy"
        description="Dùng khi đã gỡ máy trên web (Gỡ máy) và muốn Ghép lại, hoặc máy đã ghép nhầm company. Wizard quay về bước chọn company rồi chạy lại bước Máy."
        feedback={reopenError ? { ok: false, message: reopenError } : null}
        actions={reopenButton}
      />
      <WizardStep
        title="Tài khoản Paperclip"
        description={`Đăng nhập lại khi board key hết hạn hoặc cần đổi tài khoản. Paperclip: ${origin ?? 'chưa có'}`}
        feedback={null}
        actions={<ReloginButton origin={origin} />}
      />
    </>
  );
}

export function SetupScreen() {
  const [setup, setSetup] = useState<AppState['setup'] | null>(null);
  const [machine, setMachine] = useState<ExistingMachine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('setup:state')
      .then((state) => {
        setSetup(state);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  const loadMachine = useCallback(() => {
    setMachine(null);
    invoke('setup:detect')
      .then(setMachine)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    load();
    loadMachine();
  }, [load, loadMachine]);
  useStateChanged(load);

  const onResult = useCallback(
    (result: StepResult) => {
      setPrevious(result.message);
      load();
    },
    [load],
  );

  let panel: ReactNode = null;
  if (setup) {
    const props: PanelProps = { setup, machine, reloadMachine: loadMachine, onResult };
    switch (setup.step) {
      case 'v2':
        panel = <V2Panel {...props} />;
        break;
      case 'move':
        panel = <MovePanel {...props} />;
        break;
      case 'paperclip':
        panel = <PaperclipPanel {...props} />;
        break;
      case 'machine':
        panel = <MachinePanel {...props} />;
        break;
      case 'disk-access':
        panel = <DiskAccessPanel {...props} />;
        break;
      case 'sshd':
        panel = <SshdPanel {...props} />;
        break;
      case 'done':
        panel = <DonePanel origin={setup.paperclipOrigin} onResult={onResult} onReopen={load} />;
        break;
      default:
        panel = <SimplePanel key={setup.step} step={setup.step} onResult={onResult} />;
    }
  }

  const currentIndex = setup ? STEP_IDS.indexOf(setup.step) : -1;
  return (
    <>
      <PageHeader
        title="Cài đặt"
        subtitle="Làm lần lượt từng bước; đóng app giữa chừng thì mở lại sẽ tiếp tục từ bước đang dở."
      />
      <ErrorBox message={error} />
      <div className="wizard">
        <ol className="wizard-steps" aria-label="Các bước">
          {STEP_IDS.map((id, index) => (
            <li
              key={id}
              className={index < currentIndex ? 'finished' : index === currentIndex ? 'current' : undefined}
              aria-current={index === currentIndex ? 'step' : undefined}
            >
              {STEP_META[id].title}
            </li>
          ))}
        </ol>
        <div className="wizard-body">
          {previous && setup?.step !== 'done' && <Notice tone="ok">{previous}</Notice>}
          {panel}
        </div>
      </div>
    </>
  );
}
