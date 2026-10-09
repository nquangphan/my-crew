import { afterEach, describe, expect, it } from 'vitest';
import { MissingKeyError } from '../../src/main/jobs/poller.js';
import { createJobsRemote } from '../../src/main/jobs/remote.js';
import type { MachineJob } from '../../src/main/jobs/types.js';
import { type FakeHandler, startFakePaperclip } from '../paperclip-fake-server.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MACHINE = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SKILL = '44444444-4444-4444-8444-444444444444';
const KEY = 'pcp_board_khoa-gia-cho-test';
const BASE = '/api/plugins/crew.core/api';

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function serve(handler: FakeHandler, key: string | null = KEY) {
  const server = await startFakePaperclip(handler);
  servers.push(server);
  const target = { url: server.origin, companyId: COMPANY };
  const remote = createJobsRemote({ fetch: globalThis.fetch, readKey: async () => key });
  return { server, target, remote };
}

const job = (over: Partial<MachineJob>): MachineJob => ({
  id: JOB,
  companyId: COMPANY,
  machineId: MACHINE,
  kind: 'check',
  payload: { kind: 'check', projectKey: 'demo' },
  status: 'claimed',
  result: null,
  errorCode: null,
  errorText: null,
  attempts: 0,
  setupRunId: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  claimedAt: null,
  finishedAt: null,
  ...over,
});

describe('claim', () => {
  it('POST /machine-jobs/claim với board key; 204 → null, 200 → việc', async () => {
    let next: { status: number; body?: unknown } = { status: 204 };
    const { server, target, remote } = await serve(() => next);
    await expect(remote.claim(target, MACHINE)).resolves.toBeNull();
    next = { status: 200, body: job({}) };
    await expect(remote.claim(target, MACHINE)).resolves.toMatchObject({ id: JOB, kind: 'check' });
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: `${BASE}/machine-jobs/claim`,
      authorization: `Bearer ${KEY}`,
      body: { companyId: COMPANY, machineId: MACHINE },
    });
  });

  it('chưa có board key → MissingKeyError, không gửi gì', async () => {
    const { server, target, remote } = await serve(() => ({ status: 204 }), null);
    await expect(remote.claim(target, MACHINE)).rejects.toBeInstanceOf(MissingKeyError);
    expect(server.requests).toEqual([]);
  });
});

describe('submit', () => {
  it('done gửi result; failed gửi errorCode và errorText đã làm sạch', async () => {
    const { server, target, remote } = await serve(() => ({ status: 200, body: {} }));
    await remote.submit(target, MACHINE, JOB, { status: 'done', result: { kind: 'check', items: [] } });
    await remote.submit(target, MACHINE, JOB, {
      status: 'failed',
      errorCode: 'git_failed',
      errorText: 'fatal: https://u:tok@h/x \x1b[31m',
    });
    expect(server.requests.map((r) => [r.path, r.body])).toEqual([
      [
        `${BASE}/machine-jobs/${JOB}/result`,
        { companyId: COMPANY, machineId: MACHINE, status: 'done', result: { kind: 'check', items: [] } },
      ],
      [
        `${BASE}/machine-jobs/${JOB}/result`,
        {
          companyId: COMPANY,
          machineId: MACHINE,
          status: 'failed',
          errorCode: 'git_failed',
          errorText: 'fatal: https://[ĐÃ CHE]@h/x',
        },
      ],
    ]);
  });

  it('failed kèm result mà server từ chối 400 → gửi lại không có result', async () => {
    const { server, target, remote } = await serve((req) =>
      (req.body as { result?: unknown }).result
        ? { status: 400, body: { error: 'result chỉ gửi khi status là done' } }
        : { status: 200, body: {} },
    );
    await remote.submit(target, MACHINE, JOB, {
      status: 'failed',
      errorCode: 'check_failed',
      errorText: 'sshd agent',
      result: { kind: 'check', items: [{ id: 'sshd', status: 'error', title: 'sshd agent' }] },
    });
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.body).toEqual({
      companyId: COMPANY,
      machineId: MACHINE,
      status: 'failed',
      errorCode: 'check_failed',
      errorText: 'sshd agent',
    });
  });
});

describe('prepare', () => {
  it('payload sai → outcome app_error, không gọi server', async () => {
    const { server, target, remote } = await serve(() => ({ status: 200, body: {} }));
    const prepared = await remote.prepare(
      target,
      job({ kind: 'inspect-folder', payload: { kind: 'inspect-folder', folder: '../x' } }),
    );
    expect(prepared).toEqual({
      outcome: {
        status: 'failed',
        errorCode: 'app_error',
        errorText: 'Việc không hợp lệ: folder phải là đường tuyệt đối',
      },
    });
    expect(server.requests).toEqual([]);
  });

  it('prepare-checkouts có setupRunId → lấy projectId từ setup run', async () => {
    const { server, target, remote } = await serve(() => ({
      status: 200,
      body: { id: RUN, projectId: PROJECT },
    }));
    const payload = {
      kind: 'prepare-checkouts' as const,
      projectKey: 'demo',
      folder: '/Users/a/repo',
      roles: (['assistant', 'executor', 'reviewer', 'integrator'] as const).map((role) => ({
        role,
        branch: `crew/demo/${role}`,
      })),
    };
    const prepared = await remote.prepare(
      target,
      job({ kind: 'prepare-checkouts', payload, setupRunId: RUN }),
    );
    expect(prepared).toEqual({ extras: { projectId: PROJECT } });
    expect(server.requests[0]).toMatchObject({
      method: 'GET',
      path: `${BASE}/setup-runs/${RUN}`,
      query: { companyId: COMPANY },
    });
  });

  it('setup run không đọc được → projectId null (vẫn dựng checkout)', async () => {
    const { target, remote } = await serve(() => ({ status: 404, body: { error: 'x' } }));
    const payload = {
      kind: 'prepare-checkouts' as const,
      projectKey: 'demo',
      folder: '/Users/a/repo',
      roles: (['assistant', 'executor', 'reviewer', 'integrator'] as const).map((role) => ({
        role,
        branch: `crew/demo/${role}`,
      })),
    };
    expect(
      await remote.prepare(target, job({ kind: 'prepare-checkouts', payload, setupRunId: RUN })),
    ).toEqual({
      extras: { projectId: null },
    });
  });

  it('skill-sync → tải danh sách file và từng file của skill', async () => {
    const { server, target, remote } = await serve((req) => {
      if (req.path.endsWith('/files')) {
        return req.query.path === 'SKILL.md'
          ? { status: 200, body: { path: 'SKILL.md', content: '# A', encoding: 'utf8' } }
          : {
              status: 200,
              body: { path: req.query.path, content: 'IyEvYmluL3No', encoding: 'base64', executable: true },
            };
      }
      return {
        status: 200,
        body: {
          id: SKILL,
          slug: 'viet-test',
          fileInventory: [
            { path: 'SKILL.md', kind: 'skill' },
            { path: 'scripts/run.sh', kind: 'script' },
          ],
        },
      };
    });
    const prepared = await remote.prepare(
      target,
      job({
        kind: 'skill-sync',
        payload: { kind: 'skill-sync', skillId: SKILL, slug: 'viet-test', version: '1.0.0' },
      }),
    );
    expect(prepared).toEqual({
      extras: {
        projectId: null,
        skillFiles: [
          { path: 'SKILL.md', content: '# A', encoding: 'utf8', executable: false },
          { path: 'scripts/run.sh', content: 'IyEvYmluL3No', encoding: 'base64', executable: true },
        ],
      },
    });
    expect(server.requests.map((r) => `${r.path}?${r.query.path ?? ''}`)).toEqual([
      `/api/companies/${COMPANY}/skills/${SKILL}?`,
      `/api/companies/${COMPANY}/skills/${SKILL}/files?SKILL.md`,
      `/api/companies/${COMPANY}/skills/${SKILL}/files?scripts/run.sh`,
    ]);
  });

  it('skill không có, hoặc slug khác payload → skill_fetch_failed', async () => {
    const payload = { kind: 'skill-sync' as const, skillId: SKILL, slug: 'viet-test', version: '1.0.0' };
    const missing = await serve(() => ({ status: 404, body: { error: 'Skill not found' } }));
    expect(await missing.remote.prepare(missing.target, job({ kind: 'skill-sync', payload }))).toMatchObject({
      outcome: { status: 'failed', errorCode: 'skill_fetch_failed' },
    });
    const other = await serve(() => ({ status: 200, body: { id: SKILL, slug: 'khac', fileInventory: [] } }));
    expect(await other.remote.prepare(other.target, job({ kind: 'skill-sync', payload }))).toMatchObject({
      outcome: { status: 'failed', errorCode: 'skill_fetch_failed' },
    });
  });
});
