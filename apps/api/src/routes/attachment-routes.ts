import { MAX_ATTACHMENT_BYTES, UploadAttachmentRequest } from '@crew/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { getAttachmentContent, uploadAttachment } from '../services/attachment-service.js';
import { idParam, parseInput, type RouteDeps, uuidParam } from './route-deps.js';

/** Base64 of the largest accepted image plus the JSON (filename, mimeType) around it. */
const UPLOAD_BODY_LIMIT = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 64 * 1024;

function ownerId(request: FastifyRequest): string {
  const session = request.ownerSession;
  if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
  return session.ownerId;
}

/**
 * Owner-only image attachments (clipboard paste into a ticket description or comment): upload stores the
 * bytes in Postgres, the GET streams them back with their original Content-Type for `<img>`/markdown use.
 */
export async function attachmentRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.post('/v1/tickets/:id/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(UploadAttachmentRequest, request.body);
    const attachment = await uploadAttachment(db, idParam(request.params), ownerId(request), body);
    return reply.status(201).send(attachment);
  });

  app.get('/v1/attachments/:id', async (request, reply) => {
    const { mimeType, content } = await getAttachmentContent(db, uuidParam(request.params, 'attachment'));
    return reply.header('content-type', mimeType).header('cache-control', 'private, no-store').send(content);
  });
}
