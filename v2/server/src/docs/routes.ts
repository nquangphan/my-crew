import type { FastifyInstance } from 'fastify';
import type { Id, RouteDependencies, ServerOptions } from '../platform/contracts.ts';
import type { DocsImport, DocsSync } from './contracts.ts';
import { authorizeDocsSync, importDocs, syncDocs, validateDocsImport } from './import.ts';
import { readDocsPage, readDocsTree } from './read.ts';
import { searchDocs } from './search.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: uuid },
} as const;
const snapshotQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { snapshotId: uuid },
} as const;
const uploadLimit = 24 * 1024 * 1024;
export function registerDocsRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
): void {
  app.get<{ Params: { id: Id }; Querystring: { snapshotId?: Id } }>(
    '/v2/projects/:id/docs/tree',
    { schema: { params: projectParams, querystring: snapshotQuery } },
    async (request) =>
      readDocsTree(
        options.db,
        request.params.id,
        request.query.snapshotId ?? null,
        await deps.auth.authenticate(request),
      ),
  );
  app.get<{ Params: { id: Id }; Querystring: { snapshotId?: Id; path: string } }>(
    '/v2/projects/:id/docs/page',
    {
      schema: {
        params: projectParams,
        querystring: {
          ...snapshotQuery,
          required: ['path'],
          properties: { snapshotId: uuid, path: { type: 'string', minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (request) =>
      readDocsPage(
        options.db,
        request.params.id,
        request.query.path,
        request.query.snapshotId ?? null,
        await deps.auth.authenticate(request),
      ),
  );
  app.get<{ Querystring: { q: string; projectId?: Id; snapshotId?: Id; after?: string; limit?: string } }>(
    '/v2/docs/search',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 256 },
            projectId: uuid,
            snapshotId: uuid,
            after: { type: 'string', minLength: 1, maxLength: 4096 },
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
          },
        },
      },
    },
    async (request) =>
      searchDocs(
        options.db,
        { ...request.query, limit: request.query.limit === undefined ? 50 : Number(request.query.limit) },
        await deps.auth.authenticate(request),
      ),
  );
  app.post<{ Body: DocsImport }>('/v2/docs/imports', { bodyLimit: uploadLimit }, async (request, reply) => {
    const actor = await deps.auth.requireOwner(request, { csrf: true });
    validateDocsImport(request.body);
    const result = await deps.mutator(
      {
        actor,
        route: 'POST:/v2/docs/imports',
        key: String(request.headers['idempotency-key'] ?? ''),
        body: request.body,
      },
      async (tx) => ({ status: 201, body: await importDocs(tx, request.body, actor) }),
    );
    return reply.code(result.status).send(result.body);
  });
  app.post<{ Params: { id: Id }; Body: DocsSync }>(
    '/v2/projects/:id/docs/sync',
    { bodyLimit: uploadLimit, schema: { params: projectParams } },
    async (request, reply) => {
      const actor = await deps.auth.authenticate(request);
      const id = request.params.id;
      const result = await deps.mutator(
        {
          actor,
          route: `POST:/v2/projects/${id}/docs/sync`,
          key: String(request.headers['idempotency-key'] ?? ''),
          body: request.body,
          authorize: (tx) => authorizeDocsSync(tx, id, request.body, actor),
        },
        async (tx) => ({ status: 201, body: await syncDocs(tx, id, request.body, actor) }),
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
