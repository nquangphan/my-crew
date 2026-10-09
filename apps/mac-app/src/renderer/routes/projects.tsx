import { useCallback, useEffect, useState } from 'react';
import type { AddProjectInput, ProjectRow } from '../../shared/ipc-contract';
import { ErrorBox, Lozenge, Notice, PageHeader } from '../components/ui';
import { invoke, useStateChanged } from '../lib/ipc';

type Progress = NonNullable<ProjectRow['progress']>;

const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
const KEY_HINT = 'Khóa chỉ gồm chữ thường, số, dấu gạch ngang, bắt đầu bằng chữ, dài 2–31 ký tự.';
const FIXED_LABELS: Record<string, string> = {
  'ls-remote': 'Kiểm tra đọc được repo bằng git',
  mirror: 'Clone repo docs',
  project: 'Tạo project trên Paperclip',
  'status-repo': 'Đăng ký repo ảnh chụp docs',
  roles: 'Ghi vai trò của project',
  check: 'Kiểm tra cuối',
};

/** Tên bước tiếng Việt (`role:<vai>` là tạo checkout, environment và agent của vai đó). */
export function stepLabel(step: string): string {
  if (step.startsWith('role:')) return `Tạo agent ${step.slice(5)}`;
  return FIXED_LABELS[step] ?? step;
}

function executorsOf(progress: Progress): 1 | 2 {
  return Object.keys(progress.agents).filter((r) => r.startsWith('executor-')).length >= 2 ? 2 : 1;
}

/** Thứ tự các bước của một lần thêm, khớp `AddRun.all()` của Main. */
function expectedSteps(progress: Progress): string[] {
  const roles = [
    ...(executorsOf(progress) === 2 ? ['executor-1', 'executor-2'] : ['executor-1']),
    'assistant',
    'reviewer',
    'integrator',
  ];
  return [
    'ls-remote',
    'mirror',
    'project',
    'status-repo',
    ...roles.map((r) => `role:${r}`),
    'roles',
    'check',
  ];
}

function currentStep(progress: Progress): string | null {
  return expectedSteps(progress).find((s) => !(progress.done as string[]).includes(s)) ?? null;
}

const short = (commit: string | null) => (commit ? commit.slice(0, 7) : '—');
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ProgressView({
  progress,
  busy,
  onResume,
}: {
  progress: Progress;
  busy: boolean;
  onResume: () => void;
}) {
  const steps = expectedSteps(progress);
  const done = steps.filter((s) => (progress.done as string[]).includes(s)).length;
  if (done === steps.length && !progress.error) return null;
  const step = currentStep(progress);
  return (
    <div>
      <p className="muted">
        Đã xong {done}/{steps.length} bước.
        {step && ` Đang ở bước: ${stepLabel(step)}`}
        {busy && ' (đang chạy; clone có thể mất tới 10 phút, chờ duyệt agent tới 30 phút)'}
      </p>
      {progress.error && (
        <div role="alert" className="notice tone-bad">
          {progress.error}
        </div>
      )}
      {!busy && (
        <button type="button" className="btn primary" onClick={onResume}>
          Chạy tiếp
        </button>
      )}
    </div>
  );
}

function AddForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (input: AddProjectInput) => void;
  onCancel: () => void;
}) {
  const [origin, setOrigin] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [executors, setExecutors] = useState<1 | 2>(1);
  const keyOk = KEY_RE.test(key);
  const ready = origin.trim() !== '' && name.trim() !== '' && keyOk && !busy;
  return (
    <section className="wizard-card" aria-label="Thêm project">
      <h2>Thêm project</h2>
      <p className="muted">
        App clone repo vào ~/crew-projects và ~/crew-agents trên máy này rồi tạo project, environment và agent
        trên Paperclip.
      </p>
      <label className="field">
        URL git (origin)
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="git@github.com:org/repo.git"
        />
      </label>
      <label className="field">
        Tên project
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Khóa
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="landing" />
      </label>
      {key !== '' && !keyOk && <Notice tone="warn">{KEY_HINT}</Notice>}
      <fieldset>
        <legend>Số executor</legend>
        <label>
          <input type="radio" name="executors" checked={executors === 1} onChange={() => setExecutors(1)} />1
          executor
        </label>{' '}
        <label>
          <input type="radio" name="executors" checked={executors === 2} onChange={() => setExecutors(2)} />2
          executor
        </label>
      </fieldset>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={!ready}
          onClick={() => onSubmit({ origin: origin.trim(), name: name.trim(), key, executors })}
        >
          Bắt đầu thêm
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Đóng
        </button>
      </div>
    </section>
  );
}

export function ProjectsScreen() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [removal, setRemoval] = useState<{ name: string; removed: string[]; manualCommand: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    invoke('projects:list')
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((e: unknown) => setError(messageOf(e)));
  }, []);
  useEffect(load, [load]);
  useStateChanged(load);

  const add = (input: AddProjectInput) => {
    setBusyKeys((keys) => [...keys, input.key]);
    setError(null);
    invoke('projects:add', input)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => {
        setBusyKeys((keys) => keys.filter((k) => k !== input.key));
        load();
      });
  };
  const submit = (input: AddProjectInput) => {
    setAdding(false);
    add(input);
  };

  const remove = (row: ProjectRow) => {
    if (
      !window.confirm(
        `Gỡ "${row.name}" khỏi Mac? App sẽ pause agent, archive environment và bỏ repo docs khỏi bản tin. Thư mục trên máy giữ nguyên.`,
      )
    )
      return;
    invoke('projects:remove', row.projectId)
      .then((result) => {
        setRemoval({ name: row.name, ...result });
        setCopied(false);
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(load);
  };
  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <>
      <PageHeader
        title="Project"
        subtitle={rows ? `${rows.length} project` : 'Đang đọc danh sách project...'}
        actions={
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            Thêm project
          </button>
        }
      />
      <ErrorBox message={error} />
      {adding && <AddForm busy={false} onSubmit={submit} onCancel={() => setAdding(false)} />}
      {removal && (
        <Notice tone="ok">
          <p>Đã gỡ "{removal.name}" khỏi Mac:</p>
          <ul>
            {removal.removed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {removal.manualCommand ? (
            <>
              <p>Để xóa thư mục trên máy, tự chạy lệnh này trong Terminal (app không xóa giúp):</p>
              <p>
                <code className="mono">{removal.manualCommand}</code>{' '}
                <button type="button" className="btn" onClick={() => copy(removal.manualCommand)}>
                  Chép lệnh
                </button>
                {copied && ' Đã chép.'}
              </p>
            </>
          ) : (
            <p>Project này không do app thêm nên không có thư mục nào để xóa.</p>
          )}
        </Notice>
      )}
      {rows?.length === 0 && <p className="muted">Chưa có project nào.</p>}
      {rows?.map((row) => {
        const key = row.progress?.key ?? row.projectId;
        const busy = row.progress ? busyKeys.includes(row.progress.key) : false;
        return (
          <section key={key} className="wizard-card" aria-label={row.name}>
            <h2>
              {row.name}{' '}
              <Lozenge tone={row.onMac ? 'ok' : 'gray'}>
                {row.onMac ? 'Có trên Mac' : 'Chưa có trên Mac'}
              </Lozenge>
            </h2>
            {row.checkouts.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Vai trò</th>
                    <th>Thư mục</th>
                    <th>Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {row.checkouts.map((c) => (
                    <tr key={c.role}>
                      <td>{c.role}</td>
                      <td className="mono">{c.path}</td>
                      <td className="mono">{c.head ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <dl className="kv">
              <dt>Repo ảnh chụp docs</dt>
              <dd className="mono">{row.docsRepo ?? '—'}</dd>
              <dt>Commit gửi cuối</dt>
              <dd className="mono">{short(row.lastSentCommit)}</dd>
            </dl>
            {row.progress && (
              <ProgressView
                progress={row.progress}
                busy={busy}
                onResume={() =>
                  add({
                    origin: (row.progress as Progress).origin,
                    name: row.name,
                    key: (row.progress as Progress).key,
                    executors: executorsOf(row.progress as Progress),
                  })
                }
              />
            )}
            {row.projectId !== '' && row.onMac && (
              <div className="actions">
                <button type="button" className="btn danger" onClick={() => remove(row)}>
                  Gỡ khỏi Mac
                </button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
