import { MAX_ATTACHMENT_BYTES, UploadAttachmentRequest } from '@crew/shared';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, sendApiError } from '../errors.js';
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  getAttachmentContent,
  uploadAttachment,
  uploadDraftAttachment,
} from '../services/attachment-service.js';
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
  // Scoped to this plugin (Fastify encapsulates `register()`, so this never affects other routes): a raw
  // upload large enough to exceed `UPLOAD_BODY_LIMIT` (not just `MAX_ATTACHMENT_BYTES`) is rejected by
  // Fastify's own body parser before the handler below — and `decodeImage()` — ever run, which without this
  // would fall through to the app-wide handler's generic `VALIDATION_FAILED`. Report the same clear size
  // message `decodeImage()` gives for a merely-over-the-decoded-limit image, so every oversized paste (10MB,
  // 15MB, 50MB, …) gets the same clear error instead of only the ~49KB window right above 10MB.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      reply.status(413).send(new ApiError('ATTACHMENT_TOO_LARGE', ATTACHMENT_TOO_LARGE_MESSAGE).toBody());
      return;
    }
    sendApiError(error, request, reply);
  });

  app.post('/v1/tickets/:id/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(UploadAttachmentRequest, request.body);
    const attachment = await uploadAttachment(db, idParam(request.params), ownerId(request), body);
    return reply.status(201).send(attachment);
  });

  // Draft upload for the "create ticket" dialog, before a ticket exists: `POST /v1/tickets/:id/attachments`
  // needs a ticket id it cannot have yet. Claimed by `createRequestTicket()` when the new description
  // references it, cleaned up if abandoned (`deleteOrphanedDraftAttachments()`, flow `ticket-lifecycle`).
  app.post('/v1/attachments', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(UploadAttachmentRequest, request.body);
    const attachment = await uploadDraftAttachment(db, ownerId(request), body);
    return reply.status(201).send(attachment);
  });

  app.get('/v1/attachments/:id', async (request, reply) => {
    const { mimeType, content } = await getAttachmentContent(db, uuidParam(request.params, 'attachment'));
    return reply.header('content-type', mimeType).header('cache-control', 'private, no-store').send(content);
  });
}
