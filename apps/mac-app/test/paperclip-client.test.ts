import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPaperclipClient,
  normalizeOrigin,
  PaperclipAuthError,
  PaperclipForbiddenError,
  PaperclipHttpError,
} from '../src/main/paperclip/client.js';
import type { PaperclipClient } from '../src/main/paperclip/types.js';
import { type FakeHandler, startFakePaperclip } from './paperclip-fake-server.js';

const KEY = 'pcp_board_khoa-gia-0123456789abcdef';
const HASH = 'a'.repeat(64);
const C = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const B = 'abababab-abab-4bab-8bab-abababababab';
const ROLES = {
  assistantAgentId: A,
  executorAgentIds: [A],
  reviewerAgentId: '66666666-6666-4666-8666-666666666666',
  integratorAgentId: '77777777-7777-4777-8777-777777777777',
};

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function setup(handler: FakeHandler, extra: { timeoutMs?: number; key?: string | null } = {}) {
  const server = await startFakePaperclip(handler);
  close = server.close;
  const readKey = vi.fn(async () => (extra.key === undefined ? KEY : extra.key));
  const log = vi.fn();
  const client: PaperclipClient = createPaperclipClient(server.origin, {
    fetch: globalThis.fetch,
    readKey,
    log,
    timeoutMs: extra.timeoutMs,
  });
  return { server, client, readKey, log };
}

describe('origin', () => {
  it('chỉ nhận https, trừ http://127.0.0.1:<cổng> cho test', () => {
    expect(() => normalizeOrigin('http://example.com')).toThrow('Paperclip phải dùng https');
    expect(normalizeOrigin('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100');
    expect(normalizeOrigin('https://crew.2p-solutions.com/')).toBe('https://crew.2p-solutions.com');
    expect(() => normalizeOrigin('https://crew.2p-solutions.com/api')).toThrow('chỉ gồm');
    expect(() => normalizeOrigin('khong-phai-url')).toThrow();
    expect(() => createPaperclipClient('http://example.com', { fetch, readKey: async () => KEY })).toThrow(
      'Paperclip phải dùng https',
    );
  });
});

describe('request chung', () => {
  it('mọi request có Bearer key, key đọc lại mỗi lời gọi', async () => {
    const { server, client, readKey } = await setup(() => ({ status: 200, body: { userId: 'u1' } }));
    await expect(client.me()).resolves.toEqual({ userId: 'u1' });
    await client.me();
    expect(readKey).toHaveBeenCalledTimes(2);
    expect(server.requests.map((r) => r.authorization)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`]);
    expect(server.requests[0]?.path).toBe('/api/cli-auth/me');
  });

  it('timeout: server chậm hơn hạn thì lỗi tiếng Việt, không treo', async () => {
    const { client } = await setup(() => ({ status: 200, body: {}, delayMs: 500 }), { timeoutMs: 50 });
    await expect(client.me()).rejects.toThrow(/không trả lời trong/);
  });

  it('mặc định timeout 15 giây qua AbortSignal', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response(JSON.stringify({ userId: 'u' }), { status: 200 });
    }) as typeof fetch;
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = createPaperclipClient('http://127.0.0.1:9', {
      fetch: fakeFetch,
      readKey: async () => KEY,
    });
    await client.me();
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('không có key thì báo cần đăng nhập, không gọi mạng', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: {} }), { key: null });
    await expect(client.me()).rejects.toBeInstanceOf(PaperclipAuthError);
    expect(server.requests).toHaveLength(0);
  });

  it('401 → PaperclipAuthError "Cần đăng nhập lại Paperclip"', async () => {
    const { client } = await setup(() => ({ status: 401, body: { error: 'Board authentication required' } }));
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperclipAuthError);
    expect((error as Error).message).toBe('Cần đăng nhập lại Paperclip');
  });

  it('403 → PaperclipForbiddenError: báo tài khoản không có quyền, không phải "đăng nhập lại"', async () => {
    const { client } = await setup(() => ({
      status: 403,
      body: { error: 'User does not have access to this company' },
    }));
    const error = await client.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperclipForbiddenError);
    expect(error).not.toBeInstanceOf(PaperclipAuthError);
    expect(error).toMatchObject({ status: 403 });
    expect((error as Error).message).toContain('không có quyền');
    expect((error as Error).message).not.toContain('đăng nhập lại');
  });

  it('422 có code → PaperclipHttpError status/code, message có 422, không lộ key hay body', async () => {
    const { client } = await setup(() => ({ status: 422, body: { code: 'x', error: `lỗi có ${KEY}` } }));
    const error = await client.cancelRun(R).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperclipHttpError);
    expect(error).toMatchObject({ status: 422, code: 'x' });
    expect((error as Error).message).toContain('422');
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message).not.toContain('lỗi có');
  });

  it('log không bao giờ chứa key, kể cả khi lỗi', async () => {
    let n = 0;
    const { client, log } = await setup(() => {
      n += 1;
      return n === 2 ? { status: 500, body: { error: KEY } } : { status: 200, body: { userId: 'u' } };
    });
    await client.me();
    await client.me().catch(() => undefined);
    await client.me();
    expect(log).toHaveBeenCalled();
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
  });
});

describe('route', () => {
  it('companies: GET /api/companies, bỏ company đã archive', async () => {
    const { server, client } = await setup(() => ({
      status: 200,
      body: [
        {
          id: C,
          name: '2P Solutions',
          issuePrefix: 'TPS',
          requireBoardApprovalForNewAgents: false,
          status: 'active',
        },
        { id: P, name: 'Cũ', issuePrefix: 'OLD', requireBoardApprovalForNewAgents: true, status: 'archived' },
      ],
    }));
    await expect(client.companies()).resolves.toEqual([
      { id: C, name: '2P Solutions', issuePrefix: 'TPS', requireBoardApprovalForNewAgents: false },
    ]);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/api/companies' });
  });

  it('projects: dùng urlKey (API thật không có key)', async () => {
    const { server, client } = await setup(() => ({
      status: 200,
      body: [{ id: P, name: 'Phát triển Crew', urlKey: 'phat-trien-crew', status: 'backlog' }],
    }));
    await expect(client.projects(C)).resolves.toEqual([
      { id: P, name: 'Phát triển Crew', urlKey: 'phat-trien-crew' },
    ]);
    expect(server.requests[0]?.path).toBe(`/api/companies/${C}/projects`);
  });

  it('createProject: POST /api/companies/:id/projects', async () => {
    const { server, client } = await setup(() => ({ status: 201, body: { id: P, name: 'x' } }));
    await expect(client.createProject(C, { name: 'x', description: 'mô tả' })).resolves.toEqual({ id: P });
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: `/api/companies/${C}/projects`,
      body: { name: 'x', description: 'mô tả' },
    });
  });

  it('createEnvironment: SSH in_place, secret dùng lại bằng privateKeySecretRef', async () => {
    const { server, client } = await setup(() => ({ status: 201, body: { id: E } }));
    await client.createEnvironment(C, {
      name: 'repo-x-reviewer',
      host: '100.102.189.67',
      port: 2222,
      username: 'owner',
      remoteWorkspacePath: '/Users/owner/crew-agents/repo-x/reviewer',
      privateKeySecretId: '88888888-8888-4888-8888-888888888888',
      knownHosts: '[100.102.189.67]:2222 ssh-ed25519 AAAA',
      crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 },
    });
    expect(server.requests[0]).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/api/companies/${C}/environments`,
        body: {
          name: 'repo-x-reviewer',
          driver: 'ssh',
          config: {
            host: '100.102.189.67',
            port: 2222,
            username: 'owner',
            remoteWorkspacePath: '/Users/owner/crew-agents/repo-x/reviewer',
            privateKeySecretRef: {
              type: 'secret_ref',
              secretId: '88888888-8888-4888-8888-888888888888',
              version: 'latest',
            },
            knownHosts: '[100.102.189.67]:2222 ssh-ed25519 AAAA',
            strictHostKeyChecking: true,
          },
          metadata: {
            workspaceRealizationMode: 'in_place',
            crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 },
          },
        },
      }),
    );
  });

  it('archiveEnvironment: PATCH {status: archived}; client không có hàm xóa environment', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: { id: E, status: 'archived' } }));
    await client.archiveEnvironment(E);
    expect(server.requests[0]).toMatchObject({
      method: 'PATCH',
      path: `/api/environments/${E}`,
      body: { status: 'archived' },
    });
    const names = Object.keys(client).join(' ');
    expect(names).not.toMatch(/delete.*environment/i);
    expect(server.requests.every((r) => r.method !== 'DELETE')).toBe(true);
  });

  it('environments: GET danh sách để lấy secret SSH dùng chung', async () => {
    const { server, client } = await setup(() => ({
      status: 200,
      body: [
        {
          id: E,
          name: 'mac-mini',
          driver: 'ssh',
          status: 'active',
          config: {
            host: 'h',
            privateKeySecretRef: { type: 'secret_ref', secretId: 's', version: 'latest' },
          },
          metadata: { workspaceRealizationMode: 'in_place' },
        },
      ],
    }));
    const list = await client.environments(C);
    expect(list[0]).toMatchObject({ id: E, name: 'mac-mini', driver: 'ssh', status: 'active' });
    expect(server.requests[0]?.path).toBe(`/api/companies/${C}/environments`);
  });

  it('createAgent: claude_local, heartbeat tắt, maxConcurrentRuns 1, environment riêng', async () => {
    const { server, client } = await setup(() => ({ status: 201, body: { id: A, status: 'idle' } }));
    await expect(
      client.createAgent(C, {
        name: 'repo-x-reviewer',
        command: '/Users/owner/.crew/bin/crew-claude-run',
        extraArgs: ['--setting-sources', 'project,local'],
        model: 'claude-sonnet-5',
        defaultEnvironmentId: E,
      }),
    ).resolves.toEqual({ id: A, status: 'idle' });
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: `/api/companies/${C}/agents`,
      body: {
        name: 'repo-x-reviewer',
        adapterType: 'claude_local',
        runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
        defaultEnvironmentId: E,
      },
    });
    // Thiếu `engine` thì Paperclip chạy ACP, mà ACP không chạy được trên environment SSH `in_place`
    // (`adapter_engine_unavailable`). `env` rỗng như agent R1, không mang secret.
    expect((server.requests[0]?.body as { adapterConfig?: unknown } | undefined)?.adapterConfig).toEqual({
      engine: 'cli',
      command: '/Users/owner/.crew/bin/crew-claude-run',
      extraArgs: ['--setting-sources', 'project,local'],
      model: 'claude-sonnet-5',
      env: {},
    });
  });

  it('createAgent từ chối khi thiếu model, không gọi mạng', async () => {
    const { server, client } = await setup(() => ({ status: 201, body: { id: A } }));
    await expect(
      client.createAgent(C, {
        name: 'x',
        command: '/Users/owner/.crew/bin/crew-claude-run',
        extraArgs: [],
        model: '',
        defaultEnvironmentId: E,
      }),
    ).rejects.toThrow('model');
    expect(server.requests).toHaveLength(0);
  });

  it('createAgent từ chối command không phải wrapper crew-claude-run, không gọi mạng', async () => {
    const { server, client } = await setup(() => ({ status: 201, body: { id: A } }));
    await expect(
      client.createAgent(C, {
        name: 'x',
        command: 'claude',
        extraArgs: [],
        model: 'claude-sonnet-5',
        defaultEnvironmentId: E,
      }),
    ).rejects.toThrow('crew-claude-run');
    expect(server.requests).toHaveLength(0);
  });

  it('pauseAgent: POST /api/agents/:id/pause; patchAgent: PATCH; getAgent 404 → null', async () => {
    const { server, client } = await setup((req) =>
      req.method === 'GET'
        ? { status: 404, body: { error: 'Agent not found' } }
        : { status: 200, body: { id: A } },
    );
    await client.pauseAgent(A);
    await client.patchAgent(A, { title: 't' });
    await expect(client.getAgent(A)).resolves.toBeNull();
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /api/agents/${A}/pause`,
      `PATCH /api/agents/${A}`,
      `GET /api/agents/${A}`,
    ]);
    expect(server.requests[1]?.body).toEqual({ title: 't' });
  });

  it('getInstructionsFile: trả content + contentHash; 404 → null', async () => {
    let exists = true;
    const { server, client } = await setup(() =>
      exists
        ? { status: 200, body: { path: 'AGENTS.md', content: '# Vai', contentHash: HASH } }
        : { status: 404, body: { error: 'Agent file not found' } },
    );
    await expect(client.getInstructionsFile(A, 'AGENTS.md')).resolves.toEqual({
      content: '# Vai',
      hash: HASH,
    });
    expect(server.requests[0]).toMatchObject({
      path: `/api/agents/${A}/instructions-bundle/file`,
      query: { path: 'AGENTS.md' },
    });
    exists = false;
    await expect(client.getInstructionsFile(A, 'AGENTS.md')).resolves.toBeNull();
  });

  it('getInstructionsFile: hash không hợp lệ thì ném, không đoán null', async () => {
    const { client } = await setup(() => ({ status: 200, body: { content: 'x', contentHash: 'abc' } }));
    await expect(client.getInstructionsFile(A, 'AGENTS.md')).rejects.toThrow('contentHash');
  });

  it('putInstructionsFile: baseHash null hoặc đúng hash', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: { contentHash: HASH } }));
    await client.putInstructionsFile(A, 'AGENTS.md', 'nội dung', null);
    await client.putInstructionsFile(A, 'AGENTS.md', 'nội dung 2', HASH);
    expect(server.requests[0]).toMatchObject({
      method: 'PUT',
      path: `/api/agents/${A}/instructions-bundle/file`,
      body: { path: 'AGENTS.md', content: 'nội dung', baseHash: null },
    });
    expect(server.requests[1]?.body).toEqual({ path: 'AGENTS.md', content: 'nội dung 2', baseHash: HASH });
  });

  it('putInstructionsFile: 409 khi base cũ → PaperclipHttpError 409', async () => {
    const { client } = await setup(() => ({ status: 409, body: { error: 'conflict' } }));
    await expect(client.putInstructionsFile(A, 'AGENTS.md', 'x', null)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('cancelRun: POST /api/heartbeat-runs/:runId/cancel', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: { id: R, status: 'cancelled' } }));
    await client.cancelRun(R);
    expect(server.requests[0]).toMatchObject({ method: 'POST', path: `/api/heartbeat-runs/${R}/cancel` });
  });

  it('runWebUrl: <origin>/<issuePrefix>/agents/<agentId>/runs/<runId>, prefix lấy một lần mỗi company', async () => {
    const { server, client } = await setup((req) =>
      req.path.startsWith('/api/heartbeat-runs/')
        ? { status: 200, body: { id: R, agentId: A, companyId: C } }
        : { status: 200, body: { id: C, issuePrefix: 'TPS' } },
    );
    await expect(client.runWebUrl(R)).resolves.toBe(`${server.origin}/TPS/agents/${A}/runs/${R}`);
    await client.runWebUrl(R);
    expect(server.requests.map((r) => r.path)).toEqual([
      `/api/heartbeat-runs/${R}`,
      `/api/companies/${C}`,
      `/api/heartbeat-runs/${R}`,
    ]);
  });

  it('roles: GET/POST/DELETE route plugin crew.core, GET bỏ các ô runtime app không quản lý', async () => {
    let step = 0;
    const { server, client } = await setup(() => {
      step += 1;
      if (step === 1) return { status: 200, body: { roles: null } };
      if (step === 2) {
        const runtimeSlots = {
          codexExecutorAgentId: null,
          opencodeExecutorAgentId: null,
          codexReviewerAgentId: null,
        };
        return { status: 200, body: { roles: { ...ROLES, ...runtimeSlots } } };
      }
      if (step === 3) return { status: 200, body: { roles: ROLES } };
      return { status: 200, body: { deleted: true } };
    });
    await expect(client.getRoles(C, P)).resolves.toBeNull();
    await expect(client.getRoles(C, P)).resolves.toEqual(ROLES);
    await client.setRoles(C, P, ROLES);
    await client.deleteRoles(C, P);
    const path = `/api/plugins/crew.core/api/projects/${P}/roles`;
    expect(server.requests[0]).toMatchObject({ method: 'GET', path, query: { companyId: C } });
    expect(server.requests[2]).toMatchObject({ method: 'POST', path, body: { companyId: C, ...ROLES } });
    expect(server.requests[3]).toMatchObject({ method: 'DELETE', path, query: { companyId: C } });
  });
});

describe('route cho thêm/gỡ project', () => {
  it('agents: GET /api/companies/:id/agents, giữ id/tên/trạng thái/environment/engine (không giữ env)', async () => {
    const { server, client } = await setup(() => ({
      status: 200,
      body: [
        { id: A, name: 'a', status: 'paused', companyId: C, defaultEnvironmentId: E, adapterConfig: {} },
        {
          id: B,
          name: 'b',
          status: 'idle',
          companyId: C,
          defaultEnvironmentId: null,
          adapterConfig: { engine: 'cli', env: { SECRET_KEY: 'không được lộ' } },
        },
      ],
    }));
    await expect(client.agents(C)).resolves.toEqual([
      { id: A, name: 'a', status: 'paused', companyId: C, defaultEnvironmentId: E, engine: null },
      { id: B, name: 'b', status: 'idle', companyId: C, defaultEnvironmentId: null, engine: 'cli' },
    ]);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: `/api/companies/${C}/agents` });
  });

  it('setAgentPermissions: PATCH /api/agents/:id/permissions đủ ba quyền; giá trị không boolean thì không gọi mạng', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: { id: A } }));
    await client.setAgentPermissions(A, {
      canCreateAgents: false,
      canCreateSkills: false,
      canAssignTasks: true,
    });
    expect(server.requests[0]).toMatchObject({
      method: 'PATCH',
      path: `/api/agents/${A}/permissions`,
      body: { canCreateAgents: false, canCreateSkills: false, canAssignTasks: true },
    });
    await expect(
      client.setAgentPermissions(A, {
        canCreateAgents: false,
        canCreateSkills: 'no' as unknown as boolean,
        canAssignTasks: false,
      }),
    ).rejects.toThrow('boolean');
    expect(server.requests).toHaveLength(1);
  });

  it('getAgentPermissions: đọc như agent-permissions.sh (skill mặc định được, grant tasks:assign); 404 → null', async () => {
    const bodies: unknown[] = [
      {
        id: A,
        permissions: { canCreateAgents: false, canCreateSkills: false },
        access: { canAssignTasks: true, grants: [{ permissionKey: 'tasks:assign' }] },
      },
      // Thiếu canCreateSkills: server mặc định cho tạo skill. `access.canAssignTasks` true do mặc định thành viên,
      // không có grant thì không tính là được giao việc.
      { id: A, permissions: { canCreateAgents: true }, access: { canAssignTasks: true, grants: [] } },
      { id: A, permissions: {} },
    ];
    let n = 0;
    const { server, client } = await setup(() => {
      const body = bodies[n++];
      return body ? { status: 200, body } : { status: 404, body: { error: 'Agent not found' } };
    });
    await expect(client.getAgentPermissions(A)).resolves.toEqual({
      canCreateAgents: false,
      canCreateSkills: false,
      canAssignTasks: true,
    });
    await expect(client.getAgentPermissions(A)).resolves.toEqual({
      canCreateAgents: true,
      canCreateSkills: true,
      canAssignTasks: false,
    });
    await expect(client.getAgentPermissions(A)).rejects.toThrow('access.grants');
    await expect(client.getAgentPermissions(A)).resolves.toBeNull();
    expect(server.requests.every((r) => r.method === 'GET' && r.path === `/api/agents/${A}`)).toBe(true);
  });

  it('resumeAgent: POST /api/agents/:id/resume', async () => {
    const { server, client } = await setup(() => ({ status: 200, body: { id: A, status: 'idle' } }));
    await client.resumeAgent(A);
    expect(server.requests[0]).toMatchObject({ method: 'POST', path: `/api/agents/${A}/resume` });
  });

  it('setRoles 400: message có lời từ chối của plugin (kèm tên project), không có key', async () => {
    const { client } = await setup(() => ({
      status: 400,
      body: { error: `agent ${A} đang là reviewer ở project Repo A ${KEY}` },
    }));
    const error = await client.setRoles(C, P, ROLES).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperclipHttpError);
    expect(error).toMatchObject({ status: 400 });
    expect((error as Error).message).toContain('400');
    expect((error as Error).message).toContain('Repo A');
    expect((error as Error).message).not.toContain(KEY);
  });

  it('lỗi 400 của route khác vẫn không kèm body', async () => {
    const { client } = await setup(() => ({ status: 400, body: { error: 'chi tiết server' } }));
    const error = await client.createProject(C, { name: 'x' }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('chi tiết server');
  });
});

describe('ghép máy (route plugin crew.core)', () => {
  const PAIR = {
    companyId: C,
    machineId: A,
    hostname: 'Phans-MacBook-Pro',
    environmentId: E,
    tailscaleIp: '100.100.157.19',
    port: 2222,
    hostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
  };
  const MACHINE_KEY = 'm'.repeat(43);

  it('pairInfo: GET /machines/pair-info?companyId=, nhận đúng key ssh-ed25519', async () => {
    let reply = { paperclipSshPublicKey: 'ssh-ed25519 AAAAkey crew-mac-paperclip' } as Record<
      string,
      unknown
    >;
    const { server, client } = await setup(() => ({ status: 200, body: reply }));
    await expect(client.pairInfo(C)).resolves.toEqual({
      paperclipSshPublicKey: 'ssh-ed25519 AAAAkey crew-mac-paperclip',
    });
    expect(server.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/plugins/crew.core/api/machines/pair-info',
      query: { companyId: C },
    });
    reply = { paperclipSshPublicKey: 'ssh-rsa AAAA' };
    await expect(client.pairInfo(C)).rejects.toThrow('ssh-ed25519');
  });

  it('pairInfo 409 (server chưa có key) thành PaperclipHttpError 409', async () => {
    const { client } = await setup(() => ({ status: 409, body: { error: 'Server chưa có key Paperclip' } }));
    const error = await client.pairInfo(C).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaperclipHttpError);
    expect((error as PaperclipHttpError).status).toBe(409);
  });

  it('pairMachine: POST đúng các key, chỉ thêm allowRepair khi được yêu cầu, không log key máy', async () => {
    const { server, client, log } = await setup(() => ({
      status: 200,
      body: { machineKey: MACHINE_KEY, pairedAt: '2026-10-11T07:00:00.000Z' },
    }));
    await expect(client.pairMachine(PAIR)).resolves.toEqual({
      machineKey: MACHINE_KEY,
      pairedAt: '2026-10-11T07:00:00.000Z',
    });
    await client.pairMachine(PAIR, { allowRepair: true });
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/plugins/crew.core/api/machines/pair',
    });
    expect(server.requests[0]?.body).toEqual(PAIR);
    expect(server.requests[1]?.body).toEqual({ ...PAIR, allowRepair: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain(MACHINE_KEY);
  });

  it('pairMachine 409 giữ code của plugin (máy đã gỡ, máy dùng secret company); key máy sai dạng thì ném', async () => {
    let reply: { status: number; body: unknown } = {
      status: 409,
      body: { error: 'Máy đã bị gỡ, owner phải cho phép ghép lại', code: 'machine_revoked' },
    };
    const { client } = await setup(() => reply);
    await expect(client.pairMachine(PAIR)).rejects.toMatchObject({ status: 409, code: 'machine_revoked' });
    reply = {
      status: 409,
      body: { error: 'Máy đang gửi bản tin bằng secret company', code: 'machine_uses_company_secret' },
    };
    await expect(client.pairMachine(PAIR)).rejects.toMatchObject({
      status: 409,
      code: 'machine_uses_company_secret',
    });
    reply = { status: 200, body: { machineKey: 'ngắn', pairedAt: 'x' } };
    await expect(client.pairMachine(PAIR)).rejects.toThrow('key máy không hợp lệ');
  });
});
