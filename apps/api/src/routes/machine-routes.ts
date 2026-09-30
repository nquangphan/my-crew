import { ClaimRequestListQuery, OwnerAssignRequest, PairMachineRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { decideClaimRequest, listClaimRequests, ownerAssign } from '../services/claim-service.js';
import {
  createPairingCode,
  getMachineDetail,
  listMachines,
  pairMachine,
  revokeMachine,
} from '../services/machine-service.js';
import { parseInput, type RouteDeps, uuidParam } from './route-deps.js';

const PAIRING_CODE_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };
const PAIR_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/**
 * Public pairing: the desktop app or `crewd pair --code` exchanges a single-use code for a machine token.
 * Rate limited per client IP.
 */
export async function pairRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/machines/pair', { config: PAIR_RATE_LIMIT }, async (request, reply) => {
    const body = parseInput(PairMachineRequest, request.body);
    return reply.status(201).send(await pairMachine(db, body));
  });
}

/** Owner machine management: pairing codes, list, revoke, claim approval and reassignment. */
export async function machineRoutes(app: FastifyInstance, { db, bus }: RouteDeps): Promise<void> {
  app.post('/v1/machines/pairing-codes', { config: PAIRING_CODE_RATE_LIMIT }, async (_request, reply) =>
    reply.status(201).send(await createPairingCode(db)),
  );

  app.get('/v1/machines', async () => ({ items: await listMachines(db, bus) }));

  app.get('/v1/machines/:id', async (request) =>
    getMachineDetail(db, bus, uuidParam(request.params, 'machine')),
  );

  app.post('/v1/machines/:id/revoke', async (request) =>
    revokeMachine(db, bus, uuidParam(request.params, 'machine')),
  );

  app.post('/v1/machines/:id/claims', async (request) => {
    const body = parseInput(OwnerAssignRequest, request.body);
    return ownerAssign(db, uuidParam(request.params, 'machine'), body);
  });

  app.get('/v1/claim-requests', async (request) => {
    const { status } = parseInput(ClaimRequestListQuery, request.query);
    return { items: await listClaimRequests(db, status) };
  });

  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/v1/claim-requests/:id/${decision}`, { config: PAIRING_CODE_RATE_LIMIT }, async (request) => {
      const id = uuidParam(request.params, 'claim request');
      return decideClaimRequest(db, id, decision);
    });
  }
}
