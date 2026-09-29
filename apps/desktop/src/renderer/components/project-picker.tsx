import type { FolderValidation, ProjectView } from '@crew/shared';
import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { FolderPicker } from './folder-picker';
import { HealthCheckRow } from './health-check-row';
import { Lozenge, type Tone } from './ui';

export interface ProjectSelection {
  checked: boolean;
  path: string | null;
  validation: FolderValidation | null;
  validating: boolean;
}

export type Selections = Record<string, ProjectSelection>;

/** "của máy này", "chưa có máy", "đang thuộc máy X" or "Đang chờ duyệt trên web". */
export function ownershipLabel(project: ProjectView): { text: string; tone: Tone } {
  if (project.pendingClaim) return { text: 'Đang chờ duyệt trên web', tone: 'warn' };
  if (project.ownerState === 'mine') return { text: 'của máy này', tone: 'ok' };
  if (project.ownerState === 'unowned') return { text: 'chưa có máy', tone: 'gray' };
  return { text: `đang thuộc máy ${project.ownerMachineName ?? 'khác'}`, tone: 'info' };
}

export function initialSelections(projects: ProjectView[]): Selections {
  return Object.fromEntries(
    projects.map((project) => [
      project.key,
      {
        checked: project.ownerState === 'mine' || project.pendingClaim || project.localPath !== null,
        path: project.localPath,
        validation: null,
        validating: false,
      },
    ]),
  );
}

export interface ProjectPickerProps {
  projects: ProjectView[];
  selections: Selections;
  /**
   * Receives a state updater, so validations finishing in any order never overwrite each other. `byOwner` is
   * false for the automatic re-check of folders already saved on this machine.
   */
  onChange: (update: (previous: Selections) => Selections, byOwner: boolean) => void;
  disabled?: boolean;
}

const EMPTY: ProjectSelection = { checked: false, path: null, validation: null, validating: false };

/**
 * Every project on the server with its owner. Ticking one asks for its local folder, which is validated at
 * once (git repo, origin, default branch, push access, working tree).
 */
export function ProjectPicker({ projects, selections, onChange, disabled }: ProjectPickerProps) {
  const updateBy = (key: string, patch: Partial<ProjectSelection>, byOwner: boolean) =>
    onChange((previous) => ({ ...previous, [key]: { ...(previous[key] ?? EMPTY), ...patch } }), byOwner);

  const pick = async (project: ProjectView, path: string, byOwner = true) => {
    const update = (key: string, patch: Partial<ProjectSelection>) => updateBy(key, patch, byOwner);
    update(project.key, { path, validating: true, validation: null });
    try {
      const validation = await invoke('folder.validate', {
        path,
        repoUrl: project.repoUrl,
        defaultBranch: project.defaultBranch,
      });
      update(project.key, { validation, validating: false, path: validation.path });
    } catch (error) {
      update(project.key, {
        validating: false,
        validation: {
          path,
          ok: false,
          checks: [
            {
              id: 'folder.error',
              group: 'repos',
              title: 'Kiểm tra thư mục',
              status: 'red',
              detail: (error as Error).message,
            },
          ],
        },
      });
    }
  };

  // Folders already saved on this machine are validated again when the list opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per loaded project list.
  useEffect(() => {
    for (const project of projects) {
      const selection = selections[project.key];
      if (selection?.checked && selection.path && !selection.validation && !selection.validating) {
        void pick(project, selection.path, false);
      }
    }
  }, [projects]);

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted">
        Server chưa có project nào: tạo project mới từ một thư mục bên dưới.
      </p>
    );
  }
  return (
    <div className="card divide-y divide-line2">
      {projects.map((project) => {
        const selection = selections[project.key];
        const owner = ownershipLabel(project);
        return (
          <div key={project.key} className="p-4" data-project={project.key}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--blue)]"
                aria-label={`Chạy ${project.key} trên máy này`}
                checked={selection?.checked ?? false}
                disabled={disabled}
                onChange={(event) => updateBy(project.key, { checked: event.target.checked }, true)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted">{project.key}</span>
                  <span className="font-medium">{project.name}</span>
                  <Lozenge tone={owner.tone}>{owner.text}</Lozenge>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {project.repoUrl} · nhánh {project.defaultBranch}
                </div>
                {selection?.checked && (
                  <div className="mt-3 space-y-2">
                    <FolderPicker
                      value={selection.path}
                      disabled={disabled}
                      onPick={(path) => void pick(project, path)}
                    />
                    {selection.validating && (
                      <p className="text-xs text-muted">Đang kiểm tra thư mục (có push thử)…</p>
                    )}
                    {selection.validation && (
                      <div className="rounded border border-line2">
                        {selection.validation.checks.map((check) => (
                          <HealthCheckRow key={check.id} result={check} />
                        ))}
                      </div>
                    )}
                    {project.ownerState === 'other' && !project.pendingClaim && (
                      <p className="text-xs text-warn-ink">
                        Project này đang thuộc máy {project.ownerMachineName ?? 'khác'}: nhận nó cần chủ dự án
                        duyệt trên web.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The ticked projects whose folder validated (no red check). */
export function readySelections(selections: Selections): { key: string; path: string }[] {
  return Object.entries(selections)
    .filter(([, selection]) => selection.checked && selection.path && (selection.validation?.ok ?? false))
    .map(([key, selection]) => ({ key, path: selection.path as string }));
}

/** Ticked projects still missing a folder, or with a folder that failed. */
export function unreadySelections(selections: Selections): string[] {
  return Object.entries(selections)
    .filter(([, selection]) => selection.checked && !(selection.path && selection.validation?.ok))
    .map(([key]) => key);
}
