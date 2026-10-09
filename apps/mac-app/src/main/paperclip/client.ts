import type {
  ClaudeLocalAgentInput,
  PaperclipAgent,
  PaperclipClient,
  PaperclipCompany,
  PaperclipEnvironment,
  ProjectRoles,
  SshEnvironmentInput,
} from './types.js';

export const REQUEST_TIMEOUT_MS = 15_000;
const HASH_RE = /^[a-f0-9]{64}$/;
const CODE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const WRAPPER_RE = /^\/.+\/\.crew\/bin\/crew-claude-run$/;
const ROLES_PATH = '/api/plugins/crew.core/api/projects';

/** 401/403: key hết hạn, bị thu hồi hoặc không còn quyền. */
export class PaperclipAuthError extends Error {
  constructor() {
    super('Cần đăng nhập lại Paperclip');
    this.name = 'PaperclipAuthError';
  }
}

/** Lỗi HTTP khác (status 0 = không tới được server). Message chỉ có mã, không có body (body có thể chứa token). */
export class PaperclipHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message?: string,
  ) {
    super(message ?? `Paperclip trả lỗi HTTP ${status}${code ? ` (${code})` : ''}`);
    this.name = 'PaperclipHttpError';
  }
}

/** Chỉ nhận `https://<host>` hoặc `http://127.0.0.1:<cổng>` (test), không path. Trả origin chuẩn hóa. */
export function normalizeOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Địa chỉ Paperclip không hợp lệ: ${input}`);
  }
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '';
  if (url.protocol !== 'https:' && !local) throw new Error('Paperclip phải dùng https');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Địa chỉ Paperclip chỉ gồm giao thức và tên máy, ví dụ https://crew.2p-solutions.com');
  }
  return url.origin;
}

export interface HttpDeps {
  fetch: typeof fetch;
  /** Ghi một sự kiện (không bao giờ nhận key hay query string). */
  log?: (event: string, fields: Record<string, unknown>) => void;
  timeoutMs?: number;
}

export interface RequestOptions {
  method: string;
  /** Path bắt đầu `/api/`, có thể kèm query. */
  path: string;
  body?: unknown;
  key?: string;
  /** 404 trả `null` thay vì ném. */
  notFoundNull?: boolean;
  /**
   * 400 thì message kèm `error` của server (bỏ key, tối đa 300 ký tự). Chỉ dùng cho route của plugin `crew.core`,
   * nơi lời từ chối là thông báo cho owner (vd. agent đang giữ vai trò ở project nào).
   */
  exposeServerError?: boolean;
}

/** Một request JSON tới Paperclip, timeout 15 giây; lỗi thành `PaperclipAuthError`/`PaperclipHttpError`. */
export async function paperclipRequest<T>(
  origin: string,
  deps: HttpDeps,
  options: RequestOptions,
): Promise<T> {
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const logPath = options.path.split('?')[0];
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await deps.fetch(`${origin}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    deps.log?.('paperclip-request-failed', { method: options.method, path: logPath, timedOut });
    throw timedOut
      ? new PaperclipHttpError(
          0,
          'timeout',
          `Paperclip không trả lời trong ${Math.round(timeoutMs / 1000)} giây`,
        )
      : new PaperclipHttpError(0, 'network', 'Không kết nối được Paperclip');
  }
  deps.log?.('paperclip-request', { method: options.method, path: logPath, status: response.status });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (response.status === 401 || response.status === 403) throw new PaperclipAuthError();
  if (response.status === 404 && options.notFoundNull) return null as T;
  if (!response.ok) {
    const code =
      isRecord(data) && typeof data.code === 'string' && CODE_RE.test(data.code) ? data.code : null;
    if (
      options.exposeServerError &&
      response.status === 400 &&
      isRecord(data) &&
      typeof data.error === 'string'
    ) {
      const said = (options.key ? data.error.split(options.key).join('***') : data.error).slice(0, 300);
      throw new PaperclipHttpError(400, code, `Paperclip từ chối (HTTP 400): ${said}`);
    }
    throw new PaperclipHttpError(response.status, code);
  }
  return data as T;
}

export interface ClientDeps extends HttpDeps {
  /** Đọc board key từ Keychain cho mỗi lời gọi; `null` = chưa đăng nhập. */
  readKey: () => Promise<string | null>;
}

/** Client REST mỏng của Paperclip. Key không được giữ lại sau mỗi request. */
export function createPaperclipClient(origin: string, deps: ClientDeps): PaperclipClient {
  const base = normalizeOrigin(origin);
  const prefixes = new Map<string, string>();
  const id = (value: string) => encodeURIComponent(value);

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    notFoundNull = false,
    exposeServerError = false,
  ): Promise<T> {
    const key = await deps.readKey();
    if (!key) throw new PaperclipAuthError();
    return paperclipRequest<T>(base, deps, { method, path, body, key, notFoundNull, exposeServerError });
  }

  const agentView = (agent: PaperclipAgent): PaperclipAgent => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    companyId: agent.companyId,
    defaultEnvironmentId: agent.defaultEnvironmentId ?? null,
  });

  async function issuePrefix(companyId: string): Promise<string> {
    const cached = prefixes.get(companyId);
    if (cached) return cached;
    const company = await call<{ issuePrefix?: unknown }>('GET', `/api/companies/${id(companyId)}`);
    if (typeof company?.issuePrefix !== 'string' || !company.issuePrefix) {
      throw new Error('Paperclip không trả issuePrefix của company');
    }
    prefixes.set(companyId, company.issuePrefix);
    return company.issuePrefix;
  }

  return {
    origin: base,

    async me() {
      const me = await call<{ userId: string }>('GET', '/api/cli-auth/me');
      return { userId: me.userId };
    },

    async companies() {
      const list = await call<Array<PaperclipCompany & { status?: string }>>('GET', '/api/companies');
      return list
        .filter((company) => company.status !== 'archived')
        .map(({ id, name, issuePrefix, requireBoardApprovalForNewAgents }) => ({
          id,
          name,
          issuePrefix,
          requireBoardApprovalForNewAgents: requireBoardApprovalForNewAgents === true,
        }));
    },

    async projects(companyId) {
      const list = await call<Array<{ id: string; name: string; urlKey: string }>>(
        'GET',
        `/api/companies/${id(companyId)}/projects`,
      );
      return list.map(({ id, name, urlKey }) => ({ id, name, urlKey }));
    },

    async createProject(companyId, input) {
      const created = await call<{ id: string }>('POST', `/api/companies/${id(companyId)}/projects`, input);
      return { id: created.id };
    },

    async environments(companyId) {
      const list = await call<PaperclipEnvironment[]>('GET', `/api/companies/${id(companyId)}/environments`);
      return list.map(({ id, name, driver, status, config, metadata }) => ({
        id,
        name,
        driver,
        status,
        config: config ?? {},
        metadata: metadata ?? null,
      }));
    },

    async createEnvironment(companyId, input: SshEnvironmentInput) {
      const body = {
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        driver: 'ssh',
        config: {
          host: input.host,
          port: input.port,
          username: input.username,
          remoteWorkspacePath: input.remoteWorkspacePath,
          privateKeySecretRef: { type: 'secret_ref', secretId: input.privateKeySecretId, version: 'latest' },
          knownHosts: input.knownHosts,
          strictHostKeyChecking: true,
        },
        metadata: {
          workspaceRealizationMode: 'in_place',
          ...(input.crewLoadGate ? { crewLoadGate: input.crewLoadGate } : {}),
        },
      };
      const created = await call<{ id: string }>(
        'POST',
        `/api/companies/${id(companyId)}/environments`,
        body,
      );
      return { id: created.id };
    },

    async archiveEnvironment(environmentId) {
      await call('PATCH', `/api/environments/${id(environmentId)}`, { status: 'archived' });
    },

    async createAgent(companyId, input: ClaudeLocalAgentInput) {
      if (!WRAPPER_RE.test(input.command)) {
        throw new Error('command của agent phải là đường dẫn tuyệt đối <home>/.crew/bin/crew-claude-run');
      }
      const body = {
        name: input.name,
        ...(input.title === undefined ? {} : { title: input.title }),
        adapterType: 'claude_local',
        adapterConfig: {
          command: input.command,
          extraArgs: input.extraArgs,
          ...(input.model === undefined ? {} : { model: input.model }),
        },
        runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
        defaultEnvironmentId: input.defaultEnvironmentId,
      };
      const created = await call<{ id: string; status: string }>(
        'POST',
        `/api/companies/${id(companyId)}/agents`,
        body,
      );
      return { id: created.id, status: created.status };
    },

    async getAgent(agentId) {
      const agent = await call<PaperclipAgent | null>('GET', `/api/agents/${id(agentId)}`, undefined, true);
      return agent ? agentView(agent) : null;
    },

    async agents(companyId) {
      const list = await call<PaperclipAgent[]>('GET', `/api/companies/${id(companyId)}/agents`);
      return list.map(agentView);
    },

    async pauseAgent(agentId) {
      await call('POST', `/api/agents/${id(agentId)}/pause`);
    },

    async resumeAgent(agentId) {
      await call('POST', `/api/agents/${id(agentId)}/resume`);
    },

    async patchAgent(agentId, patch) {
      await call('PATCH', `/api/agents/${id(agentId)}`, patch);
    },

    async getInstructionsFile(agentId, path) {
      const file = await call<{ content?: unknown; contentHash?: unknown } | null>(
        'GET',
        `/api/agents/${id(agentId)}/instructions-bundle/file?path=${encodeURIComponent(path)}`,
        undefined,
        true,
      );
      if (!file) return null;
      if (typeof file.contentHash !== 'string' || !HASH_RE.test(file.contentHash)) {
        throw new Error('Paperclip trả file instructions không có contentHash hợp lệ');
      }
      return { content: typeof file.content === 'string' ? file.content : '', hash: file.contentHash };
    },

    async putInstructionsFile(agentId, path, content, baseHash) {
      if (baseHash !== null && !HASH_RE.test(baseHash))
        throw new Error('baseHash phải là 64 ký tự hex hoặc null');
      await call('PUT', `/api/agents/${id(agentId)}/instructions-bundle/file`, { path, content, baseHash });
    },

    async cancelRun(runId) {
      await call('POST', `/api/heartbeat-runs/${id(runId)}/cancel`);
    },

    async runWebUrl(runId) {
      const run = await call<{ agentId?: unknown; companyId?: unknown }>(
        'GET',
        `/api/heartbeat-runs/${id(runId)}`,
      );
      if (typeof run?.agentId !== 'string' || typeof run.companyId !== 'string') {
        throw new Error('Paperclip không trả agentId/companyId của run');
      }
      const prefix = await issuePrefix(run.companyId);
      return `${base}/${id(prefix)}/agents/${id(run.agentId)}/runs/${id(runId)}`;
    },

    async getRoles(companyId, projectId) {
      const answer = await call<{ roles: ProjectRoles | null }>(
        'GET',
        `${ROLES_PATH}/${id(projectId)}/roles?companyId=${id(companyId)}`,
      );
      return answer?.roles ?? null;
    },

    async setRoles(companyId, projectId, roles) {
      const { assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId } = roles;
      await call(
        'POST',
        `${ROLES_PATH}/${id(projectId)}/roles`,
        { companyId, assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId },
        false,
        true,
      );
    },

    async deleteRoles(companyId, projectId) {
      await call('DELETE', `${ROLES_PATH}/${id(projectId)}/roles?companyId=${id(companyId)}`);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
