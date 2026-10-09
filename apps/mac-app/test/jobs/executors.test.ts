import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ExecutorDeps, runJob } from '../../src/main/jobs/executors.js';
import type { CrewRoleSlot, JobPayload, MachineJob } from '../../src/main/jobs/types.js';
import { makeSandbox } from '../projects-fixture.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SKILL = '44444444-4444-4444-8444-444444444444';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup() {
  const s = makeSandbox();
  cleanups.push(s.cleanup);
  const calls = { addStatusRepo: [] as unknown[][], workflowCheck: [] as string[] };
  const deps: ExecutorDeps = {
    home: s.home,
    env: s.env,
    addStatusRepo: async (...args) => {
      calls.addStatusRepo.push(args);
    },
    statusRepoPaths: async () => [],
    doctor: async () => [
      { id: 'sshd', title: 'sshd agent', status: 'ok', detail: 'cổng 2222' },
      { id: 'reaper', title: 'Reaper', status: 'warn', detail: 'chạy lần cuối 2 giờ trước' },
    ],
    workflowCheck: async (root) => {
      calls.workflowCheck.push(root);
      return { ok: true, lines: [] };
    },
  };
  return { s, deps, calls };
}

const job = (payload: JobPayload): Pick<MachineJob, 'companyId' | 'kind' | 'payload'> => ({
  companyId: COMPANY,
  kind: payload.kind,
  payload,
});

const roles = (key: string, list: CrewRoleSlot[]) =>
  list.map((role) => ({ role, branch: `crew/${key}/${role}` }));
const FOUR: CrewRoleSlot[] = ['assistant', 'executor', 'reviewer', 'integrator'];

describe('inspect-folder', () => {
  it('repo có crew-docs.bundle: gốc, nhánh, remote, bundle, cây sạch', async () => {
    const { s, deps } = setup();
    s.git(['-C', s.folder, 'config', 'crew-docs.bundle', 'x']);
    const outcome = await runJob(
      job({ kind: 'inspect-folder', folder: s.folder }),
      { projectId: null },
      deps,
    );
    expect(outcome).toEqual({
      status: 'done',
      result: {
        kind: 'inspect-folder',
        root: realpathSync.native(s.folder),
        branch: 'main',
        remote: s.origin,
        docsBundle: 'x',
        clean: true,
      },
    });
  });

  it('có file chưa track thì clean false; remote có user:token thì bị bỏ', async () => {
    const { s, deps } = setup();
    writeFileSync(join(s.folder, 'moi.txt'), 'x');
    s.git(['-C', s.folder, 'remote', 'set-url', 'origin', 'https://u:secret-token@example.invalid/a.git']);
    const outcome = await runJob(
      job({ kind: 'inspect-folder', folder: s.folder }),
      { projectId: null },
      deps,
    );
    expect(outcome).toMatchObject({
      status: 'done',
      result: { clean: false, remote: 'https://example.invalid/a.git', docsBundle: null },
    });
  });

  it('thư mục không phải git → folder_not_git; không có → folder_missing; HOME → folder_forbidden', async () => {
    const { s, deps } = setup();
    const plain = join(s.root, 'plain');
    mkdirSync(plain);
    expect(
      await runJob(job({ kind: 'inspect-folder', folder: plain }), { projectId: null }, deps),
    ).toMatchObject({
      status: 'failed',
      errorCode: 'folder_not_git',
    });
    expect(
      await runJob(
        job({ kind: 'inspect-folder', folder: join(s.root, 'khong-co') }),
        { projectId: null },
        deps,
      ),
    ).toMatchObject({ status: 'failed', errorCode: 'folder_missing' });
    expect(
      await runJob(job({ kind: 'inspect-folder', folder: s.home }), { projectId: null }, deps),
    ).toMatchObject({
      status: 'failed',
      errorCode: 'folder_forbidden',
    });
  });

  it('payload sai (key lạ) → app_error, không chạm máy', async () => {
    const { s, deps } = setup();
    const bad = { kind: 'inspect-folder', folder: s.folder, rm: '-rf' } as unknown as JobPayload;
    expect(await runJob(job(bad), { projectId: null }, deps)).toEqual({
      status: 'failed',
      errorCode: 'app_error',
      errorText: 'Việc không hợp lệ: trường rm không được hỗ trợ',
    });
  });
});

describe('prepare-checkouts', () => {
  const gitOut = (s: ReturnType<typeof makeSandbox>, args: string[]) => s.git(args);

  it('4 vai trò → 4 worktree đúng nhánh, exclude runtime, crew-docs.bundle, add-repo một lần; chạy lại như cũ', async () => {
    const { s, deps, calls } = setup();
    const payload: JobPayload = {
      kind: 'prepare-checkouts',
      projectKey: 'demo',
      folder: s.folder,
      roles: roles('demo', FOUR),
    };
    const first = await runJob(job(payload), { projectId: PROJECT }, deps);
    expect(first.status).toBe('done');
    if (first.status !== 'done' || first.result.kind !== 'prepare-checkouts') throw new Error('sai kết quả');
    expect(first.result.checkouts.map((c) => c.role)).toEqual(FOUR);
    for (const checkout of first.result.checkouts) {
      expect(checkout.path).toBe(join(s.home, 'crew-agents', 'demo', checkout.role));
      expect(checkout.head).toMatch(/^[0-9a-f]{40}$/);
      expect(gitOut(s, ['-C', checkout.path, 'symbolic-ref', '--short', 'HEAD'])).toBe(
        `crew/demo/${checkout.role}`,
      );
      const exclude = gitOut(s, [
        '-C',
        checkout.path,
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'info/exclude',
      ]);
      expect(readFileSync(exclude, 'utf8')).toContain('.paperclip-runtime/');
      expect(gitOut(s, ['-C', checkout.path, 'config', '--get', 'crew-docs.bundle'])).toBe(
        join(s.home, '.crew', 'bin', 'crew-docs.cjs'),
      );
    }
    expect(calls.addStatusRepo).toEqual([[PROJECT, realpathSync.native(s.folder), COMPANY]]);

    const second = await runJob(job(payload), { projectId: PROJECT }, deps);
    expect(second).toEqual(first);
  });

  it('không có projectId thì không thêm repo vào bản tin', async () => {
    const { s, deps, calls } = setup();
    const payload: JobPayload = {
      kind: 'prepare-checkouts',
      projectKey: 'demo',
      folder: s.folder,
      roles: roles('demo', FOUR),
    };
    expect((await runJob(job(payload), { projectId: null }, deps)).status).toBe('done');
    expect(calls.addStatusRepo).toEqual([]);
  });

  it('thư mục đích đã có nhưng không phải worktree của repo này → checkout_exists', async () => {
    const { s, deps } = setup();
    mkdirSync(join(s.home, 'crew-agents', 'demo', 'reviewer'), { recursive: true });
    writeFileSync(join(s.home, 'crew-agents', 'demo', 'reviewer', 'cua-owner.txt'), 'x');
    const outcome = await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'checkout_exists' });
    if (outcome.status === 'failed') expect(outcome.errorText).toContain('reviewer');
  });
});

describe('agent-workspace', () => {
  it('thêm executor-2 → worktree mới, không đụng worktree khác', async () => {
    const { s, deps } = setup();
    const prepared = await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    const marker = join(s.home, 'crew-agents', 'demo', 'executor', 'dang-lam.txt');
    writeFileSync(marker, 'việc dở');
    const outcome = await runJob(
      job({
        kind: 'agent-workspace',
        projectKey: 'demo',
        folder: s.folder,
        role: 'executor-2',
        branch: 'crew/demo/executor-2',
      }),
      { projectId: null },
      deps,
    );
    const path = join(s.home, 'crew-agents', 'demo', 'executor-2');
    expect(outcome).toEqual({
      status: 'done',
      result: {
        kind: 'agent-workspace',
        role: 'executor-2',
        path,
        head: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    });
    expect(s.git(['-C', path, 'symbolic-ref', '--short', 'HEAD'])).toBe('crew/demo/executor-2');
    expect(readFileSync(marker, 'utf8')).toBe('việc dở');
    expect(prepared.status).toBe('done');
  });
});

describe('skill-sync', () => {
  const files = [
    { path: 'SKILL.md', content: '# Kỹ năng\n', encoding: 'utf8' as const, executable: false },
    {
      path: 'scripts/run.sh',
      content: Buffer.from('#!/bin/sh\necho ok\n').toString('base64'),
      encoding: 'base64' as const,
      executable: true,
    },
  ];
  const payload: JobPayload = { kind: 'skill-sync', skillId: SKILL, slug: 'viet-test', version: '1.0.0' };

  it('ghi ~/.crew/skills/<company>/<slug>/ quyền 0700, sha256 là băm cây', async () => {
    const { s, deps } = setup();
    const outcome = await runJob(job(payload), { projectId: null, skillFiles: files }, deps);
    const dir = join(s.home, '.crew', 'skills', COMPANY, 'viet-test');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('# Kỹ năng\n');
    expect(readFileSync(join(dir, 'scripts', 'run.sh'), 'utf8')).toBe('#!/bin/sh\necho ok\n');
    expect(statSync(join(dir, 'scripts', 'run.sh')).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'SKILL.md')).mode & 0o777).toBe(0o600);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const tree = sha(`SKILL.md\0${sha('# Kỹ năng\n')}\nscripts/run.sh\0${sha('#!/bin/sh\necho ok\n')}\n`);
    expect(outcome).toEqual({ status: 'done', result: { kind: 'skill-sync', sha256: tree, files: 2 } });
  });

  it('đồng bộ lại thay toàn bộ thư mục (file cũ bị bỏ)', async () => {
    const { s, deps } = setup();
    await runJob(job(payload), { projectId: null, skillFiles: files }, deps);
    const outcome = await runJob(
      job(payload),
      { projectId: null, skillFiles: [files[0] as (typeof files)[0]] },
      deps,
    );
    const dir = join(s.home, '.crew', 'skills', COMPANY, 'viet-test');
    expect(existsSync(join(dir, 'scripts'))).toBe(false);
    expect(outcome).toMatchObject({ status: 'done', result: { files: 1 } });
  });

  it('đường dẫn file thoát khỏi thư mục skill hoặc thiếu file → skill_fetch_failed, không ghi gì', async () => {
    const { s, deps } = setup();
    for (const path of ['../ngoai.md', '/etc/x', 'a/../../b', '']) {
      const outcome = await runJob(
        job(payload),
        { projectId: null, skillFiles: [{ path, content: 'x', encoding: 'utf8', executable: false }] },
        deps,
      );
      expect(outcome).toMatchObject({ status: 'failed', errorCode: 'skill_fetch_failed' });
    }
    expect(await runJob(job(payload), { projectId: null }, deps)).toMatchObject({
      status: 'failed',
      errorCode: 'skill_fetch_failed',
    });
    expect(existsSync(join(s.home, '.crew', 'skills'))).toBe(false);
  });
});

describe('check', () => {
  it('doctor + workflow-check từng checkout → items; không có lỗi thì done', async () => {
    const { s, deps, calls } = setup();
    await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    const outcome = await runJob(job({ kind: 'check', projectKey: 'demo' }), { projectId: null }, deps);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done' || outcome.result.kind !== 'check') throw new Error('sai kết quả');
    expect(outcome.result.items.slice(0, 2)).toEqual([
      { id: 'sshd', status: 'ok', title: 'sshd agent: cổng 2222' },
      { id: 'reaper', status: 'warn', title: 'Reaper: chạy lần cuối 2 giờ trước' },
    ]);
    expect(outcome.result.items.slice(2).map((i) => i.id)).toEqual([
      'workflow:assistant',
      'workflow:executor',
      'workflow:integrator',
      'workflow:reviewer',
    ]);
    expect(calls.workflowCheck).toHaveLength(4);
  });

  it('workflow của một ô lỗi → failed check_failed, result vẫn kèm items', async () => {
    const { s, deps } = setup();
    await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    deps.doctor = async () => [
      { id: 'sshd', title: 'sshd agent', status: 'fail', detail: 'không nghe cổng 2222' },
    ];
    deps.workflowCheck = async (root) =>
      root.endsWith('reviewer') ? { ok: false, lines: ['skill lạ trong .claude'] } : { ok: true, lines: [] };
    const outcome = await runJob(job({ kind: 'check', projectKey: 'demo' }), { projectId: null }, deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'check_failed' });
    if (outcome.status !== 'failed') throw new Error('sai kết quả');
    expect(outcome.errorText).not.toContain('sshd agent');
    expect(outcome.errorText).toContain('reviewer');
    expect(outcome.result).toMatchObject({ kind: 'check' });
    expect(
      outcome.result?.kind === 'check' && outcome.result.items.filter((i) => i.status === 'error'),
    ).toHaveLength(1);
  });

  it('doctor fail ở mục chung của máy → done, mục đó thành warn', async () => {
    const { s, deps } = setup();
    await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    deps.doctor = async () => [
      { id: 'sshd-agent', title: 'sshd agent', status: 'fail', detail: 'không nghe cổng 2222' },
    ];
    const outcome = await runJob(job({ kind: 'check', projectKey: 'demo' }), { projectId: null }, deps);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done' || outcome.result.kind !== 'check') throw new Error('sai kết quả');
    expect(outcome.result.items[0]).toMatchObject({ id: 'sshd-agent', status: 'warn' });
    expect(outcome.result.items[0]?.title).toContain('không nghe cổng 2222');
    expect(outcome.result.items.some((i) => i.status === 'error')).toBe(false);
  });

  it('doctor fail ở mục worktree → failed, mục giữ error', async () => {
    const { s, deps } = setup();
    await runJob(
      job({ kind: 'prepare-checkouts', projectKey: 'demo', folder: s.folder, roles: roles('demo', FOUR) }),
      { projectId: null },
      deps,
    );
    deps.doctor = async () => [
      { id: 'worktree-root', title: 'Thư mục worktree', status: 'fail', detail: 'nằm dưới /Volumes' },
      { id: 'sshd-agent', title: 'sshd agent', status: 'fail', detail: 'không nghe' },
    ];
    const outcome = await runJob(job({ kind: 'check', projectKey: 'demo' }), { projectId: null }, deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'check_failed' });
    if (outcome.status !== 'failed' || outcome.result?.kind !== 'check') throw new Error('sai kết quả');
    expect(outcome.errorText).toContain('Thư mục worktree');
    expect(outcome.errorText).not.toContain('sshd agent');
    expect(outcome.result.items.map((i) => [i.id, i.status])).toEqual([
      ['worktree-root', 'error'],
      ['sshd-agent', 'warn'],
      ['workflow:assistant', 'ok'],
      ['workflow:executor', 'ok'],
      ['workflow:integrator', 'ok'],
      ['workflow:reviewer', 'ok'],
    ]);
  });

  it('project chưa có checkout nào → check_failed', async () => {
    const { deps } = setup();
    expect(await runJob(job({ kind: 'check', projectKey: 'demo' }), { projectId: null }, deps)).toMatchObject(
      {
        status: 'failed',
        errorCode: 'check_failed',
      },
    );
  });
});
