import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { completedStepsFixture, owner } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

test('docs cũ cannot close a code request from a reported commit', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'code');
    await db`insert into evidence(id,ticket_id,kind,data) values (${crypto.randomUUID()},${f.request.id},'merge',${db.json({ verification: 'reported', commit: 'a'.repeat(40) })})`;
    await assert.rejects(
      () => f.mutation('passed', (tx) => f.services.signalTicket(tx, f.request.id, 'passed', 1, null, owner)),
      { code: 'EXECUTION_PROOF_REQUIRED' },
    );
    assert.equal((await f.read(f.request.id)).status, 'running');
  }));

test('code step completes from its verified result without requiring request merge', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'code');
    await db`update tickets set kind='code',status='running' where id=${f.a.id}`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.a.id},'code_result',${db.json({ verification: 'verified', tests: 'passed' })})`;
    const services = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async () => {},
        requestTerminalIntent: async () => {},
      },
    });
    const done = await f.mutation('code-step-passed', (tx) =>
      services.applyExecutionSignal(tx, f.a.id, 'passed', 1, null, owner),
    );
    assert.equal(done.status, 'done');
  }));

test('code request requires verified merge and docs at the same commit', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'code');
    const commit = 'a'.repeat(40);
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.request.id},'code_result',${db.json({ verification: 'verified' })}),
      (${randomUUID()},${f.request.id},'merge',${db.json({ verification: 'verified', commit })})`;
    const authority = {
      verifySignal: async () => {},
      verifyRepairResult: async () => {},
      requestTerminalIntent: async () => {},
    };
    const stale = createTicketServices({ execution: authority, docsCompletion: async () => 'b'.repeat(40) });
    await assert.rejects(
      () =>
        f.mutation('stale-docs', (tx) =>
          stale.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner),
        ),
      { code: 'COMPLETION_GATE' },
    );
    const current = createTicketServices({ execution: authority, docsCompletion: async () => commit });
    const done = await f.mutation('current-docs', (tx) =>
      current.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner),
    );
    assert.equal(done.status, 'done');
    assert.equal(done.mergedCommit, commit);
  }));

test('request cannot finish while a mandatory descendant remains incomplete', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'research');
    await db`update tickets set status='pending' where id=${f.b.id}`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.request.id},'research_result',${db.json({ verification: 'verified' })})`;
    const services = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async () => {},
        requestTerminalIntent: async () => {},
      },
    });
    await assert.rejects(
      () =>
        f.mutation('incomplete-descendant', (tx) =>
          services.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner),
        ),
      { code: 'COMPLETION_GATE' },
    );
  }));

test('completion requires every evidence kind listed in ticket criteria', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'research');
    await db`update tickets set criteria=${db.json({
      workflowChoice: 'superpowers',
      requiredEvidenceKinds: ['research_result', 'test_report'],
    })} where id=${f.request.id}`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.request.id},'research_result',${db.json({ verification: 'verified' })})`;
    const services = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async () => {},
        requestTerminalIntent: async () => {},
      },
    });
    await assert.rejects(
      () =>
        f.mutation('missing-test-report', (tx) =>
          services.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner),
        ),
      { code: 'COMPLETION_GATE' },
    );
  }));

test('ticket services keep the authority callbacks captured at construction', async () =>
  withDatabase(async (db) => {
    const f = await completedStepsFixture(db, 'research');
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${f.request.id},'research_result',${db.json({ verification: 'verified' })})`;
    const execution = {
      verifySignal: async () => {},
      verifyRepairResult: async () => {},
      requestTerminalIntent: async () => {},
    };
    const services = createTicketServices({ execution });
    execution.verifySignal = async () => {
      throw new Error('REPLACED_CALLBACK');
    };
    const done = await f.mutation('captured-authority', (tx) =>
      services.applyExecutionSignal(tx, f.request.id, 'passed', 1, null, owner),
    );
    assert.equal(done.status, 'done');
  }));
