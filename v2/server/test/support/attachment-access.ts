import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  type AttachmentExecutionGate,
  assertAttachmentExecutionCurrent,
} from '../../src/attachments/access.ts';
import type {
  AssistantInputAuthority,
  AttemptReadContext,
  PreclaimSelectionAuthority,
} from '../../src/attachments/contracts.ts';
import { denyAssistantInput, denyPreclaimSelection } from '../../src/attachments/grants.ts';
import { createMessageServices, type MessageDecisionAuthority } from '../../src/attachments/messages.ts';
import { registerAttachmentRoutes, registerInputScopeRoutes } from '../../src/attachments/routes.ts';
import { createAttachmentSubmissions } from '../../src/attachments/submissions.ts';
import { bootstrapOwner } from '../../src/auth/bootstrap.ts';
import { createAuthenticator, registerAuthRoutes } from '../../src/auth/routes.ts';
import { credentialResponseCodec } from '../../src/auth/session.ts';
import { assertNoActiveProjectExecution } from '../../src/execution/attempts.ts';
import { registerExecutionRoutes } from '../../src/execution/routes.ts';
import { registerGatewayRoutes } from '../../src/gateway/routes.ts';
import { createMutator, mutate } from '../../src/journal/mutation.ts';
import type { Actor, Db, ServerOptions, Tx } from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
import { registerProjectRoutes } from '../../src/projects/routes.ts';
import { registerTicketRoutes } from '../../src/tickets/routes.ts';
import { createTicketServices } from '../../src/tickets/service.ts';
import { attachmentFixture } from './attachments.ts';
import { nextConfig, report, selectionAuthorityFixture, source } from './gateway.ts';

const workflowSource = source('superpowers');
const pin = {
  workflow: 'superpowers' as const,
  version: workflowSource.version,
  revision: workflowSource.sourceRevision,
  checksum: workflowSource.sourceTreeSha256,
};

import { inputTicket, owner } from './tickets.ts';

export async function attachmentAccessFixture(
  db: Db,
  ports: {
    gate?: AttachmentExecutionGate;
    assistant?: AssistantInputAuthority;
    selection?: PreclaimSelectionAuthority;
    decisionAuthority?: MessageDecisionAuthority;
  } = {},
) {
  const password = randomBytes(24).toString('hex');
  await bootstrapOwner(db, password);
  const base = await attachmentFixture(db);
  const gatewayAuthority = await selectionAuthorityFixture(db);
  const options: ServerOptions = {
    db,
    now: () => new Date(),
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: randomBytes(32),
    // Test protocol authorizer only. It permits the real persisted 005 claim; it
    // does not launch a provider/process or attest native runtime isolation.
    authorizeDispatch: gatewayAuthority.authorizeDispatch,
    verifyFinalResult: async () => {
      throw new ApiError('FINAL_VERIFICATION_PENDING', 503, 'Chưa kiểm chứng');
    },
  };
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    const validation = error instanceof Error && 'validation' in error;
    if (!validation) console.error(error);
    return reply
      .status(validation ? 400 : 500)
      .send({ error: { code: validation ? 'VALIDATION' : 'INTERNAL', message: 'Yêu cầu không hợp lệ' } });
  });
  const deps = {
    auth: createAuthenticator(db, { now: options.now, publicOrigin: options.publicOrigin }),
    mutator: createMutator(db, credentialResponseCodec(options.sessionEncryptionKey)),
  };
  const submissions = createAttachmentSubmissions({
    store: base.store,
    stage: base.stage,
    tickets: createTicketServices,
    queuePolicy: { extractorVersion: 'protocol-fixture', configSha256: base.config.policySha256 },
  });
  registerAuthRoutes(app, options, deps);
  registerProjectRoutes(app, options, deps, assertNoActiveProjectExecution);
  registerGatewayRoutes(app, options, deps, gatewayAuthority.projectionPolicy);
  registerTicketRoutes(app, options, deps);
  registerExecutionRoutes(app, options, deps);
  registerAttachmentRoutes(app, options, deps, {
    stage: base.stage,
    submissions,
    store: base.store,
    config: base.config,
    executionGate: ports.gate ?? assertAttachmentExecutionCurrent,
  });
  registerInputScopeRoutes(app, options, deps, {
    store: base.store,
    messages: createMessageServices({
      decisionAuthority: ports.decisionAuthority,
      store: base.store,
      queuePolicy: { extractorVersion: 'protocol-fixture', configSha256: base.config.policySha256 },
    }),
    selection: ports.selection ?? denyPreclaimSelection,
    assistant: ports.assistant ?? denyAssistantInput,
    routing: async () => {
      throw new ApiError('INPUT_ROUTING_NOT_CONFIGURED', 409, 'Chưa cấu hình');
    },
    retire: async () => {
      throw new ApiError('ROUTE_CORRECTION_NOT_CONFIGURED', 409, 'Chưa cấu hình');
    },
  });
  try {
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/v2/auth/session',
      payload: { password },
      headers: { origin: options.publicOrigin },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers['set-cookie']?.toString().split(';')[0] ?? '';
    const csrf = login.json<{ csrfToken: string }>().csrfToken;
    const ownerHeaders = { cookie, origin: options.publicOrigin, 'x-csrf-token': csrf };
    const ownerRequest = (
      method: 'POST' | 'PUT' | 'DELETE',
      url: string,
      payload: unknown,
      key = randomUUID(),
    ) =>
      app.inject({
        method,
        url,
        payload: JSON.stringify(payload),
        headers: { ...ownerHeaders, 'idempotency-key': key, 'content-type': 'application/json' },
      });
    const projects = {} as Record<'A' | 'B', { id: string }>;
    const machines = {} as Record<'A' | 'B', { machineId: string; token: string }>;
    const actors = {} as Record<'A' | 'B', Actor>;
    const tickets = {} as Record<'A' | 'B', { id: string }>;
    const contexts = {} as Record<'A' | 'B', AttemptReadContext>;
    const mutation = <T>(work: (tx: Tx) => Promise<T>) =>
      mutate(db, { actor: owner, route: 'fixture:access', key: randomUUID(), body: {} }, async (tx) => ({
        status: 200,
        body: await work(tx),
      })).then((r) => r.body);
    const machineRequest = (
      project: 'A' | 'B',
      method: 'POST' | 'GET',
      url: string,
      payload?: unknown,
      key = randomUUID(),
    ) =>
      app.inject({
        method,
        url,
        payload: payload === undefined ? undefined : JSON.stringify(payload),
        headers: {
          authorization: `Bearer ${machines[project].token}`,
          'idempotency-key': key,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
      });
    for (const p of ['A', 'B'] as const) {
      const created = await ownerRequest('POST', '/v2/projects', {
        key: `P${randomUUID().slice(0, 8).toUpperCase()}`,
        name: p,
        repositoryUrl: null,
      });
      assert.equal(created.statusCode, 201, created.body);
      projects[p] = created.json();
      const provision = await ownerRequest('POST', '/v2/machines', { name: p });
      assert.equal(provision.statusCode, 201, provision.body);
      const provisioned = provision.json<{ machine: { id: string }; token: string }>();
      machines[p] = { machineId: provisioned.machine.id, token: provisioned.token };
      actors[p] = { kind: 'machine', id: machines[p].machineId };
      const bound = await ownerRequest('PUT', `/v2/projects/${projects[p].id}/binding`, {
        machineId: machines[p].machineId,
        checkoutPath: `/tmp/crew-test-${p}`,
        expectedRevision: 1,
      });
      assert.equal(bound.statusCode, 200, bound.body);
      const gatewayConfig = await app.inject({
        method: 'PUT',
        url: `/v2/gateway/machines/${machines[p].machineId}/config`,
        payload: JSON.stringify(nextConfig),
        headers: { ...ownerHeaders, 'idempotency-key': randomUUID(), 'content-type': 'application/json' },
      });
      assert.equal(gatewayConfig.statusCode, 200, gatewayConfig.body);
      const bootId = randomUUID();
      const boot = await machineRequest(p, 'POST', '/v2/gateway/boots', { bootId, previousGeneration: '0' });
      assert.equal(boot.statusCode, 200, boot.body);
      const install = report(bootId, boot.json<{ bootGeneration: string }>().bootGeneration);
      const installed = await machineRequest(p, 'POST', '/v2/gateway/install-reports', install);
      assert.equal(installed.statusCode, 200, installed.body);
      const createdTicket = await ownerRequest(
        'POST',
        '/v2/tickets',
        inputTicket(projects[p].id, 'request', null, { workflowPin: pin }),
      );
      assert.equal(createdTicket.statusCode, 201, createdTicket.body);
      tickets[p] = createdTicket.json();
      const signal = await ownerRequest('POST', `/v2/tickets/${tickets[p].id}/signals`, {
        signal: 'dependencies_ready',
        expectedRevision: 1,
      });
      assert.equal(signal.statusCode, 200, signal.body);
      // Exact reviewed phase03 fixture authority: private decision+selection record,
      // then real command/claim/projection API. These digests are protocol fixtures.
      const decisionId = randomUUID();
      const selected = {
        runtime: 'codex' as const,
        sourceTreeSha256: pin.checksum,
        projectionManifestSha256: 'f'.repeat(64),
        projectionTreeSha256: '1'.repeat(64),
        installReportId: install.reportId,
        configRevision: 1,
        decisionId,
      };
      await db`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope) values(${decisionId},${tickets[p].id},'owner','owner','dispatch','Test authority','Test authority','[]',${db.json({ selection: selected })})`;
      const command = await ownerRequest('POST', '/v2/commands', {
        machineId: machines[p].machineId,
        ticketId: tickets[p].id,
        type: 'start',
        payload: { selection: selected },
      });
      assert.equal(command.statusCode, 202, command.body);
      const [ticket] = await db`select revision from tickets where id=${tickets[p].id}`;
      const commandId = command.json<{ id: string }>().id;
      const processInstanceId = randomUUID();
      const claim = await machineRequest(p, 'POST', `/v2/machine/commands/${commandId}/claim`, {
        processInstanceId,
        permit: {
          commandId,
          ticketId: tickets[p].id,
          machineId: machines[p].machineId,
          bindingRevision: 2,
          ticketRevision: Number(ticket.revision),
          workflow: pin,
          checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20_000).toISOString(),
          telemetryId: randomUUID(),
          decisionId,
        },
      });
      assert.equal(claim.statusCode, 201, claim.body);
      const attempt = claim.json<{ id: string; fence: string }>();
      const projection = await machineRequest(p, 'POST', `/v2/gateway/attempts/${attempt.id}/projection`, {
        fence: attempt.fence,
        processInstanceId,
        sourceTreeSha256: selected.sourceTreeSha256,
        runtime: selected.runtime,
        projectionManifestSha256: selected.projectionManifestSha256,
        projectionTreeSha256: selected.projectionTreeSha256,
        installReportId: selected.installReportId,
      });
      assert.equal(projection.statusCode, 200, projection.body);
      contexts[p] = {
        projectId: projects[p].id,
        ticketId: tickets[p].id,
        attemptId: attempt.id,
        fence: attempt.fence,
        processInstanceId,
        bindingRevision: 2,
      };
    }
    return {
      app,
      db,
      base,
      options,
      deps,
      submissions,
      projects,
      machines,
      actors,
      tickets,
      contexts,
      cookie,
      csrf,
      ownerHeaders,
      ownerRequest,
      machineRequest,
      mutation,
      async linkFile(p: 'A' | 'B', bytes: Buffer, fileName = 'input.txt') {
        const compose = await ownerRequest('POST', '/v2/attachment-compose', {
          purpose: 'comment',
          projectId: projects[p].id,
          ticketId: tickets[p].id,
        });
        assert.equal(compose.statusCode, 201, compose.body);
        const composeId = compose.json<{ id: string }>().id;
        const sha = (await import('./attachments.ts')).sha(bytes);
        const reserved = await ownerRequest('POST', `/v2/attachment-compose/${composeId}/uploads`, {
          expectedRevision: 1,
          fileName,
          declaredMime: fileName.endsWith('.png') ? 'image/png' : 'text/plain',
          byteLength: bytes.length,
          sha256: sha,
        });
        assert.equal(reserved.statusCode, 201, reserved.body);
        const reservedBody = reserved.json<{
          attachment: { attachmentId: string };
          selectionRevision: number;
        }>();
        const upload = await app.inject({
          method: 'PUT',
          url: `/v2/attachment-uploads/${reservedBody.attachment.attachmentId}/content`,
          payload: bytes,
          headers: { ...ownerHeaders, 'content-type': 'application/octet-stream' },
        });
        assert.equal(upload.statusCode, 201, upload.body);
        const selection = {
          composeSessionId: composeId,
          selectionRevision: reservedBody.selectionRevision,
          attachmentIds: [reservedBody.attachment.attachmentId],
        };
        const submitted = await ownerRequest('POST', `/v2/tickets/${tickets[p].id}/attachment-comments`, {
          text: '',
          selection,
        });
        assert.equal(submitted.statusCode, 201, submitted.body);
        const attachmentId = selection.attachmentIds[0];
        assert.ok(attachmentId);
        return { attachmentId, sha256: sha, ownerId: 'owner' as const };
      },
      machineDownload(p: 'A' | 'B', id: string, change: Partial<AttemptReadContext> = {}) {
        return machineRequest(
          p,
          'GET',
          `/v2/machine/attachments/${id}/content?${new URLSearchParams(Object.entries({ ...contexts[p], ...change }).map(([k, v]) => [k, String(v)]))}`,
        );
      },
      async child(p: 'A' | 'B') {
        return mutation((tx) =>
          base.services.createTicket(tx, inputTicket(projects[p].id, 'step', tickets[p].id), owner),
        );
      },
      async sibling(p: 'A' | 'B') {
        const newRoot = await mutation((tx) =>
          base.services.createTicket(tx, inputTicket(projects[p].id, 'request'), owner),
        );
        return mutation((tx) =>
          base.services.createTicket(tx, inputTicket(projects[p].id, 'step', newRoot.id), owner),
        );
      },
      async close() {
        await app.close();
        await base.close();
      },
    };
  } catch (error) {
    await app.close();
    await base.close();
    throw error;
  }
}
