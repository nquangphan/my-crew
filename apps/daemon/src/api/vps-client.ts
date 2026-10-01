import {
  type AgentCommentRequest,
  type AgentMetaRequest,
  ApiErrorBody,
  type BmadProfile,
  BudgetStatusResponse,
  ClaimResponse,
  type ClaimTarget,
  Comment,
  type CreateSubtaskRequest,
  type DaemonCreateProjectRequest,
  DaemonProjectsResponse,
  DaemonRuntimeResponse,
  type DocsSyncRequest,
  DocsSyncResponse,
  EffectiveSettings,
  type FileBugRequest,
  FileBugResponse,
  HealthResponse,
  type HeartbeatRequest,
  HeartbeatResponse,
  IDEMPOTENCY_KEY_HEADER,
  type ImportLocalSettingsRequest,
  ImportLocalSettingsResponse,
  MachineCommand,
  type MachineCommandResultRequest,
  MachineTokenResponse,
  type PairMachineRequest,
  Project,
  ProjectCatalogResponse,
  type ProjectChangeBody,
  ProjectChangeResponse,
  PutBmadProfileResponse,
  type PutProjectFolderRequest,
  type PutProjectMcpRequest,
  type PutSkillsRequest,
  type RateSubtaskRequest,
  ReleaseClaimResponse,
  Report,
  type RetrySubtaskRequest,
  SaveSettingsResponse,
  type SubmitReportRequest,
  Ticket,
  TicketDetailResponse,
  type TicketStatus,
} from '@crew/shared';
import type { z } from 'zod';

/** A non-2xx answer from the API, with its error code when the body carried one. */
export class VpsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'VpsError';
  }

  /** The request never got a definitive answer (network error, timeout, 5xx gateway). */
  get transient(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

/** A request that ended in an error (after retries): what the app log records. Never headers or bodies. */
export interface ApiFailure {
  method: string;
  path: string;
  /** HTTP status; 0 when the request never got an answer (network, TLS, timeout). */
  status: number;
  code: string;
  message: string;
  attempts: number;
}

export interface VpsClientOptions {
  apiUrl: string;
  /** Read on every request, so a rotated token takes effect at once. */
  token: () => string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Attempts for transient failures; writes retry with the same Idempotency-Key. */
  attempts?: number;
  retryDelayMs?: number;
  /** Called once for every request that fails for good (the desktop app logs it). */
  onError?: (failure: ApiFailure) => void;
}

interface RequestOptions<S extends z.ZodType> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Required by the API for every daemon write except the heartbeat and token rotation. */
  idempotencyKey?: string;
  schema: S | null;
  auth?: boolean;
  /** Extra request headers (e.g. `if-none-match`). */
  headers?: Record<string, string>;
  /** A 304 answer resolves to null instead of failing (conditional GETs). */
  notModified?: boolean;
  /** Attempts for this request (default: the client's). */
  attempts?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Typed client for the VPS API. Every response is validated with the shared zod schemas. Transient
 * failures are retried; writes carry an Idempotency-Key so a retry replays the stored response instead of
 * repeating the write.
 */
export class VpsClient {
  readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: VpsClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  /** Bearer header for callers that open their own connection (the SSE stream). */
  authHeader(): Record<string, string> {
    const token = this.options.token();
    if (!token) throw new VpsError(401, 'UNAUTHORIZED', 'this machine is not paired (no machine token)');
    return { authorization: `Bearer ${token}` };
  }

  async request<S extends z.ZodType>(options: RequestOptions<S>): Promise<z.output<S>> {
    let lastError: VpsError | undefined;
    let attempt = 1;
    const attempts = options.attempts ?? this.attempts;
    try {
      for (; attempt <= attempts; attempt++) {
        try {
          return await this.once(options);
        } catch (error) {
          if (!(error instanceof VpsError) || !error.transient) throw error;
          lastError = error;
          if (attempt < attempts) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
        }
      }
      throw lastError ?? new VpsError(0, 'NETWORK', 'request failed');
    } catch (error) {
      this.report(options, error, Math.min(attempt, attempts));
      throw error;
    }
  }

  private report(options: RequestOptions<z.ZodType>, error: unknown, attempts: number): void {
    if (!this.options.onError) return;
    const vps = error instanceof VpsError ? error : null;
    try {
      this.options.onError({
        method: options.method,
        path: options.path,
        status: vps?.status ?? 0,
        code: vps?.code ?? 'CLIENT',
        message: (error as Error).message ?? String(error),
        attempts,
      });
    } catch {
      // a failing log sink never changes the request's outcome
    }
  }

  private async once<S extends z.ZodType>(options: RequestOptions<S>): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.auth !== false) Object.assign(headers, this.authHeader());
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${options.path}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VpsError(0, 'NETWORK', `${options.method} ${options.path}: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (response.status === 304 && options.notModified) return null as z.output<S>;
    const data: unknown = text === '' ? null : safeJson(text);
    if (!response.ok) {
      const parsed = ApiErrorBody.safeParse(data);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new VpsError(response.status, code, message, details);
      }
      throw new VpsError(
        response.status,
        'HTTP',
        `${options.method} ${options.path}: HTTP ${response.status}`,
      );
    }
    if (options.schema === null) return undefined as z.output<S>;
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new VpsError(
        response.status,
        'BAD_RESPONSE',
        `${options.method} ${options.path}: unexpected response shape (${parsed.error.issues[0]?.message ?? ''})`,
      );
    }
    return parsed.data;
  }

  // -------------------------------------------------------------------------
  // Public and machine endpoints
  // -------------------------------------------------------------------------

  health() {
    return this.request({ method: 'GET', path: '/v1/health', schema: HealthResponse, auth: false });
  }

  pair(body: PairMachineRequest) {
    return this.request({
      method: 'POST',
      path: '/v1/machines/pair',
      body,
      schema: MachineTokenResponse,
      auth: false,
    });
  }

  rotateToken() {
    return this.request({ method: 'POST', path: '/v1/daemon/token/rotate', schema: MachineTokenResponse });
  }

  heartbeat(body: HeartbeatRequest) {
    return this.request({ method: 'POST', path: '/v1/daemon/heartbeat', body, schema: HeartbeatResponse });
  }

  putSkills(body: PutSkillsRequest, idempotencyKey: string) {
    return this.request({ method: 'PUT', path: '/v1/daemon/skills', body, idempotencyKey, schema: null });
  }

  listProjects() {
    return this.request({ method: 'GET', path: '/v1/daemon/projects', schema: DaemonProjectsResponse });
  }

  createProject(body: DaemonCreateProjectRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: '/v1/daemon/projects',
      body,
      idempotencyKey,
      schema: Project,
    });
  }

  /** Asks the owner to change this machine's project type and UI-test MCP mapping (202 pending). */
  requestProjectChange(projectKey: string, body: ProjectChangeBody, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/projects/${encodeURIComponent(projectKey)}/change-requests`,
      body,
      idempotencyKey,
      schema: ProjectChangeResponse,
    });
  }

  /** Reports the BMAD profile read from this machine's checkout of a project it owns. */
  putBmadProfile(projectKey: string, body: BmadProfile, idempotencyKey: string) {
    return this.request({
      method: 'PUT',
      path: `/v1/daemon/projects/${encodeURIComponent(projectKey)}/bmad-profile`,
      body,
      idempotencyKey,
      schema: PutBmadProfileResponse,
    });
  }

  claim(target: ClaimTarget, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: '/v1/daemon/claims',
      body: target,
      idempotencyKey,
      schema: ClaimResponse,
    });
  }

  release(target: { projectKey: string } | { hostsAssistant: true }, idempotencyKey: string) {
    const path =
      'projectKey' in target
        ? `/v1/daemon/claims/${encodeURIComponent(target.projectKey)}`
        : '/v1/daemon/claims/assistant';
    return this.request({ method: 'DELETE', path, idempotencyKey, schema: ReleaseClaimResponse });
  }

  catalog() {
    return this.request({ method: 'GET', path: '/v1/projects/catalog', schema: ProjectCatalogResponse });
  }

  // -------------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------------

  getTicket(idOrKey: string) {
    return this.request({
      method: 'GET',
      path: `/v1/daemon/tickets/${encodeURIComponent(idOrKey)}`,
      schema: TicketDetailResponse,
    });
  }

  getBudget(ticketId: string) {
    return this.request({
      method: 'GET',
      path: `/v1/daemon/budget/${encodeURIComponent(ticketId)}`,
      schema: BudgetStatusResponse,
    });
  }

  createSubtask(body: CreateSubtaskRequest, idempotencyKey: string) {
    return this.request({ method: 'POST', path: '/v1/daemon/tickets', body, idempotencyKey, schema: Ticket });
  }

  comment(ticketId: string, body: AgentCommentRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/tickets/${encodeURIComponent(ticketId)}/comments`,
      body,
      idempotencyKey,
      schema: Comment,
    });
  }

  transition(ticketId: string, to: TicketStatus, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/tickets/${encodeURIComponent(ticketId)}/transition`,
      body: { to },
      idempotencyKey,
      schema: Ticket,
    });
  }

  submitReport(ticketId: string, body: SubmitReportRequest, idempotencyKey: string) {
    return this.request({
      method: 'PUT',
      path: `/v1/daemon/tickets/${encodeURIComponent(ticketId)}/report`,
      body,
      idempotencyKey,
      schema: Report,
    });
  }

  /** The PM (`pmTaskId`) rates or re-rates one of its open dev, qc or bug subtasks in place. */
  rateSubtask(pmTaskId: string, body: RateSubtaskRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/tickets/${encodeURIComponent(pmTaskId)}/rate-subtask`,
      body,
      idempotencyKey,
      schema: Ticket,
    });
  }

  retrySubtask(pmTaskId: string, body: RetrySubtaskRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/tickets/${encodeURIComponent(pmTaskId)}/retry-subtask`,
      body,
      idempotencyKey,
      schema: Ticket,
    });
  }

  fileBug(ticketId: string, body: FileBugRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/tickets/${encodeURIComponent(ticketId)}/bugs`,
      body,
      idempotencyKey,
      schema: FileBugResponse,
    });
  }

  agentMeta(ticketId: string, body: AgentMetaRequest, idempotencyKey: string) {
    return this.request({
      method: 'PATCH',
      path: `/v1/daemon/tickets/${encodeURIComponent(ticketId)}/agent-meta`,
      body,
      idempotencyKey,
      schema: Ticket,
    });
  }

  // -------------------------------------------------------------------------
  // Server-managed settings
  // -------------------------------------------------------------------------

  /**
   * The settings that apply to this machine; null when they still match `etag` (304). One attempt: the
   * caller keeps its cached copy and tries again on the next event or the hourly refresh.
   */
  settings(etag: string | null): Promise<EffectiveSettings | null> {
    return this.request({
      method: 'GET',
      path: '/v1/daemon/settings',
      schema: EffectiveSettings,
      headers: etag ? { 'if-none-match': etag } : {},
      notModified: true,
      attempts: 1,
    });
  }

  /** The one-time upload of this machine's local config values (kept only where the server has none). */
  importSettings(body: ImportLocalSettingsRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: '/v1/daemon/settings/import',
      body,
      idempotencyKey,
      schema: ImportLocalSettingsResponse,
    });
  }

  /** Switches MCP servers of a project this machine owns (a new revision of its server setting). */
  putProjectMcp(projectKey: string, body: PutProjectMcpRequest, idempotencyKey: string) {
    return this.request({
      method: 'PUT',
      path: `/v1/daemon/settings/projects/${encodeURIComponent(projectKey)}/mcp`,
      body,
      idempotencyKey,
      schema: SaveSettingsResponse,
    });
  }

  /** Sets one project's folder on this machine (kept with the machine's other folders on the server). */
  putProjectFolder(projectKey: string, body: PutProjectFolderRequest, idempotencyKey: string) {
    return this.request({
      method: 'PUT',
      path: `/v1/daemon/settings/project-folders/${encodeURIComponent(projectKey)}`,
      body,
      idempotencyKey,
      schema: SaveSettingsResponse,
    });
  }

  deleteProjectFolder(projectKey: string, idempotencyKey: string) {
    return this.request({
      method: 'DELETE',
      path: `/v1/daemon/settings/project-folders/${encodeURIComponent(projectKey)}`,
      idempotencyKey,
      schema: SaveSettingsResponse,
    });
  }

  // -------------------------------------------------------------------------
  // Runtime bundles (signed hot updates of the desktop app)
  // -------------------------------------------------------------------------

  /** The runtime this machine should run (pinned, else the newest its app can run) with its signed manifest. */
  runtime() {
    return this.request({
      method: 'GET',
      path: '/v1/daemon/runtime',
      schema: DaemonRuntimeResponse,
      attempts: 2,
    });
  }

  /**
   * Downloads one runtime tarball (bytes, unverified: the caller checks it against the signed manifest before
   * using it). Refuses an answer larger than `maxBytes`.
   */
  async runtimeBundle(version: string, maxBytes: number): Promise<Buffer> {
    const path = `/v1/daemon/runtime/${encodeURIComponent(version)}/bundle`;
    const download = await this.download(path, {
      accept: 'application/gzip',
      maxBytes,
      timeoutMs: Math.max(this.timeoutMs, 10 * 60 * 1000),
      tooLargeCode: 'BAD_RESPONSE',
    });
    return download.data;
  }

  /**
   * One GET that answers bytes instead of JSON (one attempt). Refuses an answer larger than `maxBytes`: by
   * its `content-length` before reading the body, and by the bytes actually read.
   */
  private async download(
    path: string,
    options: { accept: string; maxBytes: number; timeoutMs: number; tooLargeCode: string },
  ): Promise<{ data: Buffer; contentType: string }> {
    const { maxBytes } = options;
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.apiUrl}${path}`, {
          headers: { accept: options.accept, ...this.authHeader() },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new VpsError(0, 'NETWORK', `GET ${path}: ${(error as Error).message}`);
      }
      if (!response.ok) {
        const parsed = ApiErrorBody.safeParse(safeJson(await response.text()));
        if (parsed.success) {
          const { code, message, details } = parsed.data.error;
          throw new VpsError(response.status, code, message, details);
        }
        throw new VpsError(response.status, 'HTTP', `GET ${path}: HTTP ${response.status}`);
      }
      const tooLarge = () =>
        new VpsError(response.status, options.tooLargeCode, `GET ${path}: larger than ${maxBytes} bytes`);
      if (Number(response.headers.get('content-length') ?? '0') > maxBytes) {
        // The body is not read: the connection is dropped instead of downloading what will be refused.
        await response.body?.cancel().catch(() => undefined);
        throw tooLarge();
      }
      let data: Buffer;
      try {
        data = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        throw new VpsError(0, 'NETWORK', `GET ${path}: ${(error as Error).message}`);
      }
      if (data.length > maxBytes) throw tooLarge();
      return { data, contentType: response.headers.get('content-type') ?? '' };
    } catch (error) {
      this.report({ method: 'GET', path, schema: null }, error, 1);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Ticket attachments (images the owner pasted into a description or a comment)
  // -------------------------------------------------------------------------

  /**
   * Downloads one pasted image of a ticket this machine may read: its bytes and the mime type the server
   * stored for it. Refuses an answer larger than `maxBytes` (`ATTACHMENT_TOO_LARGE`). One attempt: a run never
   * waits on an image, the caller tells the agent which one it could not get.
   */
  async attachment(id: string, maxBytes: number): Promise<{ data: Buffer; mimeType: string }> {
    const { data, contentType } = await this.download(`/v1/daemon/attachments/${encodeURIComponent(id)}`, {
      accept: 'image/*',
      maxBytes,
      timeoutMs: this.timeoutMs,
      tooLargeCode: 'ATTACHMENT_TOO_LARGE',
    });
    return { data, mimeType: (contentType.split(';')[0] ?? '').trim().toLowerCase() };
  }

  // -------------------------------------------------------------------------
  // Remote machine commands
  // -------------------------------------------------------------------------

  /** Takes a command the owner sent this machine (pending → running); 409 when it expired or ended. */
  startCommand(commandId: string, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/commands/${encodeURIComponent(commandId)}/start`,
      idempotencyKey,
      schema: MachineCommand,
    });
  }

  finishCommand(commandId: string, body: MachineCommandResultRequest, idempotencyKey: string) {
    return this.request({
      method: 'POST',
      path: `/v1/daemon/commands/${encodeURIComponent(commandId)}/result`,
      body,
      idempotencyKey,
      schema: MachineCommand,
    });
  }

  syncDocs(projectKey: string, body: DocsSyncRequest, idempotencyKey: string) {
    return this.request({
      method: 'PUT',
      path: `/v1/daemon/projects/${encodeURIComponent(projectKey)}/docs`,
      body,
      idempotencyKey,
      schema: DocsSyncResponse,
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
