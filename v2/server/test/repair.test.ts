import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

test('repair review counts only completed repair failures and fifth requests terminal intent', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'b'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    await db`update tickets set status='running' where id=${f.a.id}`;
    const actor = { kind: 'machine' as const, id: machineId };
    const fifthCycle = randomUUID();
    await f.mutation('premature-owner-answer', (tx) =>
      f.services.recordDecision(
        tx,
        f.a.id,
        {
          kind: 'owner_answer',
          content: 'Tiếp tục sớm',
          rationale: 'Chưa có vòng 5',
          sources: [],
          scope: { repairStepId: f.a.id, cycleId: fifthCycle, continueAfterFive: true },
        },
        owner,
      ),
    );
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
      lastCycle = i === 5 ? fifthCycle : randomUUID();
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
    const waiting = await f.mutation('finalize-repair-limit', (tx) =>
      services.applyExecutionSignal(tx, f.a.id, 'wait_owner', ticket.revision, null, actor),
    );
    assert.equal(waiting.status, 'needs_input');
    assert.equal(waiting.waitReason, 'repair_limit');
    await assert.rejects(
      () =>
        f.mutation('premature-resume', (tx) =>
          services.signalTicket(tx, f.a.id, 'resume', waiting.revision, null, actor),
        ),
      { code: 'REPAIR_OWNER_DECISION_REQUIRED' },
    );
    const approvedDecisionId = await f.mutation('actual-owner-answer', (tx) =>
      services.recordDecision(
        tx,
        f.a.id,
        {
          kind: 'owner_answer',
          content: 'Tiếp tục sau vòng 5',
          rationale: 'Đã xem kết quả',
          sources: [],
          scope: { repairStepId: f.a.id, cycleId: fifthCycle, continueAfterFive: true },
        },
        owner,
      ),
    );
    const concurrentResume = await Promise.allSettled([
      f.mutation('approved-resume-a', (tx) =>
        services.signalTicket(tx, f.a.id, 'resume', waiting.revision, null, actor),
      ),
      f.mutation('approved-resume-b', (tx) =>
        services.signalTicket(tx, f.a.id, 'resume', waiting.revision, null, actor),
      ),
    ]);
    assert.equal(concurrentResume.filter((result) => result.status === 'fulfilled').length, 1);
    const resumed = (
      concurrentResume.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof services.signalTicket>>
      >
    ).value;
    assert.equal(resumed.status, 'pending');
    assert.equal(resumed.repairCycles, 5);
    const [consumed] =
      await db`select repair_limit_cycle_id,repair_limit_consumed_decision_id from tickets where id=${f.a.id}`;
    assert.equal(consumed?.repair_limit_cycle_id, null);
    assert.equal(consumed?.repair_limit_consumed_decision_id, approvedDecisionId);
    await db`update tickets set status='running' where id=${f.a.id}`;
    const sixthCycle = randomUUID();
    await review('repair_review', sixthCycle);
    const afterSixth = await f.read(f.a.id);
    const againWaiting = await f.mutation('finalize-second-limit', (tx) =>
      services.applyExecutionSignal(tx, f.a.id, 'wait_owner', afterSixth.revision, null, actor),
    );
    assert.equal(againWaiting.waitReason, 'repair_limit');
    await assert.rejects(
      () =>
        f.mutation('replay-old-answer', (tx) =>
          services.signalTicket(tx, f.a.id, 'resume', againWaiting.revision, null, actor),
        ),
      { code: 'REPAIR_OWNER_DECISION_REQUIRED' },
    );
  }));
