import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  Actor,
  ApiErrorBody,
  DispatchPermit,
  Id,
  RouteDependencies,
  ServerOptions,
} from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { DocsCompletionReader } from '../tickets/contracts.ts';
import {
  authorizeAttemptMutation,
  claimAttempt,
  readAttempt,
  recheckFinalization,
  reconcileAttempt,
  registerArtifactEvidence,
  requestTerminalIntent,
  saveCheckpoint,
  submitAttemptResult,
} from './attempts.ts';
import {
  ackCommand,
  assertCommandReplayScope,
  assertCreateCommandScope,
  authorizeCommandMutation,
  authorizeCreateCommandMutation,
  createCommand,
  listCommands,
  readCommand,
} from './commands.ts';
import type { Attempt, AttemptResultInput, Checkpoint, Command, CreateCommand } from './contracts.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;
const string = { type: 'string', minLength: 1, maxLength: 200 } as const;
const fence = { type: 'string', pattern: '^[1-9][0-9]*$' } as const;
const idArray = { type: 'array', maxItems: 100, uniqueItems: true, items: uuid } as const;
const object = { type: 'object', additionalProperties: true } as const;
const commandBody = {
  type: 'object',
  additionalProperties: false,
  required: ['machineId', 'ticketId', 'type', 'payload'],
  properties: {
    machineId: uuid,
    ticketId: uuid,
    type: { type: 'string', enum: ['start', 'pause', 'cancel', 'resume', 'reconcile'] },
    payload: object,
  },
} as const;
const ackBody = {
  type: 'object',
  additionalProperties: false,
  required: ['phase'],
  properties: { phase: { type: 'string', enum: ['received', 'completed'] }, result: object },
} as const;
const pin = {
  type: 'object',
  additionalProperties: false,
  required: ['workflow', 'version', 'revision', 'checksum'],
  properties: {
    workflow: { type: 'string', enum: ['superpowers', 'bmad'] },
    version: string,
    revision: string,
    checksum: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
  },
} as const;
const permit = {
  type: 'object',
  additionalProperties: false,
  required: [
    'commandId',
    'ticketId',
    'machineId',
    'bindingRevision',
    'ticketRevision',
    'workflow',
    'checkedAt',
    'expiresAt',
    'telemetryId',
    'decisionId',
  ],
  properties: {
    commandId: uuid,
    ticketId: uuid,
    machineId: uuid,
    bindingRevision: { type: 'integer', minimum: 1 },
    ticketRevision: { type: 'integer', minimum: 1 },
    workflow: pin,
    checkedAt: string,
    expiresAt: string,
    telemetryId: uuid,
    decisionId: uuid,
  },
} as const;
const claimBody = {
  type: 'object',
  additionalProperties: false,
  required: ['processInstanceId', 'permit'],
  properties: { processInstanceId: uuid, permit },
} as const;
const checkpointBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fence', 'sequence', 'step', 'artifactIds', 'commit', 'processInstanceId'],
  properties: {
    fence,
    sequence: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    step: string,
    artifactIds: idArray,
    commit: { anyOf: [{ type: 'string', pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' }, { type: 'null' }] },
    processInstanceId: uuid,
  },
} as const;
const artifactBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fence', 'processInstanceId', 'locator', 'sha256', 'sourceCommit'],
  properties: {
    fence,
    processInstanceId: uuid,
    locator: { type: 'string', minLength: 1, maxLength: 4096 },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    sourceCommit: {
      anyOf: [{ type: 'string', pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' }, { type: 'null' }],
    },
  },
} as const;
const resultBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fence', 'processInstanceId', 'outcome', 'evidenceIds', 'reason'],
  properties: {
    fence,
    processInstanceId: uuid,
    outcome: { type: 'string', enum: ['passed', 'retry', 'needs_input'] },
    evidenceIds: idArray,
    reason: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32768 }, { type: 'null' }] },
  },
} as const;
const finalizeBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fence', 'processInstanceId'],
  properties: { fence, processInstanceId: uuid },
} as const;
const reconcileBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fence', 'processInstanceId', 'observation', 'artifacts', 'stopReason'],
  properties: {
    fence,
    processInstanceId: uuid,
    observation: { type: 'string', enum: ['running', 'stopped'] },
    artifacts: idArray,
    stopReason: { anyOf: [{ type: 'string', enum: ['pause', 'cancel', 'exit'] }, { type: 'null' }] },
  },
} as const;

function key(request: FastifyRequest): string {
  return String(request.headers['idempotency-key'] ?? '');
}
async function writeActor(request: FastifyRequest, deps: RouteDependencies): Promise<Actor> {
  const actor = await deps.auth.authenticate(request);
  return actor.kind === 'owner' ? deps.auth.requireOwner(request, { csrf: true }) : actor;
}
async function requireMachine(request: FastifyRequest, deps: RouteDependencies): Promise<Actor> {
  const actor = await deps.auth.authenticate(request);
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  return actor;
}

export function registerExecutionRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  services: { docsCompletion?: DocsCompletionReader } = {},
): void {
  app.post<{ Body: CreateCommand }>(
    '/v2/commands',
    { schema: { body: commandBody } },
    async (request, reply) => {
      const actor = await writeActor(request, deps);
      await assertCreateCommandScope(options.db, request.body, actor);
      await assertCommandReplayScope(options.db, actor, key(request));
      const result = await deps.mutator(
        {
          actor,
          route: 'POST:/v2/commands',
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeCreateCommandMutation(tx, request.body, actor, key(request)),
        },
        async (tx) => {
          let body: Command | null;
          if (request.body.type === 'pause' || request.body.type === 'cancel') {
            const payload = request.body.payload;
            if (
              actor.kind !== 'owner' ||
              typeof payload.reason !== 'string' ||
              typeof payload.decisionId !== 'string'
            )
              throw new ApiError('DECISION_REQUIRED', 403, 'Cần quyết định dừng của chủ dự án');
            body = await requestTerminalIntent(
              tx,
              request.body.ticketId,
              { intent: request.body.type, reason: payload.reason, decisionId: payload.decisionId },
              actor,
            );
            if (!body) throw new ApiError('RECONCILE_REQUIRED', 409, 'Không có lệnh dừng');
          } else body = await createCommand(tx, request.body, actor);
          return { status: 202, body };
        },
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.get<{ Querystring: { after?: Id; limit?: string } }>(
    '/v2/machine/commands',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { after: uuid, limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } },
        },
      },
    },
    async (request) => {
      const actor = await requireMachine(request, deps);
      const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
      return listCommands(options.db, actor, request.query.after ?? null, limit);
    },
  );
  app.get<{ Params: { id: Id } }>(
    '/v2/machine/commands/:id',
    { schema: { params: idParam } },
    async (request) => readCommand(options.db, request.params.id, await requireMachine(request, deps)),
  );
  app.get<{ Params: { id: Id } }>(
    '/v2/machine/attempts/:id',
    { schema: { params: idParam } },
    async (request) => readAttempt(options.db, request.params.id, await requireMachine(request, deps)),
  );
  app.post<{
    Params: { id: Id };
    Body: {
      fence: string;
      processInstanceId: string;
      locator: string;
      sha256: string;
      sourceCommit: string | null;
    };
  }>(
    '/v2/machine/attempts/:id/artifacts',
    { schema: { params: idParam, body: artifactBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readAttempt(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/attempts/${id}/artifacts`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeAttemptMutation(tx, id, actor),
        },
        async (tx) => ({
          status: 201,
          body: await registerArtifactEvidence(tx, id, request.body, actor),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{
    Params: { id: Id };
    Body: { phase: 'received' | 'completed'; result?: Record<string, unknown> };
  }>(
    '/v2/machine/commands/:id/ack',
    { schema: { params: idParam, body: ackBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readCommand(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/commands/${id}/ack`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeCommandMutation(tx, id, actor),
        },
        async (tx) => ({ status: 200, body: await ackCommand(tx, id, request.body, actor) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{ Params: { id: Id }; Body: { processInstanceId: string; permit: DispatchPermit } }>(
    '/v2/machine/commands/:id/claim',
    { schema: { params: idParam, body: claimBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readCommand(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/commands/${id}/claim`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeCommandMutation(tx, id, actor),
        },
        async (tx) => ({
          status: 201,
          body: await claimAttempt(tx, id, request.body, actor, options.authorizeDispatch),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{ Params: { id: Id }; Body: Checkpoint & { fence: string } }>(
    '/v2/machine/attempts/:id/checkpoint',
    { schema: { params: idParam, body: checkpointBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readAttempt(options.db, id, actor);
      const result = await deps.mutator<Attempt | ApiErrorBody>(
        {
          actor,
          route: `POST:/v2/machine/attempts/${id}/checkpoint`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeAttemptMutation(tx, id, actor),
        },
        async (tx) => {
          const body = await saveCheckpoint(tx, id, request.body, actor);
          return body.state === 'uncertain'
            ? {
                status: 409,
                body: {
                  error: { code: 'LEASE_EXPIRED', message: 'Cần đối chiếu tiến trình trước khi ghi tiếp' },
                },
              }
            : { status: 200, body };
        },
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{ Params: { id: Id }; Body: AttemptResultInput }>(
    '/v2/machine/attempts/:id/result',
    { schema: { params: idParam, body: resultBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readAttempt(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/attempts/${id}/result`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeAttemptMutation(tx, id, actor),
        },
        async (tx) => ({
          status: 200,
          body: await submitAttemptResult(
            tx,
            id,
            request.body,
            actor,
            options.verifyFinalResult,
            services.docsCompletion,
          ),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{ Params: { id: Id }; Body: { fence: string; processInstanceId: string } }>(
    '/v2/machine/attempts/:id/finalize',
    { schema: { params: idParam, body: finalizeBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readAttempt(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/attempts/${id}/finalize`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeAttemptMutation(tx, id, actor),
        },
        async (tx) => ({
          status: 200,
          body: await recheckFinalization(
            tx,
            id,
            request.body,
            actor,
            options.verifyFinalResult,
            services.docsCompletion,
          ),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.post<{
    Params: { id: Id };
    Body: {
      fence: string;
      processInstanceId: string;
      observation: 'running' | 'stopped';
      artifacts: Id[];
      stopReason: null | 'pause' | 'cancel' | 'exit';
    };
  }>(
    '/v2/machine/attempts/:id/reconcile',
    { schema: { params: idParam, body: reconcileBody } },
    async (request, reply) => {
      const actor = await requireMachine(request, deps);
      const id = request.params.id;
      await readAttempt(options.db, id, actor);
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/machine/attempts/${id}/reconcile`,
          key: key(request),
          body: request.body,
          authorize: (tx) => authorizeAttemptMutation(tx, id, actor),
        },
        async (tx) => ({
          status: 200,
          body: await reconcileAttempt(
            tx,
            id,
            request.body,
            actor,
            options.verifyFinalResult,
            services.docsCompletion,
          ),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
}
