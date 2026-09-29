import {
  ApiErrorBody,
  type ApiErrorCode,
  type ChangePasswordRequest,
  ClaimRequest,
  ClaimRequestListResponse,
  type ClaimRequestStatus,
  ClaimResponse,
  Comment,
  type CreateProjectRequest,
  type CreateRequestTicket,
  CrossDocsSearchResponse,
  CSRF_HEADER,
  DocsOverviewResponse,
  DocsPageResponse,
  DocsSearchResponse,
  DocsSpaceResponse,
  type ListTicketsQuery,
  LoginPasswordResponse,
  type LoginTotpRequest,
  Machine,
  MachineDetailResponse,
  MachineListResponse,
  NoticeListResponse,
  NoticeReadResponse,
  type OwnerAssignRequest,
  PairingCodeResponse,
  Project,
  ProjectChangeListResponse,
  ProjectChangeRequest,
  type ProjectChangeStatus,
  ProjectListResponse,
  ReportResponse,
  SearchResponse,
  SessionResponse,
  Ticket,
  TicketDetailResponse,
  TicketListResponse,
  type TicketPriority,
  type TicketStatus,
  TicketTreeResponse,
  type UpdateProjectRequest,
  type UpdateTicketRequest,
} from '@crew/shared';
import type { z } from 'zod';

/** Error codes the client adds for failures that never reached (or never came back from) the API. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'INVALID_RESPONSE';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const CSRF_COOKIE = 'crew_csrf';
let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** The session response carries the CSRF token; every mutating request sends it back. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called once per 401 from any request except the session probe and login itself. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

type Query = Record<string, string | number | boolean | readonly string[] | null | undefined>;

export function toQueryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

interface RequestOptions<S extends z.ZodType | null> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  schema: S;
  signal?: AbortSignal;
  /** Session probe and login steps report 401 to the caller instead of the global handler. */
  quiet401?: boolean;
}

async function request<S extends z.ZodType | null>(
  path: string,
  options: RequestOptions<S>,
): Promise<S extends z.ZodType ? z.output<S> : undefined> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken ?? readCsrfCookie();
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${path}${toQueryString(options.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK', 'Không kết nối được máy chủ');
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const parsed = ApiErrorBody.safeParse(json);
    const error = parsed.success
      ? new ApiRequestError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.details,
        )
      : new ApiRequestError(response.status, 'INTERNAL', `HTTP ${response.status}`);
    if (response.status === 401 && !options.quiet401) unauthorizedHandler?.();
    throw error;
  }

  if (options.schema === null) return undefined as never;
  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, 'INVALID_RESPONSE', 'Phản hồi từ máy chủ không hợp lệ');
  }
  return parsed.data as never;
}

/** Fetches every page of a ticket list (the single-owner scale keeps this small), capped for safety. */
async function listAllTickets(query: ListTicketsQuery, maxItems = 1000): Promise<Ticket[]> {
  const items: Ticket[] = [];
  let cursor: string | undefined;
  do {
    const page = await request('/v1/tickets', {
      schema: TicketListResponse,
      query: { ...(query as Query), limit: 100, cursor },
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < maxItems);
  return items;
}

export const api = {
  session: () => request('/v1/auth/session', { schema: SessionResponse, quiet401: true }),
  login: (username: string, password: string) =>
    request('/v1/auth/login', {
      method: 'POST',
      body: { username, password },
      schema: LoginPasswordResponse,
      quiet401: true,
    }),
  loginTotp: (body: LoginTotpRequest) =>
    request('/v1/auth/login/totp', { method: 'POST', body, schema: SessionResponse, quiet401: true }),
  logout: () => request('/v1/auth/logout', { method: 'POST', schema: null, quiet401: true }),
  /** A 401 here usually means a wrong password or code, so the caller decides whether the session is gone. */
  changePassword: (body: ChangePasswordRequest) =>
    request('/v1/auth/password', { method: 'POST', body, schema: SessionResponse, quiet401: true }),

  listTickets: (query: ListTicketsQuery) => listAllTickets(query),
  getTicket: (idOrKey: string) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}`, { schema: TicketDetailResponse }),
  createTicket: (body: CreateRequestTicket) =>
    request('/v1/tickets', { method: 'POST', body, schema: Ticket }),
  updateTicket: (idOrKey: string, body: UpdateTicketRequest) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}`, { method: 'PATCH', body, schema: Ticket }),
  transition: (idOrKey: string, to: TicketStatus) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}/transition`, {
      method: 'POST',
      body: { to },
      schema: Ticket,
    }),
  setPriority: (idOrKey: string, priority: TicketPriority) => api.updateTicket(idOrKey, { priority }),
  addComment: (idOrKey: string, body: string) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}/comments`, {
      method: 'POST',
      body: { body },
      schema: Comment,
    }),
  getReports: (idOrKey: string) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}/report`, { schema: ReportResponse }),
  /** Quick search; `projectIds` narrows tickets and docs to those projects. */
  search: (q: string, projectIds?: readonly string[], signal?: AbortSignal) =>
    request('/v1/search', {
      schema: SearchResponse,
      query: { q, projectIds: projectIds?.length ? projectIds.join(',') : undefined },
      signal,
    }),

  /** One page of tickets as the server sorts it (default: most recently updated first). */
  /** Every descendant of a ticket (open and closed) in one call. */
  getTicketTree: (idOrKey: string) =>
    request(`/v1/tickets/${encodeURIComponent(idOrKey)}/tree`, { schema: TicketTreeResponse }),
  listTicketsPage: (query: ListTicketsQuery) =>
    request('/v1/tickets', { schema: TicketListResponse, query: query as Query }),

  getDocsSpace: (projectId: string) =>
    request(`/v1/projects/${encodeURIComponent(projectId)}/docs`, { schema: DocsSpaceResponse }),
  getDocsPage: (projectId: string, path: string) =>
    request(`/v1/projects/${encodeURIComponent(projectId)}/docs/page`, {
      schema: DocsPageResponse,
      query: { path },
    }),
  /** Every project's docs status (the docs home). */
  getDocsOverview: () => request('/v1/docs', { schema: DocsOverviewResponse }),
  /** Docs search across projects: every project, or only `projectIds`. */
  searchDocsAcross: (q: string, projectIds?: readonly string[], signal?: AbortSignal) =>
    request('/v1/docs/search', {
      schema: CrossDocsSearchResponse,
      query: { q, projectIds: projectIds?.length ? projectIds.join(',') : undefined },
      signal,
    }),
  searchDocs: (projectId: string, q: string, signal?: AbortSignal) =>
    request(`/v1/projects/${encodeURIComponent(projectId)}/docs/search`, {
      schema: DocsSearchResponse,
      query: { q },
      signal,
    }),

  listProjects: () => request('/v1/projects', { schema: ProjectListResponse }),
  createProject: (body: CreateProjectRequest) =>
    request('/v1/projects', { method: 'POST', body, schema: Project }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request(`/v1/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body, schema: Project }),

  listMachines: () => request('/v1/machines', { schema: MachineListResponse }),
  getMachine: (id: string) =>
    request(`/v1/machines/${encodeURIComponent(id)}`, { schema: MachineDetailResponse }),
  revokeMachine: (id: string) =>
    request(`/v1/machines/${encodeURIComponent(id)}/revoke`, { method: 'POST', schema: Machine }),
  createPairingCode: (code: string) =>
    request('/v1/machines/pairing-codes', { method: 'POST', body: { code }, schema: PairingCodeResponse }),
  assignToMachine: (machineId: string, body: OwnerAssignRequest) =>
    request(`/v1/machines/${encodeURIComponent(machineId)}/claims`, {
      method: 'POST',
      body,
      schema: ClaimResponse,
    }),

  listClaimRequests: (status?: ClaimRequestStatus) =>
    request('/v1/claim-requests', { schema: ClaimRequestListResponse, query: { status } }),
  decideClaim: (id: string, decision: 'approve' | 'reject', code: string) =>
    request(`/v1/claim-requests/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      body: { code },
      schema: ClaimRequest,
    }),

  listProjectChanges: (status?: ProjectChangeStatus) =>
    request('/v1/project-change-requests', { schema: ProjectChangeListResponse, query: { status } }),
  decideProjectChange: (id: string, decision: 'approve' | 'reject', code: string) =>
    request(`/v1/project-change-requests/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      body: { code },
      schema: ProjectChangeRequest,
    }),

  listNotices: () => request('/v1/notices', { schema: NoticeListResponse, query: { limit: 50 } }),
  markNoticesRead: (ids: string[]) =>
    request('/v1/notices/read', { method: 'POST', body: { ids }, schema: NoticeReadResponse }),
  markAllNoticesRead: (throughId?: string) =>
    request('/v1/notices/read-all', {
      method: 'POST',
      body: throughId === undefined ? {} : { throughId },
      schema: NoticeReadResponse,
    }),
};
