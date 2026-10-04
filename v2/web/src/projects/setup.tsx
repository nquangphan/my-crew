/**
 * “Tạo dự án / Gắn máy”: creates a project and binds (or rebinds) a machine checkout over the accepted
 * `/v2/projects` routes. Every write goes through the pending store with one fixed intent per action, so an
 * unconfirmed request is replayed with its original key and bytes. A rejected request (409 included) keeps
 * everything the owner typed; applying it again on refreshed data uses a new key. A rebind that the server
 * blocks because an execution is still active or unreconciled is explained, never forced or worked around.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useId, useState } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { decodeProject, type Machine, type Project } from '../contracts/machines.ts';
import { queryRoots } from '../lib/query-keys.ts';
import { DiscardHeld } from '../machines/held-discard.tsx';
import {
  heldOperation,
  machinesQueryOptions,
  onboardingFailureText,
  readFailureText,
  submitIntent,
  useUnresolved,
} from '../machines/onboarding-state.ts';
import { projectsQueryOptions } from '../tickets/queries.ts';
import {
  checkoutPathError,
  projectKeyError,
  projectNameError,
  projectNameMax,
  repositoryUrlMax,
  repositoryUrlValue,
} from './setup-state.ts';

const fieldStyle: CSSProperties = { display: 'grid', gap: '0.25rem', maxWidth: '32rem' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.4rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const panelStyle: CSSProperties = {
  border: '1px solid currentColor',
  borderRadius: '0.75rem',
  padding: '1rem',
  display: 'grid',
  gap: '0.75rem',
};
const createIntent = 'project:create';
const bindIntent = (projectId: string) => `project-bind:${projectId}`;

type CreateBody = { key: string; name: string; repositoryUrl: string | null };

function CreateProjectForm() {
  const { client, pending } = useRuntime();
  const cache = useQueryClient();
  const ids = { key: useId(), name: useId(), repo: useId() };
  const [fields, setFields] = useState({ key: '', name: '', repositoryUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entry = useUnresolved(pending, createIntent);
  const held = heldOperation(entry);
  const heldBody = held ? (JSON.parse(held.bodyJson) as CreateBody) : null;
  const shown = heldBody
    ? { key: heldBody.key, name: heldBody.name, repositoryUrl: heldBody.repositoryUrl ?? '' }
    : fields;

  const submit = async () => {
    setCreated(null);
    let body: CreateBody;
    if (heldBody) body = heldBody;
    else {
      const repository = repositoryUrlValue(fields.repositoryUrl);
      const problem =
        projectKeyError(fields.key) ??
        projectNameError(fields.name) ??
        (repository.ok ? null : repository.error);
      if (problem || !repository.ok) {
        setError(problem);
        return;
      }
      body = { key: fields.key, name: fields.name.trim(), repositoryUrl: repository.value };
    }
    setError(null);
    setBusy(true);
    try {
      const project = await submitIntent(
        pending,
        client,
        { intentId: createIntent, method: 'POST', path: '/v2/projects', body },
        decodeProject,
      );
      setFields({ key: '', name: '', repositoryUrl: '' });
      setCreated(`Đã tạo dự án “${project.name}” (${project.key}). Gắn máy ở danh sách bên dưới.`);
      void cache.invalidateQueries({ queryKey: queryRoots.projects });
    } catch (failure) {
      setError(onboardingFailureText(failure, 'project'));
    } finally {
      setBusy(false);
      void cache.invalidateQueries({ queryKey: queryRoots.projects });
    }
  };

  const locked = busy || held !== null;
  return (
    <form
      aria-label="Biểu mẫu tạo dự án"
      style={{ ...panelStyle, maxWidth: '36rem' }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void submit();
      }}
    >
      <h2 style={{ margin: 0 }}>Tạo dự án</h2>
      <div style={fieldStyle}>
        <label htmlFor={ids.key}>Mã dự án</label>
        <input
          id={ids.key}
          type="text"
          autoComplete="off"
          value={shown.key}
          disabled={locked}
          maxLength={64}
          aria-describedby={`${ids.key}-hint`}
          onChange={(event) => setFields({ ...fields, key: event.currentTarget.value })}
        />
        <span id={`${ids.key}-hint`}>Chữ in hoa, số, “_” hoặc “-”, 2–32 ký tự. Ví dụ CREW.</span>
      </div>
      <div style={fieldStyle}>
        <label htmlFor={ids.name}>Tên dự án</label>
        <input
          id={ids.name}
          type="text"
          autoComplete="off"
          value={shown.name}
          disabled={locked}
          maxLength={projectNameMax * 2}
          onChange={(event) => setFields({ ...fields, name: event.currentTarget.value })}
        />
      </div>
      <div style={fieldStyle}>
        <label htmlFor={ids.repo}>URL repository (không bắt buộc)</label>
        <input
          id={ids.repo}
          type="text"
          autoComplete="off"
          value={shown.repositoryUrl}
          disabled={locked}
          maxLength={repositoryUrlMax * 2}
          onChange={(event) => setFields({ ...fields, repositoryUrl: event.currentTarget.value })}
        />
      </div>
      {held && (
        <p role="status" style={{ margin: 0 }}>
          Yêu cầu tạo dự án chưa được xác nhận. Gửi lại đúng yêu cầu cũ để không tạo bản trùng.
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {created && (
        <p role="status" style={{ margin: 0 }}>
          {created}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="submit" style={buttonStyle} disabled={busy}>
          {held ? 'Gửi lại đúng yêu cầu cũ' : 'Tạo dự án'}
        </button>
        {entry && (
          <DiscardHeld
            disabled={busy}
            warning="Máy chủ có thể đã tạo dự án này. Nếu bỏ yêu cầu cũ rồi tạo lại, có thể tạo bản trùng. Các trường đã nhập được giữ lại."
            onDiscard={() => {
              pending.reject(entry.id);
              if (heldBody)
                setFields({
                  key: heldBody.key,
                  name: heldBody.name,
                  repositoryUrl: heldBody.repositoryUrl ?? '',
                });
              setError(null);
            }}
          />
        )}
      </div>
    </form>
  );
}

type BindDraft = { machineId: string; checkoutPath: string };
type BindBody = BindDraft & { expectedRevision: number };

function BindingSection({ project, machines }: { project: Project; machines: Machine[] }) {
  const { client, pending } = useRuntime();
  const cache = useQueryClient();
  const ids = { machine: useId(), path: useId() };
  const [draft, setDraft] = useState<BindDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const intent = bindIntent(project.id);
  const entry = useUnresolved(pending, intent);
  const held = heldOperation(entry);
  const heldBody = held ? (JSON.parse(held.bodyJson) as BindBody) : null;

  const live = machines.filter((machine) => !machine.revokedAt);
  const bound = machines.find((machine) => machine.id === project.machineId);
  const fromServer: BindDraft = {
    machineId: live.some((machine) => machine.id === project.machineId) ? (project.machineId ?? '') : '',
    checkoutPath: project.checkoutPath ?? '',
  };
  const shown: BindDraft = heldBody ?? draft ?? fromServer;

  const submit = async () => {
    setDone(null);
    let body: BindBody;
    if (heldBody) body = heldBody;
    else {
      const problem = shown.machineId === '' ? 'Chọn máy cần gắn.' : checkoutPathError(shown.checkoutPath);
      if (problem) {
        setError(problem);
        return;
      }
      body = { ...shown, expectedRevision: project.bindingRevision };
      // Freeze what the owner sent: a refetch after a conflict must not overwrite these fields.
      setDraft(shown);
    }
    setError(null);
    setBusy(true);
    try {
      await submitIntent(
        pending,
        client,
        { intentId: intent, method: 'PUT', path: `/v2/projects/${project.id}/binding`, body },
        decodeProject,
      );
      setDraft(null);
      setDone('Đã lưu liên kết máy và đường dẫn.');
    } catch (failure) {
      setError(onboardingFailureText(failure, 'binding'));
    } finally {
      setBusy(false);
      // Always re-read: a conflict means another tab changed the revision, a success changed it ourselves.
      void cache.invalidateQueries({ queryKey: queryRoots.projects });
    }
  };

  const locked = busy || held !== null;
  const rebinding = project.machineId !== null;
  return (
    <section style={panelStyle} aria-label={`Gắn máy cho dự án ${project.name}`}>
      <h3 style={{ margin: 0 }}>{project.name}</h3>
      <p style={{ margin: 0 }}>
        <code>{project.key}</code> ·{' '}
        {rebinding
          ? `Đang gắn ${bound ? bound.name : 'máy không rõ'}${bound?.revokedAt ? ' (đã thu hồi)' : ''} · ${project.checkoutPath ?? ''} · Revision ${project.bindingRevision}`
          : `Chưa gắn máy · Revision ${project.bindingRevision}`}
      </p>
      <form
        style={{ display: 'grid', gap: '0.75rem' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <div style={fieldStyle}>
          <label htmlFor={ids.machine}>Máy</label>
          <select
            id={ids.machine}
            value={shown.machineId}
            disabled={locked}
            onChange={(event) => setDraft({ ...shown, machineId: event.currentTarget.value })}
          >
            <option value="">Chọn máy</option>
            {live.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.name}
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label htmlFor={ids.path}>Đường dẫn checkout</label>
          <input
            id={ids.path}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={shown.checkoutPath}
            disabled={locked}
            aria-describedby={`${ids.path}-hint`}
            onChange={(event) => setDraft({ ...shown, checkoutPath: event.currentTarget.value })}
          />
          <span id={`${ids.path}-hint`}>Đường dẫn tuyệt đối của thư mục repository trên máy đã chọn.</span>
        </div>
        {held && (
          <p role="status" style={{ margin: 0 }}>
            Yêu cầu gắn máy chưa được xác nhận. Gửi lại đúng yêu cầu cũ (revision {heldBody?.expectedRevision}
            ).
          </p>
        )}
        {error && (
          <p role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {done && (
          <p role="status" style={{ margin: 0 }}>
            {done}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" style={buttonStyle} disabled={busy || (live.length === 0 && !held)}>
            {held ? 'Gửi lại đúng yêu cầu cũ' : rebinding ? 'Đổi máy' : 'Gắn máy'}
          </button>
          {entry && (
            <DiscardHeld
              disabled={busy}
              warning="Máy chủ có thể đã áp dụng yêu cầu cũ. Nếu bỏ, các trường đã nhập được giữ lại và bạn áp dụng lại trên revision mới đọc từ máy chủ; kiểm tra kết quả trước khi áp dụng."
              onDiscard={async () => {
                pending.reject(entry.id);
                if (heldBody)
                  setDraft({ machineId: heldBody.machineId, checkoutPath: heldBody.checkoutPath });
                setError(null);
                await cache.invalidateQueries({ queryKey: queryRoots.projects });
              }}
            />
          )}
        </div>
      </form>
    </section>
  );
}

export function ProjectSetup() {
  const { client } = useRuntime();
  const projects = useQuery(projectsQueryOptions(client));
  const machines = useQuery(machinesQueryOptions(client));
  return (
    <section className="page-stack" aria-labelledby="project-setup-heading">
      <div className="page-intro">
        <h1 id="project-setup-heading">Tạo dự án và gắn máy</h1>
        <p>
          Tạo dự án, rồi chọn máy đã đăng ký và nhập đường dẫn thư mục repository trên máy đó. Việc đổi máy bị
          chặn khi dự án còn tiến trình chưa đối chiếu.
        </p>
      </div>
      <CreateProjectForm />
      <section aria-labelledby="project-bind-heading" style={{ display: 'grid', gap: '0.75rem' }}>
        <h2 id="project-bind-heading">Gắn máy cho dự án</h2>
        {machines.data?.length === 0 && (
          <p role="status">
            Chưa có máy nào được đăng ký. Mở mục “Đăng ký máy” ở thanh bên để đăng ký máy trước khi gắn.
          </p>
        )}
        {(projects.isPending || machines.isPending) && <p role="status">Đang tải dự án và máy…</p>}
        {(projects.error || machines.error) && (
          <p role="alert">
            Không tải được dữ liệu: {readFailureText(projects.error ?? machines.error)}{' '}
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                void projects.refetch();
                void machines.refetch();
              }}
            >
              Thử lại
            </button>
          </p>
        )}
        {projects.data?.length === 0 && <p>Chưa có dự án nào. Tạo dự án ở biểu mẫu phía trên.</p>}
        {projects.data && machines.data
          ? projects.data.map((project) => (
              <BindingSection key={project.id} project={project} machines={machines.data} />
            ))
          : null}
      </section>
    </section>
  );
}
