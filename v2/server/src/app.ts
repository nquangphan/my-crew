import Fastify, { type FastifyInstance, LogController } from 'fastify';
import type { AttachmentConfig } from './attachments/config.ts';
import { createMessageServices } from './attachments/messages.ts';
import {
  createReceiverRegistry,
  type ManagedReceiverRegistry,
  readLocalWriterIdentity,
} from './attachments/receivers.ts';
import { registerAttachmentRoutes, registerInputScopeRoutes } from './attachments/routes.ts';
import { createStageServices } from './attachments/staging.ts';
import { createFileBlobStore } from './attachments/storage.ts';
import { createAttachmentSubmissions } from './attachments/submissions.ts';
import { authenticateCurrentCredential, createAuthenticator, registerAuthRoutes } from './auth/routes.ts';
import { credentialResponseCodec } from './auth/session.ts';
import { docsCompletionReader, docsSourceReader, readProjectDocsState } from './docs/read.ts';
import { registerDocsRoutes } from './docs/routes.ts';
import {
  assertNoActiveProjectExecution,
  createExecutionAuthority,
  denyDispatch,
  denyFinalResult,
} from './execution/attempts.ts';
import { registerExecutionRoutes } from './execution/routes.ts';
import type { GatewayProjectionPolicy } from './gateway/contracts.ts';
import { registerGatewayRoutes } from './gateway/routes.ts';
import { createMutator } from './journal/mutation.ts';
import { registerEventRoutes } from './journal/routes.ts';
import type { ModelRouteOptions } from './models/contracts.ts';
import { registerModelRoutes } from './models/routes.ts';
import type { ServerOptions } from './platform/contracts.ts';
import { ApiError } from './platform/errors.ts';
import { registerProjectRoutes } from './projects/routes.ts';
import { projectEventScope } from './projects/service.ts';
import { registerTicketRoutes } from './tickets/routes.ts';
import { createTicketServices } from './tickets/service.ts';
/**
 * Durable attachment storage for the owner HTTP surface. Absent: storage routes
 * are not mounted; input-scope routes stay mounted and fail closed.
 */
export type AttachmentAssembly = {
  config: AttachmentConfig;
  /** Stable UUID of the Linux storage host shared by every writer process. */
  storageHostId: string;
  /** Certified extractor version; absent → submissions with files 503 EXTRACTION_NOT_CONFIGURED. */
  extractorVersion?: string;
  /** Upload writer port. Default: native Linux closed-ACK registry (startup fails elsewhere). */
  receivers?: ManagedReceiverRegistry;
};
export type AppOptions = Omit<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'> &
  Partial<Pick<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'>> & {
    gatewayProjectionPolicy?: GatewayProjectionPolicy;
    modelVerifiers?: ModelRouteOptions;
    attachments?: AttachmentAssembly;
  };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function assembleAttachments(db: ServerOptions['db'], now: () => Date, input: AttachmentAssembly) {
  if (!uuidPattern.test(input.storageHostId)) throw new Error('ATTACHMENT_STORAGE_HOST_INVALID');
  if (input.extractorVersion !== undefined && !input.extractorVersion.trim())
    throw new Error('EXTRACTION_POLICY_INVALID');
  const { config } = input;
  // No persistIntent: owner routes never write extraction blobs; the extraction
  // worker assembly must supply its own journaled intent writer.
  const store = await createFileBlobStore({ root: config.storageRoot });
  const receivers =
    input.receivers ??
    createReceiverRegistry({
      db,
      storageRoot: config.storageRoot,
      storageHostId: input.storageHostId,
      now,
      identity: await readLocalWriterIdentity(input.storageHostId),
    });
  const stage = createStageServices({ db, store, receivers, now, config });
  const queuePolicy = input.extractorVersion
    ? { extractorVersion: input.extractorVersion, configSha256: config.policySha256 }
    : undefined;
  return {
    config,
    store,
    stage,
    submissions: createAttachmentSubmissions({
      store,
      stage,
      tickets: createTicketServices,
      queuePolicy,
      now,
    }),
    messages: createMessageServices({ store, queuePolicy, now }),
  };
}
/** Compose routes only. Caller owns database migration, listener and pool shutdown. */
export async function buildApp(input: AppOptions): Promise<FastifyInstance> {
  const options: ServerOptions = Object.freeze({
    ...input,
    authorizeDispatch: input.authorizeDispatch ?? denyDispatch,
    verifyFinalResult: input.verifyFinalResult ?? denyFinalResult,
  });
  const attachments = input.attachments
    ? await assembleAttachments(options.db, options.now, input.attachments)
    : undefined;
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'req.body.password',
        'req.body.secret',
        'res.headers.set-cookie',
      ],
    },
    bodyLimit: 1024 * 1024,
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (
      error &&
      typeof error === 'object' &&
      ('validation' in error || ('statusCode' in error && error.statusCode === 400))
    )
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Dữ liệu không hợp lệ' } });
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 413)
      return reply.code(413).send({ error: { code: 'BODY_TOO_LARGE', message: 'Dữ liệu vượt giới hạn' } });
    request.log.error({ code: 'INTERNAL_ERROR' }, 'Lỗi API');
    return reply
      .code(503)
      .send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không sẵn sàng' } });
  });
  const auth = createAuthenticator(options.db, options);
  const deps = {
    auth,
    mutator: createMutator(options.db, credentialResponseCodec(options.sessionEncryptionKey)),
  };
  registerAuthRoutes(app, options, deps);
  registerProjectRoutes(app, options, deps, assertNoActiveProjectExecution, readProjectDocsState);
  registerTicketRoutes(app, options, deps, {
    execution: createExecutionAuthority(),
    docsCompletion: docsCompletionReader,
    docsSource: docsSourceReader,
  });
  registerExecutionRoutes(app, options, deps, { docsCompletion: docsCompletionReader });
  registerDocsRoutes(app, options, deps);
  registerGatewayRoutes(app, options, deps, input.gatewayProjectionPolicy);
  registerModelRoutes(app, options, deps, input.modelVerifiers);
  // Machine execution gate, input manifests (Task6), Assistant/selection
  // authorities and message routing are not produced yet: defaults deny.
  if (attachments)
    registerAttachmentRoutes(app, options, deps, {
      stage: attachments.stage,
      submissions: attachments.submissions,
      store: attachments.store,
      config: attachments.config,
    });
  registerInputScopeRoutes(app, options, deps, {
    store: attachments?.store,
    messages: attachments?.messages,
  });
  registerEventRoutes(app, options, deps, projectEventScope, (db, request) =>
    authenticateCurrentCredential(db, request, options.now()),
  );
  await app.ready();
  return app;
}
