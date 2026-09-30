import {
  ImportLocalSettingsRequest,
  ProjectKey,
  PutProjectFolderRequest,
  PutProjectMcpRequest,
  RestoreSettingsRequest,
  SaveSettingsRequest,
  SettingsDiffQuery,
  SettingsKey,
  SettingsKeyQuery,
  ValidateSettingsRequest,
} from '@crew/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireMachine } from '../auth/machine-auth.js';
import { ApiError } from '../errors.js';
import { replyIdempotent } from '../services/idempotency.js';
import {
  contentErrors,
  diffRevisions,
  effectiveSettings,
  getRevision,
  importLocalSettings,
  putProjectFolderFromMachine,
  putProjectMcpFromMachine,
  restoreRevision,
  saveRevision,
  settingsHistory,
  settingsOverview,
} from '../services/settings-service.js';
import { parseInput, type RouteDeps, uuidParam } from './route-deps.js';

function ownerAuthor(request: FastifyRequest): string {
  const session = request.ownerSession;
  if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
  return `owner:${session.username}`;
}

/**
 * Owner routes of the server-managed settings ("Cài đặt hệ thống" on the web): the overview, validation,
 * saving a revision, history, diff and restore. Registered inside the owner-guarded scope.
 */
export async function settingsRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/settings', async () => settingsOverview(db));

  app.get('/v1/settings/history', async (request) => {
    const query = parseInput(SettingsKeyQuery, request.query);
    const key = parseInput(SettingsKey, {
      kind: query.kind,
      scope: query.scope,
      machineId: query.machineId ?? null,
      projectId: query.projectId ?? null,
      name: query.name ?? '',
    });
    return { items: await settingsHistory(db, key) };
  });

  app.post('/v1/settings/validate', async (request) => {
    const { key, content } = parseInput(ValidateSettingsRequest, request.body);
    const errors = contentErrors(key, content ?? null);
    return { ok: errors.length === 0, errors };
  });

  app.post('/v1/settings', async (request, reply) => {
    const body = parseInput(SaveSettingsRequest, request.body);
    const author = ownerAuthor(request);
    const saved = await db.transaction((tx) =>
      saveRevision(tx, {
        key: body.key,
        content: body.content ?? null,
        note: body.note,
        author,
        ...(body.baseVersion === undefined ? {} : { baseVersion: body.baseVersion }),
      }),
    );
    return reply.status(201).send(saved);
  });

  app.get('/v1/settings/revisions/:id', async (request) =>
    getRevision(db, uuidParam(request.params, 'settings revision')),
  );

  app.get('/v1/settings/diff', async (request) => {
    const { from, to } = parseInput(SettingsDiffQuery, request.query);
    return diffRevisions(db, from, to);
  });

  app.post('/v1/settings/revisions/:id/restore', async (request, reply) => {
    const { note } = parseInput(RestoreSettingsRequest, request.body ?? {});
    const saved = await restoreRevision(db, {
      revisionId: uuidParam(request.params, 'settings revision'),
      note,
      author: ownerAuthor(request),
    });
    return reply.status(201).send(saved);
  });
}

/**
 * Daemon routes: the machine's effective settings (with an ETag, so an unchanged poll costs a 304), the
 * one-time upload of its local values, and its own project's MCP switches.
 */
export async function daemonSettingsRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/daemon/settings', async (request, reply) => {
    const machine = requireMachine(request);
    const settings = await effectiveSettings(db, machine.machineId);
    const etag = `"${settings.revision}"`;
    reply.header('etag', etag).header('cache-control', 'no-cache');
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return settings;
  });

  app.post('/v1/daemon/settings/import', async (request, reply) => {
    const machine = requireMachine(request);
    const body = parseInput(ImportLocalSettingsRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await importLocalSettings(tx, machine, body),
    }));
  });

  app.put('/v1/daemon/settings/project-folders/:projectKey', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    const body = parseInput(PutProjectFolderRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await putProjectFolderFromMachine(tx, machine, projectKey, body),
    }));
  });

  app.delete('/v1/daemon/settings/project-folders/:projectKey', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await putProjectFolderFromMachine(tx, machine, projectKey, null),
    }));
  });

  app.put('/v1/daemon/settings/projects/:projectKey/mcp', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    const body = parseInput(PutProjectMcpRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await putProjectMcpFromMachine(tx, machine, projectKey, body),
    }));
  });
}
