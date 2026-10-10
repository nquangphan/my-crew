import { type ChildProcess, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ExecutorDeps, runJob } from '../../src/main/jobs/executors.js';
import { forgetRemovedProject } from '../../src/main/jobs/remove.js';
import type { CrewRoleSlot, JobOutcome, JobPayload, MachineJob } from '../../src/main/jobs/types.js';
import { makeSandbox, makeStore } from '../projects-fixture.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT = '55555555-5555-4555-8555-555555555555';
const SKILL = '44444444-4444-4444-8444-444444444444';
const FOUR: CrewRoleSlot[] = ['assistant', 'executor', 'reviewer', 'integrator'];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

type Lsof = NonNullable<ExecutorDeps['lsof']>;

function setup(lsof?: Lsof) {
  const s = makeSandbox();
  cleanups.push(s.cleanup);
  const calls = { removeStatusRepo: [] as string[], lsof: [] as string[][] };
  const deps: ExecutorDeps = {
    home: s.home,
    env: s.env,
    addStatusRepo: async () => undefined,
    statusRepoPaths: async () => [],
    removeStatusRepo: async (projectId) => {
      calls.removeStatusRepo.push(projectId);
    },
    lsof:
      lsof ??
      (async (args) => {
        calls.lsof.push(args);
        return { code: 1, stdout: '', stderr: '' };
      }),
    doctor: async () => [],
    workflowCheck: async () => ({ ok: true, lines: [] }),
    runtimesSetup: async () => ({
      wrappers: { codex: false, opencode: false },
      codex: { version: null, loggedIn: null },
      opencode: { version: null, keyPresent: null },
    }),
  };
  const agents = join(s.home, 'crew-agents', 'demo');
  const checkout = (role: string) => join(agents, role);
  return { s, deps, calls, agents, checkout };
}

const job = (payload: JobPayload): Pick<MachineJob, 'companyId' | 'kind' | 'payload'> => ({
  companyId: COMPANY,
  kind: payload.kind,
  payload,
});

async function prepare(ctx: ReturnType<typeof setup>, roles: CrewRoleSlot[] = FOUR) {
  const outcome = await runJob(
    job({
      kind: 'prepare-checkouts',
      projectKey: 'demo',
      folder: ctx.s.folder,
      roles: roles.map((role) => ({ role, branch: `crew/demo/${role}` })),
    }),
    { projectId: null },
    ctx.deps,
  );
  expect(outcome.status).toBe('done');
}

const removeJob = (roles: CrewRoleSlot[], removeStatusRepo = false) =>
  job({ kind: 'remove-checkouts', projectId: PROJECT, projectKey: 'demo', roles, removeStatusRepo });

async function remove(ctx: ReturnType<typeof setup>, roles: CrewRoleSlot[], removeStatusRepo = false) {
  return runJob(removeJob(roles, removeStatusRepo), { projectId: null }, ctx.deps);
}

function branches(ctx: ReturnType<typeof setup>): string[] {
  return ctx.s
    .git(['-C', ctx.s.folder, 'branch', '--format=%(refname:short)'])
    .split('\n')
    .filter(Boolean)
    .sort();
}

describe('remove-checkouts', () => {
  it('checkout sạch (có tệp runtime bị ignore) → removed; nhánh và folder gốc còn nguyên; worktree hết trong danh sách', async () => {
    const ctx = setup();
    await prepare(ctx);
    const path = ctx.checkout('executor');
    mkdirSync(join(path, '.paperclip-runtime'));
    writeFileSync(join(path, '.paperclip-runtime', 'run.log'), 'x');
    const before = branches(ctx);
    const realPath = realpathSync.native(path);

    const outcome = await remove(ctx, ['executor']);

    expect(outcome).toEqual({
      status: 'done',
      result: { kind: 'remove-checkouts', removed: [{ role: 'executor', path }], kept: [], absent: [] },
    });
    expect(existsSync(path)).toBe(false);
    expect(branches(ctx)).toEqual(before);
    expect(branches(ctx)).toContain('crew/demo/executor');
    expect(readFileSync(join(ctx.s.folder, 'README.md'), 'utf8')).toBe('repo thử\n');
    expect(ctx.s.git(['-C', ctx.s.folder, 'status', '--porcelain'])).toBe('');
    expect(ctx.s.git(['-C', ctx.s.folder, 'worktree', 'list', '--porcelain'])).not.toContain(path);
    expect(existsSync(ctx.checkout('reviewer'))).toBe(true);
    expect(ctx.calls.lsof).toEqual([['-t', '+D', realPath]]);
  });

  it('có tệp sửa hoặc tệp mới chưa commit → kept dirty, thư mục còn nguyên', async () => {
    const ctx = setup();
    await prepare(ctx);
    writeFileSync(join(ctx.checkout('executor'), 'README.md'), 'đang sửa\n');
    writeFileSync(join(ctx.checkout('reviewer'), 'ghi-chu.txt'), 'mới\n');

    const outcome = await remove(ctx, ['executor', 'reviewer']);

    expect(outcome).toMatchObject({
      status: 'done',
      result: {
        removed: [],
        kept: [
          { role: 'executor', path: ctx.checkout('executor'), reason: 'dirty' },
          { role: 'reviewer', path: ctx.checkout('reviewer'), reason: 'dirty' },
        ],
        absent: [],
      },
    });
    expect(readFileSync(join(ctx.checkout('executor'), 'README.md'), 'utf8')).toBe('đang sửa\n');
    expect(readFileSync(join(ctx.checkout('reviewer'), 'ghi-chu.txt'), 'utf8')).toBe('mới\n');
  });

  it('có process đang mở thư mục (lsof trả PID) → kept busy, không xóa', async () => {
    const seen: string[][] = [];
    const ctx = setup(async (args) => {
      seen.push(args);
      // lsof của macOS thoát mã 1 cả khi tìm thấy process: chỉ tin stdout.
      return { code: 1, stdout: '4242\n', stderr: '' };
    });
    await prepare(ctx);
    const outcome = await remove(ctx, ['executor']);
    expect(outcome).toMatchObject({
      status: 'done',
      result: {
        removed: [],
        kept: [{ role: 'executor', reason: 'busy', detail: expect.stringContaining('4242') }],
      },
    });
    expect(seen).toEqual([['-t', '+D', realpathSync.native(ctx.checkout('executor'))]]);
    expect(existsSync(join(ctx.checkout('executor'), 'README.md'))).toBe(true);
  });

  it('không chạy được lsof → kept busy (không biết thì không xóa)', async () => {
    const ctx = setup(async () => ({ code: -1, stdout: '', stderr: 'spawn ENOENT' }));
    await prepare(ctx);
    const outcome = await remove(ctx, ['executor']);
    expect(outcome).toMatchObject({ result: { kept: [{ role: 'executor', reason: 'busy' }] } });
    expect(existsSync(ctx.checkout('executor'))).toBe(true);
  });

  it.skipIf(!existsSync('/usr/sbin/lsof'))(
    'lsof thật: process có thư mục làm việc ở thư mục con của checkout → kept busy',
    async () => {
      const ctx = setup();
      delete ctx.deps.lsof;
      await prepare(ctx);
      const sub = join(ctx.checkout('executor'), 'docs');
      const child: ChildProcess = spawn('/bin/sleep', ['30'], { cwd: sub, stdio: 'ignore' });
      cleanups.push(() => child.kill('SIGKILL'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const outcome = await remove(ctx, ['executor']);
      expect(outcome).toMatchObject({ result: { kept: [{ role: 'executor', reason: 'busy' }] } });
      expect(existsSync(sub)).toBe(true);
    },
  );

  it('đường dẫn là symlink trỏ ra ngoài ~/crew-agents/<key>/ (tới một worktree thật) → kept not_worktree, đích còn', async () => {
    const ctx = setup();
    await prepare(ctx);
    const outside = join(ctx.s.root, 'ngoai', 'wt');
    mkdirSync(join(ctx.s.root, 'ngoai'));
    ctx.s.git(['-C', ctx.s.folder, 'worktree', 'add', '-q', '-b', 'ngoai', outside]);
    renameSync(ctx.checkout('reviewer'), join(ctx.s.root, 'reviewer-cu'));
    symlinkSync(outside, ctx.checkout('reviewer'));

    const outcome = await remove(ctx, ['reviewer']);

    expect(outcome).toMatchObject({
      result: { removed: [], kept: [{ role: 'reviewer', reason: 'not_worktree' }] },
    });
    expect(existsSync(join(outside, 'README.md'))).toBe(true);
    expect(ctx.s.git(['-C', ctx.s.folder, 'worktree', 'list', '--porcelain'])).toContain(outside);
  });

  it('~/crew-agents/<key> là symlink ra ngoài → mọi vai kept not_worktree, không xóa gì', async () => {
    const ctx = setup();
    const elsewhere = join(ctx.s.root, 'elsewhere');
    mkdirSync(elsewhere);
    ctx.s.git(['-C', ctx.s.folder, 'worktree', 'add', '-q', '-b', 'x', join(elsewhere, 'executor')]);
    mkdirSync(join(ctx.s.home, 'crew-agents'), { recursive: true });
    symlinkSync(elsewhere, ctx.agents);

    const outcome = await remove(ctx, ['executor']);

    expect(outcome).toMatchObject({ result: { kept: [{ role: 'executor', reason: 'not_worktree' }] } });
    expect(existsSync(join(elsewhere, 'executor', 'README.md'))).toBe(true);
  });

  it('worktree chính (repo clone riêng) hoặc thư mục thường → kept not_worktree', async () => {
    const ctx = setup();
    mkdirSync(ctx.agents, { recursive: true });
    ctx.s.git(['clone', '-q', ctx.s.origin, ctx.checkout('integrator')]);
    mkdirSync(ctx.checkout('assistant'));
    writeFileSync(join(ctx.checkout('assistant'), 'cua-owner.txt'), 'x');

    const outcome = await remove(ctx, ['integrator', 'assistant']);

    expect(outcome).toMatchObject({
      result: {
        removed: [],
        kept: [
          { role: 'integrator', reason: 'not_worktree' },
          { role: 'assistant', reason: 'not_worktree' },
        ],
      },
    });
    expect(existsSync(join(ctx.checkout('integrator'), 'README.md'))).toBe(true);
    expect(existsSync(join(ctx.checkout('assistant'), 'cua-owner.txt'))).toBe(true);
  });

  it('HEAD tách rời có commit không thuộc nhánh nào → kept dirty; tách rời ở commit đã có trên nhánh → removed', async () => {
    const ctx = setup();
    await prepare(ctx);
    const exec = ctx.checkout('executor');
    ctx.s.git(['-C', exec, 'checkout', '-q', '--detach']);
    ctx.s.git([
      '-C',
      exec,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'lẻ',
    ]);
    ctx.s.git(['-C', ctx.checkout('reviewer'), 'checkout', '-q', '--detach']);

    const outcome = await remove(ctx, ['executor', 'reviewer']);

    expect(outcome).toMatchObject({
      result: {
        removed: [{ role: 'reviewer' }],
        kept: [{ role: 'executor', reason: 'dirty', detail: expect.stringContaining('HEAD tách rời') }],
      },
    });
    expect(existsSync(exec)).toBe(true);
  });

  it('worktree bị khóa: git từ chối (không --force) → kept git_failed', async () => {
    const ctx = setup();
    await prepare(ctx);
    ctx.s.git(['-C', ctx.s.folder, 'worktree', 'lock', ctx.checkout('executor')]);
    const outcome = await remove(ctx, ['executor']);
    expect(outcome).toMatchObject({ result: { kept: [{ role: 'executor', reason: 'git_failed' }] } });
    expect(existsSync(join(ctx.checkout('executor'), 'README.md'))).toBe(true);
  });

  it('không tồn tại → absent; chạy lại sau khi đã gỡ → absent', async () => {
    const ctx = setup();
    await prepare(ctx);
    expect(await remove(ctx, ['executor-2'])).toEqual({
      status: 'done',
      result: { kind: 'remove-checkouts', removed: [], kept: [], absent: ['executor-2'] },
    });
    expect((await remove(ctx, ['executor'])).status).toBe('done');
    expect(await remove(ctx, ['executor'])).toMatchObject({ result: { removed: [], absent: ['executor'] } });
  });

  it('gỡ hết mọi vai → rmdir ~/crew-agents/<key>; removeStatusRepo:true gọi removeStatusRepo(projectId)', async () => {
    const ctx = setup();
    await prepare(ctx);
    const outcome = await remove(ctx, FOUR, true);
    expect(outcome).toMatchObject({ status: 'done', result: { kept: [], absent: [] } });
    expect(existsSync(ctx.agents)).toBe(false);
    expect(existsSync(join(ctx.s.home, 'crew-agents'))).toBe(true);
    expect(ctx.calls.removeStatusRepo).toEqual([PROJECT]);
    expect(ctx.s.git(['-C', ctx.s.folder, 'worktree', 'list', '--porcelain'])).not.toContain('crew-agents');
    expect(branches(ctx)).toEqual([
      'crew/demo/assistant',
      'crew/demo/executor',
      'crew/demo/integrator',
      'crew/demo/reviewer',
      'main',
    ]);
  });

  it('còn checkout giữ lại → thư mục project còn; removeStatusRepo:false không gọi removeStatusRepo', async () => {
    const ctx = setup();
    await prepare(ctx);
    writeFileSync(join(ctx.checkout('executor'), 'README.md'), 'đang sửa\n');
    const outcome = await remove(ctx, FOUR, false);
    expect(outcome).toMatchObject({ result: { kept: [{ role: 'executor', reason: 'dirty' }] } });
    expect(existsSync(ctx.agents)).toBe(true);
    expect(ctx.calls.removeStatusRepo).toEqual([]);
  });

  it('projectKey ../x (payload sửa tay) → app_error, không chạm máy', async () => {
    const ctx = setup();
    await prepare(ctx);
    const bad = { ...removeJob(['executor']).payload, projectKey: '../x' } as JobPayload;
    expect(await runJob(job(bad), { projectId: null }, ctx.deps)).toEqual({
      status: 'failed',
      errorCode: 'app_error',
      errorText: 'Việc không hợp lệ: projectKey không hợp lệ',
    });
    expect(ctx.calls.lsof).toEqual([]);
  });
});

describe('forgetRemovedProject', () => {
  const done: JobOutcome = {
    status: 'done',
    result: { kind: 'remove-checkouts', removed: [], kept: [], absent: [] },
  };
  const progress = (key: string, projectId: string) => ({
    key,
    folder: '/x',
    projectId,
    done: [],
    agents: {},
    error: null,
  });

  async function storeWith() {
    const s = makeSandbox();
    cleanups.push(s.cleanup);
    const store = await makeStore(s.root);
    await store.update((st) => ({
      ...st,
      projects: { demo: progress('demo', PROJECT), khac: progress('khac', OTHER_PROJECT) },
    }));
    return store;
  }

  it('gỡ project xong (removeStatusRepo:true) → xóa tiến độ của đúng project trong app.json', async () => {
    const store = await storeWith();
    await forgetRemovedProject(store, removeJob(FOUR, true), done);
    expect(Object.keys(store.get().projects)).toEqual(['khac']);
  });

  it('gỡ agent (removeStatusRepo:false), việc thất bại hay việc khác → giữ tiến độ', async () => {
    const store = await storeWith();
    await forgetRemovedProject(store, removeJob(['executor'], false), done);
    await forgetRemovedProject(store, removeJob(FOUR, true), {
      status: 'failed',
      errorCode: 'app_error',
      errorText: 'x',
    });
    await forgetRemovedProject(store, job({ kind: 'check', projectKey: 'demo' }), done);
    expect(Object.keys(store.get().projects).sort()).toEqual(['demo', 'khac']);
  });
});

describe('skill-remove', () => {
  const skillJob = (slug: string) => job({ kind: 'skill-remove', skillId: SKILL, slug });

  function skillsSetup() {
    const ctx = setup();
    const base = join(ctx.s.home, '.crew', 'skills', COMPANY);
    const workflows = join(ctx.s.home, '.crew', 'workflows');
    mkdirSync(join(base, 'viet-docs'), { recursive: true });
    writeFileSync(join(base, 'viet-docs', 'SKILL.md'), '# a\n');
    mkdirSync(join(base, 'giu-lai'), { recursive: true });
    writeFileSync(join(base, 'giu-lai', 'SKILL.md'), '# b\n');
    mkdirSync(join(workflows, 'superpowers', 'skills', 'brainstorming'), { recursive: true });
    writeFileSync(join(workflows, 'superpowers', 'skills', 'brainstorming', 'SKILL.md'), '# ghim\n');
    return { ...ctx, base, workflows };
  }

  it('xóa đúng thư mục skill; skill khác và Superpowers ghim còn; chạy lại → removed:false', async () => {
    const ctx = skillsSetup();
    // symlink bên trong skill trỏ sang workflows: chỉ link bị xóa, đích còn.
    symlinkSync(join(ctx.workflows, 'superpowers'), join(ctx.base, 'viet-docs', 'ghim'));
    expect(await runJob(skillJob('viet-docs'), { projectId: null }, ctx.deps)).toEqual({
      status: 'done',
      result: { kind: 'skill-remove', removed: true },
    });
    expect(existsSync(join(ctx.base, 'viet-docs'))).toBe(false);
    expect(existsSync(join(ctx.base, 'giu-lai', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(ctx.workflows, 'superpowers', 'skills', 'brainstorming', 'SKILL.md'))).toBe(true);
    expect(await runJob(skillJob('viet-docs'), { projectId: null }, ctx.deps)).toEqual({
      status: 'done',
      result: { kind: 'skill-remove', removed: false },
    });
  });

  it('chưa có thư mục skill nào của company → removed:false', async () => {
    const ctx = setup();
    expect(await runJob(skillJob('chua-co'), { projectId: null }, ctx.deps)).toEqual({
      status: 'done',
      result: { kind: 'skill-remove', removed: false },
    });
  });

  it('slug là symlink trỏ sang ~/.crew/workflows/x → từ chối, đích còn nguyên', async () => {
    const ctx = skillsSetup();
    symlinkSync(join(ctx.workflows, 'superpowers'), join(ctx.base, 'superpowers'));
    const outcome = await runJob(skillJob('superpowers'), { projectId: null }, ctx.deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'folder_forbidden' });
    expect(existsSync(join(ctx.workflows, 'superpowers', 'skills', 'brainstorming', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(ctx.base, 'superpowers'))).toBe(true);
  });

  it('thư mục skills của company là symlink ra ngoài → từ chối, không xóa gì', async () => {
    const ctx = skillsSetup();
    const outsideBase = join(ctx.s.root, 'ngoai-skills');
    mkdirSync(join(outsideBase, 'viet-docs'), { recursive: true });
    writeFileSync(join(outsideBase, 'viet-docs', 'SKILL.md'), '# x\n');
    renameSync(ctx.base, join(ctx.s.root, 'skills-cu'));
    symlinkSync(outsideBase, ctx.base);
    const outcome = await runJob(skillJob('viet-docs'), { projectId: null }, ctx.deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'folder_forbidden' });
    expect(existsSync(join(outsideBase, 'viet-docs', 'SKILL.md'))).toBe(true);
  });

  it('slug ../workflows (payload sửa tay) → app_error, không xóa gì', async () => {
    const ctx = skillsSetup();
    const bad = { kind: 'skill-remove', skillId: SKILL, slug: '../workflows' } as JobPayload;
    expect(await runJob(job(bad), { projectId: null }, ctx.deps)).toMatchObject({
      status: 'failed',
      errorCode: 'app_error',
    });
    expect(existsSync(join(ctx.workflows, 'superpowers', 'skills', 'brainstorming', 'SKILL.md'))).toBe(true);
  });
});
