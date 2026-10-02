import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

test('repair review counts only completed repair failures and fifth requests terminal intent', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'b'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    await db`update tickets set status='running' where id=${f.a.id}`;
    const actor = { kind: 'machine' as const, id: machineId };
    const intents: string[] = [];
    const services = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async (_tx, input) => {
          if (input.fence !== '7' || input.ticketId !== f.a.id) throw new Error('BAD_FENCE');
        },
        requestTerminalIntent: async (_tx, id, intent) => {
          intents.push(`${id}:${intent}`);
        },
      },
    });
    const review = (classification: 'initial_review' | 'repair_review' | 'model', cycleId: string) =>
      f.mutation(cycleId, (tx) =>
        services.recordRepairResult(
          tx,
          {
            ticketId: f.a.id,
            attemptId: randomUUID(),
            fence: '7',
            cycleId,
            classification,
            passed: false,
            evidence: { observation: 'Không đạt' },
          },
          actor,
        ),
      );
    await review('initial_review', randomUUID());
    await review('model', randomUUID());
    assert.equal((await f.read(f.a.id)).repairCycles, 0);
    let lastCycle = '';
    for (let i = 1; i <= 5; i++) {
      lastCycle = randomUUID();
      const result = await review('repair_review', lastCycle);
      assert.equal(result.repairCycles, i);
    }
    const ticket = await f.read(f.a.id);
    assert.equal(ticket.status, 'running');
    assert.equal(ticket.waitReason, 'repair_limit');
    assert.deepEqual(intents, [`${f.a.id}:needs_input`]);
    assert.equal(
      (await db`select count(*)::integer as n from repair_links where check_step_id=${f.a.id}`)[0]?.n,
      5,
    );
    assert.equal(
      (await db`select count(*)::integer as n from repair_results where check_step_id=${f.a.id}`)[0]?.n,
      7,
    );
    assert.ok(lastCycle);
    await assert.rejects(
      () =>
        f.mutation('stale-duplicate', (tx) =>
          services.recordRepairResult(
            tx,
            {
              ticketId: f.a.id,
              attemptId: randomUUID(),
              fence: '6',
              cycleId: lastCycle,
              classification: 'repair_review',
              passed: false,
              evidence: { observation: 'Không đạt' },
            },
            actor,
          ),
        ),
      { message: 'BAD_FENCE' },
    );
  }));
