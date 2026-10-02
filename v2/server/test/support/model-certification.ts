import type { FastifyInstance } from 'fastify';
import { objectSchema, uuidSchema } from '../../src/gateway/contracts.ts';
import { authorizeGatewayMutation } from '../../src/gateway/service.ts';
import { type ChallengeInput, issueCertificationChallenge } from '../../src/models/certification.ts';
import { contextSchema } from '../../src/models/contracts.ts';
import type { RouteDependencies, ServerOptions } from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
/** Explicit private scratch fixture composition. Not imported by app or production routes. */
export function registerModelTestIssuer(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
): void {
  app.post<{ Body: ChallengeInput }>(
    '/v2/test/model-certifications/challenges',
    {
      schema: {
        body: objectSchema({
          machineId: uuidSchema,
          projectId: uuidSchema,
          context: contextSchema,
          maxTurns: { type: 'integer', minimum: 1, maximum: 2 },
          maxTools: { type: 'integer', minimum: 1, maximum: 3 },
          maxCostUsd: { const: 0 },
        }),
      },
    },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      const challenge = await options.db.begin(async (tx) => {
        await tx`select value from event_cursor where singleton for update`;
        await tx`select id from projects where id=${request.body.projectId} for update`;
        await authorizeGatewayMutation(tx, request, actor, options, request.body.machineId);
        return issueCertificationChallenge(tx, request.body, options.now(), {
          authorize: async (tx, input) => {
            const [scope] =
              await tx`select 1 from model_test_scope where machine_id=${input.machineId} and project_id=${input.projectId}`;
            if (!scope) throw new ApiError('TEST_SCOPE_REQUIRED', 403, 'Chỉ scratch fixture');
          },
        });
      });
      reply.status(201);
      return challenge;
    },
  );
}
