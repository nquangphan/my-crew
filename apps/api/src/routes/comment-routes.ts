import { type Comment, CreateCommentRequest } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { addComment } from '../services/ticket-service.js';
import { idParam, parseInput, type RouteDeps } from './route-deps.js';

/** Owner comments. Answering a needs_input ticket resumes it and wakes its agent. */
export async function commentRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/tickets/:id/comments', async (request, reply) => {
    const { body } = parseInput(CreateCommentRequest, request.body);
    const row = await addComment(db, { ticketId: idParam(request.params), body, authorKind: 'owner' });
    const comment: Comment = {
      id: row.id,
      ticketId: row.ticketId,
      authorKind: row.authorKind,
      authorRole: row.authorRole,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
    return reply.status(201).send(comment);
  });
}
