import { type Actor, canTransition, TicketStatus } from '@crew/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { submitReport } from '../src/services/report-service.js';
import { createRequestTicket, transitionTicket } from '../src/services/ticket-service.js';
import { makeApp, seedAndLogin } from './helpers/owner-session.js';
import { eventsOf, getTicket, minimalReport, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
const statuses = TicketStatus.options;
const actors: Actor[] = ['owner', 'agent', 'system'];

describe('transition matrix', () => {
  it.each(actors)('accepts exactly the %s edges of the shared workflow', async (actor) => {
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue;
        const ticket = await createRequestTicket(ctx.db, { title: `${from}->${to}` });
        await submitReport(ctx.db, ticket.id, minimalReport());
        await setStatus(ctx.db, ticket.id, from);

        const attempt = transitionTicket(ctx.db, { ticketId: ticket.id, to, actor });
        if (canTransition(actor, from, to)) {
          await expect(attempt, `${actor} ${from}->${to}`).resolves.toMatchObject({ status: to });
        } else {
          await expect(attempt, `${actor} ${from}->${to}`).rejects.toMatchObject({
            code: 'ILLEGAL_TRANSITION',
          });
          expect((await getTicket(ctx.db, ticket.id)).status).toBe(from);
        }
      }
    }
  });

  it('emits ticket.status_changed for each accepted transition', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'x' });
    await transitionTicket(ctx.db, { ticketId: ticket.id, to: 'triage', actor: 'agent' });
    const [event] = await eventsOf(ctx.db, 'ticket.status_changed');
    expect(event).toMatchObject({ ticketId: ticket.id, targetMachineId: null });
    expect(event?.payload).toEqual({
      type: 'ticket.status_changed',
      data: { ticketId: ticket.id, from: 'todo', to: 'triage' },
    });
  });
});

describe('REPORT_REQUIRED', () => {
  it('refuses done without a report, for agents and the owner', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'x' });
    await setStatus(ctx.db, ticket.id, 'in_progress');
    await expect(
      transitionTicket(ctx.db, { ticketId: ticket.id, to: 'done', actor: 'agent' }),
    ).rejects.toMatchObject({ code: 'REPORT_REQUIRED', statusCode: 409 });
    await setStatus(ctx.db, ticket.id, 'in_review');
    await expect(
      transitionTicket(ctx.db, { ticketId: ticket.id, to: 'done', actor: 'owner' }),
    ).rejects.toMatchObject({ code: 'REPORT_REQUIRED' });
    expect(await eventsOf(ctx.db, 'ticket.status_changed')).toHaveLength(0);

    await submitReport(ctx.db, ticket.id, minimalReport());
    await expect(
      transitionTicket(ctx.db, { ticketId: ticket.id, to: 'done', actor: 'owner' }),
    ).resolves.toMatchObject({ status: 'done' });
  });

  describe('over HTTP', () => {
    let app: Awaited<ReturnType<typeof makeApp>> | undefined;
    afterEach(async () => app?.close());

    it('returns 409 REPORT_REQUIRED to the owner and 409 ILLEGAL_TRANSITION for a forbidden edge', async () => {
      app = await makeApp(ctx.db);
      const owner = await seedAndLogin(app, ctx.db);
      const ticket = await createRequestTicket(ctx.db, { title: 'x' });
      await setStatus(ctx.db, ticket.id, 'in_review');

      const noReport = await app.inject({
        method: 'POST',
        url: `/v1/tickets/${ticket.key}/transition`,
        headers: owner.headers,
        payload: { to: 'done' },
      });
      expect(noReport.statusCode).toBe(409);
      expect(noReport.json().error.code).toBe('REPORT_REQUIRED');

      const illegal = await app.inject({
        method: 'POST',
        url: `/v1/tickets/${ticket.id}/transition`,
        headers: owner.headers,
        payload: { to: 'triage' },
      });
      expect(illegal.statusCode).toBe(409);
      expect(illegal.json().error).toMatchObject({
        code: 'ILLEGAL_TRANSITION',
        details: { from: 'in_review' },
      });

      const invalid = await app.inject({
        method: 'POST',
        url: `/v1/tickets/${ticket.id}/transition`,
        headers: owner.headers,
        payload: { to: 'finished' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
    });
  });
});
