import { CreateRequestTicket, ListTicketsQuery, SearchQuery, TransitionRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { getTicketDetail, listTickets, search } from '../services/ticket-query-service.js';
import { createRequestTicket, transitionTicket } from '../services/ticket-service.js';
import { idParam, parseInput, type RouteDeps } from './route-deps.js';

/** Owner ticket routes. Agent writes (subtasks, bugs, reports) go through the daemon routes. */
export async function ticketRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/tickets', async (request) => listTickets(db, parseInput(ListTicketsQuery, request.query)));

  app.post('/v1/tickets', async (request, reply) => {
    const body = parseInput(CreateRequestTicket, request.body);
    return reply.status(201).send(await createRequestTicket(db, body));
  });

  app.get('/v1/tickets/:id', async (request) => getTicketDetail(db, idParam(request.params)));

  app.post('/v1/tickets/:id/transition', async (request) => {
    const body = parseInput(TransitionRequest, request.body);
    return transitionTicket(db, { ticketId: idParam(request.params), to: body.to, actor: 'owner' });
  });

  app.get('/v1/search', async (request) => {
    const { q } = parseInput(SearchQuery, request.query);
    return search(db, q);
  });
}
