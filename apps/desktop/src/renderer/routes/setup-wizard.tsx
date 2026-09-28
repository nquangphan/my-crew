import type {
  AppInfo,
  ClaimOutcome,
  HealthCheckResult,
  HookView,
  ProjectsView,
  ResourcesView,
  ServerCheck,
} from '@crew/shared';
import { useEffect, useState } from 'react';
import { HealthCheckRow } from '../components/health-check-row';
import { NewProjectForm } from '../components/new-project-form';
import {
  initialSelections,
  ProjectPicker,
  readySelections,
  type Selections,
  unreadySelections,
} from '../components/project-picker';
import { type ResourceDraft, ResourceForm, resourceDraftError } from '../components/resource-form';
import { Lozenge, Notice, Toggle } from '../components/ui';
import { WIZARD_STEPS, WizardStep, type WizardStepId } from '../components/wizard-step';
import { errorText, formatTime } from '../lib/format';
import { invoke } from '../lib/ipc';

export const DEFAULT_SERVER_URL = 'https://crew.2p-solutions.com';

const OUTCOME_TONE = { granted: 'ok', already_owned: 'ok', pending: 'warn', error: 'bad' } as const;

function OutcomeList({ outcomes }: { outcomes: ClaimOutcome[] }) {
  if (outcomes.length === 0) return null;
  return (
    <ul className="card divide-y divide-line2 text-sm">
      {outcomes.map((outcome) => (
        <li key={outcome.target} className="flex items-center gap-3 px-4 py-2" data-outcome={outcome.target}>
          <span className="w-20 font-mono text-xs font-semibold">
            {outcome.target === 'assistant' ? 'Trợ lý' : outcome.target}
          </span>
          <Lozenge tone={OUTCOME_TONE[outcome.status as keyof typeof OUTCOME_TONE] ?? 'gray'}>
            {outcome.status}
          </Lozenge>
          <span className="text-muted">{outcome.message}</span>
        </li>
      ))}
    </ul>
  );
}

export interface SetupWizardProps {
  info: AppInfo;
  /** Open at this step (e.g. `pairing` from the "Ghép lại máy" fix). */
  section?: string;
  onFinished: (info: AppInfo) => void;
}

/** First-run setup (and "Chạy lại trình cài đặt" from Settings). Each step validates before "Tiếp". */
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
  const [projects, setProjects] = useState<ProjectsView | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [assistant, setAssistant] = useState(false);
  const [outcomes, setOutcomes] = useState<ClaimOutcome[]>([]);
  const [applied, setApplied] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [hooks, setHooks] = useState<HookView[] | null>(null);
  const [resources, setResources] = useState<ResourcesView | null>(null);
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [resourcesSaved, setResourcesSaved] = useState(false);

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
  const loadProjects = () =>
    run(async () => {
      const view = await invoke('projects.list', {});
      setProjects(view);
      setSelections(initialSelections(view.items));
      setAssistant(view.assistant.state === 'mine' || view.assistant.pendingClaim);
    });
  const loadHooks = () =>
    run(async () => {
      let list = await invoke('hooks.list', {});
      // Install what is missing or stale right away; the owner only sees the result.
      for (const hook of list.filter((item) => !item.installed || !item.current)) {
        await invoke('hooks.install', { key: hook.key });
      }
      list = await invoke('hooks.list', {});
      setHooks(list);
    });
  const loadResources = () =>
    run(async () => {
      const view = await invoke('config.resources', {});
      setResources(view);
      setDraft({ resources: view.resources, models: view.models });
    });

  // Each step loads (or re-checks) its data when it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the step only.
  useEffect(() => {
    if (step === 'claude') void checkClaude();
    if (step === 'projects') void loadProjects();
    if (step === 'hooks') void loadHooks();
    if (step === 'resources') void loadResources();
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
              setProjects(null);
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

  if (step === 'projects') {
    const waiting = unreadySelections(selections);
    const apply = () =>
      run(async () => {
        const result = await invoke('projects.apply', { selections: readySelections(selections), assistant });
        setOutcomes(result);
        setApplied(!result.some((item) => item.status === 'error'));
        const view = await invoke('projects.list', {});
        setProjects(view);
      });
    return (
      <WizardStep
        step="projects"
        description="Máy này quyết định mình chạy project nào. Project chưa có máy được nhận ngay; project đang thuộc máy khác chờ chủ dự án duyệt trên web (có thể hoàn tất cài đặt khi còn mục chờ duyệt)."
        canNext={applied}
        busy={busy}
        error={error}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      >
        {projects ? (
          <ProjectPicker
            projects={projects.items}
            selections={selections}
            disabled={busy}
            onChange={(update) => {
              setApplied(false);
              setSelections(update);
            }}
          />
        ) : (
          <p className="text-sm text-muted">Đang tải danh sách project…</p>
        )}
        <div className="card flex items-center justify-between p-4">
          <Toggle
            checked={assistant}
            onChange={(value) => {
              setAssistant(value);
              setApplied(false);
            }}
            label="Máy này làm trợ lý"
          />
          {projects && (
            <span className="text-xs text-muted">
              {projects.assistant.state === 'mine'
                ? 'Đang là trợ lý'
                : projects.assistant.pendingClaim
                  ? 'Đang chờ duyệt trên web'
                  : projects.assistant.state === 'other'
                    ? `Trợ lý hiện ở máy ${projects.assistant.hostName ?? 'khác'}`
                    : 'Chưa có máy nào làm trợ lý'}
            </span>
          )}
        </div>
        <div className="card p-4">
          <button type="button" className="btn" onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Ẩn' : 'Thêm project mới từ thư mục'}
          </button>
          {showNew && (
            <div className="mt-4">
              <NewProjectForm
                onCreated={(outcome) => {
                  setOutcomes([outcome]);
                  setShowNew(false);
                  void loadProjects();
                }}
              />
            </div>
          )}
        </div>
        <OutcomeList outcomes={outcomes} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {waiting.length > 0
              ? `Chưa có thư mục hợp lệ: ${waiting.join(', ')}`
              : 'Thư mục chỉ được lưu trên máy này.'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || waiting.length > 0}
            onClick={() => void apply()}
          >
            Lưu và nhận project
          </button>
        </div>
      </WizardStep>
    );
  }

  if (step === 'hooks') {
    const allInstalled = hooks?.every((hook) => hook.installed && hook.current) ?? false;
    return (
      <WizardStep
        step="hooks"
        description="App cài hook git của crew-docs vào từng repo (nối tiếp husky hoặc lefthook nếu có). Hook chạy bằng chính app, máy không cần cài Node."
        canNext={allInstalled}
        busy={busy}
        error={error}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      >
        <div className="card divide-y divide-line2">
          {hooks === null && <p className="p-4 text-sm text-muted">Đang cài hook…</p>}
          {hooks?.length === 0 && <p className="p-4 text-sm text-muted">Máy này chưa chạy project nào.</p>}
          {hooks?.map((hook) => (
            <div key={hook.key} className="flex items-center gap-3 p-4" data-hook={hook.key}>
              <span className="w-16 font-mono text-xs font-semibold">{hook.key}</span>
              <Lozenge tone={hook.installed && hook.current ? 'ok' : 'bad'}>
                {hook.installed && hook.current ? 'Đã cài hook' : 'Chưa cài hook'}
              </Lozenge>
              <span className="flex-1 text-sm text-muted">
                {hook.docsInitialized
                  ? 'Đã có docs.'
                  : 'Chưa có docs: một ticket docs-init sẽ chạy trước mọi ticket khác của project.'}
              </span>
              {!(hook.installed && hook.current) && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() => invoke('hooks.install', { key: hook.key }).then(() => loadHooks()))
                  }
                >
                  Cài lại
                </button>
              )}
            </div>
          ))}
        </div>
      </WizardStep>
    );
  }

  if (step === 'resources') {
    const problem = draft ? resourceDraftError(draft) : 'Đang tải…';
    return (
      <WizardStep
        step="resources"
        description="Giới hạn tài nguyên và model cho agent trên máy này. Mọi giá trị được lưu vào ~/.crew/config.yaml."
        canNext={resourcesSaved}
        busy={busy}
        error={error ?? (draft && problem ? problem : null)}
        onBack={() => go(-1)}
        onNext={() => go(1)}
      >
        {resources && draft && (
          <ResourceForm
            view={resources}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setResourcesSaved(false);
            }}
          />
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !draft || problem !== null}
          onClick={() =>
            void run(async () => {
              if (!draft) return;
              const saved = await invoke('config.saveResources', draft);
              setResources(saved);
              setResourcesSaved(true);
            })
          }
        >
          Lưu
        </button>
        {resourcesSaved && <Notice tone="ok">Đã lưu vào ~/.crew/config.yaml.</Notice>}
      </WizardStep>
    );
  }

  return (
    <WizardStep
      step="finish"
      description="App sẽ bật mở cùng máy, khởi động daemon và mở bảng sức khỏe."
      canNext
      nextLabel="Hoàn tất"
      busy={busy}
      error={error}
      onBack={() => go(-1)}
      onNext={() => void run(async () => onFinished(await invoke('setup.finish', {})))}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Máy chạy nền từ biểu tượng trên thanh menu, kể cả khi đóng cửa sổ.</li>
        <li>Mục đang chờ duyệt sẽ tự chạy khi chủ dự án duyệt trên web.</li>
        <li>Chỉ mã ghép, lệnh /login của Claude và việc chọn thư mục là thao tác tay.</li>
      </ul>
    </WizardStep>
  );
}
