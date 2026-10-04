import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateCurrentCredential } from '../auth/routes.ts';
import { readSessionCookie, sha256 } from '../auth/session.ts';
import type { RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import {
  type AssistantConfigChange,
  authorizeAssistantConfigChange,
  readAssistantConfig,
  setAssistantConfig,
} from './authority.ts';
import { assistantConfigSchema, assistantPolicySchema } from './contracts.ts';
import { type AssistantTools, registerAssistantToolRoutes } from './tools.ts';

const emptyQuery = { type: 'object', properties: {}, additionalProperties: false };
const configChangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'machineId', 'preferred', 'policy'],
  properties: {
    expectedRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    machineId: { type: 'string', format: 'uuid' },
    preferred: { type: 'null' },
    policy: assistantPolicySchema,
  },
};

/** Last authority lock: retain this exact owner credential through replay or mutation commit. */
async function lockCurrentOwnerCredential(tx: Tx, request: FastifyRequest): Promise<void> {
  const secret = readSessionCookie(request);
  if (!secret) throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
  const idHash = sha256(secret);
  const [locked] = await tx`select id_hash from sessions
    where id_hash=${idHash} and owner_id='owner' for share`;
  if (!locked) throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
  // A separate statement checks wall time after any credential-row lock wait.
  const [current] = await tx`select 1 from sessions where id_hash=${idHash}
    and owner_id='owner' and revoked_at is null and expires_at>clock_timestamp()`;
  if (!current) throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
}

/** Optional producers of the Assistant routes; an absent producer keeps its route 503. */
export type AssistantRouteAssembly = { tools?: AssistantTools };

export function registerAssistantRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  assembly: AssistantRouteAssembly = {},
): void {
  app.get(
    '/v2/assistant/config',
    {
      schema: { querystring: emptyQuery, response: { 200: assistantConfigSchema } },
    },
    async (request) => {
      await deps.auth.requireOwner(request, { csrf: false });
      return options.db.begin(async (tx) => {
        const actor = await authenticateCurrentCredential(tx, request, options.now());
        return readAssistantConfig(tx, actor);
      });
    },
  );
  app.put<{ Body: AssistantConfigChange }>(
    '/v2/assistant/config',
    {
      schema: { querystring: emptyQuery, body: configChangeSchema, response: { 200: assistantConfigSchema } },
    },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      const input = { ...request.body, machineId: request.body.machineId.toLowerCase() };
      const result = await deps.mutator(
        {
          actor,
          route: 'PUT:/v2/assistant/config',
          key: String(request.headers['idempotency-key'] ?? ''),
          body: request.body,
          authorize: async (tx) => {
            const current = await authenticateCurrentCredential(tx, request, options.now());
            if (current.kind !== actor.kind || current.id !== actor.id)
              throw new ApiError('OWNER_REQUIRED', 403, 'Cần quyền chủ dự án hiện hành');
            await authorizeAssistantConfigChange(tx, current, input.machineId);
            await lockCurrentOwnerCredential(tx, request);
          },
        },
        async (tx) => ({ status: 200, body: await setAssistantConfig(tx, actor, input) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  registerAssistantToolRoutes(app, options, deps, assembly.tools);
}
