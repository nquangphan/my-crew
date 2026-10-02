import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { connectDb } from '../src/db/client.ts';
import type { Attempt } from '../src/execution/contracts.ts';
import { appendEvent, readEvents } from '../src/journal/events.ts';
import type { Db, DispatchPermit, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import type { Project } from '../src/projects/service.ts';
import { projectEventScope } from '../src/projects/service.ts';
import type { Ticket } from '../src/tickets/contracts.ts';
import { databaseFixture } from './support/db.ts';
import { legacyBundle, validDocs } from './support/docs.ts';
import { openPeerDb, pin } from './support/execution.ts';
import { apiFixture, type HttpResponse } from './support/http.ts';

const withDatabase = databaseFixture(6);
const checked = <T>(response: HttpResponse, status: number): T => {
  assert.equal(response.statusCode, status, response.text);
  return response.json<T>();
};
type Api = Awaited<ReturnType<typeof apiFixture>>;
const trustedDispatch = async (_tx: Tx) => {};
async function machines(f: Api) {
  const rawA = checked<{ machine: { id: string }; token: string }>(
    await f.ownerPost('/v2/machines', { name: 'Mac A' }),
    201,
  );
  const rawB = checked<{ machine: { id: string }; token: string }>(
    await f.ownerPost('/v2/machines', { name: 'Mac B' }),
    201,
  );
  return {
    a: { machineId: rawA.machine.id, token: rawA.token },
    b: { machineId: rawB.machine.id, token: rawB.token },
  };
}
async function ticket(
  f: Api,
  projectId: string,
  parentId: string | null,
  level: Ticket['level'],
  kind: Ticket['kind'] = 'research',
) {
  return checked<Ticket>(
    await f.ownerPost('/v2/tickets', {
      projectId,
      parentId,
      level,
      kind,
      title: level,
      description: '',
      mandatory: true,
      criteria: {},
      inputs: {},
      outputs: {},
      skill: null,
      workflowPin: pin,
    }),
    201,
  );
}
async function setup(f: Api) {
  const { a, b } = await machines(f);
  const project = checked<Project>(
    await f.ownerPost('/v2/projects', { key: 'HTTP', name: 'HTTP acceptance', repositoryUrl: null }),
    201,
  );
  checked(
    await f.ownerPut(`/v2/projects/${project.id}/binding`, {
      machineId: a.machineId,
      checkoutPath: '/tmp/http-crew',
      expectedRevision: 1,
    }),
    200,
  );
  const root = await ticket(f, project.id, null, 'request');
  const step = await ticket(f, project.id, root.id, 'step');
  const task = await ticket(f, project.id, step.id, 'task');
  return { a, b, project, root, step, task };
}
async function start(f: Api, x: Awaited<ReturnType<typeof setup>>, target = x.task, expected = 201) {
  const ready = checked<Ticket>(
    await f.ownerPost(`/v2/tickets/${target.id}/signals`, {
      signal: 'dependencies_ready',
      expectedRevision: target.revision,
    }),
    200,
  );
  const command = checked<{ id: string }>(
    await f.ownerPost('/v2/commands', {
      machineId: x.a.machineId,
      ticketId: target.id,
      type: 'start',
      payload: {},
    }),
    202,
  );
  const permit: DispatchPermit = {
    commandId: command.id,
    ticketId: target.id,
    machineId: x.a.machineId,
    bindingRevision: 2,
    ticketRevision: ready.revision,
    workflow: pin,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 25_000).toISOString(),
    telemetryId: randomUUID(),
    decisionId: randomUUID(),
  };
  const body = { processInstanceId: randomUUID(), permit };
  const response = await f.machineWrite(`/v2/machine/commands/${command.id}/claim`, x.a.token, body, 'claim');
  if (expected !== 201) {
    checked(response, expected);
    return { command, response, body, attempt: null };
  }
  return { command, response, body, attempt: checked<Attempt>(response, 201) };
}
async function digest(db: Db) {
  const [counts] =
    await db`select (select count(*) from tickets)::int tickets,(select count(*) from events)::int events,(select count(*) from docs_snapshots)::int snapshots,(select count(*) from commands)::int commands,(select count(*) from attempts)::int attempts,(select value::text from event_cursor) cursor`;
  const files =
    await db`select snapshot_id,path,sha,encode(bytes,'hex') bytes from docs_files order by snapshot_id,path`;
  const results = await db`select id,state,result from commands order by id`;
  return { counts, files: [...files], results: [...results] };
}
async function backupRestore(db: Db) {
  const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
  assert(containerId, 'Private test container ID is required');
  assert.match(containerId, /^[0-9a-f]{64}$/);
  const base = process.env.CREW_V2_TEST_DATABASE_URL;
  assert(base, 'Private test database URL is required');
  const [name] = await db`select current_database() name`;
  assert(name && typeof name.name === 'string', 'Database must return its current name');
  const dump = spawnSync(
    'docker',
    ['exec', containerId, 'pg_dump', '-U', 'postgres', '-Fc', '-d', name.name],
    { maxBuffer: 24 * 1024 * 1024 },
  );
  assert.equal(dump.status, 0, dump.stderr.toString());
  const restoredName = `crew_v2_restore_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(base, { max: 1 });
  try {
    await admin`create database ${admin(restoredName)}`;
    try {
      const restored = spawnSync(
        'docker',
        ['exec', '-i', containerId, 'pg_restore', '-U', 'postgres', '-d', restoredName],
        { input: dump.stdout, maxBuffer: 24 * 1024 * 1024 },
      );
      assert.equal(restored.status, 0, restored.stderr.toString());
      const url = new URL(base);
      url.pathname = `/${restoredName}`;
      const copy = connectDb(url.toString());
      try {
        assert.deepEqual(await digest(copy), await digest(db));
      } finally {
        await copy.end();
      }
    } finally {
      await admin`drop database ${admin(restoredName)} with (force)`;
    }
  } finally {
    await admin.end();
  }
  return { containerId, restoredName, dumpBytes: dump.stdout.length };
}

test('HTTP persistence graph commands events docs reconnect restart and backup restore', async (t) =>
  withDatabase(async (db) => {
    let f = await apiFixture(db, { authority: { authorizeDispatch: trustedDispatch } });
    let reopened: Db | undefined;
    try {
      const x = await setup(f);
      const sibling = await ticket(f, x.project.id, x.step.id, 'task');
      checked(
        await f.ownerPost(`/v2/tickets/${sibling.id}/dependencies`, {
          predecessorId: x.task.id,
          expectedRevision: sibling.revision,
        }),
        201,
      );
      checked(
        await f.ownerPost(`/v2/tickets/${x.task.id}/comments`, { text: 'Ghi nhận từ HTTP' }, 'comment'),
        201,
      );
      const decision = checked<{ id: string }>(
        await f.ownerPost(`/v2/tickets/${x.task.id}/decisions`, {
          kind: 'intervention',
          content: 'Tạm dừng',
          rationale: 'Owner yêu cầu',
          sources: [],
          scope: {},
        }),
        201,
      );
      const imported = legacyBundle(validDocs());
      const first = await f.import(imported, 'import');
      const replay = await f.import(imported, 'import');
      assert.deepEqual(replay, first);
      const importedProject = first.projects[0];
      assert(importedProject, 'Import must return a project');
      assert.equal(
        (await f.ownerGet(`/v2/projects/${importedProject.projectId}`)).json().docsState,
        'unverified',
      );
      const priorCursor = checked<{ cursor: string }>(await f.ownerGet('/v2/events?limit=100'), 200).cursor;
      const launch = await start(f, x);
      const attempt = launch.attempt;
      assert(attempt, 'Successful claim must return an attempt');
      assert.equal((await f.machineGet(`/v2/machine/attempts/${attempt.id}`, x.b.token)).statusCode, 404);
      const checkpoint = {
        fence: attempt.fence,
        processInstanceId: attempt.processInstanceId,
        sequence: '1',
        step: 'HTTP checkpoint',
        artifactIds: [],
        commit: null,
      };
      checked(
        await f.machineWrite(
          `/v2/machine/attempts/${attempt.id}/checkpoint`,
          x.a.token,
          checkpoint,
          'checkpoint',
        ),
        200,
      );
      const stop = checked<{ id: string }>(
        await f.ownerPost('/v2/commands', {
          machineId: x.a.machineId,
          ticketId: x.task.id,
          type: 'pause',
          payload: { reason: 'Tạm dừng', decisionId: decision.id },
        }),
        202,
      );
      const ackBody = { phase: 'completed', result: { accepted: true } };
      const ack = checked(
        await f.machineWrite(`/v2/machine/commands/${stop.id}/ack`, x.a.token, ackBody, 'ack'),
        200,
      );
      assert.equal((await f.ownerGet(`/v2/tickets/${x.task.id}`)).json().status, 'running');
      checked(
        await f.machineWrite(`/v2/machine/attempts/${attempt.id}/reconcile`, x.a.token, {
          fence: attempt.fence,
          processInstanceId: attempt.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'pause',
        }),
        200,
      );
      assert.equal((await f.ownerGet(`/v2/tickets/${x.task.id}`)).json().status, 'paused');
      const graph = checked(await f.ownerGet(`/v2/tickets/${x.root.id}/graph`), 200);
      const stored = await digest(db);
      const identity = f.identity;
      const firstUrl = f.url;
      await f.close();
      reopened = await openPeerDb(db);
      await db.end();
      f = await apiFixture(reopened, { prior: identity });
      assert.deepEqual(checked(await f.ownerGet(`/v2/tickets/${x.root.id}/graph`), 200), graph);
      assert.deepEqual(await digest(reopened), stored);
      assert.deepEqual(
        checked(await f.machineWrite(`/v2/machine/commands/${stop.id}/ack`, x.a.token, ackBody, 'ack'), 200),
        ack,
      );
      assert.deepEqual(await f.import(imported, 'import'), first);
      checked(
        await f.ownerPost(`/v2/tickets/${x.task.id}/comments`, { text: 'Sau restart' }, 'after-restart'),
        201,
      );
      const events = checked<{ items: { cursor: string; type: string }[] }>(
        await f.ownerGet(`/v2/events?after=${priorCursor}&limit=100`),
        200,
      ).items;
      assert.equal(new Set(events.map((event) => event.cursor)).size, events.length);
      assert.equal(events.filter((event) => event.type === 'comment.created').length, 1);
      const page = checked<{ sourceCommit: string | null }>(
        await f.ownerGet(`/v2/projects/${importedProject.projectId}/docs/page?path=docs/index.md`),
        200,
      );
      assert.equal(page.sourceCommit, null);
      const reconnect = await stream(f, { cookie: f.identity.cookie, 'last-event-id': priorCursor });
      for (let i = 0; i < 100 && !reconnect.content().includes('event: comment.created'); i++)
        await delay(10);
      assert(reconnect.content().includes('event: comment.created'));
      const streamedIds = [...reconnect.content().matchAll(/^id: (\d+)$/gm)].map((match) => match[1]);
      assert.deepEqual(
        streamedIds,
        events.map((event) => event.cursor),
      );
      await reconnect.close();
      await reconnect.finished;
      const proof = await backupRestore(reopened);
      t.diagnostic(
        JSON.stringify({
          realHttp: true,
          port0: true,
          prefix: 6,
          restartPool: true,
          firstUrl,
          reopenedUrl: f.url,
          ...proof,
        }),
      );
      await reopened`update machines set revoked_at=now() where id=${x.a.machineId}`;
      assert.equal((await f.machineGet('/v2/machines/self', x.a.token)).statusCode, 401);
      assert.equal(
        (
          await f.ownerPost('/v2/projects', {
            key: 'OLD',
            name: 'v1',
            repositoryUrl: null,
            legacyId: randomUUID(),
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (await f.ownerPost('/v2/machines', { name: 'v1', token: 'legacy-token' })).statusCode,
        400,
      );
    } finally {
      await f.close();
      await reopened?.end();
    }
  }));

async function waitForBlockedMutation(peer: Db): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [row] =
      await peer`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%event_cursor%' limit 1`;
    if (row) return;
    await delay(10);
  }
  throw new Error('MUTATION_DID_NOT_REACH_JOURNAL_LOCK');
}
test('HTTP ticket cached replay cannot race current binding or machine revocation across pools', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db);
    const peer = await openPeerDb(db);
    try {
      const x = await setup(f);
      const body = { text: 'Replay secret' };
      const path = `/v2/tickets/${x.task.id}/comments`;
      checked(await f.machineWrite(path, x.a.token, body, 'machine-comment'), 201);
      for (const operation of ['binding', 'revocation'] as const) {
        let release = () => {};
        let acquired = () => {};
        const ready = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const blocking = db.begin(async (tx) => {
          await tx`select value from event_cursor for update`;
          acquired();
          await gate;
        });
        await ready;
        const pending = f.machineWrite(path, x.a.token, body, 'machine-comment');
        try {
          await waitForBlockedMutation(peer);
          if (operation === 'binding')
            await peer`update projects set machine_id=${x.b.machineId},binding_revision=binding_revision+1 where id=${x.project.id}`;
          else await peer`update machines set revoked_at=now() where id=${x.a.machineId}`;
        } finally {
          release();
          await blocking;
        }
        assert.equal((await pending).statusCode, 404);
        assert.equal(
          (await peer`select count(*)::int n from comments where ticket_id=${x.task.id}`)[0]?.n,
          1,
        );
        if (operation === 'binding')
          await peer`update projects set machine_id=${x.a.machineId},binding_revision=binding_revision+1 where id=${x.project.id}`;
      }
    } finally {
      await f.close();
      await peer.end();
    }
  }));

async function stream(f: Api, headers: Record<string, string>) {
  const response = await fetch(`${f.url}/v2/events/stream`, { headers, signal: AbortSignal.timeout(6000) });
  assert.equal(response.status, 200);
  const body = response.body;
  assert(body, 'Successful SSE response must provide a body');
  const reader = body.getReader();
  let content = '';
  const finished = (async () => {
    while (true) {
      const packet = await reader.read();
      if (packet.done) return content;
      content += new TextDecoder().decode(packet.value);
    }
  })();
  for (let i = 0; i < 100 && !content.includes(': connected'); i++) await delay(10);
  assert(content.includes(': connected'));
  return { finished, content: () => content, close: () => reader.cancel() };
}
test('real SSE current credential revocation and owner expiry close streams without future data', async () =>
  withDatabase(async (db) => {
    let now = new Date();
    const f = await apiFixture(db, { now: () => now });
    const peer = await openPeerDb(db);
    try {
      const x = await setup(f);
      const before = checked<{ cursor: string }>(await f.ownerGet('/v2/events?limit=100'), 200).cursor;
      const machine = await stream(f, { authorization: `Bearer ${x.a.token}`, 'last-event-id': before });
      await peer`update machines set revoked_at=now() where id=${x.a.machineId}`;
      const revokedEvent = await peer.begin((tx) =>
        appendEvent(tx, {
          type: 'probe',
          projectId: x.project.id,
          ticketId: null,
          audienceMachineId: x.a.machineId,
          data: { ok: true },
        }),
      );
      assert(!(await machine.finished).includes(`id: ${revokedEvent.cursor}\n`));
      await assert.rejects(
        () => readEvents(db, { kind: 'machine', id: x.a.machineId }, before, 100, projectEventScope),
        { code: 'UNAUTHENTICATED' },
      );
      const owner = await stream(f, {
        cookie: f.identity.cookie,
        'last-event-id': checked<{ cursor: string }>(await f.ownerGet('/v2/events?limit=100'), 200).cursor,
      });
      now = new Date(now.getTime() + 13 * 60 * 60_000);
      const expiredEvent = await peer.begin((tx) =>
        appendEvent(tx, {
          type: 'probe',
          projectId: null,
          ticketId: null,
          audienceMachineId: null,
          data: { ok: true },
        }),
      );
      assert(!(await owner.finished).includes(`id: ${expiredEvent.cursor}\n`));
      assert.equal((await f.ownerGet('/v2/events')).statusCode, 401);
    } finally {
      await f.close();
      await peer.end();
    }
  }));

test('HTTP default dispatch denies; reported evidence stays finalizing until trusted research test attestation', async () =>
  withDatabase(async (db) => {
    let f = await apiFixture(db);
    try {
      const x = await setup(f);
      const denied = await start(f, x, x.task, 503);
      assert.equal(denied.response.json<{ error: { code: string } }>().error.code, 'DISPATCH_NOT_CONFIGURED');
      assert.equal((await db`select count(*)::int n from attempts`)[0]?.n, 0);
      const identity = f.identity;
      await f.close();
      f = await apiFixture(db, {
        prior: identity,
        authority: {
          authorizeDispatch: trustedDispatch,
          verifyFinalResult: async (tx, input) => {
            const [accepted] =
              await tx`select 1 from evidence where ticket_id=${input.ticketId} and attempt_id=${input.attemptId} and kind='research_result' and data->>'verification'='verified' and data->>'testAuthority'='Task7' limit 1`;
            if (!accepted) throw new ApiError('FINAL_RESULT_NOT_VERIFIED', 409, 'Thiếu attestation kiểm thử');
          },
        },
      });
      const attempt = checked<Attempt>(
        await f.machineWrite(
          `/v2/machine/commands/${denied.command.id}/claim`,
          x.a.token,
          denied.body,
          'claim',
        ),
        201,
      );
      const report = checked<{ id: string }>(
        await f.machineWrite(`/v2/machine/attempts/${attempt.id}/artifacts`, x.a.token, {
          fence: attempt.fence,
          processInstanceId: attempt.processInstanceId,
          locator: 'test/research.md',
          sha256: 'a'.repeat(64),
          sourceCommit: null,
        }),
        201,
      );
      assert.equal(
        (await db`select data->>'verification' v from evidence where id=${report.id}`)[0]?.v,
        'reported',
      );
      checked(
        await f.machineWrite(`/v2/machine/attempts/${attempt.id}/result`, x.a.token, {
          fence: attempt.fence,
          processInstanceId: attempt.processInstanceId,
          outcome: 'passed',
          evidenceIds: [report.id],
          reason: null,
        }),
        200,
      );
      const proof = {
        fence: attempt.fence,
        processInstanceId: attempt.processInstanceId,
        observation: 'stopped',
        artifacts: [],
        stopReason: 'exit',
      };
      assert.equal(
        checked<Attempt>(
          await f.machineWrite(`/v2/machine/attempts/${attempt.id}/reconcile`, x.a.token, proof),
          200,
        ).state,
        'finalizing',
      );
      assert.equal(
        (await db`select active_attempt_id from execution_guards where ticket_id=${x.task.id}`)[0]
          ?.active_attempt_id,
        attempt.id,
      );
      await db`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${randomUUID()},${x.task.id},${attempt.id},'research_result',${db.json({ verification: 'verified', testAuthority: 'Task7', originalEvidenceId: report.id })})`;
      assert.equal(
        checked<Attempt>(
          await f.machineWrite(`/v2/machine/attempts/${attempt.id}/finalize`, x.a.token, {
            fence: attempt.fence,
            processInstanceId: attempt.processInstanceId,
          }),
          200,
        ).state,
        'stopped',
      );
      assert.equal((await f.ownerGet(`/v2/tickets/${x.task.id}`)).json().status, 'done');
      assert.equal(
        (await db`select data->>'verification' v from evidence where id=${report.id}`)[0]?.v,
        'reported',
      );
    } finally {
      await f.close();
    }
  }));

test('HTTP all machine ticket mutation families reject cached replay after rebind', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db, { authority: { authorizeDispatch: trustedDispatch } });
    try {
      const { a, b } = await machines(f);
      const p = (await f.import(legacyBundle(validDocs()))).projects[0];
      assert(p, 'Import must return a project');
      checked(
        await f.ownerPut(`/v2/projects/${p.projectId}/binding`, {
          machineId: a.machineId,
          checkoutPath: '/tmp/acl',
          expectedRevision: 1,
        }),
        200,
      );
      const root = await ticket(f, p.projectId, null, 'request');
      const step = await ticket(f, p.projectId, root.id, 'step');
      const childBody = {
        projectId: p.projectId,
        parentId: step.id,
        level: 'task',
        kind: 'research',
        title: 'Machine child',
        description: '',
        mandatory: true,
        criteria: {},
        inputs: {},
        outputs: {},
        skill: null,
        workflowPin: pin,
      };
      const task = checked<Ticket>(await f.machineWrite('/v2/tickets', a.token, childBody, 'create'), 201);
      const previous = await ticket(f, p.projectId, step.id, 'task');
      const cases: { path: string; method: string; key: string; body: unknown; status: number }[] = [
        { path: '/v2/tickets', method: 'POST', key: 'create', body: childBody, status: 201 },
        {
          path: `/v2/tickets/${task.id}/signals`,
          method: 'POST',
          key: 'signal',
          body: { signal: 'dependencies_ready', expectedRevision: task.revision },
          status: 200,
        },
        {
          path: `/v2/tickets/${task.id}/comments`,
          method: 'POST',
          key: 'comment',
          body: { text: 'Machine comment' },
          status: 201,
        },
        {
          path: `/v2/tickets/${task.id}/decisions`,
          method: 'POST',
          key: 'decision',
          body: { kind: 'assessment', content: 'Đánh giá', rationale: 'Bằng chứng', sources: [], scope: {} },
          status: 201,
        },
      ];
      for (const c of cases.slice(1))
        checked(await f.machineWrite(c.path, a.token, c.body, c.key, c.method), c.status);
      let current = checked<Ticket>(await f.ownerGet(`/v2/tickets/${task.id}`), 200);
      const link = {
        path: `/v2/tickets/${task.id}/docs-links`,
        method: 'PUT',
        key: 'link',
        body: { snapshotId: p.snapshotId, paths: ['docs/index.md'], expectedRevision: current.revision },
        status: 200,
      };
      checked(await f.machineWrite(link.path, a.token, link.body, link.key, link.method), link.status);
      cases.push(link);
      current = checked<Ticket>(await f.ownerGet(`/v2/tickets/${previous.id}`), 200);
      const dependency = {
        path: `/v2/tickets/${previous.id}/dependencies`,
        method: 'POST',
        key: 'dep',
        body: { predecessorId: task.id, expectedRevision: current.revision },
        status: 201,
      };
      checked(await f.machineWrite(dependency.path, a.token, dependency.body, dependency.key), 201);
      cases.push(dependency);
      await db`update projects set machine_id=${b.machineId},binding_revision=3 where id=${p.projectId}`;
      for (const c of cases)
        assert.equal(
          (await f.machineWrite(c.path, a.token, c.body, c.key, c.method)).statusCode,
          404,
          c.path,
        );
    } finally {
      await f.close();
    }
  }));

test('HTTP fifth repair result remains fenced until confirmed physical stop', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db, { authority: { authorizeDispatch: trustedDispatch } });
    try {
      const x = await setup(f);
      const launch = await start(f, x, x.step);
      const attempt = launch.attempt;
      assert(attempt, 'Successful claim must return an attempt');
      await db`update tickets set repair_cycles=4 where id=${x.step.id}`;
      const body = {
        attemptId: attempt.id,
        fence: attempt.fence,
        cycleId: randomUUID(),
        classification: 'repair_review',
        passed: false,
        evidence: {},
      };
      checked(await f.machineWrite(`/v2/tickets/${x.step.id}/repair-results`, x.a.token, body, 'fifth'), 200);
      const before = checked<Ticket>(await f.ownerGet(`/v2/tickets/${x.step.id}`), 200);
      assert.equal(before.repairCycles, 5);
      assert.equal(before.status, 'running');
      assert.equal(before.waitReason, 'repair_limit');
      assert.equal(
        (await db`select active_attempt_id from execution_guards where ticket_id=${x.step.id}`)[0]
          ?.active_attempt_id,
        attempt.id,
      );
      checked(
        await f.machineWrite(`/v2/machine/attempts/${attempt.id}/reconcile`, x.a.token, {
          fence: attempt.fence,
          processInstanceId: attempt.processInstanceId,
          observation: 'stopped',
          artifacts: [],
          stopReason: 'pause',
        }),
        200,
      );
      const after = checked<Ticket>(await f.ownerGet(`/v2/tickets/${x.step.id}`), 200);
      assert.equal(after.status, 'needs_input');
      assert.equal(after.repairCycles, 5);
      assert.equal(after.waitReason, 'repair_limit');
      assert.equal(
        (await db`select active_attempt_id from execution_guards where ticket_id=${x.step.id}`)[0]
          ?.active_attempt_id,
        null,
      );
      await db`update projects set machine_id=${x.b.machineId},binding_revision=3 where id=${x.project.id}`;
      assert.equal(
        (await f.machineWrite(`/v2/tickets/${x.step.id}/repair-results`, x.a.token, body, 'fifth'))
          .statusCode,
        404,
      );
    } finally {
      await f.close();
    }
  }));

test('current credential and event scope share one snapshot across rebind and revocation', async () =>
  withDatabase(async (db) => {
    const { authenticateCurrentCredential } = await import('../src/auth/routes.ts');
    const f = await apiFixture(db);
    const peer = await openPeerDb(db);
    try {
      const x = await setup(f);
      const before = checked<{ cursor: string }>(await f.ownerGet('/v2/events?limit=100'), 200).cursor;
      const request = {
        headers: { authorization: `Bearer ${x.a.token}` },
      } as import('fastify').FastifyRequest;
      let observed = () => {};
      let release = () => {};
      const ready = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = readEvents(
        db,
        { kind: 'machine', id: x.a.machineId },
        before,
        100,
        async (queryDb, actor) => {
          const current = await authenticateCurrentCredential(queryDb, request, new Date());
          assert.deepEqual(current, actor);
          const scope = await projectEventScope(queryDb, actor);
          observed();
          await gate;
          return scope;
        },
      );
      await ready;
      try {
        await peer.begin(async (tx) => {
          await tx`update machines set revoked_at=now() where id=${x.a.machineId}`;
          await tx`update projects set machine_id=${x.b.machineId},binding_revision=3 where id=${x.project.id}`;
          await appendEvent(tx, {
            type: 'probe',
            projectId: x.project.id,
            ticketId: null,
            audienceMachineId: x.a.machineId,
            data: { ok: true },
          });
        });
      } finally {
        release();
      }
      assert.deepEqual(await pending, []);
      await assert.rejects(
        () =>
          readEvents(db, { kind: 'machine', id: x.a.machineId }, before, 100, async (queryDb, actor) => {
            await authenticateCurrentCredential(queryDb, request, new Date());
            return projectEventScope(queryDb, actor);
          }),
        { code: 'UNAUTHENTICATED' },
      );
    } finally {
      await f.close();
      await peer.end();
    }
  }));

test('buildApp composes without migrations or listener; unknown DB errors are generic503', async () =>
  databaseFixture(1)(async (db) => {
    const { buildApp } = await import('../src/app.ts');
    const app = await buildApp({
      db,
      publicOrigin: 'http://localhost:5182',
      secureCookies: false,
      sessionEncryptionKey: randomBytes(32),
      now: () => new Date(),
    });
    try {
      assert.equal(app.server.listening, false);
      assert.equal((await db`select count(*)::int n from schema_migrations`)[0]?.n, 1);
      const response = await app.inject({ method: 'GET', url: '/v2/auth/session' });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không sẵn sàng' },
      });
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/v2/auth/session',
            payload: { password: 'test', token: 'v1' },
          })
        ).statusCode,
        400,
      );
      const imported = spawnSync(process.execPath, ['-e', 'import("./src/main.ts")'], {
        cwd: new URL('../', import.meta.url),
        encoding: 'utf8',
      });
      assert.equal(imported.status, 0, imported.stderr);
    } finally {
      await app.close();
    }
  }));

test('HTTP bounded docs upload exceeds ordinary1MiB and app shutdown closes real SSE', async () =>
  withDatabase(async (db) => {
    const f = await apiFixture(db);
    try {
      const bundle = legacyBundle({
        'docs/flows/large-a.md': Buffer.from('x '.repeat(350_000)),
        'docs/flows/large-b.md': Buffer.from('y '.repeat(350_000)),
      });
      assert(JSON.stringify(bundle).length > 1024 * 1024);
      const result = await f.import(bundle);
      const importedProject = result.projects[0];
      assert(importedProject, 'Large bundle import must return a project');
      assert.equal(importedProject.auditState, 'invalid');
      assert.equal(
        (await f.ownerOversizedPost('/v2/tickets', { blob: 'x'.repeat(1024 * 1024) })).statusCode,
        413,
      );
      assert.equal(
        (await f.ownerOversizedPost('/v2/docs/imports', { blob: 'x'.repeat(24 * 1024 * 1024) })).statusCode,
        413,
      );
      const cursor = checked<{ cursor: string }>(await f.ownerGet('/v2/events?limit=100'), 200).cursor;
      const active = await stream(f, { cookie: f.identity.cookie, 'last-event-id': cursor });
      const closed = active.finished.catch(() => 'socket closed');
      await f.close();
      await closed;
      assert.equal(f.app.server.listening, false);
    } finally {
      await f.close();
    }
  }));
