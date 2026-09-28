import type { ClaimOutcome, FolderValidation, ProjectDetail, ProjectsView } from '@crew/shared';
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
import { invoke } from '../lib/ipc';

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

      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">Loại project và MCP test UI</h2>
        <p className="text-sm">
          Loại: <strong>{detail.platform ? PLATFORM_LABELS[detail.platform] : '—'}</strong>
          {detail.uiTestMcp && (
            <>
              {' '}
              · test UI web: <code>{detail.uiTestMcp.playwright}</code> · test UI mobile:{' '}
              <code>{detail.uiTestMcp.maestro}</code>
            </>
          )}
        </p>
        <p className="text-sm text-muted">
          QC bắt buộc dùng:{' '}
          {detail.requiredMcps.length ? detail.requiredMcps.join(', ') : 'không có (backend)'}. Mặc định
          Maestro cho mobile, Playwright cho web; có thể trỏ sang server tên khác.
        </p>
        {detail.webSettingsUrl && (
          <button
            type="button"
            className="btn text-xs"
            onClick={() => void invoke('app.openExternal', { url: detail.webSettingsUrl as string })}
          >
            Đổi loại và MCP trên web
          </button>
        )}
      </section>

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
