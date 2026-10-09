import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addProject } from '../src/main/projects/add-project.js';
import { removeProject } from '../src/main/projects/remove-project.js';
import {
  baseDeps,
  fakeOps,
  makeSandbox,
  makeStore,
  startStatefulPaperclip,
  TEMPLATE_ENV,
} from './projects-fixture.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function added() {
  const sandbox = makeSandbox();
  cleanups.push(sandbox.cleanup);
  const paperclip = await startStatefulPaperclip();
  cleanups.push(paperclip.close);
  const store = await makeStore(sandbox.root);
  const fake = fakeOps(sandbox.home);
  const deps = baseDeps(sandbox, paperclip, fake.ops, store);
  const progress = await addProject(deps, {
    folder: sandbox.folder,
    name: 'Landing',
    key: 'landing',
    executors: 1,
  });
  expect(progress.error).toBeNull();
  return { sandbox, paperclip, store, fake, deps, progress, projectId: progress.projectId as string };
}

describe('removeProject', () => {
  it('pause agent → archive environment → remove-repo → xóa vai trò; không xóa project, không xóa thư mục', async () => {
    const { sandbox, paperclip, store, fake, deps, progress, projectId } = await added();
    const before = paperclip.requests.length;
    const opsBefore = fake.calls.length;

    const result = await removeProject(deps, projectId);

    const folder = progress.folder as string;
    expect(result.manualCommand).toBe(
      ['executor-1', 'assistant', 'reviewer', 'integrator']
        .map(
          (role) => `git -C ${folder} worktree remove ${join(sandbox.home, 'crew-agents', 'landing', role)}`,
        )
        .join(' && '),
    );
    const writes = paperclip.requests.slice(before).filter((r) => r.method !== 'GET');
    const agentIds = Object.values(progress.agents).map((a) => a.agentId as string);
    const envIds = Object.values(progress.agents).map((a) => a.environmentId as string);
    expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
      ...agentIds.map((id) => `POST /api/agents/${id}/pause`),
      ...envIds.map((id) => `PATCH /api/environments/${id}`),
      `DELETE /api/plugins/crew.core/api/projects/${projectId}/roles`,
    ]);
    for (const r of writes.filter((w) => w.method === 'PATCH'))
      expect(r.body).toEqual({ status: 'archived' });
    expect(fake.calls.slice(opsBefore)).toEqual([{ op: 'removeStatusRepo', args: [projectId] }]);
    expect(result.removed).toEqual([
      ...Object.keys(progress.agents).map((role) => `agent landing-${role} đã pause`),
      ...Object.keys(progress.agents).map((role) => `environment landing-${role} đã archive`),
      'repo docs khỏi bản tin máy',
      'vai trò của project',
    ]);

    for (const id of agentIds) expect(paperclip.agents.get(id)?.status).toBe('paused');
    for (const id of envIds) expect(paperclip.envs.get(id)?.status).toBe('archived');
    expect(paperclip.envs.get(TEMPLATE_ENV)?.status).toBe('active');
    expect(paperclip.projects.has(projectId)).toBe(true);
    expect(paperclip.roles.has(projectId)).toBe(false);
    expect(existsSync(join(sandbox.home, 'crew-agents', 'landing', 'reviewer'))).toBe(true);
    expect(sandbox.git(['-C', folder, 'worktree', 'list'])).toContain(
      join(sandbox.home, 'crew-agents', 'landing', 'reviewer'),
    );
    expect(sandbox.git(['-C', folder, 'status', '--porcelain'])).toBe('');
    expect(paperclip.requests.some((r) => r.method === 'DELETE' && !r.path.endsWith('/roles'))).toBe(false);
    expect(store.get().projects.landing).toBeUndefined();
  });

  it('chạy lại khi đã gỡ → không lỗi, không pause/archive gì thêm', async () => {
    const { paperclip, deps, projectId } = await added();
    await removeProject(deps, projectId);
    const before = paperclip.requests.length;
    const again = await removeProject(deps, projectId);
    expect(again.removed).toEqual(['repo docs khỏi bản tin máy']);
    expect(paperclip.requests.slice(before).filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('lỗi giữa chừng → giữ tiến độ, chạy lại làm nốt (bước đã xong bỏ qua)', async () => {
    const { paperclip, store, deps, projectId } = await added();
    paperclip.rules.push({ match: (r) => r.method === 'PATCH', status: 500 });
    await expect(removeProject(deps, projectId)).rejects.toThrow('500');
    expect(store.get().projects.landing).toBeDefined();
    const result = await removeProject(deps, projectId);
    expect(result.removed).toContain('vai trò của project');
    for (const env of paperclip.envs.values()) {
      if (env.id !== TEMPLATE_ENV) expect(env.status).toBe('archived');
    }
    expect(store.get().projects.landing).toBeUndefined();
  });

  it('project không do app thêm → chỉ remove-repo và xóa vai trò, không pause agent nào', async () => {
    const { paperclip, fake, deps, progress } = await added();
    const other = randomUUID();
    const ids = (role: string) => progress.agents[role]?.agentId as string;
    paperclip.roles.set(other, {
      assistantAgentId: ids('assistant'),
      executorAgentIds: [ids('executor-1')],
      reviewerAgentId: ids('reviewer'),
      integratorAgentId: ids('integrator'),
    });
    const before = paperclip.requests.length;
    const result = await removeProject(deps, other);
    expect(result.manualCommand).toBe('');
    const writes = paperclip.requests.slice(before).filter((r) => r.method !== 'GET');
    expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
      `DELETE /api/plugins/crew.core/api/projects/${other}/roles`,
    ]);
    expect(fake.calls.at(-1)).toEqual({ op: 'removeStatusRepo', args: [other] });
    expect(result.removed).toEqual(['repo docs khỏi bản tin máy', 'vai trò của project']);
    for (const agent of paperclip.agents.values()) expect(agent.status).toBe('idle');
  });

  it('đường dẫn có dấu cách hay ký tự lạ thì lệnh in ra được quote cho shell', async () => {
    const { store, deps, progress, projectId } = await added();
    await store.update((s) => ({
      ...s,
      projects: {
        landing: {
          ...progress,
          folder: "/Volumes/Ổ Ngoài/it's",
          agents: {
            reviewer: {
              agentId: progress.agents.reviewer?.agentId ?? null,
              environmentId: progress.agents.reviewer?.environmentId ?? null,
              checkout: '/h/crew-agents/landing/reviewer',
            },
          },
        },
      },
    }));
    const result = await removeProject(deps, projectId);
    expect(result.manualCommand).toBe(
      `git -C '/Volumes/Ổ Ngoài/it'\\''s' worktree remove /h/crew-agents/landing/reviewer`,
    );
  });

  it('tiến độ kiểu cũ (clone từ URL git) → lệnh xóa thư mục clone như trước', async () => {
    const { store, deps, progress, projectId } = await added();
    const { folder: _f, ...rest } = progress;
    await store.update((s) => ({
      ...s,
      projects: { landing: { ...rest, origin: 'git@github.com:x/landing.git' } },
    }));
    const result = await removeProject(deps, projectId);
    expect(result.manualCommand).toBe('rm -rf ~/crew-agents/landing ~/crew-projects/landing');
  });

  it('projectId sai dạng → từ chối', async () => {
    const { deps } = await added();
    await expect(removeProject(deps, '../x')).rejects.toThrow('projectId');
  });
});
