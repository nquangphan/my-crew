import {
  DOCS_SNAPSHOT_MAX_BYTES,
  DocsPageQuery,
  DocsSearchQuery,
  DocsSyncRequest,
  ProjectKey,
} from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { requireMachine } from '../auth/machine-auth.js';
import { getDocsPage, getDocsSpace, searchDocs, syncDocsSnapshot } from '../services/docs-service.js';
import { replyIdempotent } from '../services/idempotency.js';
import { parseInput, type RouteDeps, uuidParam } from './route-deps.js';

/**
 * JSON escaping can make the body larger than the files it carries; the files themselves are capped at
 * 5 MB by the request schema.
 */
const SYNC_BODY_LIMIT = DOCS_SNAPSHOT_MAX_BYTES + 1024 * 1024;

/** Owner reads of the read-only docs space. Registered inside the owner-guarded scope. */
export async function docsRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/projects/:id/docs', async (request) => getDocsSpace(db, uuidParam(request.params, 'project')));

  app.get('/v1/projects/:id/docs/page', async (request) => {
    const { path } = parseInput(DocsPageQuery, request.query);
    return getDocsPage(db, uuidParam(request.params, 'project'), path);
  });

  app.get('/v1/projects/:id/docs/search', async (request) => {
    const { q } = parseInput(DocsSearchQuery, request.query);
    return searchDocs(db, uuidParam(request.params, 'project'), q);
  });
}

/** Docs snapshot sync. Registered inside the machine-guarded scope; only the owning machine may call it. */
export async function daemonDocsRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.put('/v1/daemon/projects/:key/docs', { bodyLimit: SYNC_BODY_LIMIT }, async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { key?: unknown }).key);
    const body = parseInput(DocsSyncRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await syncDocsSnapshot(tx, machine.machineId, projectKey, body),
    }));
  });
}
