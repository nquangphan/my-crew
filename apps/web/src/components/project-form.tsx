import {
  CreateProjectRequest,
  type Machine,
  type Project,
  type ProjectPlatform,
  UpdateProjectRequest,
} from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../lib/api-client';
import { errorMessage } from '../lib/format';
import { keys, useMachines } from '../lib/queries';
import { Button } from './ui/button';
import { DialogContent, DialogRoot } from './ui/dialog';
import { Field, Input, Select, Textarea } from './ui/field';
import { useToast } from './ui/toast';

export const PLATFORM_LABEL: Record<ProjectPlatform, string> = {
  web: 'Web',
  mobile: 'Mobile',
  web_mobile: 'Web và mobile',
  backend: 'Backend',
};

interface Draft {
  key: string;
  name: string;
  description: string;
  repoUrl: string;
  defaultBranch: string;
  platform: ProjectPlatform;
  playwright: string;
  maestro: string;
  maxChildrenPerTicket: string;
  ticketTreeBudgetUsd: string;
  dailyBudgetUsd: string;
}

function draftOf(project: Project | null): Draft {
  return {
    key: project?.key ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    repoUrl: project?.repoUrl ?? '',
    defaultBranch: project?.defaultBranch ?? 'main',
    platform: project?.platform ?? 'web',
    playwright: project?.uiTestMcp.playwright ?? 'playwright',
    maestro: project?.uiTestMcp.maestro ?? 'maestro',
    maxChildrenPerTicket: String(project?.maxChildrenPerTicket ?? 12),
    ticketTreeBudgetUsd: project?.ticketTreeBudgetUsd?.toString() ?? '',
    dailyBudgetUsd: project?.dailyBudgetUsd?.toString() ?? '',
  };
}

const money = (value: string) => (value.trim() === '' ? null : Number(value));

/** Builds the request body; the shared schema validates it before anything is sent. */
function bodyOf(draft: Draft) {
  return {
    name: draft.name,
    description: draft.description,
    repoUrl: draft.repoUrl.trim(),
    defaultBranch: draft.defaultBranch,
    platform: draft.platform,
    uiTestMcp: { playwright: draft.playwright.trim(), maestro: draft.maestro.trim() },
    maxChildrenPerTicket: Number(draft.maxChildrenPerTicket),
    ticketTreeBudgetUsd: money(draft.ticketTreeBudgetUsd),
    dailyBudgetUsd: money(draft.dailyBudgetUsd),
  };
}

const FIELD_TEXT: Record<string, string> = {
  key: 'Key gồm 2–10 chữ in hoa hoặc số, bắt đầu bằng chữ (AST dành cho request).',
  name: 'Nhập tên dự án.',
  description: 'Nhập mô tả; trợ lý dùng nó để chọn dự án.',
  repoUrl: 'Repo phải bắt đầu bằng https:// hoặc git@.',
  defaultBranch: 'Nhập nhánh mặc định.',
  maxChildrenPerTicket: 'Số ticket con từ 1 đến 200.',
  ticketTreeBudgetUsd: 'Ngân sách phải là số dương, hoặc để trống.',
  dailyBudgetUsd: 'Ngân sách phải là số dương, hoặc để trống.',
  uiTestMcp: 'Tên MCP chỉ gồm chữ, số, _ . -',
};

/**
 * Create or edit a project: key, name, the description (the only text the assistant uses for routing),
 * repo, default branch, platform and UI-test MCP servers, the child cap and the optional budgets.
 */
export function ProjectForm({
  project,
  onDone,
}: {
  project: Project | null;
  onDone?: (project: Project) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = bodyOf(draft);
    const parsed = project
      ? UpdateProjectRequest.safeParse(body)
      : CreateProjectRequest.safeParse({ ...body, key: draft.key.trim() });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        next[field] = FIELD_TEXT[field] ?? issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const saved = project
        ? await api.updateProject(project.id, body)
        : await api.createProject({ ...body, key: draft.key.trim() });
      await queryClient.invalidateQueries({ queryKey: keys.projects });
      toast(project ? `Đã lưu ${saved.key}` : `Đã tạo dự án ${saved.key}`, 'success');
      onDone?.(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={project ? `Sửa dự án ${project.key}` : 'Tạo dự án'}
    >
      <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
        <Field label="Key" error={errors.key}>
          <Input
            value={draft.key}
            onChange={(e) => set({ key: e.target.value.toUpperCase() })}
            disabled={project !== null}
            maxLength={10}
            className="font-mono"
            required
          />
        </Field>
        <Field label="Tên" error={errors.name}>
          <Input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={120}
            required
          />
        </Field>
      </div>
      <Field
        label="Mô tả"
        hint="Trợ lý chỉ dùng mô tả này để chọn dự án cho request. Không lấy từ repo."
        error={errors.description}
      >
        <Textarea
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={4}
          maxLength={10_000}
          required
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
        <Field label="Repo" error={errors.repoUrl}>
          <Input
            value={draft.repoUrl}
            onChange={(e) => set({ repoUrl: e.target.value })}
            placeholder="https://github.com/…"
            required
          />
        </Field>
        <Field label="Nhánh mặc định" error={errors.defaultBranch}>
          <Input
            value={draft.defaultBranch}
            onChange={(e) => set({ defaultBranch: e.target.value })}
            required
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Nền tảng" hint="Quyết định MCP test UI của QC.">
          <Select
            value={draft.platform}
            onChange={(e) => set({ platform: e.target.value as ProjectPlatform })}
          >
            {Object.entries(PLATFORM_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="MCP Playwright" error={errors.uiTestMcp}>
          <Input
            value={draft.playwright}
            onChange={(e) => set({ playwright: e.target.value })}
            className="font-mono"
          />
        </Field>
        <Field label="MCP Maestro">
          <Input
            value={draft.maestro}
            onChange={(e) => set({ maestro: e.target.value })}
            className="font-mono"
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Tối đa ticket con" error={errors.maxChildrenPerTicket}>
          <Input
            type="number"
            min={1}
            max={200}
            value={draft.maxChildrenPerTicket}
            onChange={(e) => set({ maxChildrenPerTicket: e.target.value })}
          />
        </Field>
        <Field
          label="Ngân sách mỗi PM task ($)"
          hint="Để trống: không giới hạn."
          error={errors.ticketTreeBudgetUsd}
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draft.ticketTreeBudgetUsd}
            onChange={(e) => set({ ticketTreeBudgetUsd: e.target.value })}
          />
        </Field>
        <Field label="Ngân sách mỗi ngày ($)" hint="Để trống: không giới hạn." error={errors.dailyBudgetUsd}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draft.dailyBudgetUsd}
            onChange={(e) => set({ dailyBudgetUsd: e.target.value })}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Đang lưu…' : project ? 'Lưu' : 'Tạo dự án'}
        </Button>
      </div>
    </form>
  );
}

/** Moves a project to another machine; the owner confirms, then open tickets move with it. */
export function ReassignDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const machines = useMachines();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [machineId, setMachineId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = (machines.data ?? []).filter(
    (m: Machine) => m.revokedAt === null && m.id !== project.ownerMachineId,
  );
  const current = machines.data?.find((m) => m.id === project.ownerMachineId);
  const target = candidates.find((m) => m.id === machineId);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.assignToMachine(target.id, { projectId: project.id });
      toast(`${project.key} đã chuyển sang ${target.name}`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.projects }),
        queryClient.invalidateQueries({ queryKey: keys.machines }),
        queryClient.invalidateQueries({ queryKey: keys.tickets }),
      ]);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Chuyển ${project.key} sang máy khác`}
        description={`Máy hiện tại: ${current?.name ?? 'chưa có'}. Ticket đang mở của dự án chuyển theo; job đang chạy trên máy cũ sẽ dừng.`}
      >
        <div className="flex flex-col gap-4">
          <Field label="Máy mới">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">Chọn máy…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.online ? m.name : `${m.name} (offline)`}
                </option>
              ))}
            </Select>
          </Field>
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Hủy</Button>
            <Button variant="primary" disabled={!target || busy} onClick={() => void confirm()}>
              {target ? `Chuyển sang ${target.name}` : 'Chuyển'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
