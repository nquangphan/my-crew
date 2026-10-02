import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {
  assertNoActiveProjectExecution,
  claimAttempt,
  createExecutionAuthority,
  readAttempt,
  recheckFinalization,
  reconcileAttempt,
  registerArtifactEvidence,
  saveCheckpoint,
  submitAttemptResult,
} from '../src/execution/attempts.ts';
import { createCommand } from '../src/execution/commands.ts';
import { registerExecutionRoutes } from '../src/execution/routes.ts';
import { createMutator } from '../src/journal/mutation.ts';
import type { ApiError } from '../src/platform/errors.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { executionFixture as setup } from './support/execution.ts';

const withDatabase = databaseFixture(5);

test('concurrent claim fences one durable launch and lost reply replays it', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const launch = randomUUID();
    const outcomes = await Promise.allSettled([
      db.begin((tx) =>
        claimAttempt(tx, x.command.id, { processInstanceId: launch, permit: x.permit }, x.actor, x.authorize),
      ),
      db.begin((tx) =>
        claimAttempt(
          tx,
          x.command.id,
          { processInstanceId: randomUUID(), permit: x.permit },
          x.actor,
          x.authorize,
        ),
      ),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    const accepted = outcomes.find((x) => x.status === 'fulfilled');
    if (accepted?.status !== 'fulfilled') throw Error('claim missing');
    const again = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: accepted.value.processInstanceId, permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    assert.equal(again.id, accepted.value.id);
    assert.equal((await db`select count(*)::int n from attempts`)[0]?.n, 1);
  }));

test('stopped observation reserves guard until result and verifier allow finalization', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    const stopped = await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    assert.equal(stopped.state, 'finalizing');
    assert.equal((await x.f.read(x.f.a.id)).status, 'running');
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      a.id,
    );
    await assert.rejects(
      () =>
        db.begin((tx) =>
          saveCheckpoint(
            tx,
            a.id,
            {
              fence: a.fence,
              sequence: '1',
              step: 'late',
              artifactIds: [],
              commit: null,
              processInstanceId: a.processInstanceId,
            },
            x.actor,
          ),
        ),
      { code: 'PROCESS_STOPPED' },
    );
    const result = await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'retry',
          evidenceIds: [],
          reason: null,
        },
        x.actor,
      ),
    );
    assert.equal(result.state, 'finalizing');
    const final = await db.begin((tx) =>
      recheckFinalization(
        tx,
        a.id,
        { fence: a.fence, processInstanceId: a.processInstanceId },
        x.actor,
        async () => {},
      ),
    );
    assert.equal(final.state, 'stopped');
    assert.equal((await x.f.read(x.f.a.id)).status, 'pending');
  }));

test('result before stop does not close; stopped result stays pending without verifier', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'retry',
          evidenceIds: [],
          reason: null,
        },
        x.actor,
      ),
    );
    assert.equal((await x.f.read(x.f.a.id)).status, 'running');
    const stopped = await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    assert.equal(stopped.state, 'finalizing');
    assert.equal((await x.f.read(x.f.a.id)).status, 'running');
    assert.equal((await readAttempt(db, a.id, x.actor)).state, 'finalizing');
  }));

test('current state read rejects stale project binding', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db`update projects set binding_revision=3 where id=${x.f.project.id}`;
    await assert.rejects(() => readAttempt(db, a.id, x.actor), { code: 'NOT_FOUND' });
    await assert.rejects(
      () =>
        db.begin((tx) =>
          saveCheckpoint(
            tx,
            a.id,
            {
              fence: a.fence,
              sequence: '1',
              step: 'work',
              artifactIds: [],
              commit: null,
              processInstanceId: a.processInstanceId,
            },
            x.actor,
          ),
        ),
      { code: 'STALE_BINDING' },
    );
  }));

test('registered artifact has canonical locator and checkpoint accepts same-attempt evidence', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    const artifact = await db.begin((tx) =>
      registerArtifactEvidence(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          sha256: 'c'.repeat(64),
          locator: 'reports/kết-quả.md',
          sourceCommit: null,
        },
        x.actor,
      ),
    );
    assert.equal(artifact.locator, 'reports/kết-quả.md');
    const [evidence] = await db`select kind,data from evidence where id=${artifact.id}`;
    assert.equal(evidence?.kind, 'artifact');
    assert.equal(evidence?.data?.verification, 'reported');
    const checkpoint = await db.begin((tx) =>
      saveCheckpoint(
        tx,
        a.id,
        {
          fence: a.fence,
          sequence: '1',
          step: 'report',
          artifactIds: [artifact.id],
          commit: null,
          processInstanceId: a.processInstanceId,
        },
        x.actor,
      ),
    );
    assert.deepEqual(checkpoint.checkpoint.artifactIds, [artifact.id]);
    await assert.rejects(
      () =>
        db.begin((tx) =>
          saveCheckpoint(
            tx,
            a.id,
            {
              fence: a.fence,
              sequence: '2',
              step: 'foreign',
              artifactIds: [randomUUID()],
              commit: null,
              processInstanceId: a.processInstanceId,
            },
            x.actor,
          ),
        ),
      { code: 'EVIDENCE_SCOPE' },
    );
    await assert.rejects(
      () =>
        db.begin((tx) =>
          registerArtifactEvidence(
            tx,
            a.id,
            {
              fence: a.fence,
              processInstanceId: a.processInstanceId,
              sha256: 'c'.repeat(64),
              locator: '../escape',
              sourceCommit: null,
            },
            x.actor,
          ),
        ),
      { code: 'VALIDATION' },
    );
    await assert.rejects(
      () =>
        db.begin((tx) =>
          registerArtifactEvidence(
            tx,
            a.id,
            {
              fence: a.fence,
              processInstanceId: a.processInstanceId,
              sha256: 'c'.repeat(64),
              locator: 'https:remote',
              sourceCommit: null,
            },
            x.actor,
          ),
        ),
      { code: 'VALIDATION' },
    );
  }));

test('artifact route is authenticated idempotent and keeps late finalizing report', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    let actor = x.actor;
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.setErrorHandler((error, _, reply) => {
      const failure = error as ApiError;
      reply.status(failure.status ?? 400).send({ code: failure.code ?? 'VALIDATION' });
    });
    registerExecutionRoutes(
      app,
      {
        db,
        publicOrigin: 'http://example.test',
        secureCookies: false,
        sessionEncryptionKey: Buffer.alloc(32),
        now: () => new Date(),
        authorizeDispatch: x.authorize,
        verifyFinalResult: async () => {},
      },
      {
        mutator: createMutator(db),
        auth: {
          authenticate: async () => actor,
          requireOwner: async () => {
            throw Error('owner denied');
          },
        },
      },
    );
    const url = `/v2/machine/attempts/${a.id}/artifacts`;
    const payload = {
      fence: a.fence,
      processInstanceId: a.processInstanceId,
      locator: 'reports/kiểm-tra.md',
      sha256: 'd'.repeat(64),
      sourceCommit: null,
    };
    const request = (key: string, body: typeof payload) =>
      app.inject({ method: 'POST', url, headers: { 'idempotency-key': key }, payload: body });
    const first = await request('artifact-1', payload);
    assert.equal(first.statusCode, 201);
    const id = first.json().id;
    assert.equal((await request('artifact-1', payload)).json().id, id);
    assert.equal((await request('artifact-wrong-fence', { ...payload, fence: '99' })).statusCode, 409);
    assert.equal(
      (await request('artifact-wrong-process', { ...payload, processInstanceId: randomUUID() })).statusCode,
      409,
    );
    assert.equal((await request('artifact-traversal', { ...payload, locator: '../secret' })).statusCode, 400);
    assert.equal((await request('artifact-hash', { ...payload, sha256: 'ZZ' })).statusCode, 400);
    actor = { kind: 'machine', id: randomUUID() };
    assert.equal((await request('artifact-foreign', payload)).statusCode, 404);
    actor = x.actor;
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    const late = await request('artifact-late', { ...payload, locator: 'reports/late.md' });
    assert.equal(late.statusCode, 201);
    await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'retry',
          evidenceIds: [],
          reason: null,
        },
        x.actor,
        async () => {},
      ),
    );
    assert.equal(
      (await request('artifact-late', { ...payload, locator: 'reports/late.md' })).json().id,
      late.json().id,
    );
    assert.equal(
      (await request('artifact-after', { ...payload, locator: 'reports/after.md' })).statusCode,
      409,
    );
    await db`update projects set checkout_path='/tmp/rebound',binding_revision=binding_revision+1 where id=${x.f.project.id}`;
    assert.equal((await request('artifact-1', payload)).statusCode, 404);
    await app.close();
  }));

test('missing dispatch authority leaves no attempt or running ticket', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const before = (await db`select value from event_cursor where singleton=true`)[0]?.value;
    await assert.rejects(
      () =>
        db.begin((tx) =>
          claimAttempt(
            tx,
            x.command.id,
            { processInstanceId: randomUUID(), permit: x.permit },
            x.actor,
            async () => {
              throw Object.assign(new Error('gate'), { code: 'DISPATCH_NOT_CONFIGURED' });
            },
          ),
        ),
      { code: 'DISPATCH_NOT_CONFIGURED' },
    );
    assert.equal((await db`select count(*)::int n from attempts`)[0]?.n, 0);
    assert.equal((await x.f.read(x.f.a.id)).status, 'ready');
    assert.equal((await db`select value from event_cursor where singleton=true`)[0]?.value, before);
  }));

test('expired lease marks uncertain without accepting checkpoint progress', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db`update attempts set lease_expires_at=now()-interval '1 second' where id=${a.id}`;
    const current = await db.begin((tx) =>
      saveCheckpoint(
        tx,
        a.id,
        {
          fence: a.fence,
          sequence: '1',
          step: 'late',
          artifactIds: [],
          commit: null,
          processInstanceId: a.processInstanceId,
        },
        x.actor,
      ),
    );
    assert.equal(current.state, 'uncertain');
    assert.equal(current.checkpoint.sequence, '0');
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      a.id,
    );
  }));

test('verified research result finalizes atomically only after physical stop', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    const evidenceId = randomUUID();
    await db`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${evidenceId},${x.f.a.id},${a.id},'research_result',${db.json({ verification: 'verified' })})`;
    const verify = async () => {};
    await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'passed',
          evidenceIds: [evidenceId],
          reason: null,
        },
        x.actor,
        verify,
      ),
    );
    assert.equal((await x.f.read(x.f.a.id)).status, 'running');
    const final = await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
        verify,
      ),
    );
    assert.equal(final.state, 'stopped');
    assert.equal((await x.f.read(x.f.a.id)).status, 'done');
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      null,
    );
  }));

test('host needs_input result records scoped question decision', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'needs_input',
          evidenceIds: [],
          reason: 'Cần owner chọn phương án',
        },
        x.actor,
      ),
    );
    const [decision] =
      await db`select kind,scope from decisions where ticket_id=${x.f.a.id} and actor_kind='machine' order by created_at desc limit 1`;
    assert.equal(decision?.scope?.attemptId, a.id);
    assert.equal(decision?.scope?.action, 'needs_input');
  }));

test('reconcile persists host provenance and refuses conflicting stop reason', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'running',
          artifacts: [],
          stopReason: null,
        },
        x.actor,
      ),
    );
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    const rows =
      await db`select machine_id,process_instance_id,observation,stop_reason from reconciliation_observations where attempt_id=${a.id} order by observed_at,id`;
    assert.deepEqual(
      rows.map((row) => row.observation),
      ['running', 'stopped'],
    );
    assert.equal(rows[1]?.machine_id, x.actor.id);
    assert.equal(rows[1]?.process_instance_id, a.processInstanceId);
    await assert.rejects(
      () =>
        db.begin((tx) =>
          reconcileAttempt(
            tx,
            a.id,
            {
              fence: a.fence,
              processInstanceId: a.processInstanceId,
              observation: 'stopped',
              artifacts: [],
              stopReason: 'cancel',
            },
            x.actor,
          ),
        ),
      { code: 'STOP_CONFLICT' },
    );
  }));

test('fence exhaustion fails closed before attempt or ticket mutation', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    await db`insert into execution_guards(ticket_id,fence) values(${x.f.a.id},9223372036854775807)`;
    await assert.rejects(
      () =>
        db.begin((tx) =>
          claimAttempt(
            tx,
            x.command.id,
            { processInstanceId: randomUUID(), permit: x.permit },
            x.actor,
            x.authorize,
          ),
        ),
      { code: 'FENCE_EXHAUSTED' },
    );
    assert.equal((await db`select count(*)::int n from attempts`)[0]?.n, 0);
    assert.equal((await x.f.read(x.f.a.id)).status, 'ready');
  }));

test('another queued launch stays blocked while stopped result is pending', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const second = await db.begin((tx) =>
      createCommand(
        tx,
        { machineId: x.actor.id, ticketId: x.f.a.id, type: 'start', payload: {} },
        { kind: 'owner', id: 'owner' },
      ),
    );
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    const permit = { ...x.permit, commandId: second.id };
    await assert.rejects(
      () =>
        db.begin((tx) =>
          claimAttempt(tx, second.id, { processInstanceId: randomUUID(), permit }, x.actor, x.authorize),
        ),
      { code: 'FINAL_RESULT_PENDING' },
    );
  }));

test('internal needs_input intent finalizes stopped attempt and preserves repair limit', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    await db`update tickets set wait_reason='repair_limit' where id=${x.f.a.id}`;
    await db.begin((tx) =>
      createExecutionAuthority().requestTerminalIntent(tx, x.f.a.id, 'needs_input', 'repair_limit'),
    );
    const ticket = await x.f.read(x.f.a.id);
    assert.equal(ticket.status, 'needs_input');
    assert.equal(ticket.waitReason, 'repair_limit');
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      null,
    );
  }));

test('identical checkpoint and result replay are stable across JSONB key ordering', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    const checkpoint = {
      fence: a.fence,
      sequence: '1',
      step: 'review',
      artifactIds: [],
      commit: null,
      processInstanceId: a.processInstanceId,
    };
    const first = await db.begin((tx) => saveCheckpoint(tx, a.id, checkpoint, x.actor));
    const replay = await db.begin((tx) => saveCheckpoint(tx, a.id, checkpoint, x.actor));
    assert.equal(replay.checkpoint.sequence, first.checkpoint.sequence);
    const result = {
      fence: a.fence,
      processInstanceId: a.processInstanceId,
      outcome: 'retry' as const,
      evidenceIds: [],
      reason: null,
    };
    await db.begin((tx) => submitAttemptResult(tx, a.id, result, x.actor));
    await db.begin((tx) => submitAttemptResult(tx, a.id, result, x.actor));
  }));

test('fifth repair failure after confirmed stop keeps needs_input and repair_limit', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db`update tickets set repair_cycles=4 where id=${x.f.a.id}`;
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    const services = createTicketServices({ execution: createExecutionAuthority() });
    const before = (await x.f.read(x.f.a.id)).revision;
    await db.begin((tx) =>
      services.recordRepairResult(
        tx,
        {
          ticketId: x.f.a.id,
          attemptId: a.id,
          fence: a.fence,
          cycleId: randomUUID(),
          classification: 'repair_review',
          passed: false,
          evidence: {},
        },
        x.actor,
      ),
    );
    const ticket = await x.f.read(x.f.a.id);
    assert.equal(ticket.status, 'needs_input');
    assert.equal(ticket.waitReason, 'repair_limit');
    assert.equal(ticket.repairCycles, 5);
    assert(ticket.revision > before);
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      null,
    );
  }));

test('binding guard blocks uncertain attempt and releases only after terminal finalization', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db`update attempts set lease_expires_at=now()-interval '1 second' where id=${a.id}`;
    await db.begin((tx) =>
      saveCheckpoint(
        tx,
        a.id,
        {
          fence: a.fence,
          sequence: '1',
          step: 'expired',
          artifactIds: [],
          commit: null,
          processInstanceId: a.processInstanceId,
        },
        x.actor,
      ),
    );
    await assert.rejects(() => db.begin((tx) => assertNoActiveProjectExecution(tx, x.f.project.id)), {
      code: 'ACTIVE_EXECUTION',
    });
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'exit',
        },
        x.actor,
      ),
    );
    await db.begin((tx) =>
      submitAttemptResult(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          outcome: 'retry',
          evidenceIds: [],
          reason: null,
        },
        x.actor,
        async () => {},
      ),
    );
    await db.begin((tx) => assertNoActiveProjectExecution(tx, x.f.project.id));
  }));

test('repair proof rejects same machine after binding revision changes', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const a = await db.begin((tx) =>
      claimAttempt(
        tx,
        x.command.id,
        { processInstanceId: randomUUID(), permit: x.permit },
        x.actor,
        x.authorize,
      ),
    );
    await db`update projects set checkout_path='/tmp/rebound',binding_revision=3 where id=${x.f.project.id}`;
    const services = createTicketServices({ execution: createExecutionAuthority() });
    await assert.rejects(
      () =>
        db.begin((tx) =>
          services.recordRepairResult(
            tx,
            {
              ticketId: x.f.a.id,
              attemptId: a.id,
              fence: a.fence,
              cycleId: randomUUID(),
              classification: 'repair_review',
              passed: false,
              evidence: {},
            },
            x.actor,
          ),
        ),
      { code: 'STALE_FENCE' },
    );
  }));
