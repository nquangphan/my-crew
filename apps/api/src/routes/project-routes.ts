import { CreateProjectRequest, UpdateProjectRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import { createProject, getProject, listProjects, updateProject } from '../services/project-service.js';
import { idParam, parseInput, type RouteDeps, UUID_RE } from './route-deps.js';

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
}
