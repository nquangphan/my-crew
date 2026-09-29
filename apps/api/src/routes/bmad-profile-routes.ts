import { BmadProfile, ProjectKey } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { requireMachine } from '../auth/machine-auth.js';
import { putBmadProfile } from '../services/bmad-profile-service.js';
import { replyIdempotent } from '../services/idempotency.js';
import { parseInput, type RouteDeps } from './route-deps.js';

/** The owning machine reports its project's BMAD profile. Registered behind the machine guard. */
export async function daemonBmadProfileRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.put('/v1/daemon/projects/:projectKey/bmad-profile', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    const body = parseInput(BmadProfile.strict(), request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await putBmadProfile(tx, machine.machineId, projectKey, body),
    }));
  });
}
