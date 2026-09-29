import {
  CreateRequestTicket,
  ListTicketsQuery,
  SearchQuery,
  TransitionRequest,
  UpdateTicketRequest,
} from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { withAgentActivity } from '../services/agent-activity-service.js';
import { getTicketDetail, getTicketTree, listTickets, search } from '../services/ticket-query-service.js';
import { createRequestTicket, transitionTicket, updateTicket } from '../services/ticket-service.js';
import { idParam, parseInput, type RouteDeps } from './route-deps.js';

/**
 * Owner ticket routes. Agent writes (subtasks, bugs, reports) go through the daemon routes. Owner reads
 * carry each ticket's agent activity (what a machine reports doing with it).
 */
export async function ticketRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/tickets', async (request) => {
    const page = await listTickets(db, parseInput(ListTicketsQuery, request.query));
    return { ...page, items: await withAgentActivity(db, page.items) };
  });

  app.post('/v1/tickets', async (request, reply) => {
    const body = parseInput(CreateRequestTicket, request.body);
    return reply.status(201).send(await createRequestTicket(db, body));
  });

  app.get('/v1/tickets/:id', async (request) => {
    const detail = await getTicketDetail(db, idParam(request.params));
    const [ticket, ...children] = await withAgentActivity(db, [detail.ticket, ...detail.children]);
    return { ...detail, ticket: ticket ?? detail.ticket, children };
  });

  app.get('/v1/tickets/:id/tree', async (request) => {
    const tree = await getTicketTree(db, idParam(request.params));
    return { ...tree, items: await withAgentActivity(db, tree.items) };
  });

  app.patch('/v1/tickets/:id', async (request) => {
    const body = parseInput(UpdateTicketRequest, request.body);
    return updateTicket(db, idParam(request.params), body);
  });

  app.post('/v1/tickets/:id/transition', async (request) => {
    const body = parseInput(TransitionRequest, request.body);
    return transitionTicket(db, { ticketId: idParam(request.params), to: body.to, actor: 'owner' });
  });

  app.get('/v1/search', async (request) => {
    const { q } = parseInput(SearchQuery, request.query);
    return search(db, q);
  });
}
