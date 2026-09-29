import type { ClaimOutcome, FolderValidation, ProjectPlatform } from '@crew/shared';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { errorText } from '../lib/format';
import { invoke } from '../lib/ipc';
import { FolderPicker } from './folder-picker';
import { HealthCheckRow } from './health-check-row';
import { ErrorBox, Notice } from './ui';

export const PLATFORM_LABELS: Record<ProjectPlatform, string> = {
  web: 'Web',
  mobile: 'Mobile',
  web_mobile: 'Web + mobile',
  backend: 'Backend',
};

interface Draft {
  path: string | null;
  key: string;
  name: string;
  description: string;
  repoUrl: string;
  defaultBranch: string;
  platform: ProjectPlatform;
  playwright: string;
  maestro: string;
}

const EMPTY: Draft = {
  path: null,
  key: '',
  name: '',
  description: '',
  repoUrl: '',
  defaultBranch: 'main',
  platform: 'web',
  playwright: 'playwright',
  maestro: 'maestro',
};

/** What still blocks creating the drafted project, in words the owner acts on; null when it is ready. */
export function draftProblem(draft: Pick<Draft, 'key' | 'name' | 'description' | 'repoUrl'>): string | null {
  const problems: string[] = [];
  const missing: string[] = [];
  const key = draft.key.trim().toUpperCase();
  if (!key) missing.push('key');
  else if (key.length > 10) problems.push(`Key dài ${key.length} ký tự, tối đa 10.`);
  else if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    problems.push('Key phải có 2–10 chữ in hoa hoặc số, bắt đầu bằng chữ.');
  }
  if (!draft.name.trim()) missing.push('tên');
  if (!draft.repoUrl.trim()) missing.push('repo URL');
  if (!draft.description.trim()) missing.push('mô tả');
  if (missing.length > 0) problems.push(`Còn thiếu ${missing.join(', ')}.`);
  return problems.length > 0 ? problems.join(' ') : null;
}

export interface NewProjectFormHandle {
  /** A folder is picked and its project is not created yet. */
  hasDraft: () => boolean;
  /** Validates and creates the drafted project; null when it could not (the form shows why). */
  submit: () => Promise<ClaimOutcome | null>;
}

export interface NewProjectFormProps {
  onCreated: (outcome: ClaimOutcome) => void;
  /** True while a picked folder waits to be created, so the page never moves on without it. */
  onDraftChange?: (pending: boolean) => void;
  /** Lets the setup wizard's "Lưu và nhận project" create the drafted project too. */
  ref?: Ref<NewProjectFormHandle>;
}

/**
 * "Thêm project mới từ thư mục": the folder prefills key, name, repo URL and branch from `origin`. The owner
 * types the description (the assistant routes tickets by it; it is never read from the repo).
 */
export function NewProjectForm({ onCreated, onDraftChange, ref }: NewProjectFormProps) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [validation, setValidation] = useState<FolderValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const draftChange = useRef(onDraftChange);
  draftChange.current = onDraftChange;

  useEffect(() => {
    draftChange.current?.(draft.path !== null);
  }, [draft.path]);
  // Hiding the form drops the draft.
  useEffect(
    () => () => {
      draftChange.current?.(false);
    },
    [],
  );

  const pick = async (path: string) => {
    setError(null);
    setValidation(null);
    try {
      const info = await invoke('folder.inspect', { path });
      if (!info.isRepo) {
        setError(`${info.path} không phải repo git.`);
        return;
      }
      set({
        path: info.path,
        key: info.suggestedKey,
        name: info.suggestedName,
        repoUrl: info.origin ?? '',
        defaultBranch: info.defaultBranch ?? 'main',
      });
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const submit = async (): Promise<ClaimOutcome | null> => {
    if (!draft.path) return null;
    const problem = draftProblem(draft);
    if (problem) {
      setError(`Chưa tạo được project: ${problem}`);
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const checked = await invoke('folder.validate', {
        path: draft.path,
        repoUrl: draft.repoUrl,
        defaultBranch: draft.defaultBranch,
      });
      setValidation(checked);
      if (!checked.ok) {
        setError('Thư mục chưa hợp lệ: xem các dòng đỏ ở trên.');
        return null;
      }
      const outcome = await invoke('projects.create', {
        path: draft.path,
        key: draft.key.trim().toUpperCase(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        repoUrl: draft.repoUrl.trim(),
        defaultBranch: draft.defaultBranch.trim(),
        platform: draft.platform,
        uiTestMcp: { playwright: draft.playwright.trim(), maestro: draft.maestro.trim() },
      });
      setDraft(EMPTY);
      setValidation(null);
      return outcome;
    } catch (caught) {
      setError(errorText(caught));
      return null;
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({ hasDraft: () => draft.path !== null, submit }));

  const problem = draftProblem(draft);
  const needsPlaywright = draft.platform === 'web' || draft.platform === 'web_mobile';
  const needsMaestro = draft.platform === 'mobile' || draft.platform === 'web_mobile';

  return (
    <div className="space-y-3" data-form="new-project">
      <FolderPicker
        value={draft.path}
        onPick={(path) => void pick(path)}
        label="Chọn thư mục repo…"
        disabled={busy}
      />
      {draft.path && (
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Key</span>
            <input
              className="input font-mono"
              value={draft.key}
              onChange={(e) => set({ key: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            <span className="label">Tên</span>
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="col-span-2">
            <span className="label">Repo URL (origin)</span>
            <input
              className="input font-mono text-xs"
              value={draft.repoUrl}
              onChange={(e) => set({ repoUrl: e.target.value })}
            />
          </label>
          <label>
            <span className="label">Nhánh mặc định</span>
            <input
              className="input font-mono"
              value={draft.defaultBranch}
              onChange={(e) => set({ defaultBranch: e.target.value })}
            />
          </label>
          <label>
            <span className="label">Loại project</span>
            <select
              className="input"
              value={draft.platform}
              onChange={(e) => set({ platform: e.target.value as ProjectPlatform })}
            >
              {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {needsPlaywright && (
            <label>
              <span className="label">MCP test UI web (mặc định Playwright)</span>
              <input
                className="input font-mono"
                value={draft.playwright}
                onChange={(e) => set({ playwright: e.target.value })}
              />
            </label>
          )}
          {needsMaestro && (
            <label>
              <span className="label">MCP test UI mobile (mặc định Maestro)</span>
              <input
                className="input font-mono"
                value={draft.maestro}
                onChange={(e) => set({ maestro: e.target.value })}
              />
            </label>
          )}
          <label className="col-span-2">
            <span className="label">Mô tả (trợ lý dùng mô tả này để chuyển ticket đúng project)</span>
            <textarea
              className="input min-h-20"
              value={draft.description}
              placeholder="Ví dụ: Cửa hàng trực tuyến bán đồ gia dụng, gồm web khách hàng và trang quản trị."
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
        </div>
      )}
      {validation && !validation.ok && (
        <div className="rounded border border-line2">
          {validation.checks.map((check) => (
            <HealthCheckRow key={check.id} result={check} />
          ))}
        </div>
      )}
      <ErrorBox message={error} />
      {draft.path && (
        <div className="flex items-center justify-between gap-3">
          <Notice tone={problem ? 'warn' : 'gray'}>
            {problem ?? 'Máy này sẽ sở hữu project mới ngay khi tạo.'}
          </Notice>
          <button
            type="button"
            className="btn btn-primary"
            disabled={problem !== null || busy}
            onClick={() =>
              void submit().then((outcome) => {
                if (outcome) onCreated(outcome);
              })
            }
          >
            {busy ? 'Đang tạo…' : 'Tạo project'}
          </button>
        </div>
      )}
    </div>
  );
}
