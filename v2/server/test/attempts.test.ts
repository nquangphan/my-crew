import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import {
  assertNoActiveProjectExecution,
  authorizeAttemptMutation,
  claimAttempt,
  createExecutionAuthority,
  readAttempt,
  recheckFinalization,
  reconcileAttempt,
  registerArtifactEvidence,
  requestTerminalIntent,
  saveCheckpoint,
  submitAttemptResult,
} from '../src/execution/attempts.ts';
import { createCommand } from '../src/execution/commands.ts';
import type { Attempt } from '../src/execution/contracts.ts';
import { registerExecutionRoutes } from '../src/execution/routes.ts';
import { createMutator } from '../src/journal/mutation.ts';
import type { Db, ServerOptions } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { openPeerDb, executionFixture as setup } from './support/execution.ts';

const withDatabase = databaseFixture(5);
const owner = { kind: 'owner', id: 'owner' } as const;

async function ownerIntervention(db: Db, ticketId: string) {
  const services = createTicketServices({ execution: createExecutionAuthority() });
  return db.begin((tx) =>
    services.recordDecision(
      tx,
      ticketId,
      { kind: 'intervention', content: 'Dừng tiến trình', rationale: 'Kiểm tra', sources: [], scope: {} },
      owner,
    ),
  );
}

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

test('independent pools racing claim keep one durable attempt and one fence', async () =>
  withDatabase(async (db) => {
    const x = await setup(db);
    const left = await openPeerDb(db);
    const right = await openPeerDb(db);
    try {
      const contenders = [
        { pool: left, processId: randomUUID() },
        { pool: right, processId: randomUUID() },
      ];
      const results = await Promise.allSettled(
        contenders.map(({ pool, processId }) =>
          pool.begin((tx) =>
            claimAttempt(
              tx,
              x.command.id,
              { processInstanceId: processId, permit: x.permit },
              x.actor,
              x.authorize,
            ),
          ),
        ),
      );
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const winner = results.find((result) => result.status === 'fulfilled');
      if (winner?.status !== 'fulfilled') throw Error('claim winner missing');
      assert.equal(
        (await db`select count(*)::int n from attempts where command_id=${x.command.id}`)[0]?.n,
        1,
      );
      assert.equal(
        (await db`select fence from execution_guards where ticket_id=${x.f.a.id}`)[0]?.fence,
        winner.value.fence,
      );
      const replay = await right.begin((tx) =>
        claimAttempt(
          tx,
          x.command.id,
          { processInstanceId: winner.value.processInstanceId, permit: x.permit },
          x.actor,
          x.authorize,
        ),
      );
      assert.equal(replay.id, winner.value.id);
    } finally {
      await left.end();
      await right.end();
    }
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

test('expired active lease rejects new artifact until running reconciliation, but finalizing accepts late report', async () =>
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
    const report = {
      fence: a.fence,
      processInstanceId: a.processInstanceId,
      locator: 'report.md',
      sha256: 'e'.repeat(64),
      sourceCommit: null,
    };
    await db`update attempts set lease_expires_at=now()-interval '1 second' where id=${a.id}`;
    await assert.rejects(() => db.begin((tx) => registerArtifactEvidence(tx, a.id, report, x.actor)), {
      code: 'LEASE_EXPIRED',
    });
    assert.equal((await db`select count(*)::int n from evidence where attempt_id=${a.id}`)[0]?.n, 0);
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      a.id,
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
    const accepted = await db.begin((tx) => registerArtifactEvidence(tx, a.id, report, x.actor));
    assert.equal((await db`select count(*)::int n from evidence where id=${accepted.id}`)[0]?.n, 1);
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
    await db`update attempts set lease_expires_at=now()-interval '1 second' where id=${a.id}`;
    const late = await db.begin((tx) =>
      registerArtifactEvidence(tx, a.id, { ...report, locator: 'late.md' }, x.actor),
    );
    assert.notEqual(late.id, accepted.id);
  }));

test('pause after replacement targets the new attempt and repeat pause reuses only its command', async () =>
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
    const firstDecision = await ownerIntervention(db, x.f.a.id);
    const first = await db.begin((tx) =>
      requestTerminalIntent(
        tx,
        x.f.a.id,
        { intent: 'pause', reason: 'first', decisionId: firstDecision },
        owner,
      ),
    );
    assert.equal(first?.payload.attemptId, a.id);
    await db.begin((tx) =>
      reconcileAttempt(
        tx,
        a.id,
        {
          fence: a.fence,
          processInstanceId: a.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'pause',
        },
        x.actor,
      ),
    );
    const services = createTicketServices({ execution: createExecutionAuthority() });
    let ticket = await x.f.read(x.f.a.id);
    ticket = await db.begin((tx) =>
      services.signalTicket(tx, ticket.id, 'resume', ticket.revision, null, owner),
    );
    ticket = await db.begin((tx) =>
      services.signalTicket(tx, ticket.id, 'dependencies_ready', ticket.revision, null, owner),
    );
    const resume = await db.begin((tx) =>
      createCommand(tx, { machineId: x.actor.id, ticketId: ticket.id, type: 'resume', payload: {} }, owner),
    );
    const permit = {
      ...x.permit,
      commandId: resume.id,
      ticketRevision: ticket.revision,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
    };
    const b = await db.begin((tx) =>
      claimAttempt(tx, resume.id, { processInstanceId: randomUUID(), permit }, x.actor, x.authorize),
    );
    await assert.rejects(
      () =>
        db.begin((tx) =>
          saveCheckpoint(
            tx,
            a.id,
            {
              fence: a.fence,
              processInstanceId: a.processInstanceId,
              sequence: '1',
              step: 'stale',
              artifactIds: [],
              commit: null,
            },
            x.actor,
          ),
        ),
      { code: 'STALE_FENCE' },
    );
    const secondDecision = await ownerIntervention(db, x.f.a.id);
    const second = await db.begin((tx) =>
      requestTerminalIntent(
        tx,
        ticket.id,
        { intent: 'pause', reason: 'second', decisionId: secondDecision },
        owner,
      ),
    );
    assert.notEqual(second?.id, first?.id);
    assert.equal(second?.payload.attemptId, b.id);
    const repeat = await db.begin((tx) =>
      requestTerminalIntent(
        tx,
        ticket.id,
        { intent: 'pause', reason: 'repeat', decisionId: secondDecision },
        owner,
      ),
    );
    assert.equal(repeat?.id, second?.id);
    assert.equal(first?.payload.attemptId, a.id);
    assert.equal(
      (await db`select count(*)::int n from commands where ticket_id=${ticket.id} and type='pause'`)[0]?.n,
      2,
    );
  }));

test('wait_owner event matches ticket response both before and after stop proof', async () => {
  for (const stopFirst of [false, true]) {
    await withDatabase(async (db) => {
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
      if (stopFirst)
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
      const before = await x.f.read(x.f.a.id);
      const response = await db.begin((tx) =>
        services.signalTicket(tx, before.id, 'wait_owner', before.revision, null, owner),
      );
      const [event] =
        await db`select data from events where ticket_id=${before.id} and type='ticket.changed' order by cursor desc limit 1`;
      const current = await x.f.read(before.id);
      const [guard] = await db`select active_attempt_id from execution_guards where ticket_id=${before.id}`;
      const [attempt] = await db`select state from attempts where id=${a.id}`;
      assert.equal(event?.data?.status, response.status);
      assert.equal(event?.data?.revision, response.revision);
      assert.equal(response.status, current.status);
      assert.equal(response.revision, current.revision);
      assert.equal(response.status, stopFirst ? 'needs_input' : 'running');
      assert.equal(guard?.active_attempt_id, stopFirst ? null : a.id);
      assert.equal(attempt?.state, stopFirst ? 'stopped' : 'active');
    });
  }
});

test('concurrent stop and retry result finalize once with one guard release', async () =>
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
    let verified = 0;
    const verify = async () => {
      verified += 1;
    };
    await Promise.all([
      db.begin((tx) =>
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
      ),
      db.begin((tx) =>
        submitAttemptResult(
          tx,
          a.id,
          {
            fence: a.fence,
            processInstanceId: a.processInstanceId,
            outcome: 'retry',
            evidenceIds: [],
            reason: 'retry',
          },
          x.actor,
          verify,
        ),
      ),
    ]);
    assert.equal(verified, 1);
    assert.equal(
      (
        await db`select count(*)::int n from events where type='attempt.finalized' and data->>'attemptId'=${a.id}`
      )[0]?.n,
      1,
    );
    assert.equal(
      (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
        ?.active_attempt_id,
      null,
    );
    assert.equal((await db`select state from attempts where id=${a.id}`)[0]?.state, 'stopped');
    assert.equal((await x.f.read(x.f.a.id)).status, 'pending');
  }));

test('owner pause and cancel intents dominate a previously reported passed result', async () => {
  for (const intent of ['pause', 'cancel'] as const) {
    await withDatabase(async (db) => {
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
            outcome: 'passed',
            evidenceIds: [],
            reason: null,
          },
          x.actor,
        ),
      );
      const decisionId = await ownerIntervention(db, x.f.a.id);
      await db.begin((tx) =>
        requestTerminalIntent(tx, x.f.a.id, { intent, reason: 'owner stop', decisionId }, owner),
      );
      let verified = 0;
      await db.begin((tx) =>
        reconcileAttempt(
          tx,
          a.id,
          {
            fence: a.fence,
            processInstanceId: a.processInstanceId,
            observation: 'stopped',
            artifacts: [],
            stopReason: intent,
          },
          x.actor,
          async () => {
            verified += 1;
          },
        ),
      );
      assert.equal(verified, 0);
      assert.equal((await x.f.read(x.f.a.id)).status, intent === 'pause' ? 'paused' : 'cancelled');
      assert.equal(
        (await db`select state,terminal_intent from attempts where id=${a.id}`)[0]?.state,
        'stopped',
      );
      assert.equal(
        (await db`select terminal_intent from attempts where id=${a.id}`)[0]?.terminal_intent,
        intent,
      );
      assert.equal(
        (await db`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
          ?.active_attempt_id,
        null,
      );
    });
  }
});

test('stopped attestation survives pool restart and recheck finalizes without rewriting proof', async () =>
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
    const writer = await openPeerDb(db);
    try {
      await writer.begin((tx) =>
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
      const pending = await writer.begin((tx) =>
        submitAttemptResult(
          tx,
          a.id,
          {
            fence: a.fence,
            processInstanceId: a.processInstanceId,
            outcome: 'retry',
            evidenceIds: [],
            reason: 'restart',
          },
          x.actor,
        ),
      );
      assert.equal(pending.state, 'finalizing');
    } finally {
      await writer.end();
    }
    const reader = await openPeerDb(db);
    try {
      const [before] =
        await reader`select count(*)::int n from reconciliation_observations where attempt_id=${a.id}`;
      assert.equal(before?.n, 1);
      const finalized = await reader.begin((tx) =>
        recheckFinalization(
          tx,
          a.id,
          { fence: a.fence, processInstanceId: a.processInstanceId },
          x.actor,
          async () => {},
        ),
      );
      assert.equal(finalized.state, 'stopped');
      const [after] =
        await reader`select count(*)::int n from reconciliation_observations where attempt_id=${a.id}`;
      assert.equal(after?.n, 1);
      assert.equal(
        (
          await reader`select count(*)::int n from events where type='attempt.finalized' and data->>'attemptId'=${a.id}`
        )[0]?.n,
        1,
      );
    } finally {
      await reader.end();
    }
  }));

test('append-only verifier attestation linked to original reported evidence advances persisted passed result after pool restart', async () =>
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
    const writer = await openPeerDb(db);
    const reportInput = {
      fence: a.fence,
      processInstanceId: a.processInstanceId,
      locator: 'artifacts/result.json',
      sha256: 'f'.repeat(64),
      sourceCommit: 'c'.repeat(40),
    };
    const verifyFromDb: ServerOptions['verifyFinalResult'] = async (tx, input) => {
      if (input.kind !== 'research' || input.outcome !== 'passed' || input.evidenceIds.length !== 1)
        throw new ApiError('FINAL_VERIFICATION_PENDING', 503, 'Attestation chưa hợp lệ');
      const [linked] = await tx`select v.id from evidence e join evidence v
        on v.ticket_id=e.ticket_id and v.attempt_id=e.attempt_id
        where e.id=${input.evidenceIds[0]} and e.ticket_id=${input.ticketId}
        and e.attempt_id=${input.attemptId} and e.kind='artifact'
        and e.data->>'verification'='reported'
        and v.kind='research_result' and v.data->>'verification'='verified'
        and v.data->>'originalEvidenceId'=e.id::text
        and v.data->>'locator'=e.data->>'locator'
        and v.data->>'sha256'=e.data->>'sha256'
        and v.data->>'sourceCommit'=e.data->>'sourceCommit' limit 1`;
      if (!linked) throw new ApiError('FINAL_VERIFICATION_PENDING', 503, 'Attestation chưa liên kết nguồn');
    };
    let reportedId: string;
    let originalReportedData: string;
    let originalResultData: string;
    let originalResponse: Attempt;
    let resultContext: {
      actor: typeof x.actor;
      route: string;
      key: string;
      body: {
        fence: string;
        processInstanceId: string;
        outcome: 'passed';
        evidenceIds: string[];
        reason: null;
      };
      authorize: (tx: Parameters<typeof authorizeAttemptMutation>[0]) => Promise<void>;
    };
    try {
      const reported = await writer.begin((tx) => registerArtifactEvidence(tx, a.id, reportInput, x.actor));
      reportedId = reported.id;
      const [reportedBefore] = await writer`select data::text as data from evidence where id=${reportedId}`;
      originalReportedData = reportedBefore?.data as string;
      const resultInput = {
        fence: a.fence,
        processInstanceId: a.processInstanceId,
        outcome: 'passed' as const,
        evidenceIds: [reportedId],
        reason: null,
      };
      resultContext = {
        actor: x.actor,
        route: `POST:/v2/machine/attempts/${a.id}/result`,
        key: 'original-passed-result',
        body: resultInput,
        authorize: (tx) => authorizeAttemptMutation(tx, a.id, x.actor),
      };
      originalResponse = (
        await createMutator(writer)(resultContext, async (tx) => ({
          status: 200,
          body: await submitAttemptResult(tx, a.id, resultInput, x.actor, verifyFromDb),
        }))
      ).body;
      assert.equal(originalResponse.state, 'active');
      const [resultBefore] =
        await writer`select terminal_result::text as result from attempts where id=${a.id}`;
      originalResultData = resultBefore?.result as string;
      await writer.begin((tx) =>
        reconcileAttempt(
          tx,
          a.id,
          {
            fence: a.fence,
            processInstanceId: a.processInstanceId,
            observation: 'stopped',
            artifacts: [reportedId],
            stopReason: 'exit',
          },
          x.actor,
          verifyFromDb,
        ),
      );
      const pendingWithoutAttestation = await writer.begin((tx) =>
        recheckFinalization(
          tx,
          a.id,
          { fence: a.fence, processInstanceId: a.processInstanceId },
          x.actor,
          verifyFromDb,
        ),
      );
      assert.equal(pendingWithoutAttestation.state, 'finalizing');
      assert.equal(
        (await writer`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
          ?.active_attempt_id,
        a.id,
      );
      const wrongId = randomUUID();
      await writer`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${randomUUID()},${x.f.a.id},${a.id},'research_result',${writer.json({ verification: 'verified', originalEvidenceId: wrongId, locator: reportInput.locator, sha256: reportInput.sha256, sourceCommit: reportInput.sourceCommit })})`;
      const pendingWrongLink = await writer.begin((tx) =>
        recheckFinalization(
          tx,
          a.id,
          { fence: a.fence, processInstanceId: a.processInstanceId },
          x.actor,
          verifyFromDb,
        ),
      );
      assert.equal(pendingWrongLink.state, 'finalizing');
      assert.equal(
        (await writer`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
          ?.active_attempt_id,
        a.id,
      );
      await writer`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${randomUUID()},${x.f.a.id},${a.id},'research_result',${writer.json({ verification: 'verified', originalEvidenceId: reportedId, locator: reportInput.locator, sha256: reportInput.sha256, sourceCommit: reportInput.sourceCommit })})`;
      assert.equal(
        (await writer`select data::text as data from evidence where id=${reportedId}`)[0]?.data,
        originalReportedData,
      );
      assert.equal(
        (await writer`select terminal_result::text as result from attempts where id=${a.id}`)[0]?.result,
        originalResultData,
      );
    } finally {
      await writer.end();
    }
    const reader = await openPeerDb(db);
    try {
      const recheckContext = {
        actor: x.actor,
        route: `POST:/v2/machine/attempts/${a.id}/finalize`,
        key: 'attested-recheck',
        body: { fence: a.fence, processInstanceId: a.processInstanceId },
        authorize: (tx: Parameters<typeof authorizeAttemptMutation>[0]) =>
          authorizeAttemptMutation(tx, a.id, x.actor),
      };
      const finalized = (
        await createMutator(reader)(recheckContext, async (tx) => ({
          status: 200,
          body: await recheckFinalization(tx, a.id, recheckContext.body, x.actor, verifyFromDb),
        }))
      ).body;
      assert.equal(finalized.state, 'stopped');
      assert.equal((await x.f.read(x.f.a.id)).status, 'done');
      assert.equal(
        (await reader`select active_attempt_id from execution_guards where ticket_id=${x.f.a.id}`)[0]
          ?.active_attempt_id,
        null,
      );
      assert.equal(
        (
          await reader`select count(*)::int n from events where type='attempt.finalized' and data->>'attemptId'=${a.id}`
        )[0]?.n,
        1,
      );
      assert.equal(
        (
          await reader`select count(*)::int n from reconciliation_observations where attempt_id=${a.id} and observation='stopped'`
        )[0]?.n,
        1,
      );
      assert.equal(
        (await reader`select data::text as data from evidence where id=${reportedId}`)[0]?.data,
        originalReportedData,
      );
      const [stored] =
        await reader`select terminal_result::text as result,fence from attempts where id=${a.id}`;
      assert.equal(stored?.result, originalResultData);
      assert.equal(String(stored?.fence), a.fence);
      const originalReplay = await createMutator(reader)<Attempt>(resultContext, async () => {
        throw Error('original result work reran');
      });
      assert.deepEqual(originalReplay.body, originalResponse);
      assert.equal(originalReplay.body.state, 'active');
      assert.equal((await reader`select count(*)::int n from evidence where id=${reportedId}`)[0]?.n, 1);
    } finally {
      await reader.end();
    }
  }));

test('claim rejects unapproved deploy, unfinished predecessor, and expired permit before authority callback', async () => {
  for (const gate of ['deploy', 'dependency', 'permit'] as const) {
    await withDatabase(async (db) => {
      const x = await setup(db);
      if (gate === 'deploy') await db`update tickets set kind='deploy' where id=${x.f.a.id}`;
      if (gate === 'dependency')
        await db`insert into dependencies(ticket_id,predecessor_id) values(${x.f.a.id},${x.f.b.id})`;
      const permit =
        gate === 'permit' ? { ...x.permit, expiresAt: new Date(Date.now() - 1000).toISOString() } : x.permit;
      let callbacks = 0;
      const code =
        gate === 'deploy'
          ? 'DEPLOY_OWNER_INTENT_REQUIRED'
          : gate === 'dependency'
            ? 'DEPENDENCIES_NOT_READY'
            : 'DISPATCH_PERMIT_INVALID';
      await assert.rejects(
        () =>
          db.begin((tx) =>
            claimAttempt(tx, x.command.id, { processInstanceId: randomUUID(), permit }, x.actor, async () => {
              callbacks += 1;
            }),
          ),
        { code },
      );
      assert.equal(callbacks, 0);
      assert.equal((await db`select count(*)::int n from attempts where ticket_id=${x.f.a.id}`)[0]?.n, 0);
      assert.equal((await x.f.read(x.f.a.id)).status, 'ready');
    });
  }
});

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
