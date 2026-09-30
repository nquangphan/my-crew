import { MachineCommandRequest, MachineCommandResultRequest } from '@crew/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireMachine } from '../auth/machine-auth.js';
import { ApiError } from '../errors.js';
import { replyIdempotent } from '../services/idempotency.js';
import {
  createMachineCommand,
  finishMachineCommand,
  getMachineCommand,
  listMachineCommands,
  startMachineCommand,
} from '../services/machine-command-service.js';
import { parseInput, type RouteDeps, uuidParam } from './route-deps.js';

function requestedBy(request: FastifyRequest): string {
  const session = request.ownerSession;
  if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
  return `owner:${session.username}`;
}

const commandId = (params: unknown) => {
  const id = (params as { commandId?: unknown }).commandId;
  return uuidParam({ id }, 'machine command');
};

/** Owner routes: ask a machine for a whitelisted action and follow its outcome. */
export async function machineCommandRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/machines/:id/commands', async (request, reply) => {
    const machineId = uuidParam(request.params, 'machine');
    const body = parseInput(MachineCommandRequest, request.body);
    const command = await createMachineCommand(db, {
      machineId,
      request: body,
      requestedBy: requestedBy(request),
    });
    return reply.status(201).send(command);
  });

  app.get('/v1/machines/:id/commands', async (request) => ({
    items: await listMachineCommands(db, uuidParam(request.params, 'machine')),
  }));

  app.get('/v1/machines/:id/commands/:commandId', async (request) =>
    getMachineCommand(db, uuidParam(request.params, 'machine'), commandId(request.params)),
  );
}

/** Daemon routes: take a command, then report its result (idempotent, like every daemon write). */
export async function daemonCommandRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/daemon/commands/:commandId/start', async (request, reply) => {
    const machine = requireMachine(request);
    const id = commandId(request.params);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await startMachineCommand(tx, machine, id),
    }));
  });

  app.post('/v1/daemon/commands/:commandId/result', async (request, reply) => {
    const machine = requireMachine(request);
    const id = commandId(request.params);
    const body = parseInput(MachineCommandResultRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await finishMachineCommand(tx, machine, id, body),
    }));
  });
}
