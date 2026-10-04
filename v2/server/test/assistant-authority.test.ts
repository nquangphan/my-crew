import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { createPersistedAssistantActorResolver } from '../src/assistant/authority.ts';
import type { AssistantPolicy } from '../src/assistant/contracts.ts';
import { registerAssistantRoutes } from '../src/assistant/routes.ts';
import { bootstrapOwner } from '../src/auth/bootstrap.ts';
import { createAuthenticator, registerAuthRoutes } from '../src/auth/routes.ts';
import { credentialResponseCodec, sha256 } from '../src/auth/session.ts';
import { createMutator } from '../src/journal/mutation.ts';
import type { Db, RouteDependencies, ServerOptions, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { assistantFixture, fixtureVerifierBuildSha256 } from './support/assistant.ts';
import { databaseFixture } from './support/db.ts';

const withDatabase = databaseFixture(11);
const policy: AssistantPolicy = {
  maxJobs: 1,
  telemetryMaxAgeMs: 15000,
  maxLoadPerCpu: 1,
  minMemoryBytes: '4294967296',
  minDiskBytes: '8589934592',
  maxTurnsPerRun: 1,
  maxToolsPerTurn: 1,
  maxCostUsdPerRun: 0,
  maxTurnMs: 60000,
  maxRecoveryAttempts: 0,
  parallelApprovalId: null,
};

async function fixture(db: Db) {
  const password = randomBytes(24).toString('hex');
  await bootstrapOwner(db, password);
  const options: ServerOptions = {
    db,
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: randomBytes(32),
    now: () => new Date(),
    authorizeDispatch: async () => {
      throw new Error('DISPATCH_NOT_CONFIGURED');
    },
    verifyFinalResult: async () => {
      throw new Error('FINAL_NOT_CONFIGURED');
    },
  };
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send({ error: { code: error.code } });
    return reply
      .status(error instanceof Error && 'validation' in error ? 400 : 500)
      .send({ error: { code: 'VALIDATION_OR_INTERNAL' } });
  });
  const auth = createAuthenticator(db, options);
  let revokeAfterAuthentication = false;
  let beforeAuthorization: ((tx: Tx) => Promise<void>) | undefined;
  let afterAuthorization: ((tx: Tx) => Promise<void>) | undefined;
  const mutator = createMutator(db, credentialResponseCodec(options.sessionEncryptionKey));
  const deps: RouteDependencies = {
    auth: {
      ...auth,
      requireOwner: async (...args: Parameters<typeof auth.requireOwner>) => {
        const actor = await auth.requireOwner(...args);
        if (revokeAfterAuthentication) await db`update sessions set revoked_at=now()`;
        return actor;
      },
    },
    mutator: (context, work) =>
      mutator(
        {
          ...context,
          authorize: async (tx) => {
            await beforeAuthorization?.(tx);
            await context.authorize?.(tx);
            await afterAuthorization?.(tx);
          },
        },
        work,
      ),
  };
  registerAuthRoutes(app, options, deps);
  registerAssistantRoutes(app, options, deps);
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/v2/auth/session',
    payload: { password },
    headers: { origin: options.publicOrigin },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    cookie: String(login.headers['set-cookie']).split(';')[0],
    origin: options.publicOrigin,
    'x-csrf-token': login.json().csrfToken as string,
  };
  return {
    app,
    headers,
    get: () => app.inject({ method: 'GET', url: '/v2/assistant/config', headers }),
    put: (body: unknown, key = randomUUID()) =>
      app.inject({
        method: 'PUT',
        url: '/v2/assistant/config',
        payload: body as object,
        headers: { ...headers, 'idempotency-key': key },
      }),
    machine: async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v2/machines',
        payload: { name: 'Máy A' },
        headers: { ...headers, 'idempotency-key': randomUUID() },
      });
      assert.equal(response.statusCode, 201);
      const body = response.json() as { machine: { id: string }; token: string };
      return { machineId: body.machine.id, token: body.token };
    },
    revokeBeforeTransaction: () => {
      revokeAfterAuthentication = true;
    },
    observeAuthorization: (before?: (tx: Tx) => Promise<void>, after?: (tx: Tx) => Promise<void>) => {
      beforeAuthorization = before;
      afterAuthorization = after;
    },
  };
}

function handshake<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function observedLockWait(db: Db, waitingPid: number, blockingPid: number, queryPart: string) {
  const deadline = performance.now() + 5000;
  do {
    const [row] = await db`select wait_event_type,query,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where pid=${waitingPid}`;
    if (
      row?.wait_event_type === 'Lock' &&
      (row.blockers as number[]).includes(blockingPid) &&
      String(row.query).includes(queryPart)
    ) {
      console.info(`A1 lock witness waiting=${waitingPid} blocker=${blockingPid} query=${queryPart}`);
      return;
    }
    await delay(10);
  } while (performance.now() < deadline);
  assert.fail(`Không quan sát được PostgreSQL lock wait ${waitingPid} -> ${blockingPid} (${queryPart})`);
}

async function observedCredentialOrder(db: Db, waitingPid: number, blockingPid: number, sessionHash: string) {
  const deadline = performance.now() + 5000;
  do {
    const [activity] = await db`select wait_event_type,query,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where pid=${waitingPid}`;
    if (
      activity?.wait_event_type === 'Lock' &&
      (activity.blockers as number[]).includes(blockingPid) &&
      String(activity.query).includes('update sessions')
    ) {
      console.info(`A1 credential lock witness waiting=${waitingPid} blocker=${blockingPid}`);
      return 'blocked';
    }
    const [session] =
      await db`select revoked_at is not null as revoked from sessions where id_hash=${sessionHash}`;
    if (session?.revoked) {
      console.info(`A1 credential order witness revoked=true while authorized request=${blockingPid} paused`);
      return 'revoked';
    }
    await delay(10);
  } while (performance.now() < deadline);
  assert.fail('Không quan sát được thứ tự credential lock hoặc revocation commit');
}

async function configState(db: Db) {
  return {
    config: await db`select * from assistant_config`,
    designation: await db`select * from assistant_designations order by id`,
    journal: await db`select * from idempotency where route='PUT:/v2/assistant/config' order by key`,
  };
}

// Catches a missing designation write, wrong audit actor, or replay creating another designation.
test('assistant authority owner chỉ định một máy, CAS và replay không tạo designation trùng', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    try {
      const initial = await f.get();
      assert.equal(initial.statusCode, 200);
      assert.equal(initial.json().designation, null);
      assert.equal(initial.json().revision, 1);
      const machine = await f.machine();
      const input = { expectedRevision: 1, machineId: machine.machineId, preferred: null, policy };
      const key = randomUUID();
      const response = await f.put(input, key);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().revision, 2);
      assert.equal(response.json().designation.machineId, machine.machineId);
      assert.equal(response.json().preferred, null);
      const replay = await f.put(input, key);
      assert.deepEqual(replay.json(), response.json());
      const stale = await f.put(input);
      assert.equal(stale.statusCode, 409);
      const [count] = await db`select count(*)::int as count from assistant_designations`;
      assert.equal(count.count, 1);
      const [audit] =
        await db`select actor_kind,actor_id from idempotency where route='PUT:/v2/assistant/config'`;
      assert.deepEqual(audit, { actor_kind: 'owner', actor_id: 'owner' });
      assert.equal((await db`select id from assistant_turns`).length, 0);
      assert.equal((await db`select id from attachment_assistant_grants`).length, 0);
      await db`update machines set revoked_at=now() where id=${machine.machineId}`;
      assert.equal((await f.put(input, key)).statusCode, 404);
      assert.equal((await db`select id from assistant_designations`).length, 1);
    } finally {
      await f.app.close();
    }
  }));

// Catches absent owner, CSRF, exact target and strict body checks before mutation.
test('assistant authority từ chối máy tự chỉ định, target sai và body ngoài slice', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    try {
      const machine = await f.machine();
      const input = { expectedRevision: 1, machineId: machine.machineId, preferred: null, policy };
      assert.equal(
        (
          await f.app.inject({
            method: 'PUT',
            url: '/v2/assistant/config',
            payload: input,
            headers: { authorization: `Bearer ${machine.token}`, 'idempotency-key': randomUUID() },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.app.inject({
            method: 'GET',
            url: '/v2/assistant/config',
            headers: { authorization: `Bearer ${machine.token}` },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.app.inject({
            method: 'PUT',
            url: '/v2/assistant/config',
            payload: input,
            headers: { cookie: f.headers.cookie, origin: f.headers.origin, 'idempotency-key': randomUUID() },
          })
        ).statusCode,
        403,
      );
      assert.equal((await f.put({ ...input, machineId: randomUUID() })).statusCode, 404);
      assert.equal((await f.put({ ...input, expectedRevision: 0 })).statusCode, 400);
      assert.equal(
        (
          await f.put({
            ...input,
            preferred: { machineId: machine.machineId, runtime: 'api', providerId: 'p', modelId: 'm' },
          })
        ).statusCode,
        400,
      );
      assert.equal((await f.put({ ...input, surprise: true })).statusCode, 400);
      assert.equal((await f.put({ ...input, policy: { ...policy, maxCostUsdPerRun: -1 } })).statusCode, 400);
      await db`update machines set revoked_at=now() where id=${machine.machineId}`;
      assert.equal((await f.put(input)).statusCode, 404);
      assert.equal((await db`select id from assistant_designations`).length, 0);
    } finally {
      await f.app.close();
    }
  }));

// Catches stale cached replies bypassing credential revocation inside the caller transaction.
test('assistant authority kiểm session hiện hành trước cached reply', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    try {
      const machine = await f.machine();
      const input = { expectedRevision: 1, machineId: machine.machineId, preferred: null, policy };
      const key = randomUUID();
      assert.equal((await f.put(input, key)).statusCode, 200);
      f.revokeBeforeTransaction();
      assert.equal((await f.put(input, key)).statusCode, 401);
      const [config] = await db`select revision from assistant_config`;
      assert.equal(String(config.revision), '2');
    } finally {
      await f.app.close();
    }
  }));

// Catches current SQL fixture identity being mistaken for measured admission authority.
test('assistant authority resolver không cấp Actor từ receipt UNVERIFIED hoặc scope hết hạn', async () =>
  withDatabase(async (db) => {
    const f = await assistantFixture(db);
    try {
      const { conversation, message } = await f.submitMessage();
      const fence = await f.seedTurn(conversation.id, message.id);
      const proof = { fence, scopeId: randomUUID(), operationId: randomUUID() };
      const resolveActor = createPersistedAssistantActorResolver({
        verifierBuildSha256: fixtureVerifierBuildSha256,
      });
      await assert.rejects(
        db.begin((tx) => resolveActor(tx, proof)),
        (e: unknown) => e instanceof ApiError && e.code === 'ASSISTANT_SCOPE_NOT_FOUND',
      );
      const snapshotId = randomUUID();
      await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
        values(${snapshotId},'message',${message.id},1,0,'{}',${'a'.repeat(64)})`;
      const scope = async (seconds: number) => {
        const id = randomUUID();
        await db`insert into assistant_scopes(id,turn_id,message_id,actions,tool_names,input_snapshot_id,scope_sha256,owner_authorization_id,expires_at)
          values(${id},${fence.turnId},${message.id},'[]','[]',${snapshotId},${'a'.repeat(64)},${randomUUID()},clock_timestamp()+${seconds}*interval '1 second')`;
        return id;
      };
      const expiredScope = await scope(-60),
        currentScope = await scope(60);
      await assert.rejects(
        db.begin((tx) => resolveActor(tx, { ...proof, scopeId: expiredScope })),
        { code: 'ASSISTANT_SCOPE_STALE' },
      );
      await assert.rejects(
        db.begin((tx) => resolveActor(tx, { ...proof, scopeId: currentScope })),
        { code: 'ASSISTANT_ADMISSION_NOT_CONFIGURED' },
      );
      await assert.rejects(
        db.begin((tx) =>
          resolveActor(tx, {
            ...proof,
            scopeId: currentScope,
            fence: { ...fence, generation: '2' },
          }),
        ),
        { code: 'ASSISTANT_TURN_STALE' },
      );
      await db`update machines set revoked_at=now() where id=(select machine_id from assistant_designations where id=${fence.designationId})`;
      await assert.rejects(
        db.begin((tx) => resolveActor(tx, { ...proof, scopeId: currentScope })),
        { code: 'ASSISTANT_TURN_STALE' },
      );
    } finally {
      await f.close();
    }
  }));

test('assistant authority resolver requires a valid pinned verifier build at assembly', () => {
  for (const verifierBuildSha256 of [undefined, '', 'F'.repeat(64), 'f'.repeat(63), 42])
    assert.throws(
      () =>
        createPersistedAssistantActorResolver({
          verifierBuildSha256: verifierBuildSha256 as unknown as string,
        }),
      /ASSISTANT_VERIFIER_PIN_INVALID/,
    );
});

async function admittedScope(db: Db, sessionExpiresInSeconds = 300) {
  const f = await assistantFixture(db);
  const { conversation } = await f.submitMessage();
  const seeded = await f.seedAdmittedTurn({
    conversationId: conversation.id,
    messageId: null,
    target: { kind: 'ticket', id: f.request.id },
    sessionExpiresInSeconds,
  });
  const scopeId = randomUUID();
  await db`insert into assistant_scopes(id,turn_id,root_ticket_id,project_id,actions,tool_names,input_snapshot_id,scope_sha256,owner_authorization_id,expires_at)
    values(${scopeId},${seeded.fence.turnId},${f.request.id},${f.project.id},'["decision"]','[]',${seeded.snapshotId},
    ${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '60 seconds')`;
  return { f, seeded, proof: { fence: seeded.fence, scopeId, operationId: randomUUID() } };
}

// Catches a stubbed or fallback resolver: only persisted admitted rows yield the designation machine.
test('assistant authority resolver returns the designation machine for an admitted PASS turn', async () =>
  withDatabase(async (db) => {
    const { f, seeded, proof } = await admittedScope(db);
    try {
      const actor = await db.begin((tx) =>
        createPersistedAssistantActorResolver({ verifierBuildSha256: fixtureVerifierBuildSha256 })(tx, proof),
      );
      assert.deepEqual(actor, { kind: 'machine', id: seeded.machineId });
      assert.ok(Object.isFrozen(actor));
    } finally {
      await f.close();
    }
  }));

// Catches session expiry measured at transaction start (now()) instead of after the locks.
test('assistant authority resolver measures session expiry with clock_timestamp after locking', async () =>
  withDatabase(async (db) => {
    const { f, proof } = await admittedScope(db, 3);
    try {
      const resolveActor = createPersistedAssistantActorResolver({
        verifierBuildSha256: fixtureVerifierBuildSha256,
      });
      const witness = await db
        .begin(async (tx) => {
          const [before] =
            await tx`select now()<expires_at as open, expires_at from attachment_assistant_sessions`;
          await tx`select pg_sleep_until(${before?.expires_at}::timestamptz + interval '50 milliseconds')`;
          const [after] = await tx`select now()<expires_at as start_open,
            clock_timestamp()>=expires_at as clock_expired from attachment_assistant_sessions`;
          let code: string | null = null;
          try {
            await resolveActor(tx, proof);
          } catch (error) {
            code = error instanceof ApiError ? error.code : 'UNEXPECTED';
          }
          return { open: before?.open, ...after, code };
        })
        .then((value) => ({ ...value }));
      assert.deepEqual(witness, {
        open: true,
        start_open: true,
        clock_expired: true,
        code: 'ASSISTANT_ADMISSION_DENIED',
      });
    } finally {
      await f.close();
    }
  }));

// Catches competing owners both committing, unnecessary designation churn, or unsafe live reassignment.
test('assistant authority concurrent CAS, idle reassignment và live turn giữ nguyên authority', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    try {
      const a = await f.machine(),
        b = await f.machine();
      const input = { expectedRevision: 1, machineId: a.machineId, preferred: null, policy };
      const responses = await Promise.all([f.put(input), f.put({ ...input, machineId: b.machineId })]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
      const current = (await f.get()).json();
      const update = await f.put({
        ...input,
        expectedRevision: 2,
        machineId: current.designation.machineId,
        policy: { ...policy, maxToolsPerTurn: 2 },
      });
      assert.equal(update.statusCode, 200, update.body);
      assert.equal(update.json().designation.id, current.designation.id);
      const other = current.designation.machineId === a.machineId ? b : a;
      const changed = await f.put({ ...input, expectedRevision: 3, machineId: other.machineId });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.notEqual(changed.json().designation.id, current.designation.id);
      assert.equal((await db`select id from assistant_designations where retired_at is null`).length, 1);
      assert.equal((await db`select id from assistant_designations where retired_at is not null`).length, 1);
    } finally {
      await f.app.close();
    }
  }));

test('assistant authority live turn chặn reassignment và không thả guard bằng config', async () =>
  withDatabase(async (db) => {
    const sql = await assistantFixture(db);
    const f = await fixture(db);
    try {
      const m = await sql.submitMessage();
      const fence = await sql.seedTurn(m.conversation.id, m.message.id);
      const before = (await f.get()).json();
      const machine = await f.machine();
      const response = await f.put({
        expectedRevision: 1,
        machineId: machine.machineId,
        preferred: null,
        policy,
      });
      assert.equal(response.statusCode, 409);
      assert.deepEqual((await f.get()).json(), before);
      const [turn] = await db`select state from assistant_turns where id=${fence.turnId}`;
      assert.equal(turn.state, 'running');
      const same = await f.put({
        expectedRevision: 1,
        machineId: before.designation.machineId,
        preferred: null,
        policy: { ...policy, maxToolsPerTurn: 2 },
      });
      assert.equal(same.statusCode, 200, same.body);
      assert.equal(same.json().designation.id, before.designation.id);
      assert.equal(
        (await db`select state from assistant_turns where id=${fence.turnId}`)[0].state,
        'running',
      );
    } finally {
      await f.app.close();
      await sql.close();
    }
  }));

// A1: catches a credential snapshot taken before an observed authority lock wait.
for (const mode of ['fresh', 'replay'] as const) {
  for (const lock of ['guard', 'machine'] as const) {
    for (const invalidation of ['revoked', 'expired'] as const) {
      test(`assistant authority A1 ${mode}/${lock}/${invalidation} trong lock wait bị từ chối`, async () =>
        withDatabase(async (db) => {
          const f = await fixture(db);
          const release = handshake<void>();
          let blocker: Promise<unknown> | undefined;
          let pending: Promise<unknown> | undefined;
          try {
            const machine = await f.machine();
            const input = { expectedRevision: 1, machineId: machine.machineId, preferred: null, policy };
            const key = randomUUID();
            if (mode === 'replay') assert.equal((await f.put(input, key)).statusCode, 200);
            const before = await configState(db);
            const blocked = handshake<number>(),
              requestPid = handshake<number>();
            blocker = db.begin(async (tx) => {
              const [pid] = await tx`select pg_backend_pid() as pid`;
              if (lock === 'guard') await tx`select singleton from assistant_calibration_guard for update`;
              else await tx`select id from machines where id=${machine.machineId} for update`;
              blocked.resolve(Number(pid.pid));
              await release.promise;
            });
            const blockerPid = await blocked.promise;
            f.observeAuthorization(async (tx) => {
              const [pid] = await tx`select pg_backend_pid() as pid`;
              requestPid.resolve(Number(pid.pid));
            });
            const response = f.put(input, key).then((value) => value);
            pending = response;
            const pid = await requestPid.promise;
            await observedLockWait(
              db,
              pid,
              blockerPid,
              lock === 'guard' ? 'assistant_calibration_guard' : 'machines',
            );
            const secret = f.headers.cookie.split('=')[1];
            assert.ok(secret);
            const sessionHash = sha256(secret);
            if (invalidation === 'revoked') {
              await db`update sessions set revoked_at=clock_timestamp() where id_hash=${sessionHash}`;
              const [witness] =
                await db`select revoked_at is not null as revoked from sessions where id_hash=${sessionHash}`;
              assert.equal(witness.revoked, true);
              console.info(`A1 revoke committed before releasing ${lock} for ${mode}`);
            } else {
              await db`update sessions set expires_at=clock_timestamp()+interval '100 milliseconds' where id_hash=${sessionHash}`;
              await db`select pg_sleep_until(expires_at) from sessions where id_hash=${sessionHash}`;
              const [witness] = await db`select s.expires_at<=clock_timestamp() as expired,
                a.xact_start<s.expires_at as transaction_predates_expiry from sessions s
                cross join pg_stat_activity a where s.id_hash=${sessionHash} and a.pid=${pid}`;
              assert.equal(witness.expired, true);
              assert.equal(witness.transaction_predates_expiry, true);
              console.info(`A1 expiry witness expired=true transaction_predates_expiry=true ${mode}/${lock}`);
            }
            release.resolve();
            await blocker;
            const result = await response;
            assert.equal(result.statusCode, 401, result.body);
            assert.deepEqual(await configState(db), before);
          } finally {
            release.resolve();
            await Promise.allSettled([blocker, pending]);
            await f.app.close();
          }
        }));
    }
  }
}

// A1: fixture-only stopped state permits reassignment after the observed final turn lock wait.
test('assistant authority A1 turn/expired sau mọi authority lock bị từ chối', async () =>
  withDatabase(async (db) => {
    const sql = await assistantFixture(db);
    const f = await fixture(db);
    const release = handshake<void>();
    let blocker: Promise<unknown> | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      const message = await sql.submitMessage();
      const fence = await sql.seedTurn(message.conversation.id, message.message.id);
      const machine = await f.machine();
      const before = await configState(db);
      const blocked = handshake<number>(),
        requestPid = handshake<number>();
      blocker = db.begin(async (tx) => {
        const [pid] = await tx`select pg_backend_pid() as pid`;
        await tx`select id from assistant_turns where id=${fence.turnId} for update`;
        // Relational fixture only: this is not production process-stop evidence.
        await tx`update assistant_turns set state='stopped',stop_evidence_id=${randomUUID()},
            finalized_at=clock_timestamp() where id=${fence.turnId}`;
        blocked.resolve(Number(pid.pid));
        await release.promise;
      });
      const blockerPid = await blocked.promise;
      f.observeAuthorization(async (tx) => {
        const [pid] = await tx`select pg_backend_pid() as pid`;
        requestPid.resolve(Number(pid.pid));
      });
      const secret = f.headers.cookie.split('=')[1];
      assert.ok(secret);
      const hash = sha256(secret);
      await db`update sessions set expires_at=clock_timestamp()+interval '1 second' where id_hash=${hash}`;
      const response = f
        .put({ expectedRevision: 1, machineId: machine.machineId, preferred: null, policy })
        .then((value) => value);
      pending = response;
      const pid = await requestPid.promise;
      await observedLockWait(db, pid, blockerPid, 'assistant_turns');
      await db`select pg_sleep_until(expires_at) from sessions where id_hash=${hash}`;
      const [witness] = await db`select s.expires_at<=clock_timestamp() as expired,
            a.xact_start<s.expires_at as transaction_predates_expiry from sessions s
            cross join pg_stat_activity a where s.id_hash=${hash} and a.pid=${pid}`;
      assert.equal(witness.expired, true);
      assert.equal(witness.transaction_predates_expiry, true);
      console.info('A1 turn expiry witness expired=true transaction_predates_expiry=true');
      release.resolve();
      await blocker;
      const result = await response;
      assert.equal(result.statusCode, 401, result.body);
      assert.deepEqual(await configState(db), before);
    } finally {
      release.resolve();
      await Promise.allSettled([blocker, pending]);
      await f.app.close();
      await sql.close();
    }
  }));

// A1: catches a final recheck that still releases the credential row before commit/cache delivery.
for (const mode of ['fresh', 'replay'] as const) {
  test(`assistant authority A1 ${mode} giữ credential lock đến mutation commit`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const release = handshake<void>();
      let response: ReturnType<typeof f.put> | undefined;
      let revocation: Promise<unknown> | undefined;
      try {
        const machine = await f.machine();
        const input = { expectedRevision: 1, machineId: machine.machineId, preferred: null, policy };
        const key = randomUUID();
        if (mode === 'replay') assert.equal((await f.put(input, key)).statusCode, 200);
        const authorized = handshake<number>(),
          revoker = handshake<number>();
        f.observeAuthorization(undefined, async (tx) => {
          const [pid] = await tx`select pg_backend_pid() as pid`;
          authorized.resolve(Number(pid.pid));
          await release.promise;
        });
        response = f.put(input, key).then((value) => value);
        const requestPid = await authorized.promise;
        const secret = f.headers.cookie.split('=')[1];
        assert.ok(secret);
        revocation = db.begin(async (tx) => {
          const [pid] = await tx`select pg_backend_pid() as pid`;
          revoker.resolve(Number(pid.pid));
          await tx`update sessions set revoked_at=clock_timestamp() where id_hash=${sha256(secret)}`;
        });
        const revokerPid = await revoker.promise;
        assert.equal(await observedCredentialOrder(db, revokerPid, requestPid, sha256(secret)), 'blocked');
        release.resolve();
        assert.equal((await response).statusCode, 200);
        await revocation;
        const [row] =
          await db`select revoked_at is not null as revoked from sessions where id_hash=${sha256(secret)}`;
        assert.equal(row.revoked, true);
        assert.equal((await f.put(input, key)).statusCode, 401);
        assert.equal((await db`select id from assistant_designations`).length, 1);
        assert.equal((await db`select revision from assistant_config`)[0].revision, '2');
      } finally {
        release.resolve();
        await Promise.allSettled([response, revocation]);
        await f.app.close();
      }
    }));
}

// A2: catches comparing the PostgreSQL canonical UUID with the raw request casing.
test('assistant authority A2 uppercase designation và revoked target dùng cùng identity', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    try {
      const machine = await f.machine();
      const upper = machine.machineId.toUpperCase();
      assert.notEqual(upper, machine.machineId);
      const input = { expectedRevision: 1, machineId: upper, preferred: null, policy };
      const key = randomUUID();
      const first = await f.put(input, key);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().designation.machineId, machine.machineId);
      const replay = await f.put(input, key);
      assert.deepEqual(replay.json(), first.json());
      // Raw wire payload remains the idempotency identity, even for one logical machine.
      assert.equal((await f.put({ ...input, machineId: machine.machineId }, key)).statusCode, 409);
      await db`update machines set revoked_at=clock_timestamp() where id=${machine.machineId}`;
      assert.equal((await f.put(input, key)).statusCode, 404);
      assert.equal((await f.put({ ...input, machineId: machine.machineId })).statusCode, 404);
      assert.equal((await db`select id from assistant_designations`).length, 1);
    } finally {
      await f.app.close();
    }
  }));

test('assistant authority A2 đổi casing cùng máy không retire designation hoặc live turn', async () =>
  withDatabase(async (db) => {
    const sql = await assistantFixture(db);
    const f = await fixture(db);
    try {
      const m = await sql.submitMessage();
      const fence = await sql.seedTurn(m.conversation.id, m.message.id);
      const before = (await f.get()).json();
      const response = await f.put({
        expectedRevision: before.revision,
        machineId: before.designation.machineId.toUpperCase(),
        preferred: null,
        policy: { ...policy, maxToolsPerTurn: 2 },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().designation, before.designation);
      assert.equal(response.json().revision, before.revision + 1);
      assert.equal((await db`select id from assistant_designations`).length, 1);
      const [turn] =
        await db`select state,designation_id,designation_revision from assistant_turns where id=${fence.turnId}`;
      assert.equal(turn.state, 'running');
      assert.equal(turn.designation_id, before.designation.id);
      assert.equal(Number(turn.designation_revision), before.designation.revision);
    } finally {
      await f.app.close();
      await sql.close();
    }
  }));
