import { CreateCommentRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { addComment, toCommentDto } from '../services/ticket-service.js';
import { idParam, parseInput, type RouteDeps } from './route-deps.js';

/**
 * Owner comments. Answering a needs_input ticket resumes it and wakes its agent; a comment tagged `@pm`
 * wakes the PM of the ticket's pm_task tree instead (400 PM_NOT_AVAILABLE outside an open tree).
 */
export async function commentRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/tickets/:id/comments', async (request, reply) => {
    const { body } = parseInput(CreateCommentRequest, request.body);
    const row = await addComment(db, { ticketId: idParam(request.params), body, authorKind: 'owner' });
    return reply.status(201).send(toCommentDto(row));
  });
}
