import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Id, RouteDependencies, ServerOptions } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { authorizeTicketMutation } from './authorization.ts';
import type {
  CreateTicket,
  DecisionInput,
  RepairResultInput,
  TicketServiceDependencies,
} from './contracts.ts';
import { readTicketDocsLinks, readTicketHistory } from './history.ts';
import { createTicketServices, requireProjectScope, requireTicket } from './service.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const obj = { type: 'object', additionalProperties: true } as const;
const nullableUuid = { anyOf: [uuid, { type: 'null' }] } as const;
const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;
const createBody = {
  type: 'object',
  additionalProperties: false,
  required: [
    'projectId',
    'parentId',
    'level',
    'kind',
    'title',
    'description',
    'mandatory',
    'criteria',
    'inputs',
    'outputs',
    'skill',
  ],
  properties: {
    projectId: uuid,
    parentId: nullableUuid,
    level: { type: 'string', enum: ['request', 'step', 'task'] },
    kind: { type: 'string', enum: ['code', 'research', 'docs', 'deploy'] },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 65536 },
    mandatory: { type: 'boolean' },
    criteria: obj,
    inputs: obj,
    outputs: obj,
    skill: { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] },
    workflowPin: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['workflow', 'version', 'revision', 'checksum'],
          properties: {
            workflow: { type: 'string', enum: ['superpowers', 'bmad'] },
            version: { type: 'string', minLength: 1 },
            revision: { type: 'string', minLength: 1 },
            checksum: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
          },
        },
      ],
    },
    deployApprovalDecisionId: { anyOf: [uuid, { type: 'null' }] },
  },
} as const;
const dependencyBody = {
  type: 'object',
  additionalProperties: false,
  required: ['predecessorId', 'expectedRevision'],
  properties: { predecessorId: uuid, expectedRevision: revision },
} as const;
const signalBody = {
  type: 'object',
  additionalProperties: false,
  required: ['signal', 'expectedRevision'],
  properties: {
    signal: { type: 'string', enum: ['dependencies_ready', 'wait_owner', 'resume'] },
    expectedRevision: revision,
    evidenceId: uuid,
  },
} as const;
const commentBody = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string', minLength: 1, maxLength: 32768 } },
} as const;
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: { type: 'string', enum: ['docs', 'ticket', 'artifact', 'owner_decision'] },
    id: uuid,
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    locator: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;
const decisionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'content', 'rationale', 'sources', 'scope'],
  properties: {
    kind: {
      type: 'string',
      enum: ['assessment', 'delegated', 'owner_answer', 'approval', 'intervention', 'dispatch'],
    },
    content: { type: 'string', minLength: 1, maxLength: 32768 },
    rationale: { type: 'string', minLength: 1, maxLength: 32768 },
    sources: { type: 'array', maxItems: 100, items: sourceSchema },
    scope: obj,
  },
} as const;
const repairBody = {
  type: 'object',
  additionalProperties: false,
  required: ['attemptId', 'fence', 'cycleId', 'classification', 'passed', 'evidence'],
  properties: {
    attemptId: uuid,
    fence: { type: 'string', pattern: '^[1-9][0-9]*$' },
    cycleId: uuid,
    classification: { type: 'string', enum: ['initial_review', 'repair_review', 'infrastructure', 'model'] },
    passed: { type: 'boolean' },
    evidence: obj,
  },
} as const;
const docsLinksBody = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshotId', 'paths', 'expectedRevision'],
  properties: {
    snapshotId: uuid,
    paths: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 4096 },
    },
    expectedRevision: revision,
  },
} as const;

type TicketServices = ReturnType<typeof createTicketServices>;
type PageQuery = { limit?: string; cursor?: string };
function page(query: PageQuery): { limit: number; cursor: Id | null } {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
  return { limit, cursor: query.cursor ?? null };
}
async function writeActor(request: FastifyRequest, deps: RouteDependencies): Promise<Actor> {
  const actor = await deps.auth.authenticate(request);
  if (actor.kind === 'owner') return deps.auth.requireOwner(request, { csrf: true });
  return actor;
}
function key(request: FastifyRequest): string {
  return String(request.headers['idempotency-key'] ?? '');
}
function route(method: string, path: string): string {
  return `${method}:${path}`;
}

export function registerTicketRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  servicesOrDependencies: TicketServices | TicketServiceDependencies = {},
): void {
  const services =
    'createTicket' in servicesOrDependencies
      ? servicesOrDependencies
      : createTicketServices(servicesOrDependencies);
  app.post<{ Body: CreateTicket }>(
    '/v2/tickets',
    { schema: { body: createBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      const body = { ...request.body, workflowPin: request.body.workflowPin ?? null };
      const result = await deps.mutator(
        {
          actor,
          route: route('POST', '/v2/tickets'),
          key: key(request),
          body,
          authorize: (tx) =>
            authorizeTicketMutation(tx, actor, { projectId: body.projectId, parentId: body.parentId }),
        },
        async (tx) => ({ status: 201, body: await services.createTicket(tx, body, actor) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.get<{
    Querystring: PageQuery & { projectId?: Id; status?: string; kind?: string; rootId?: Id; level?: string };
  }>(
    '/v2/tickets',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: uuid,
            rootId: uuid,
            status: {
              type: 'string',
              enum: ['pending', 'ready', 'running', 'needs_input', 'paused', 'done', 'cancelled'],
            },
            kind: { type: 'string', enum: ['code', 'research', 'docs', 'deploy'] },
            level: { type: 'string', enum: ['request', 'step', 'task'] },
            cursor: uuid,
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      const { limit, cursor } = page(request.query);
      if (request.query.projectId)
        await options.db.begin((tx) => requireProjectScope(tx, request.query.projectId as Id, actor));
      const projectId = request.query.projectId ?? null;
      const status = request.query.status ?? null;
      const kind = request.query.kind ?? null;
      const rootId = request.query.rootId ?? null;
      const level = request.query.level ?? null;
      const rows = await options.db`select t.* from tickets t join projects p on p.id=t.project_id
        where (${projectId}::uuid is null or t.project_id=${projectId})
          and (${status}::text is null or t.status=${status})
          and (${kind}::text is null or t.kind=${kind})
          and (${rootId}::uuid is null or t.root_id=${rootId})
          and (${level}::text is null or t.level=${level})
          and (${cursor}::uuid is null or t.id>${cursor})
          and (${actor.kind === 'owner'} or p.machine_id=${actor.id === 'owner' ? null : actor.id}::uuid)
        order by t.id limit ${limit + 1}`;
      const items = rows.slice(0, limit).map(services.mapTicket);
      return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
    },
  );
  app.get<{ Params: { id: Id } }>('/v2/tickets/:id', { schema: { params: idParam } }, async (request) => {
    const actor = await deps.auth.authenticate(request);
    return options.db.begin((tx) => requireTicket(tx, request.params.id, actor));
  });
  app.get<{ Params: { id: Id } }>(
    '/v2/tickets/:id/graph',
    { schema: { params: idParam } },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      return services.readGraph(options.db, request.params.id, actor);
    },
  );
  app.get<{ Params: { id: Id }; Querystring: { cursor?: string; limit?: string } }>(
    '/v2/tickets/:id/history',
    {
      schema: {
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      const { limit } = page({ limit: request.query.limit });
      return readTicketHistory(options.db, request.params.id, actor, request.query.cursor ?? '0', limit);
    },
  );
  app.get<{ Params: { id: Id }; Querystring: { cursor?: string; limit?: string } }>(
    '/v2/tickets/:id/docs-links',
    {
      schema: {
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1, maxLength: 8192 },
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      const { limit } = page({ limit: request.query.limit ?? '20' });
      return readTicketDocsLinks(options.db, request.params.id, actor, request.query.cursor ?? null, limit);
    },
  );
  app.post<{ Params: { id: Id }; Body: { predecessorId: Id; expectedRevision: number } }>(
    '/v2/tickets/:id/dependencies',
    { schema: { params: idParam, body: dependencyBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: route('POST', `/v2/tickets/${id}/dependencies`),
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
        },
        async (tx) => {
          await requireTicket(tx, id, actor);
          return {
            status: 201,
            body: await services.addDependency(
              tx,
              id,
              request.body.predecessorId,
              request.body.expectedRevision,
            ),
          };
        },
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{
    Params: { id: Id };
    Body: {
      signal: 'dependencies_ready' | 'wait_owner' | 'resume';
      expectedRevision: number;
      evidenceId?: Id;
    };
  }>('/v2/tickets/:id/signals', { schema: { params: idParam, body: signalBody } }, async (request, reply) => {
    const actor = await writeActor(request, deps);
    const id = request.params.id;
    const result = await deps.mutator(
      {
        actor,
        route: route('POST', `/v2/tickets/${id}/signals`),
        key: key(request),
        body: request.body,
        authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
      },
      async (tx) => ({
        status: 200,
        body: await services.signalTicket(
          tx,
          id,
          request.body.signal,
          request.body.expectedRevision,
          request.body.evidenceId ?? null,
          actor,
        ),
      }),
    );
    reply.status(result.status);
    return result.body;
  });
  app.post<{ Params: { id: Id }; Body: { text: string } }>(
    '/v2/tickets/:id/comments',
    { schema: { params: idParam, body: commentBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: route('POST', `/v2/tickets/${id}/comments`),
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
        },
        async (tx) => ({ status: 201, body: await services.appendComment(tx, id, request.body.text, actor) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.get<{ Params: { id: Id }; Querystring: PageQuery }>(
    '/v2/tickets/:id/comments',
    {
      schema: {
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: uuid,
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      const { limit, cursor } = page(request.query);
      return options.db.begin(async (tx) => {
        await requireTicket(tx, request.params.id, actor);
        const rows = await tx`select * from comments where ticket_id=${request.params.id}
          and (${cursor}::uuid is null or id>${cursor}) order by id limit ${limit + 1}`;
        const items = rows.slice(0, limit).map((row) => ({
          id: row.id,
          ticketId: row.ticket_id,
          actor: { kind: row.actor_kind, id: row.actor_id },
          text: row.text,
          createdAt: (row.created_at as Date).toISOString(),
        }));
        return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
      });
    },
  );
  app.post<{ Params: { id: Id }; Body: DecisionInput }>(
    '/v2/tickets/:id/decisions',
    { schema: { params: idParam, body: decisionBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: route('POST', `/v2/tickets/${id}/decisions`),
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
        },
        async (tx) => ({
          status: 201,
          body: { id: await services.recordDecision(tx, id, request.body, actor) },
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.get<{ Params: { id: Id }; Querystring: PageQuery }>(
    '/v2/tickets/:id/decisions',
    {
      schema: {
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: uuid,
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) => {
      const actor = await deps.auth.authenticate(request);
      const { limit, cursor } = page(request.query);
      return options.db.begin(async (tx) => {
        await requireTicket(tx, request.params.id, actor);
        const rows = await tx`select * from decisions where ticket_id=${request.params.id}
          and (${cursor}::uuid is null or id>${cursor}) order by id limit ${limit + 1}`;
        const items = rows.slice(0, limit).map((row) => ({
          id: row.id,
          ticketId: row.ticket_id,
          actor: { kind: row.actor_kind, id: row.actor_id },
          kind: row.kind,
          content: row.content,
          rationale: row.rationale,
          sources: row.sources,
          scope: row.scope,
          createdAt: (row.created_at as Date).toISOString(),
        }));
        return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
      });
    },
  );
  app.post<{ Params: { id: Id }; Body: Omit<RepairResultInput, 'ticketId'> }>(
    '/v2/tickets/:id/repair-results',
    { schema: { params: idParam, body: repairBody } },
    async (request, reply) => {
      const actor = await deps.auth.authenticate(request);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: route('POST', `/v2/tickets/${id}/repair-results`),
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
        },
        async (tx) => ({
          status: 200,
          body: await services.recordRepairResult(tx, { ticketId: id, ...request.body }, actor),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.put<{ Params: { id: Id }; Body: { snapshotId: Id; paths: string[]; expectedRevision: number } }>(
    '/v2/tickets/:id/docs-links',
    { schema: { params: idParam, body: docsLinksBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: route('PUT', `/v2/tickets/${id}/docs-links`),
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeTicketMutation(tx, actor, { ticketId: id }),
        },
        async (tx) => ({
          status: 200,
          body: await services.linkDocs(
            tx,
            id,
            request.body.snapshotId,
            request.body.paths,
            request.body.expectedRevision,
            actor,
          ),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
}
