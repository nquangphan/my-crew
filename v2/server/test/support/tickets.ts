import { randomUUID } from 'node:crypto';
import { mutate } from '../../src/journal/mutation.ts';
import type { Actor, Db, Id, Tx } from '../../src/platform/contracts.ts';
import { createProject } from '../../src/projects/service.ts';
import type { CreateTicket, Ticket } from '../../src/tickets/contracts.ts';
import { createTicketServices } from '../../src/tickets/service.ts';

export const owner: Actor = { kind: 'owner', id: 'owner' };
export const inputTicket = (
  projectId: Id,
  level: CreateTicket['level'],
  parentId: Id | null = null,
  changes: Partial<CreateTicket> = {},
): CreateTicket => ({
  projectId,
  parentId,
  level,
  kind: 'research',
  title: `Ticket ${level}`,
  description: 'Mô tả kiểm thử',
  mandatory: true,
  criteria: {},
  inputs: {},
  outputs: {},
  skill: null,
  workflowPin: null,
  ...changes,
});

export async function ticketFixture(db: Db) {
  const services = createTicketServices();
  const mutation = <T>(key: string, work: (tx: Tx) => Promise<T>) =>
    mutate(db, { actor: owner, route: `fixture:${key}`, key, body: {} }, async (tx) => ({
      status: 200,
      body: await work(tx),
    })).then((result) => result.body);
  const project = await mutation('project', (tx) =>
    createProject(tx, {
      key: `P${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Project',
      repositoryUrl: null,
    }),
  );
  const request = await mutation('request', (tx) =>
    services.createTicket(tx, inputTicket(project.id, 'request'), owner),
  );
  const a = await mutation('a', (tx) =>
    services.createTicket(tx, inputTicket(project.id, 'step', request.id), owner),
  );
  const b = await mutation('b', (tx) =>
    services.createTicket(tx, inputTicket(project.id, 'step', request.id), owner),
  );
  return {
    services,
    mutation,
    project,
    request,
    a,
    b,
    async read(id: Id): Promise<Ticket> {
      const [row] = await db`select * from tickets where id=${id}`;
      if (!row) throw new Error('MISSING_TICKET');
      return services.mapTicket(row);
    },
  };
}

export async function completedStepsFixture(db: Db, kind: CreateTicket['kind']) {
  const f = await ticketFixture(db);
  await db`update tickets set kind=${kind}, status='running' where id=${f.request.id}`;
  await db`update tickets set status='done' where id in (${f.a.id}, ${f.b.id})`;
  return f;
}
