import type {
  BmadInstallPlan,
  ClaimOutcome,
  FolderValidation,
  PendingProjectChange,
  ProjectChangeStatus,
  ProjectDetail,
  ProjectPlatform,
  ProjectsView,
  ProjectTestSetup,
} from '@crew/shared';
import { useCallback, useEffect, useState } from 'react';
import { FolderPicker } from '../components/folder-picker';
import { HealthCheckRow } from '../components/health-check-row';
import { NewProjectForm, PLATFORM_LABELS } from '../components/new-project-form';
import {
  initialSelections,
  ownershipLabel,
  ProjectPicker,
  readySelections,
  type Selections,
} from '../components/project-picker';
import { ErrorBox, Lozenge, Notice, PageHeader, Toggle } from '../components/ui';
import { errorText } from '../lib/format';
import { invoke, useDesktopEvent } from '../lib/ipc';

/** How often the panel re-reads the project while a change waits for the owner. */
const PENDING_POLL_MS = 5_000;

/** What the panel says once the machine's change request is no longer pending. */
const OUTCOME_TEXT: Record<ProjectChangeStatus, string | null> = {
  pending: null,
  approved: 'Chủ dự án đã xác nhận: đã đổi loại project và MCP test UI.',
  rejected: 'Chủ dự án đã từ chối thay đổi; loại project giữ nguyên.',
  withdrawn: 'Yêu cầu đổi đã tự rút vì máy này không còn giữ project; loại project giữ nguyên.',
};

const sameSetup = (a: ProjectTestSetup, b: ProjectTestSetup) =>
  a.platform === b.platform &&
  a.uiTestMcp.playwright === b.uiTestMcp.playwright &&
  a.uiTestMcp.maestro === b.uiTestMcp.maestro;

/**
 * Project type and UI-test MCP mapping. The machine may only ask: the change waits for the owner's TOTP
 * confirmation on the web, and the panel shows it as pending until the owner decides.
 */
function TestSetupSection({
  detail,
  disabled,
  onSubmit,
  onRefresh,
}: {
  detail: ProjectDetail;
  disabled: boolean;
  onSubmit: (setup: ProjectTestSetup) => void;
  onRefresh: (detail: ProjectDetail) => void;
}) {
  const current: ProjectTestSetup | null =
    detail.platform && detail.uiTestMcp ? { platform: detail.platform, uiTestMcp: detail.uiTestMcp } : null;
  const pending = detail.pendingChange;
  const [draft, setDraft] = useState<ProjectTestSetup | null>(pending ?? current);
  const [asked, setAsked] = useState<PendingProjectChange | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // A new detail (another project, or a decision) resets the form to what the server has.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the server values only
  useEffect(() => {
    setDraft(pending ?? current);
  }, [
    detail.key,
    pending?.requestId,
    current?.platform,
    current?.uiTestMcp.playwright,
    current?.uiTestMcp.maestro,
  ]);

  // While pending, re-read the project until the owner decides or the request is withdrawn.
  useEffect(() => {
    if (!pending) return;
    setAsked(pending);
    const timer = setInterval(() => {
      invoke('projects.detail', { key: detail.key }).then(
        (next) => {
          if (next.pendingChange) return;
          onRefresh(next);
        },
        () => undefined,
      );
    }, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [pending, detail.key, onRefresh]);

  // The request left pending: say how it ended (the server keeps the machine's latest request).
  useEffect(() => {
    if (pending || !asked) return;
    const ended = detail.lastChange?.requestId === asked.requestId ? detail.lastChange.status : null;
    setOutcome(ended ? OUTCOME_TEXT[ended] : null);
    setAsked(null);
  }, [pending, asked, detail.lastChange]);

  if (!current || !draft) {
    return (
      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">Loại project và MCP test UI</h2>
        <p className="text-sm text-muted">Chưa đọc được project từ server.</p>
      </section>
    );
  }
  const set = (patch: Partial<ProjectTestSetup>) => setDraft({ ...draft, ...patch });
  const setMcp = (patch: Partial<ProjectTestSetup['uiTestMcp']>) =>
    setDraft({ ...draft, uiTestMcp: { ...draft.uiTestMcp, ...patch } });
  const needsPlaywright = draft.platform === 'web' || draft.platform === 'web_mobile';
  const needsMaestro = draft.platform === 'mobile' || draft.platform === 'web_mobile';
  const valid = draft.uiTestMcp.playwright.trim() !== '' && draft.uiTestMcp.maestro.trim() !== '';
  const locked = disabled || pending !== null;

  return (
    <section className="card space-y-3 p-5" data-section="test-setup">
      <h2 className="font-semibold">Loại project và MCP test UI</h2>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">Loại project</span>
          <select
            className="input"
            value={draft.platform}
            disabled={locked}
            onChange={(e) => set({ platform: e.target.value as ProjectPlatform })}
          >
            {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div />
        {needsPlaywright && (
          <label>
            <span className="label">MCP test UI web (mặc định Playwright)</span>
            <input
              className="input font-mono"
              value={draft.uiTestMcp.playwright}
              disabled={locked}
              onChange={(e) => setMcp({ playwright: e.target.value })}
            />
          </label>
        )}
        {needsMaestro && (
          <label>
            <span className="label">MCP test UI mobile (mặc định Maestro)</span>
            <input
              className="input font-mono"
              value={draft.uiTestMcp.maestro}
              disabled={locked}
              onChange={(e) => setMcp({ maestro: e.target.value })}
            />
          </label>
        )}
      </div>
      <p className="text-sm text-muted">
        QC bắt buộc dùng: {detail.requiredMcps.length ? detail.requiredMcps.join(', ') : 'không có (backend)'}
        . Mặc định Maestro cho mobile, Playwright cho web; có thể trỏ sang server tên khác. Thay đổi chỉ có
        hiệu lực khi chủ dự án xác nhận trên web.
      </p>
      {pending && (
        <Notice tone="warn">
          Đang chờ chủ dự án xác nhận: {PLATFORM_LABELS[pending.platform]} · test UI web{' '}
          <code>{pending.uiTestMcp.playwright}</code> · test UI mobile{' '}
          <code>{pending.uiTestMcp.maestro}</code>
        </Notice>
      )}
      {!pending && outcome && <Notice tone="ok">{outcome}</Notice>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={locked || !valid || sameSetup(draft, current)}
          onClick={() => {
            setOutcome(null);
            onSubmit({
              platform: draft.platform,
              uiTestMcp: {
                playwright: draft.uiTestMcp.playwright.trim(),
                maestro: draft.uiTestMcp.maestro.trim(),
              },
            });
          }}
        >
          Gửi yêu cầu đổi
        </button>
        {detail.webSettingsUrl && (
          <button
            type="button"
            className="btn text-xs"
            onClick={() => void invoke('app.openExternal', { url: detail.webSettingsUrl as string })}
          >
            Mở cài đặt project trên web
          </button>
        )}
      </div>
    </section>
  );
}

/** Output lines kept on screen while the installer runs. */
const MAX_BMAD_LINES = 200;

const LOCAL_STATE: Record<BmadInstallPlan, { tone: 'ok' | 'warn' | 'gray' | 'info'; text: string }> = {
  no_profile: { tone: 'gray', text: 'Chưa có cấu hình' },
  skip: { tone: 'ok', text: 'Khớp cấu hình' },
  install: { tone: 'gray', text: 'Chưa cài' },
  update: { tone: 'warn', text: 'Khác cấu hình' },
  newer: { tone: 'info', text: 'Mới hơn cấu hình' },
};

/**
 * "Cài BMAD": the project's BMAD profile (what the machine holding it installed) and this machine's install.
 * Manual only; the installer's output streams in while it runs, and nothing is committed.
 */
function BmadSection({
  detail,
  onInstalled,
}: {
  detail: ProjectDetail;
  onInstalled: (next: ProjectDetail) => void;
}) {
  const { profile, local, plan } = detail.bmad;
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another project is shown
  useEffect(() => {
    setLines([]);
    setResult(null);
    setError(null);
  }, [detail.key]);

  useDesktopEvent('bmad.progress', (progress) => {
    if (progress.key === detail.key)
      setLines((current) => [...current.slice(1 - MAX_BMAD_LINES), progress.line]);
  });

  const install = async () => {
    setRunning(true);
    setLines([]);
    setResult(null);
    setError(null);
    try {
      const outcome = await invoke('projects.installBmad', { key: detail.key });
      setResult(outcome.message);
      onInstalled(outcome.detail);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRunning(false);
    }
  };

  const state = LOCAL_STATE[plan];
  return (
    <section className="card space-y-3 p-5" data-section="bmad">
      <h2 className="font-semibold">BMAD</h2>
      {profile ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Cấu hình</dt>
          <dd>
            BMAD <span className="font-mono">{profile.version}</span>
          </dd>
          <dt className="text-muted">Module</dt>
          <dd className="font-mono text-xs">{profile.modules.join(', ')}</dd>
          <dt className="text-muted">Công cụ</dt>
          <dd className="font-mono text-xs">{profile.tools.join(', ') || '—'}</dd>
          <dt className="text-muted">Ngôn ngữ</dt>
          <dd>
            trò chuyện {profile.communicationLanguage ?? 'mặc định'} · tài liệu{' '}
            {profile.documentOutputLanguage ?? 'mặc định'}
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-muted">Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).</p>
      )}
      <div className="flex items-center gap-2 text-sm" data-bmad-local={plan}>
        <span className="text-muted">Máy này:</span>
        <span>
          {local ? (
            <>
              BMAD <span className="font-mono">{local.version}</span> · module{' '}
              <span className="font-mono text-xs">{local.modules.join(', ') || '—'}</span>
            </>
          ) : (
            'chưa cài BMAD'
          )}
        </span>
        <Lozenge tone={state.tone}>{state.text}</Lozenge>
      </div>
      <p className="text-sm text-muted">
        Cài bằng <code>npx bmad-method</code> vào thư mục project; không chép <code>_bmad/custom</code>,{' '}
        <code>_bmad/memory</code> và không commit gì.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={running || !profile || plan === 'newer'}
        onClick={() => void install()}
      >
        {running ? 'Đang cài BMAD…' : 'Cài BMAD'}
      </button>
      {lines.length > 0 && (
        <pre
          className="max-h-48 overflow-auto rounded border border-line2 bg-soft p-2 font-mono text-xs"
          data-bmad-log
        >
          {lines.join('\n')}
        </pre>
      )}
      {result && <Notice tone="ok">{result}</Notice>}
      <ErrorBox message={error} />
    </section>
  );
}

function ProjectPanel({
  projectKey,
  onReleased,
}: {
  projectKey: string;
  onReleased: (outcome: ClaimOutcome) => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [validation, setValidation] = useState<FolderValidation | null>(null);
  const [newPath, setNewPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    setDetail(null);
    setValidation(null);
    invoke('projects.detail', { key: projectKey }).then(setDetail, (caught) => setError(errorText(caught)));
  }, [projectKey]);

  if (!detail) return <ErrorBox message={error} />;
  const disabled = new Set(detail.disabledMcpServers);
  const extra = detail.sharedPaths.extra;

  return (
    <div className="space-y-5" data-project-panel={projectKey}>
      <ErrorBox message={error} />
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Thư mục</h2>
        <FolderPicker
          value={detail.localPath}
          label="Đổi thư mục…"
          disabled={busy}
          onPick={(path) =>
            void run(async () => {
              const result = await invoke('projects.setFolder', { key: projectKey, path });
              setValidation(result);
              if (result.ok) setDetail(await invoke('projects.detail', { key: projectKey }));
            })
          }
        />
        {validation && (
          <div className="rounded border border-line2">
            {validation.checks.map((check) => (
              <HealthCheckRow key={check.id} result={check} />
            ))}
          </div>
        )}
        {validation && !validation.ok && <Notice tone="bad">Thư mục chưa hợp lệ nên chưa được lưu.</Notice>}
      </section>

      <TestSetupSection
        detail={detail}
        disabled={busy}
        onSubmit={(setup) =>
          void run(async () =>
            setDetail(await invoke('projects.requestTestSetup', { key: projectKey, ...setup })),
          )
        }
        onRefresh={setDetail}
      />

      <BmadSection detail={detail} onInstalled={setDetail} />

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Skill & MCP của project</h2>
          <button
            type="button"
            className="btn text-xs"
            disabled={busy}
            onClick={() =>
              void run(async () => setDetail(await invoke('projects.refreshInventory', { key: projectKey })))
            }
          >
            Làm mới
          </button>
        </div>
        {!detail.inventory ? (
          <p className="text-sm text-muted">
            Chưa có kho skill (daemon dò trong worktree của project khi chạy).
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="label">MCP server ({detail.inventory.mcpServers.length})</h3>
              <div className="rounded border border-line2">
                {detail.inventory.mcpServers.length === 0 && (
                  <p className="p-3 text-sm text-muted">Không có.</p>
                )}
                {detail.inventory.mcpServers.map((server) => (
                  <div
                    key={server.name}
                    className="flex items-start gap-3 border-b border-line2 p-3 last:border-b-0"
                    data-mcp={server.name}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{server.name}</span>
                        <Lozenge tone={server.status === 'connected' ? 'ok' : 'bad'}>{server.status}</Lozenge>
                        <span className="text-xs text-muted">{server.source}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {server.tools.length} tool: {server.tools.map((tool) => tool.name).join(', ') || '—'}
                      </div>
                    </div>
                    <Toggle
                      checked={!disabled.has(server.name)}
                      disabled={busy || detail.requiredMcps.includes(server.name)}
                      label={disabled.has(server.name) ? 'Tắt' : 'Bật'}
                      onChange={(enabled) =>
                        void run(async () =>
                          setDetail(
                            await invoke('projects.setMcpEnabled', {
                              key: projectKey,
                              server: server.name,
                              enabled,
                            }),
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="label">Skill ({detail.inventory.skills.length})</h3>
              <div className="max-h-80 overflow-auto rounded border border-line2">
                {detail.inventory.skills.map((skill) => (
                  <div key={skill.name} className="border-b border-line2 px-3 py-2 last:border-b-0">
                    <span className="font-mono text-xs font-semibold">{skill.name}</span>{' '}
                    <span className="text-xs text-muted">({skill.source})</span>
                    {skill.description && <div className="text-xs text-muted">{skill.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Thư mục dùng chung cho worktree</h2>
        <p className="text-sm text-muted">
          Cấu hình agent không nằm trong git được liên kết vào mọi worktree, để agent thấy cùng skill như
          checkout chính.
        </p>
        <div className="flex flex-wrap gap-2">
          {detail.sharedPaths.detected.map((path) => (
            <Lozenge key={path} tone="gray">
              {path} (tự nhận)
            </Lozenge>
          ))}
          {extra.map((path) => (
            <span
              key={path}
              className="inline-flex items-center gap-1 rounded bg-accent-bg px-1.5 py-0.5 text-xs text-accent-ink"
            >
              {path}
              <button
                type="button"
                aria-label={`Bỏ ${path}`}
                className="font-bold"
                onClick={() =>
                  void run(async () =>
                    setDetail(
                      await invoke('projects.setSharedPaths', {
                        key: projectKey,
                        paths: extra.filter((item) => item !== path),
                      }),
                    ),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = newPath.trim();
            if (!value) return;
            void run(async () => {
              setDetail(
                await invoke('projects.setSharedPaths', { key: projectKey, paths: [...extra, value] }),
              );
              setNewPath('');
            });
          }}
        >
          <input
            className="input font-mono"
            placeholder=".cursor/rules"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button type="submit" className="btn shrink-0" disabled={busy}>
            Thêm
          </button>
        </form>
      </section>

      <section className="card flex items-center justify-between p-5">
        <div className="text-sm text-muted">Trả project: các ticket đang mở của nó chờ máy khác nhận.</div>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                `Trả project ${projectKey}? Các ticket đang mở sẽ không có máy nào chạy cho tới khi máy khác nhận.`,
              )
            )
              return;
            void run(async () => onReleased(await invoke('projects.release', { key: projectKey })));
          }}
        >
          Trả project
        </button>
      </section>
    </div>
  );
}

/** Settings → Projects: what this machine runs, each project's folder, inventory and shared paths. */
export function SettingsProjectsPage({ initialKey }: { initialKey?: string }) {
  const [view, setView] = useState<ProjectsView | null>(null);
  const [selected, setSelected] = useState<string | null>(initialKey ?? null);
  const [adding, setAdding] = useState<'claim' | 'create' | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [outcomes, setOutcomes] = useState<ClaimOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await invoke('projects.list', {});
      setView(loaded);
      const others = loaded.items.filter((item) => item.localPath === null && item.ownerState !== 'mine');
      setSelections(
        Object.fromEntries(
          Object.entries(initialSelections(others)).map(([key, value]) => [
            key,
            { ...value, checked: false },
          ]),
        ),
      );
      setSelected((current) => current ?? loaded.items.find((item) => item.localPath !== null)?.key ?? null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (initialKey) setSelected(initialKey);
  }, [initialKey]);

  const mine = view?.items.filter((item) => item.localPath !== null) ?? [];
  const others = view?.items.filter((item) => item.localPath === null && item.ownerState !== 'mine') ?? [];
  const assistantOn = view ? view.assistant.state === 'mine' || view.assistant.pendingClaim : false;

  const act = async (task: () => Promise<ClaimOutcome[] | ClaimOutcome>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      setOutcomes(Array.isArray(result) ? result : [result]);
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      <PageHeader
        title="Project của máy này"
        subtitle="Thay đổi có hiệu lực ngay, daemon không cần khởi động lại; kiểm tra sức khỏe chạy lại cho repo bị ảnh hưởng."
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setAdding(adding === 'claim' ? null : 'claim')}
            >
              Nhận thêm project
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setAdding(adding === 'create' ? null : 'create')}
            >
              Tạo project từ thư mục
            </button>
          </>
        }
      />
      <ErrorBox message={error} />
      {outcomes.length > 0 && (
        <div className="mb-4 space-y-1">
          {outcomes.map((outcome) => (
            <Notice
              key={outcome.target}
              tone={outcome.status === 'error' ? 'bad' : outcome.status === 'pending' ? 'warn' : 'ok'}
            >
              {outcome.target === 'assistant' ? 'Trợ lý' : outcome.target}: {outcome.message}
            </Notice>
          ))}
        </div>
      )}
      {adding === 'claim' && (
        <div className="mb-5 space-y-3">
          <ProjectPicker projects={others} selections={selections} onChange={setSelections} disabled={busy} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || readySelections(selections).length === 0}
            onClick={() =>
              void act(async () => {
                const result = await invoke('projects.apply', {
                  selections: readySelections(selections),
                  assistant: assistantOn,
                });
                setAdding(null);
                return result.filter((item) => item.target !== 'assistant');
              })
            }
          >
            Nhận project đã chọn
          </button>
        </div>
      )}
      {adding === 'create' && (
        <div className="card mb-5 p-5">
          <NewProjectForm
            onCreated={(outcome) => {
              setAdding(null);
              setSelected(outcome.target);
              setOutcomes([outcome]);
              void load();
            }}
          />
        </div>
      )}
      <div className="flex gap-6">
        <aside className="w-64 shrink-0 space-y-3">
          <div className="card divide-y divide-line2">
            {mine.length === 0 && <p className="p-3 text-sm text-muted">Máy này chưa chạy project nào.</p>}
            {mine.map((project) => {
              const owner = ownershipLabel(project);
              return (
                <button
                  key={project.key}
                  type="button"
                  className={`block w-full px-3 py-2.5 text-left ${selected === project.key ? 'bg-accent-bg' : 'hover:bg-soft'}`}
                  onClick={() => setSelected(project.key)}
                >
                  <div className="font-mono text-xs font-semibold">{project.key}</div>
                  <div className="truncate text-sm">{project.name}</div>
                  <Lozenge tone={owner.tone}>{owner.text}</Lozenge>
                </button>
              );
            })}
          </div>
          <div className="card p-3">
            <Toggle
              checked={assistantOn}
              disabled={busy}
              label="Máy này làm trợ lý"
              onChange={(enabled) => void act(() => invoke('projects.setAssistant', { enabled }))}
            />
            {view?.assistant.pendingClaim && (
              <p className="mt-1 text-xs text-warn-ink">Đang chờ duyệt trên web.</p>
            )}
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          {selected && mine.some((project) => project.key === selected) ? (
            <ProjectPanel
              projectKey={selected}
              onReleased={(outcome) => {
                setOutcomes([outcome]);
                setSelected(null);
                void load();
              }}
            />
          ) : (
            <p className="text-sm text-muted">Chọn một project bên trái.</p>
          )}
        </main>
      </div>
    </div>
  );
}
