import { CreateProjectRequest, ProjectChangeListQuery, UpdateProjectRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import { decideProjectChange, listProjectChanges } from '../services/project-change-service.js';
import { createProject, getProject, listProjects, updateProject } from '../services/project-service.js';
import { idParam, parseInput, type RouteDeps, UUID_RE, uuidParam } from './route-deps.js';

const DECISION_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };

function projectId(params: unknown): string {
  const id = idParam(params);
  if (!UUID_RE.test(id)) throw new ApiError('VALIDATION_FAILED', 'invalid project id');
  return id;
}

/** Owner project management. Registered inside the owner-guarded scope. */
export async function projectRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/projects', async () => ({ items: await listProjects(db) }));

  app.post('/v1/projects', async (request, reply) => {
    const body = parseInput(CreateProjectRequest, request.body);
    return reply.status(201).send(await createProject(db, body));
  });

  app.get('/v1/projects/:id', async (request) => getProject(db, projectId(request.params)));

  app.patch('/v1/projects/:id', async (request) => {
    const body = parseInput(UpdateProjectRequest, request.body);
    return updateProject(db, projectId(request.params), body);
  });

  /** Type and UI-test MCP changes the owning machines asked for. */
  app.get('/v1/project-change-requests', async (request) => {
    const { status } = parseInput(ProjectChangeListQuery, request.query);
    return { items: await listProjectChanges(db, status) };
  });

  for (const decision of ['approve', 'reject'] as const) {
    app.post(
      `/v1/project-change-requests/:id/${decision}`,
      { config: DECISION_RATE_LIMIT },
      async (request) => {
        const id = uuidParam(request.params, 'project change request');
        return decideProjectChange(db, id, decision);
      },
    );
  }
}
