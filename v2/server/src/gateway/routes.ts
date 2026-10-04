import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import type { Actor, Id, RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { readWorkflowCatalogue } from './catalogue.ts';
import type {
  ConfigInput,
  GatewayAck,
  GatewayHeartbeat,
  GatewayProjectionPolicy,
  InstallReport,
  ProjectionInput,
} from './contracts.ts';
import {
  ackSchema,
  configSchema,
  cursorSchema,
  heartbeatSchema,
  installReportSchema,
  objectSchema,
  projectionInputSchema,
  retrySchema,
  uuidSchema,
} from './contracts.ts';
import {
  ackGatewayCommand,
  authorizeGatewayMutation,
  denyProjectionSelection,
  listGatewayCommands,
  listMachineCommands,
  readGatewayApplied,
  readGatewayConfig,
  readGatewayStatus,
  registerBoot,
  requestWorkflowRetry,
  saveAttemptProjection,
  saveHeartbeat,
  saveInstallReport,
  writeGatewayConfig,
} from './service.ts';

const idParams = objectSchema({ id: uuidSchema });
export function registerGatewayRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  projectionPolicy: GatewayProjectionPolicy = denyProjectionSelection,
): void {
  async function machine(request: FastifyRequest): Promise<Actor & { kind: 'machine' }> {
    const actor = await deps.auth.authenticate(request);
    if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần xác thực máy');
    return actor;
  }
  async function write<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    actor: Actor,
    machineId: Id,
    work: (tx: Tx) => Promise<T>,
    attemptId?: Id,
  ): Promise<T> {
    const result = await deps.mutator(
      {
        actor,
        route: `${request.method}:${request.url.split('?')[0]}`,
        key: String(request.headers['idempotency-key'] ?? ''),
        body: request.body,
        authorize: (tx) => authorizeGatewayMutation(tx, request, actor, options, machineId, attemptId),
      },
      async (tx) => ({ status: 200, body: await work(tx) }),
    );
    reply.status(result.status);
    return result.body;
  }
  async function read<T>(request: FastifyRequest, actor: Actor, work: (tx: Tx) => Promise<T>): Promise<T> {
    return options.db.begin('isolation level repeatable read read only', async (tx) => {
      const current = await authenticateCurrentCredential(tx, request, options.now());
      if (current.kind !== actor.kind || current.id !== actor.id)
        throw new ApiError('UNAUTHENTICATED', 401, 'Cần xác thực');
      return work(tx);
    }) as Promise<T>;
  }
  app.post<{ Body: { bootId: Id; previousGeneration: string } }>(
    '/v2/gateway/boots',
    { schema: { body: objectSchema({ bootId: uuidSchema, previousGeneration: cursorSchema }) } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        registerBoot(tx, actor.id, request.body, options.now()),
      );
    },
  );
  app.post<{ Body: GatewayHeartbeat }>(
    '/v2/gateway/heartbeat',
    { schema: { body: heartbeatSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        saveHeartbeat(tx, actor.id, request.body, options.now()),
      );
    },
  );
  app.get('/v2/gateway/config', { schema: { querystring: objectSchema({}) } }, async (request) => {
    const actor = await machine(request);
    return read(request, actor, async (tx) => {
      const config = await readGatewayConfig(tx, actor.id),
        applied = await readGatewayApplied(tx, actor.id);
      return config ? { ...config, applied } : { desiredConfig: null, applied };
    });
  });
  app.put<{ Params: { id: Id }; Body: ConfigInput }>(
    '/v2/gateway/machines/:id/config',
    { schema: { params: idParams, body: configSchema } },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      return write(request, reply, actor, request.params.id, (tx) =>
        writeGatewayConfig(tx, request.params.id, request.body, options.now()),
      );
    },
  );
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    '/v2/gateway/commands',
    {
      schema: {
        querystring: objectSchema(
          { after: cursorSchema, limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } },
          [],
        ),
      },
    },
    async (request) => {
      const actor = await machine(request);
      return read(request, actor, (tx) =>
        listGatewayCommands(
          tx,
          actor.id,
          request.query.after ?? '0',
          request.query.limit === undefined ? 50 : Number(request.query.limit),
        ),
      );
    },
  );
  app.post<{ Params: { id: Id }; Body: GatewayAck }>(
    '/v2/gateway/commands/:id/ack',
    { schema: { params: idParams, body: ackSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        ackGatewayCommand(tx, actor.id, request.params.id, request.body, options.now()),
      );
    },
  );
  app.post<{ Body: InstallReport }>(
    '/v2/gateway/install-reports',
    { schema: { body: installReportSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        saveInstallReport(tx, actor.id, request.body, options.now()),
      );
    },
  );
  app.post<{ Params: { id: Id }; Body: ProjectionInput }>(
    '/v2/gateway/attempts/:id/projection',
    { schema: { params: idParams, body: projectionInputSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(
        request,
        reply,
        actor,
        actor.id,
        (tx) =>
          saveAttemptProjection(tx, request.params.id, request.body, actor, projectionPolicy, options.now()),
        request.params.id,
      );
    },
  );
  app.get<{ Params: { id: Id } }>(
    '/v2/gateway/machines/:id/status',
    { schema: { params: idParams, querystring: objectSchema({}) } },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      return read(request, actor, (tx) => readGatewayStatus(tx, request.params.id, options.now()));
    },
  );
  app.get<{ Params: { id: Id } }>(
    '/v2/gateway/machines/:id/workflows',
    { schema: { params: idParams, querystring: objectSchema({}) } },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      return read(request, actor, (tx) => readWorkflowCatalogue(tx, request.params.id));
    },
  );
  app.post<{ Params: { id: Id }; Body: { expectedRevision: number } }>(
    '/v2/gateway/machines/:id/workflows/retry',
    { schema: { params: idParams, body: retrySchema } },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      return write(request, reply, actor, request.params.id, (tx) =>
        requestWorkflowRetry(tx, request.params.id, request.body, options.now()),
      );
    },
  );
  app.get<{ Params: { id: Id }; Querystring: { before?: string; limit?: string } }>(
    '/v2/gateway/machines/:id/commands',
    {
      schema: {
        params: idParams,
        querystring: objectSchema(
          { before: cursorSchema, limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } },
          [],
        ),
      },
    },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      return read(request, actor, (tx) =>
        listMachineCommands(
          tx,
          request.params.id,
          request.query.before,
          request.query.limit === undefined ? 50 : Number(request.query.limit),
        ),
      );
    },
  );
}
