import type { ClaimOutcome, FolderValidation, ProjectPlatform } from '@crew/shared';
import { useState } from 'react';
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

/**
 * "Thêm project mới từ thư mục": the folder prefills key, name, repo URL and branch from `origin`. The owner
 * types the description (the assistant routes tickets by it; it is never read from the repo).
 */
export function NewProjectForm({ onCreated }: { onCreated: (outcome: ClaimOutcome) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [validation, setValidation] = useState<FolderValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

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

  const submit = async () => {
    if (!draft.path) return;
    setBusy(true);
    setError(null);
    try {
      const checked = await invoke('folder.validate', {
        path: draft.path,
        repoUrl: draft.repoUrl,
        defaultBranch: draft.defaultBranch,
      });
      setValidation(checked);
      if (!checked.ok) return;
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
      onCreated(outcome);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    draft.path &&
    /^[A-Z][A-Z0-9]{1,9}$/.test(draft.key.trim().toUpperCase()) &&
    draft.name.trim() &&
    draft.description.trim() &&
    draft.repoUrl.trim();
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
          <Notice tone="gray">Máy này sẽ sở hữu project mới ngay khi tạo.</Notice>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Đang tạo…' : 'Tạo project'}
          </button>
        </div>
      )}
    </div>
  );
}
