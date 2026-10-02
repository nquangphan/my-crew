import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import type { GatewayAck } from '../gateway/contracts.ts';
import { ackSchema, cursorSchema, objectSchema, uuidSchema } from '../gateway/contracts.ts';
import { authorizeGatewayMutation, readGatewayConfig } from '../gateway/service.ts';
import type { Actor, Id, RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
import { getPool, reportModelApplied, reportModelInventory } from './catalog.ts';
import { verifyCertification } from './certification.ts';
import { ackModelCommand, readModelCommands } from './commands.ts';
import { readModelApplied, readSourceConfig, setSourceConfig } from './config.ts';
import type {
  CertificationEvidence,
  CredentialKeyConfirmation,
  CredentialKeyRegistration,
  ModelAppliedBody,
  ModelInventoryBody,
  ModelReportEnvelope,
  ModelRouteOptions,
  SecretAck,
  SecretInput,
  SourceConfigInput,
} from './contracts.ts';
import {
  appliedSchema,
  certificationSchema,
  confirmationSchema,
  inventorySchema,
  registrationSchema,
  secretAckSchema,
  secretSchema,
  sourceConfigSchema,
} from './contracts.ts';
import { fail } from './helpers.ts';
import {
  ackSecret,
  confirmCredentialKey,
  markSecretKeyLost,
  provisionSecret,
  readSecretEnvelopes,
  registerCredentialKey,
} from './secret-envelopes.ts';
export function registerModelRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  ports: ModelRouteOptions = {},
): void {
  const machine = async (request: FastifyRequest) => {
    const actor = await deps.auth.authenticate(request);
    if (actor.kind !== 'machine') fail('MACHINE_REQUIRED', 403);
    return actor;
  };
  const write = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    actor: Actor,
    machineId: Id,
    work: (tx: Tx) => Promise<T>,
    attemptId?: Id,
  ) => {
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
  };
  const read = async <T>(request: FastifyRequest, actor: Actor, work: (tx: Tx) => Promise<T>) =>
    options.db.begin('isolation level repeatable read read only', async (tx) => {
      const current = await authenticateCurrentCredential(tx, request, options.now());
      if (current.kind !== actor.kind || current.id !== actor.id) fail('UNAUTHENTICATED', 401);
      return work(tx);
    });
  app.post<{ Body: CredentialKeyRegistration }>(
    '/v2/machine/credential-keys',
    { schema: { body: registrationSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        registerCredentialKey(tx, actor.id, request.body, options.now()),
      );
    },
  );
  app.post<{ Params: { keyId: Id }; Body: CredentialKeyConfirmation }>(
    '/v2/machine/credential-keys/:keyId/confirm',
    { schema: { params: objectSchema({ keyId: uuidSchema }), body: confirmationSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        confirmCredentialKey(tx, actor.id, request.params.keyId, request.body, options.now()),
      );
    },
  );
  app.get<{ Querystring: { after?: Id } }>(
    '/v2/machine/api-secret-envelopes',
    { schema: { querystring: objectSchema({ after: cursorSchema }, []) } },
    async (request) => {
      const actor = await machine(request);
      return read(request, actor, (tx) =>
        readSecretEnvelopes(tx, actor.id, request.query.after ?? '0', options.now()),
      );
    },
  );
  app.post<{ Params: { id: Id }; Body: SecretAck }>(
    '/v2/machine/api-secret-envelopes/:id/ack',
    { schema: { params: objectSchema({ id: uuidSchema }), body: secretAckSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        ackSecret(tx, actor.id, request.params.id, request.body, options.now()),
      );
    },
  );
  app.post<{ Params: { id: Id } }>(
    '/v2/machine/api-secret-envelopes/:id/key-lost',
    { schema: { params: objectSchema({ id: uuidSchema }), body: objectSchema({}) } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        markSecretKeyLost(tx, actor.id, request.params.id, options.now()),
      );
    },
  );
  app.post<{ Params: { id: Id; providerId: Id }; Body: SecretInput }>(
    '/v2/machines/:id/api-providers/:providerId/secret',
    { schema: { params: objectSchema({ id: uuidSchema, providerId: uuidSchema }), body: secretSchema } },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      return write(request, reply, actor, request.params.id, (tx) =>
        provisionSecret(tx, request.params.id, request.params.providerId, request.body, options.now()),
      );
    },
  );
  app.post<{ Body: CertificationEvidence }>(
    '/v2/machine/models/certifications',
    { schema: { body: certificationSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      const [attempt] = await options.db`select machine_id from attempts where id=${request.body.attemptId}`;
      if (attempt && attempt.machine_id !== actor.id) fail('NOT_FOUND', 404);
      return write(
        request,
        reply,
        actor,
        actor.id,
        async (tx) => ({
          status: await verifyCertification(
            tx,
            request.body,
            options.now(),
            ports.certificationVerifier,
            actor.id,
          ),
        }),
        attempt ? request.body.attemptId : undefined,
      );
    },
  );
  app.get<{ Querystring: { after?: string; limit?: string } }>(
    '/v2/machine/model-commands',
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
        readModelCommands(
          tx,
          actor.id,
          request.query.after ?? '0',
          request.query.limit === undefined ? 50 : Number(request.query.limit),
        ),
      );
    },
  );
  app.post<{ Params: { id: Id }; Body: GatewayAck }>(
    '/v2/machine/model-commands/:id/ack',
    { schema: { params: objectSchema({ id: uuidSchema }), body: ackSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        ackModelCommand(tx, actor.id, request.params.id, request.body, options.now()),
      );
    },
  );
  const params = objectSchema({ id: uuidSchema });
  app.get('/v2/machine/model-sources', { schema: { querystring: objectSchema({}) } }, async (request) => {
    const actor = await machine(request);
    return read(request, actor, (tx) => readSourceConfig(tx, actor.id));
  });
  app.get<{ Params: { id: Id } }>(
    '/v2/machines/:id/model-sources',
    { schema: { params, querystring: objectSchema({}) } },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      return read(request, actor, async (tx) => {
        const config = await readSourceConfig(tx, request.params.id),
          applied = await readModelApplied(tx, request.params.id);
        return config ? { ...config, applied } : { desiredConfig: null, applied };
      });
    },
  );
  app.put<{ Params: { id: Id }; Body: SourceConfigInput }>(
    '/v2/machines/:id/model-sources',
    { schema: { params, body: sourceConfigSchema } },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      return write(request, reply, actor, request.params.id, (tx) =>
        setSourceConfig(tx, request.params.id, request.body, options.now()),
      );
    },
  );
  app.get<{ Querystring: { workflow: 'bmad' | 'superpowers' } }>(
    '/v2/machine/models',
    { schema: { querystring: objectSchema({ workflow: { enum: ['bmad', 'superpowers'] } }) } },
    async (request) => {
      const actor = await machine(request);
      return read(request, actor, async (tx) => {
        const config = await readSourceConfig(tx, actor.id),
          gateway = await readGatewayConfig(tx, actor.id);
        const source = gateway?.desired[request.query.workflow].source;
        return {
          items: source ? await getPool(tx, actor.id, source, options.now()) : [],
          reason:
            config && !Object.values(config.enabled).some(Boolean)
              ? 'NO_SOURCE_ENABLED'
              : config
                ? null
                : 'MODEL_CONFIG_NOT_CONFIGURED',
        };
      });
    },
  );
  app.post<{ Body: ModelReportEnvelope<ModelInventoryBody> }>(
    '/v2/machine/models/inventory',
    { schema: { body: inventorySchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        reportModelInventory(tx, actor.id, request.body, options.now(), ports.probeVerifier),
      );
    },
  );
  app.post<{ Body: ModelReportEnvelope<ModelAppliedBody> }>(
    '/v2/machine/models/applied',
    { schema: { body: appliedSchema } },
    async (request, reply) => {
      const actor = await machine(request);
      return write(request, reply, actor, actor.id, (tx) =>
        reportModelApplied(tx, actor.id, request.body, options.now()),
      );
    },
  );
  app.get<{ Params: { id: Id }; Querystring: { workflow: 'bmad' | 'superpowers' } }>(
    '/v2/machines/:id/models',
    { schema: { params, querystring: objectSchema({ workflow: { enum: ['bmad', 'superpowers'] } }) } },
    async (request) => {
      const actor = await deps.auth.requireOwner(request, { csrf: false });
      return read(request, actor, async (tx) => {
        const config = await readSourceConfig(tx, request.params.id),
          gateway = await readGatewayConfig(tx, request.params.id);
        const source = gateway?.desired[request.query.workflow].source;
        return {
          items: source ? await getPool(tx, request.params.id, source, options.now()) : [],
          reason: config && !Object.values(config.enabled).some(Boolean) ? 'NO_SOURCE_ENABLED' : null,
        };
      });
    },
  );
}
