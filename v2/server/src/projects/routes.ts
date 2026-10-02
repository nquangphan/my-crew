import type { FastifyInstance } from 'fastify';
import type { RouteDependencies, ServerOptions } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import {
  type Binding,
  type BindingGuard,
  bindProject,
  type CreateProject,
  createProject,
  getProject,
  listProjects,
} from './service.ts';

export type { BindingGuard } from './service.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const bodyCreate = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name', 'repositoryUrl'],
  properties: {
    key: { type: 'string', pattern: '^[A-Z][A-Z0-9_-]{1,31}$' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    repositoryUrl: { anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'null' }] },
  },
} as const;
const bodyBinding = {
  type: 'object',
  additionalProperties: false,
  required: ['machineId', 'checkoutPath', 'expectedRevision'],
  properties: {
    machineId: uuid,
    checkoutPath: { type: 'string', minLength: 1, maxLength: 4096 },
    expectedRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
} as const;

export function registerProjectRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  bindingGuard: BindingGuard,
): void {
  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/v2/projects',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' }, cursor: uuid },
        },
      },
    },
    async (request) => {
      await deps.auth.requireOwner(request, { csrf: false });
      const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
      return listProjects(options.db, limit, request.query.cursor ?? null);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/v2/projects/:id',
    {
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      },
    },
    async (request) => {
      await deps.auth.requireOwner(request, { csrf: false });
      return getProject(options.db, request.params.id);
    },
  );
  app.post<{ Body: CreateProject }>(
    '/v2/projects',
    { schema: { body: bodyCreate } },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      const result = await deps.mutator(
        {
          actor,
          route: 'POST:/v2/projects',
          key: String(request.headers['idempotency-key'] ?? ''),
          body: request.body,
        },
        async (tx) => ({ status: 201, body: await createProject(tx, request.body) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.put<{ Params: { id: string }; Body: Binding }>(
    '/v2/projects/:id/binding',
    {
      schema: {
        params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
        body: bodyBinding,
      },
    },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: `PUT:/v2/projects/${id}/binding`,
          key: String(request.headers['idempotency-key'] ?? ''),
          body: request.body,
        },
        async (tx) => ({
          status: 200,
          body: await bindProject(tx, id, request.body, bindingGuard),
        }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
}
