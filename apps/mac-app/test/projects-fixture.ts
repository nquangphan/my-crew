import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { AppStateStore } from '../src/main/app-state.js';
import type { OpsBridge, OpsName } from '../src/main/ops-bridge.js';
import { createPaperclipClient } from '../src/main/paperclip/client.js';
import type { ProjectRoles } from '../src/main/paperclip/types.js';
import type { ProjectDeps } from '../src/main/projects/progress.js';
import { type SeenRequest, startFakePaperclip } from './paperclip-fake-server.js';

export const COMPANY = '11111111-1111-4111-8111-111111111111';
export const SECRET = '99999999-9999-4999-8999-999999999999';
export const TEMPLATE_ENV = '88888888-8888-4888-8888-888888888888';
const KEY = 'pcp_board_khoa-gia-cho-test';

interface FakeAgent {
  id: string;
  name: string;
  status: string;
  companyId: string;
  defaultEnvironmentId: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: unknown;
}

interface FakeEnv {
  id: string;
  name: string;
  driver: string;
  status: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

/** Luật thất bại: request khớp `match` trả `status` (`times` lần, mặc định 1). */
export interface FailRule {
  match: (req: SeenRequest) => boolean;
  status: number;
  body?: unknown;
  times?: number;
  /** Server vẫn làm thật rồi mới trả lỗi (response bị mất). */
  passThrough?: boolean;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Paperclip giả có trạng thái (project, environment, agent, AGENTS.md, vai trò), chạy trên `127.0.0.1`. */
export async function startStatefulPaperclip(
  opts: { requireApproval?: boolean; approveAfterGets?: number } = {},
) {
  const projects = new Map<string, { id: string; name: string; urlKey: string }>();
  const envs = new Map<string, FakeEnv>([
    [
      TEMPLATE_ENV,
      {
        id: TEMPLATE_ENV,
        name: 'mac-mini',
        driver: 'ssh',
        status: 'active',
        config: {
          host: '100.64.1.2',
          port: 2222,
          username: 'owner',
          remoteWorkspacePath: '/Users/owner/crew-agents/assistant',
          privateKeySecretRef: { type: 'secret_ref', secretId: SECRET, version: 'latest' },
          knownHosts: '[100.64.1.2]:2222 ssh-ed25519 AAAA',
          strictHostKeyChecking: true,
        },
        metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: { maxLoad1: 6, maxWaitMinutes: 30 } },
      },
    ],
  ]);
  const agents = new Map<string, FakeAgent>();
  const files = new Map<string, string>();
  const roles = new Map<string, ProjectRoles>();
  const rules: FailRule[] = [];
  const pendingGets = new Map<string, number>();

  const handler = (req: SeenRequest) => {
    for (const rule of rules) {
      if ((rule.times ?? 1) > 0 && rule.match(req)) {
        rule.times = (rule.times ?? 1) - 1;
        if (rule.passThrough) serve(req);
        return { status: rule.status, body: rule.body ?? { error: 'lỗi giả' } };
      }
    }
    return serve(req);
  };

  const serve = (req: SeenRequest): { status: number; body?: unknown } => {
    const p = req.path;
    const envMatch = p.match(/^\/api\/environments\/([^/]+)$/);
    const agentMatch = p.match(/^\/api\/agents\/([^/]+)(\/[a-z-/]+)?$/);
    const rolesMatch = p.match(/^\/api\/plugins\/crew\.core\/api\/projects\/([^/]+)\/roles$/);
    if (req.method === 'GET' && p === `/api/companies/${COMPANY}/projects`)
      return { status: 200, body: [...projects.values()] };
    if (req.method === 'POST' && p === `/api/companies/${COMPANY}/projects`) {
      const body = req.body as { name: string };
      const project = { id: randomUUID(), name: body.name, urlKey: body.name.toLowerCase() };
      projects.set(project.id, project);
      return { status: 201, body: project };
    }
    if (req.method === 'GET' && p === `/api/companies/${COMPANY}/environments`)
      return { status: 200, body: [...envs.values()] };
    if (req.method === 'POST' && p === `/api/companies/${COMPANY}/environments`) {
      const body = req.body as Omit<FakeEnv, 'id' | 'status'>;
      const env: FakeEnv = { ...body, id: randomUUID(), status: 'active' };
      envs.set(env.id, env);
      return { status: 201, body: env };
    }
    if (req.method === 'PATCH' && envMatch) {
      const env = envs.get(envMatch[1] as string);
      if (!env) return { status: 404, body: { error: 'not found' } };
      Object.assign(env, req.body as object);
      return { status: 200, body: env };
    }
    if (req.method === 'GET' && p === `/api/companies/${COMPANY}/agents`)
      return { status: 200, body: [...agents.values()] };
    if (req.method === 'POST' && p === `/api/companies/${COMPANY}/agents`) {
      const body = req.body as Omit<FakeAgent, 'id' | 'status' | 'companyId'>;
      const agent: FakeAgent = {
        ...body,
        id: randomUUID(),
        companyId: COMPANY,
        status: opts.requireApproval ? 'pending_approval' : 'idle',
      };
      agents.set(agent.id, agent);
      files.set(agent.id, `# ${agent.name}\nmặc định\n`);
      return { status: 201, body: agent };
    }
    if (agentMatch) {
      const agent = agents.get(agentMatch[1] as string);
      if (!agent) return { status: 404, body: { error: 'Agent not found' } };
      const tail = agentMatch[2] ?? '';
      if (req.method === 'GET' && tail === '') {
        if (agent.status === 'pending_approval') {
          const n = (pendingGets.get(agent.id) ?? 0) + 1;
          pendingGets.set(agent.id, n);
          if (n >= (opts.approveAfterGets ?? Number.POSITIVE_INFINITY)) agent.status = 'idle';
        }
        return { status: 200, body: agent };
      }
      if (req.method === 'POST' && tail === '/pause') {
        if (agent.status === 'terminated') return { status: 409, body: { error: 'terminated' } };
        agent.status = 'paused';
        return { status: 200, body: agent };
      }
      if (req.method === 'POST' && tail === '/resume') {
        if (agent.status === 'pending_approval' || agent.status === 'terminated')
          return { status: 409, body: { error: 'cannot resume' } };
        agent.status = 'idle';
        return { status: 200, body: agent };
      }
      if (tail === '/instructions-bundle/file') {
        const current = files.get(agent.id);
        if (req.method === 'GET') {
          if (current === undefined) return { status: 404, body: { error: 'File not found' } };
          return { status: 200, body: { path: 'AGENTS.md', content: current, contentHash: sha(current) } };
        }
        if (req.method === 'PUT') {
          const body = req.body as { content: string; baseHash?: string | null };
          if (body.baseHash === undefined) return { status: 422, body: { error: 'baseHash required' } };
          if ((current === undefined ? null : sha(current)) !== body.baseHash)
            return { status: 409, body: { code: 'INSTRUCTION_REVISION_CONFLICT' } };
          files.set(agent.id, body.content);
          return { status: 200, body: { path: 'AGENTS.md', contentHash: sha(body.content) } };
        }
      }
    }
    if (rolesMatch) {
      const projectId = rolesMatch[1] as string;
      if (req.method === 'GET') return { status: 200, body: { roles: roles.get(projectId) ?? null } };
      if (req.method === 'POST') {
        const { companyId: _c, ...rest } = req.body as ProjectRoles & { companyId: string };
        roles.set(projectId, rest);
        return { status: 200, body: { roles: rest } };
      }
      if (req.method === 'DELETE') return { status: 200, body: { deleted: roles.delete(projectId) } };
    }
    return { status: 404, body: { error: `không có route ${req.method} ${p}` } };
  };

  const server = await startFakePaperclip(handler);
  const client = createPaperclipClient(server.origin, { fetch: globalThis.fetch, readKey: async () => KEY });
  return { ...server, client, projects, envs, agents, files, roles, rules };
}

export type OpsCall = { op: OpsName; args: unknown[] };

/** `OpsBridge` giả: không chạm `~/.crew` thật, ghi lại lời gọi. */
export function fakeOps(
  home: string,
  override: Partial<Record<OpsName, (...args: unknown[]) => unknown>> = {},
) {
  const calls: OpsCall[] = [];
  const pinDir = join(home, '.crew', 'workflows', 'superpowers', '5.0.7-abc123');
  const defaults: Partial<Record<OpsName, (...args: unknown[]) => unknown>> = {
    setup: () => ({
      changed: [],
      restarted: [],
      manifest: {
        version: 1,
        port: 2222,
        listenAddress: '100.64.1.2',
        worktreeRoot: join(home, 'crew-agents'),
      },
      superpowers: {
        dir: pinDir,
        extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', pinDir],
      },
      sshdHandoff: 'unchanged',
    }),
    addStatusRepo: () => undefined,
    removeStatusRepo: () => undefined,
    listStatusRepos: () => [],
    doctor: () => [
      { id: 'worktree-root', title: 'Thư mục worktree', status: 'ok', detail: '' },
      { id: 'worktree-workflows', title: 'Nguồn skill', status: 'ok', detail: '' },
      { id: 'claude-auth', title: 'Claude', status: 'fail', detail: 'không liên quan' },
    ],
    workflowCheck: () => ({ ok: true, lines: [] }),
  };
  const ops: OpsBridge = {
    call: vi.fn(async (op: OpsName, ...args: unknown[]) => {
      calls.push({ op, args });
      const fn = override[op] ?? defaults[op];
      if (!fn) throw new Error(`ops giả không có ${op}`);
      return fn(...args);
    }) as unknown as OpsBridge['call'],
  };
  return { ops, calls, pinDir };
}

/**
 * HOME giả + repo git gốc (bare, làm remote giả) có `docs/flows.yaml` + folder owner (clone của remote đó) + bundle
 * crew-docs giả, tất cả dưới thư mục tạm.
 */
export function makeSandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-pj-')));
  const home = join(root, 'home');
  mkdirSync(join(home, '.crew', 'bin'), { recursive: true });
  writeFileSync(join(home, '.crew', 'bin', 'crew-docs.cjs'), '// bundle giả\n');
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args: string[], cwd?: string) =>
    execFileSync('/usr/bin/git', args, { cwd, env, encoding: 'utf8' }).trim();
  const work = join(root, 'src');
  mkdirSync(join(work, 'docs'), { recursive: true });
  writeFileSync(join(work, 'README.md'), 'repo thử\n');
  writeFileSync(join(work, 'docs', 'flows.yaml'), 'flows: {}\n');
  git(['init', '-q', '-b', 'main', work]);
  git(['-C', work, 'add', '.']);
  git(['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'đầu']);
  const origin = join(root, 'origin.git');
  git(['clone', '-q', '--bare', work, origin]);
  // Folder owner chọn: bản clone thường có `origin` và `origin/HEAD`, nằm ngoài HOME (như `/Volumes/...`).
  const folder = join(root, 'Projects', 'landing');
  git(['clone', '-q', origin, folder]);
  return {
    root,
    home,
    env,
    origin,
    folder,
    git,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function makeStore(root: string, companyId: string | null = COMPANY) {
  const store = new AppStateStore(join(root, 'app-support', 'app.json'), '0.1.0');
  return store
    .update((s) => ({ ...s, setup: { ...s.setup, paperclipOrigin: 'http://127.0.0.1:1', companyId } }))
    .then(() => store);
}

export function baseDeps(
  sandbox: ReturnType<typeof makeSandbox>,
  paperclip: Awaited<ReturnType<typeof startStatefulPaperclip>>,
  ops: OpsBridge,
  store: AppStateStore,
): ProjectDeps {
  return {
    home: sandbox.home,
    env: sandbox.env,
    client: paperclip.client,
    ops,
    store,
    sleep: async () => undefined,
  };
}
