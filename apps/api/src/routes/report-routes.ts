import type { FastifyInstance } from 'fastify';
import { getReports } from '../services/report-service.js';
import { idParam, type RouteDeps } from './route-deps.js';

/** Owner report reads: the current report plus every earlier version. Reports are written by daemons. */
export async function reportRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/tickets/:id/report', async (request) => getReports(db, idParam(request.params)));
}
