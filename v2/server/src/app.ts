import Fastify, { type FastifyInstance, LogController } from 'fastify';
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
import type { ServerOptions } from './platform/contracts.ts';
import { ApiError } from './platform/errors.ts';
import { registerProjectRoutes } from './projects/routes.ts';
import { projectEventScope } from './projects/service.ts';
import { registerTicketRoutes } from './tickets/routes.ts';
export type AppOptions = Omit<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'> &
  Partial<Pick<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'>> & {
    gatewayProjectionPolicy?: GatewayProjectionPolicy;
  };
/** Compose routes only. Caller owns database migration, listener and pool shutdown. */
export async function buildApp(input: AppOptions): Promise<FastifyInstance> {
  const options: ServerOptions = Object.freeze({
    ...input,
    authorizeDispatch: input.authorizeDispatch ?? denyDispatch,
    verifyFinalResult: input.verifyFinalResult ?? denyFinalResult,
  });
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'req.body.password',
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
  registerEventRoutes(app, options, deps, projectEventScope, (db, request) =>
    authenticateCurrentCredential(db, request, options.now()),
  );
  await app.ready();
  return app;
}
