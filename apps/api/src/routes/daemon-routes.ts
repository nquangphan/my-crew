import {
  AgentCommentRequest,
  AgentMetaRequest,
  ClaimTarget,
  type Comment,
  CreateSubtaskRequest,
  DaemonCreateProjectRequest,
  FileBugRequest,
  HeartbeatRequest,
  ProjectChangeBody,
  ProjectKey,
  PutSkillsRequest,
  RateSubtaskRequest,
  SubmitReportRequest,
  TransitionRequest,
} from '@crew/shared';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { z } from 'zod';
import {
  assertAssistantHost,
  assertTicketInScope,
  assertTicketReadable,
  type MachineContext,
  requireMachine,
} from '../auth/machine-auth.js';
import type { Transaction } from '../db/client.js';
import type { TicketRow } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { getBudgetStatus } from '../services/budget-service.js';
import {
  claim,
  createDaemonProject,
  listDaemonProjects,
  projectCatalog,
  release,
} from '../services/claim-service.js';
import { replyIdempotent } from '../services/idempotency.js';
import {
  assertKnownCapabilities,
  putInventory,
  recordHeartbeat,
  rotateToken,
} from '../services/machine-service.js';
import { requestProjectChange } from '../services/project-change-service.js';
import { recordAgentMeta, submitReport } from '../services/report-service.js';
import { getTicketDetail } from '../services/ticket-query-service.js';
import {
  addComment,
  createSubtask,
  fileBug,
  getTicketRow,
  rateSubtask,
  transitionTicket,
} from '../services/ticket-service.js';
import { idParam, parseInput, type RouteDeps } from './route-deps.js';

/**
 * Daemon REST endpoints, registered behind the machine guard. Writes act as `actor='agent'`, require an
 * `Idempotency-Key` and replay the stored response on retry. Exceptions: the heartbeat (a full-state
 * replace sent every 30 s) and token rotation (its response is a secret that must never be stored).
 */
export async function daemonRoutes(
  app: FastifyInstance,
  { db, config, waitingJobs }: RouteDeps,
): Promise<void> {
  const timezone = config.budgetTimezone;

  /** An idempotent write on one in-scope ticket. */
  function ticketWrite<S extends z.ZodType>(
    method: HTTPMethods,
    url: string,
    schema: S,
    statusCode: number,
    run: (tx: Transaction, ticket: TicketRow, body: z.output<S>, machine: MachineContext) => Promise<unknown>,
  ) {
    app.route({
      method,
      url,
      handler: async (request, reply) => {
        const machine = requireMachine(request);
        const id = idParam(request.params);
        const body = parseInput(schema, request.body);
        return replyIdempotent(db, request, reply, machine.machineId, async (tx) => {
          const ticket = await getTicketRow(tx, id);
          await assertTicketInScope(tx, machine.machineId, ticket);
          return { statusCode, body: await run(tx, ticket, body, machine) };
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // Token, heartbeat, inventory
  // -------------------------------------------------------------------------

  app.post('/v1/daemon/token/rotate', async (request, reply) =>
    reply.status(201).send(await rotateToken(db, requireMachine(request))),
  );

  app.post('/v1/daemon/heartbeat', async (request) => {
    const machine = requireMachine(request);
    const body = parseInput(HeartbeatRequest, request.body);
    const response = await recordHeartbeat(db, machine, body);
    waitingJobs.record(machine.machineId, body.waitingJobs);
    return response;
  });

  app.put('/v1/daemon/skills', async (request, reply) => {
    const machine = requireMachine(request);
    const body = parseInput(PutSkillsRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => {
      await putInventory(tx, machine.machineId, body);
      return { statusCode: 204, body: null };
    });
  });

  // -------------------------------------------------------------------------
  // Projects and claims
  // -------------------------------------------------------------------------

  app.get('/v1/daemon/projects', async (request) =>
    listDaemonProjects(db, requireMachine(request).machineId),
  );

  app.post('/v1/daemon/projects', async (request, reply) => {
    const machine = requireMachine(request);
    const body = parseInput(DaemonCreateProjectRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 201,
      body: await createDaemonProject(tx, machine.machineId, body),
    }));
  });

  /** The owning machine asks to change its project's type and UI-test MCP mapping; the owner decides. */
  app.post('/v1/daemon/projects/:projectKey/change-requests', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    const body = parseInput(ProjectChangeBody, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => {
      const result = await requestProjectChange(tx, machine.machineId, projectKey, body);
      return { statusCode: result.status === 'pending' ? 202 : 200, body: result };
    });
  });

  app.post('/v1/daemon/claims', async (request, reply) => {
    const machine = requireMachine(request);
    const target = parseInput(ClaimTarget, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => {
      const body = await claim(tx, machine.machineId, target);
      return { statusCode: body.status === 'pending' ? 202 : 200, body };
    });
  });

  app.delete('/v1/daemon/claims/assistant', async (request, reply) => {
    const machine = requireMachine(request);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await release(tx, machine.machineId, { hostsAssistant: true }),
    }));
  });

  app.delete('/v1/daemon/claims/:projectKey', async (request, reply) => {
    const machine = requireMachine(request);
    const projectKey = parseInput(ProjectKey, (request.params as { projectKey?: unknown }).projectKey);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => ({
      statusCode: 200,
      body: await release(tx, machine.machineId, { projectKey }),
    }));
  });

  /** Triage catalog: assistant host only; owner-entered text only. */
  app.get('/v1/projects/catalog', async (request) => {
    await assertAssistantHost(db, requireMachine(request).machineId);
    return projectCatalog(db);
  });

  // -------------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------------

  app.get('/v1/daemon/tickets/:id', async (request) => {
    const machine = requireMachine(request);
    const ticket = await getTicketRow(db, idParam(request.params));
    await assertTicketReadable(db, machine.machineId, ticket);
    return getTicketDetail(db, ticket.id);
  });

  app.get('/v1/daemon/budget/:id', async (request) => {
    const machine = requireMachine(request);
    const ticket = await getTicketRow(db, idParam(request.params));
    await assertTicketInScope(db, machine.machineId, ticket);
    return getBudgetStatus(db, ticket, timezone);
  });

  /** pm_task (assistant host, under a request) or dev/qc/docs_init (project owner, under a pm_task). */
  app.post('/v1/daemon/tickets', async (request, reply) => {
    const machine = requireMachine(request);
    const body = parseInput(CreateSubtaskRequest, request.body);
    return replyIdempotent(db, request, reply, machine.machineId, async (tx) => {
      if (body.type === 'pm_task') await assertAssistantHost(tx, machine.machineId);
      const parent = await getTicketRow(tx, body.parentId);
      if (body.type === 'pm_task' && parent.type !== 'request') {
        throw new ApiError('INVALID_HIERARCHY', 'a pm_task must be created under a request');
      }
      await assertTicketInScope(tx, machine.machineId, parent);
      await assertKnownCapabilities(tx, {
        projectId: body.type === 'pm_task' ? (body.projectId ?? null) : parent.projectId,
        skills: body.requiredSkills ?? [],
        mcps: body.requiredMcps ?? [],
      });
      return { statusCode: 201, body: await createSubtask(tx, body) };
    });
  });

  ticketWrite(
    'POST',
    '/v1/daemon/tickets/:id/comments',
    AgentCommentRequest,
    201,
    async (tx, ticket, body) => {
      const row = await addComment(tx, {
        ticketId: ticket.id,
        body: body.body,
        authorKind: 'agent',
        authorRole: body.role ?? ticket.assigneeRole,
      });
      const comment: Comment = {
        id: row.id,
        ticketId: row.ticketId,
        authorKind: row.authorKind,
        authorRole: row.authorRole,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      };
      return comment;
    },
  );

  ticketWrite('POST', '/v1/daemon/tickets/:id/transition', TransitionRequest, 200, (tx, ticket, body) =>
    transitionTicket(tx, { ticketId: ticket.id, to: body.to, actor: 'agent' }),
  );

  ticketWrite('PUT', '/v1/daemon/tickets/:id/report', SubmitReportRequest, 200, (tx, ticket, body) =>
    submitReport(tx, ticket.id, body, { timezone }),
  );

  /** QC files a bug in the ticket it verifies, or the PM rejects a finished dev or bug ticket. */
  ticketWrite('POST', '/v1/daemon/tickets/:id/bugs', FileBugRequest, 201, async (tx, ticket, body) => {
    await assertKnownCapabilities(tx, { projectId: ticket.projectId, skills: body.requiredSkills, mcps: [] });
    return fileBug(tx, ticket.id, body);
  });

  /** The PM (`:id` is its pm_task) rates or re-rates one of its open dev, qc or bug subtasks in place. */
  ticketWrite('POST', '/v1/daemon/tickets/:id/rate-subtask', RateSubtaskRequest, 200, (tx, ticket, body) =>
    rateSubtask(tx, ticket.id, body),
  );

  ticketWrite('PATCH', '/v1/daemon/tickets/:id/agent-meta', AgentMetaRequest, 200, (tx, ticket, body) =>
    recordAgentMeta(tx, ticket.id, body, { timezone }),
  );
}
