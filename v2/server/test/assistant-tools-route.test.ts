import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { createPersistedAssistantActorResolver } from '../src/assistant/authority.ts';
import type { DocRead, QuestionProposal, RoutingTool, TurnFence } from '../src/assistant/contracts.ts';
import { operationRequestSha256 } from '../src/assistant/operation-request.ts';
import { createProjectOrchestrationPort } from '../src/assistant/orchestration.ts';
import { registerAssistantRoutes } from '../src/assistant/routes.ts';
import { createWorkflowRuns } from '../src/assistant/runs.ts';
import { createAssistantTools } from '../src/assistant/tools.ts';
import { bootstrapOwner } from '../src/auth/bootstrap.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { createAuthenticator } from '../src/auth/routes.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { createMutator } from '../src/journal/mutation.ts';
import type { Db, Id, RouteDependencies, ServerOptions } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { assistantFixture, fixtureVerifierBuildSha256 } from './support/assistant.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner } from './support/tickets.ts';

const withDatabase = databaseFixture(11);
const route = 'POST:/v2/assistant/turns/:id/tools';
const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
// Request hash oracle: the shared tagged form, recomputed here without the module under test.
const requestOracle = (action: string, payload: unknown) =>
  createHash('sha256')
    .update(canonicalJson({ schema: 'crew-v2:operation-request:1', action, payload }))
    .digest('hex');
const questionScopeOracle = (context: Record<string, unknown>) =>
  createHash('sha256')
    .update(canonicalJson(['crew-v2:owner-question-scope:1', context]))
    .digest('hex');

type VectorEntry = {
  source: Record<string, unknown>;
  projection: Record<string, unknown>;
  definition: { sha256: string; skills: unknown[]; customizationSha256: string };
};
const vector = JSON.parse(
  await readFile(
    new URL('../../gateway/test/fixtures/workflow-definitions/install-report-vector.json', import.meta.url),
    'utf8',
  ),
) as { superpowers: VectorEntry; bmad: VectorEntry };
const missingSlot = { state: 'missing', installed: null, lastError: null, observedAt: null };
const currentSlot = (installed: unknown, extra: Record<string, unknown> = {}) => ({
  state: 'current',
  installed,
  lastError: null,
  observedAt: '2026-10-04T00:00:00.000Z',
  ...extra,
});
const workflowStatus = () => ({
  superpowers: {
    source: currentSlot(vector.superpowers.source),
    projections: {
      claude: currentSlot(vector.superpowers.projection, { definition: vector.superpowers.definition }),
      codex: missingSlot,
      api: missingSlot,
    },
  },
  bmad: {
    source: currentSlot(vector.bmad.source),
    projections: {
      claude: currentSlot(vector.bmad.projection, { definition: vector.bmad.definition }),
      codex: missingSlot,
      api: missingSlot,
    },
  },
});

const allTools = [
  'read_catalog',
  'read_docs',
  'route_message',
  'read_execution_candidates',
  'assess_ticket',
  'ask_owner',
  'create_run',
  'request_dispatch',
  'request_review',
  'publish_reply',
];

type FixtureOptions = { tools?: string[]; maxToolsPerTurn?: number; assembly?: boolean };

// Real rows end to end: owner, machines A (designated Assistant), B (project binding) and
// C (authenticated, not designated); an admitted PASS turn of A on the root's input
// snapshot; the root scope; B's stored install report. The route runs on a Fastify
// instance with the real authenticator, journal mutator and the tools assembly.
async function toolsFixture(db: Db, options: FixtureOptions = {}) {
  const f = await assistantFixture(db);
  await bootstrapOwner(db, randomBytes(24).toString('hex'));
  const machines = await f.mutation(randomUUID(), async (tx) => ({
    a: await provisionMachine(tx, 'Assistant A'),
    b: await provisionMachine(tx, 'Bound B'),
    c: await provisionMachine(tx, 'Other C'),
  }));
  const tokens = { a: machines.a.token, b: machines.b.token, c: machines.c.token };
  const ids = { a: machines.a.machine.id, b: machines.b.machine.id, c: machines.c.machine.id };
  await db`update projects set machine_id=${ids.b},checkout_path='/tmp/b3a-test-only',binding_revision=2,
    expected_commit=${'a'.repeat(40)} where id=${f.project.id}`;
  const root = await f.mutation(randomUUID(), (tx) =>
    f.services.createTicket(
      tx,
      inputTicket(f.project.id, 'request', null, {
        kind: 'code',
        title: 'Yêu cầu chạy workflow',
        criteria: { workflowChoice: 'superpowers' },
      }),
      owner,
    ),
  );
  const otherRoot = await f.mutation(randomUUID(), (tx) =>
    f.services.createTicket(tx, inputTicket(f.project.id, 'request', null, { kind: 'code' }), owner),
  );
  const reportId = randomUUID();
  await db.begin(async (tx) => {
    await tx`insert into gateway_boots(machine_id,boot_id,boot_generation,previous_generation,created_at)
      values(${ids.b},${randomUUID()},1,0,now())`;
    await tx`insert into gateway_install_reports(id,machine_id,boot_generation,config_revision,body_hash,report,response,received_at)
      values(${reportId},${ids.b},1,1,${'a'.repeat(64)},${tx.json({ fixture: true })},${tx.json({ accepted: true })},now())`;
    await tx`insert into gateway_applied(machine_id,revision,inventory,latest_report_id,workflow_status,applied_at)
      values(${ids.b},1,${tx.json(workflowStatus() as never)},${reportId},${tx.json(workflowStatus() as never)},now())`;
  });
  const submitted = await f.submitMessage();
  const seeded = await f.seedAdmittedTurn({
    conversationId: submitted.conversation.id,
    messageId: null,
    target: { kind: 'ticket', id: root.id },
    machineId: ids.a,
    snapshotCanonical: { required: [] },
  });
  const fence: TurnFence = seeded.fence;
  const snapshotId = seeded.snapshotId as Id;
  const scopeId = randomUUID();
  await db`insert into assistant_scopes(id,turn_id,root_ticket_id,message_id,project_id,actions,tool_names,input_snapshot_id,
    scope_sha256,owner_authorization_id,expires_at)
    values(${scopeId},${fence.turnId},${root.id},null,${f.project.id},
    ${db.json(['create_ticket', 'dependency'])},${db.json(options.tools ?? allTools)},${snapshotId},
    ${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '10 minutes')`;
  await db`update assistant_config set policy=policy||${db.json({ maxToolsPerTurn: options.maxToolsPerTurn ?? 64 })}
    where singleton=true`;
  const [snapshot] = await db`select sha256 from attachment_input_snapshots where id=${snapshotId}`;
  const pin = {
    snapshotId,
    snapshotSha256: String(snapshot?.sha256),
    inputRevision: '1',
    selectionSha256: sha([]),
  };

  const options_: ServerOptions = {
    db,
    publicOrigin: 'http://localhost:5183',
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
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    return reply
      .status(error instanceof Error && 'validation' in error ? 400 : 500)
      .send({ error: { code: 'VALIDATION_OR_INTERNAL' } });
  });
  const mutator = createMutator(db);
  const hooks: { failAfterWork: boolean } = { failAfterWork: false };
  const deps: RouteDependencies = {
    auth: createAuthenticator(db, options_),
    // Test seam: drop the response before commit (the work ran, the Tx rolls back).
    mutator: (context, work) =>
      mutator(context, async (tx) => {
        const result = await work(tx);
        if (hooks.failAfterWork) {
          hooks.failAfterWork = false;
          throw new Error('RESPONSE_LOST_BEFORE_COMMIT');
        }
        return result;
      }),
  };
  registerAssistantRoutes(
    app,
    options_,
    deps,
    options.assembly === false
      ? {}
      : { tools: createAssistantTools({ verifierBuildSha256: fixtureVerifierBuildSha256 }) },
  );
  await app.ready();

  let sequence = 0;
  type CallOptions = {
    operationId?: Id;
    clientSequence?: string;
    providerCallId?: string | null;
    token?: string | null;
    fence?: Partial<TurnFence>;
    pin?: Partial<typeof pin>;
    path?: string;
    extra?: Record<string, unknown>;
  };
  const request = (call: RoutingTool | Record<string, unknown>, opts: CallOptions = {}) => {
    const operationId = opts.operationId ?? randomUUID();
    sequence += 1;
    const body = {
      fence: { ...fence, ...opts.fence },
      operationId,
      clientSequence: opts.clientSequence ?? String(sequence),
      inputSnapshot: { ...pin, ...opts.pin },
      call,
      ...opts.extra,
    };
    const providerCallId = opts.providerCallId === undefined ? `toolu_${operationId}` : opts.providerCallId;
    const token = opts.token === undefined ? tokens.a : opts.token;
    return { operationId, body, providerCallId, token, path: opts.path ?? fence.turnId };
  };
  const send = (prepared: ReturnType<typeof request>) =>
    app.inject({
      method: 'POST',
      url: `/v2/assistant/turns/${prepared.path}/tools`,
      payload: prepared.body,
      headers: {
        ...(prepared.token === null ? {} : { authorization: `Bearer ${prepared.token}` }),
        ...(prepared.providerCallId === null ? {} : { 'x-crew-provider-call-id': prepared.providerCallId }),
      },
    });
  const call = (tool: RoutingTool | Record<string, unknown>, opts: CallOptions = {}) => {
    const prepared = request(tool, opts);
    return send(prepared).then((response) => ({ ...prepared, response }));
  };
  const counts = async () => {
    const [row] = await db`select
      (select count(*)::int from assistant_tool_operations) as operations,
      (select count(*)::int from workflow_runs) as runs,
      (select count(*)::int from tickets) as tickets,
      (select count(*)::int from dependencies) as dependencies,
      (select count(*)::int from assistant_questions) as questions,
      (select count(*)::int from assistant_doc_read_receipts) as receipts,
      (select count(*)::int from events) as events,
      (select count(*)::int from idempotency where route=${route}) as replies`;
    return { ...row };
  };
  const operation = async (operationId: Id) => {
    const [row] = await db`select operation_id,turn_id,client_sequence::text,provider_call_id,request_hash,
      input_snapshot_id,state,response,xmin::text as xmin from assistant_tool_operations where operation_id=${operationId}`;
    return row;
  };
  const runInput = {
    rootTicketId: root.id,
    path: 'architectural',
    definitionSha256: vector.superpowers.definition.sha256,
  };
  // Independent oracle for the create_run request: the accepted producer read on its own Tx.
  const createRunOracle = async (operationId: Id) => {
    const resolver = createPersistedAssistantActorResolver({
      verifierBuildSha256: fixtureVerifierBuildSha256,
    });
    const runs = createWorkflowRuns({ port: createProjectOrchestrationPort({ resolver }), resolver });
    return db.begin((tx) => runs.createRunRequest(tx, operationId, runInput as never));
  };
  const [turn] = await db`select conversation_id from assistant_turns where id=${fence.turnId}`;
  const conversationId = String(turn?.conversation_id);
  const proposal = (changes: Partial<QuestionProposal> = {}): QuestionProposal => ({
    conversationId,
    ticketId: root.id,
    runId: null,
    stepId: null,
    gateId: null,
    cycleId: null,
    artifactSha256: null,
    question: 'Chủ dự án muốn ưu tiên phạm vi nào?',
    options: ['Phạm vi nhỏ', 'Phạm vi đầy đủ'],
    scopeSha256: questionScopeOracle({
      conversationId,
      rootTicketId: root.id,
      ticketId: root.id,
      runId: null,
      stepId: null,
    }),
    ...changes,
  });
  const seedDocs = async (
    projectId: Id,
    path = 'docs/index.md',
    text = '# Tài liệu\n\nNội dung kiểm thử\n',
  ) => {
    const snapshot = randomUUID();
    const bytes = Buffer.from(text, 'utf8');
    await db`insert into docs_snapshots(id,project_id,import_id,source_commit,snapshot_sha,source_kind,audit_state,audit_report,content_class)
      values(${snapshot},${projectId},null,${'a'.repeat(40)},${createHash('sha256').update(snapshot).digest('hex')},
      'checkout_sync','verified','{}','implemented')`;
    await db`insert into docs_files(snapshot_id,path,content_class,bytes,sha,title,search_text)
      values(${snapshot},${path},'implemented',${bytes},${createHash('sha256').update(bytes).digest('hex')},'Tài liệu',${text})`;
    const [row] = await db`select received_at from docs_snapshots where id=${snapshot}`;
    if (!row) throw new Error('DOCS_FIXTURE_MISSING');
    return {
      snapshotId: snapshot,
      path,
      text,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      receivedAt: (row.received_at as Date).toISOString(),
    };
  };
  const closeAttachments = f.close;
  return {
    ...f,
    app,
    hooks,
    tokens,
    ids,
    root,
    otherRoot,
    fence,
    pin,
    scopeId,
    snapshotId,
    conversationId,
    request,
    send,
    call,
    counts,
    operation,
    runInput,
    createRunOracle,
    proposal,
    seedDocs,
    async close() {
      await app.close();
      // The attachment fixture removes its own scratch root after its ownership checks.
      await closeAttachments();
    },
  };
}
type ToolsFixture = Awaited<ReturnType<typeof toolsFixture>>;

async function withTools(options: FixtureOptions, fn: (f: ToolsFixture, db: Db) => Promise<void>) {
  await withDatabase(async (db) => {
    const f = await toolsFixture(db, options);
    try {
      await fn(f, db);
    } finally {
      await f.close();
    }
  });
}

const catalog: RoutingTool = { name: 'read_catalog', input: {} };
const uniform = { code: 'ASSISTANT_SCOPE_NOT_FOUND' };

test('assistant tools: production assembly without tools is 503 and writes nothing', async () =>
  withTools({ assembly: false }, async (f) => {
    const before = await f.counts();
    const { response } = await f.call(catalog);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'ASSISTANT_TOOLS_NOT_CONFIGURED');
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: authentication and provider call ID come before any authority', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const missing = await f.call(catalog, { token: null });
    assert.equal(missing.response.statusCode, 401);
    const bad = await f.call(catalog, { token: 'f'.repeat(64) });
    assert.equal(bad.response.statusCode, 401);
    for (const providerCallId of [null, '', 'a b', 'x'.repeat(4097), 'gọi-tool'])
      assert.equal(
        (await f.call(catalog, { providerCallId })).response.statusCode,
        400,
        `provider ${JSON.stringify(providerCallId)?.slice(0, 20)}`,
      );
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: every failure before proof → scope resolution has one shape', async () =>
  withTools({}, async (f, db) => {
    const before = await f.counts();
    const unknownTurn = randomUUID();
    const variants: [string, Parameters<ToolsFixture['call']>[1]][] = [
      ['path turn differs from fence', { path: randomUUID() }],
      ['unknown turn', { fence: { turnId: unknownTurn }, path: unknownTurn }],
      ['wrong generation', { fence: { generation: String(BigInt(f.fence.generation) + 1n) } }],
      ['wrong process instance', { fence: { processInstanceId: randomUUID() } }],
      ['wrong designation', { fence: { designationId: randomUUID() } }],
      ['wrong designation revision', { fence: { designationRevision: f.fence.designationRevision + 1 } }],
      ['unknown input snapshot', { pin: { snapshotId: randomUUID() } }],
      ['authenticated machine is not the designated Assistant', { token: f.tokens.c }],
      ['project machine B is not the designated Assistant', { token: f.tokens.b }],
    ];
    const shapes = [];
    for (const [label, opts] of variants) {
      const { response } = await f.call(catalog, opts);
      shapes.push({ label, status: response.statusCode, body: response.json() });
    }
    // An expired scope of the same turn reads exactly like a missing one. The scope row is
    // immutable, so the test-only tamper bypasses its identity trigger in a replica session.
    await db.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update assistant_scopes set expires_at=clock_timestamp()-interval '1 second' where id=${f.scopeId}`;
    });
    const expired = (await f.call(catalog)).response;
    shapes.push({ label: 'expired scope', status: expired.statusCode, body: expired.json() });
    const first = shapes[0];
    assert.equal(first?.status, 404);
    assert.equal(first?.body.error.code, uniform.code);
    for (const shape of shapes)
      assert.deepEqual(
        { status: shape.status, body: shape.body },
        { status: first?.status, body: first?.body },
        shape.label,
      );
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: unknown tool, extra fields and forged results are rejected without rows', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const cases: [string, Record<string, unknown>, Parameters<ToolsFixture['call']>[1]?][] = [
      ['unknown tool', { name: 'run_shell', input: { command: 'id' } }],
      ['extra tool field', { name: 'read_catalog', input: {}, approved: true }],
      ['extra input field', { name: 'read_catalog', input: { all: true } }],
      ['forged approval in body', catalog, { extra: { result: { kind: 'run' } } }],
      ['bad operation id', catalog, { operationId: 'not-a-uuid' }],
      ['bad client sequence', catalog, { clientSequence: '0' }],
    ];
    for (const [label, tool, opts] of cases)
      assert.equal((await f.call(tool, opts)).response.statusCode, 400, label);
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: stale input pin is 409 after scope resolution and writes nothing', async () =>
  withTools({}, async (f, db) => {
    const before = await f.counts();
    for (const pin of [
      { snapshotSha256: 'f'.repeat(64) },
      { selectionSha256: 'e'.repeat(64) },
      { inputRevision: '2' },
    ]) {
      const { response } = await f.call(catalog, { pin });
      assert.equal(response.statusCode, 409, JSON.stringify(pin));
      assert.equal(response.json().error.code, 'ASSISTANT_INPUT_STALE');
    }
    // The root's input moved on after the snapshot was taken.
    await db`insert into attachment_input_revisions(target_kind,target_id,revision,route_revision)
      values('ticket',${f.root.id},2,0) on conflict(target_kind,target_id) do update set revision=2`;
    const { response } = await f.call(catalog);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'ASSISTANT_INPUT_STALE');
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: a tool outside the scope tool_names is 403 without rows', async () =>
  withTools({ tools: ['read_catalog', 'create_run'] }, async (f) => {
    const before = await f.counts();
    for (const tool of [
      { name: 'ask_owner', input: f.proposal() },
      {
        name: 'read_docs',
        input: { projectId: f.project.id, snapshotId: randomUUID(), path: 'docs/index.md' },
      },
      {
        name: 'request_review',
        input: {
          runId: randomUUID(),
          implementationStepId: randomUUID(),
          implementationAttemptId: randomUUID(),
        },
      },
    ] as RoutingTool[]) {
      const { response } = await f.call(tool);
      assert.equal(response.statusCode, 403, tool.name);
      assert.equal(response.json().error.code, 'ASSISTANT_TOOL_NOT_IN_SCOPE');
    }
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: the per-turn tool budget denies the next call but not the replay', async () =>
  withTools({ maxToolsPerTurn: 1 }, async (f) => {
    const first = await f.call(catalog);
    assert.equal(first.response.statusCode, 200);
    const after = await f.counts();
    const second = await f.call(catalog);
    assert.equal(second.response.statusCode, 409);
    assert.equal(second.response.json().error.code, 'ASSISTANT_TOOL_BUDGET_EXHAUSTED');
    assert.deepEqual(await f.counts(), after);
    const replay = await f.send(first);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), first.response.json());
    assert.deepEqual(await f.counts(), after);
  }));

test('assistant tools: read_catalog returns the scoped catalog and stores the bound result', async () =>
  withTools({}, async (f, db) => {
    const docs = await f.seedDocs(f.project.id);
    const { operationId, providerCallId, body, response } = await f.call(catalog);
    assert.equal(response.statusCode, 200);
    const [project] = await db`select key,name from projects where id=${f.project.id}`;
    const expected = {
      operationId,
      state: 'completed',
      result: {
        kind: 'catalog',
        items: [
          {
            projectId: f.project.id,
            key: String(project?.key),
            name: String(project?.name),
            latestSnapshotId: docs.snapshotId,
            sourceCommit: 'a'.repeat(40),
          },
        ],
      },
      errorCode: null,
    };
    assert.deepEqual(response.json(), expected);
    const row = await f.operation(operationId);
    assert.equal(row?.turn_id, f.fence.turnId);
    assert.equal(row?.client_sequence, body.clientSequence);
    assert.equal(row?.provider_call_id, providerCallId);
    assert.equal(row?.input_snapshot_id, f.snapshotId);
    assert.equal(row?.state, 'completed');
    assert.equal(row?.request_hash, requestOracle('read_catalog', {}));
    assert.deepEqual(row?.response, expected);
  }));

test('assistant tools: read_docs returns the page with a read receipt; foreign and unknown are one 404', async () =>
  withTools({}, async (f, db) => {
    const docs = await f.seedDocs(f.project.id);
    const input = { projectId: f.project.id, snapshotId: docs.snapshotId, path: docs.path };
    const { operationId, response } = await f.call({ name: 'read_docs', input });
    assert.equal(response.statusCode, 200);
    const value = response.json();
    const page: DocRead = {
      projectId: f.project.id,
      snapshotId: docs.snapshotId,
      path: docs.path,
      sha256: docs.sha256,
      sourceCommit: 'a'.repeat(40),
      receivedAt: docs.receivedAt,
      auditState: 'verified',
      contentClass: 'implemented',
      text: docs.text,
      state: 'current',
    };
    assert.deepEqual(value, {
      operationId,
      state: 'completed',
      result: { kind: 'docs', page, readReceiptId: value.result.readReceiptId },
      errorCode: null,
    });
    const receipts = await db`select id,turn_id,snapshot_id,path,sha256 from assistant_doc_read_receipts`;
    assert.deepEqual(
      receipts.map((row) => ({ ...row })),
      [
        {
          id: value.result.readReceiptId,
          turn_id: f.fence.turnId,
          snapshot_id: docs.snapshotId,
          path: docs.path,
          sha256: docs.sha256,
        },
      ],
    );
    assert.equal((await f.operation(operationId))?.request_hash, requestOracle('read_docs', input));
    // A project outside the root scope reads exactly like a project that does not exist.
    const other = randomUUID();
    await db`insert into projects(id,key,name) values(${other},${`O${other.slice(0, 8).toUpperCase()}`},'Khác')`;
    const otherDocs = await f.seedDocs(other);
    const before = await f.counts();
    const foreign = await f.call({
      name: 'read_docs',
      input: { projectId: other, snapshotId: otherDocs.snapshotId, path: otherDocs.path },
    });
    const unknown = await f.call({
      name: 'read_docs',
      input: { projectId: randomUUID(), snapshotId: randomUUID(), path: otherDocs.path },
    });
    const missingPath = await f.call({
      name: 'read_docs',
      input: { projectId: f.project.id, snapshotId: docs.snapshotId, path: 'docs/khong-co.md' },
    });
    assert.equal(foreign.response.statusCode, 404);
    assert.deepEqual(foreign.response.json(), unknown.response.json());
    assert.equal(unknown.response.statusCode, 404);
    assert.equal(missingPath.response.statusCode, 404);
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: create_run through the real route creates the graph as machine A once', async () =>
  withTools({}, async (f, db) => {
    const before = await f.counts();
    // The oracle plans the graph from the rows before the run exists.
    const planned = randomUUID();
    const oracle = await f.createRunOracle(planned);
    const { operationId, response } = await f.call({ name: 'create_run', input: f.runInput } as RoutingTool, {
      operationId: planned,
    });
    assert.equal(response.statusCode, 200, response.body);
    const value = response.json();
    assert.equal(value.operationId, operationId);
    assert.equal(value.state, 'completed');
    assert.equal(value.errorCode, null);
    assert.equal(value.result.kind, 'run');
    const run = value.result.run;
    assert.equal(run.rootTicketId, f.root.id);
    assert.equal(run.path, 'architectural');
    assert.ok(run.steps.length > 0);
    const row = await f.operation(operationId);
    assert.equal(row?.state, 'completed');
    assert.deepEqual(row?.response, value);
    // The row is bound to the exact create_run request with the server-derived graph digest.
    assert.equal(row?.request_hash, requestOracle('create_run', oracle.payload));
    assert.equal(row?.request_hash, operationRequestSha256(oracle));
    const tickets =
      await db`select created_actor_kind,created_actor_id from tickets where parent_id=${f.root.id}`;
    assert.equal(tickets.length, run.steps.length);
    for (const ticket of tickets)
      assert.deepEqual({ ...ticket }, { created_actor_kind: 'machine', created_actor_id: f.ids.a });
    // Journal actor of the whole mutation is the authenticated Assistant machine A.
    const [reply] = await db`select actor_kind,actor_id,key from idempotency where route=${route}`;
    assert.deepEqual({ ...reply }, { actor_kind: 'machine', actor_id: f.ids.a, key: operationId });
    const after = await f.counts();
    assert.equal(after.runs, before.runs + 1);
    assert.equal(after.operations, before.operations + 1);
    assert.equal(after.tickets, before.tickets + run.steps.length);
  }));

test('assistant tools: create_run on a root outside the scope is one 404 without ticket probing', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const foreign = await f.call({
      name: 'create_run',
      input: { ...f.runInput, rootTicketId: f.otherRoot.id },
    } as RoutingTool);
    const unknown = await f.call({
      name: 'create_run',
      input: { ...f.runInput, rootTicketId: randomUUID() },
    } as RoutingTool);
    assert.equal(foreign.response.statusCode, 404);
    assert.deepEqual(foreign.response.json(), unknown.response.json());
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: ask_owner through the real route opens the question bound to its operation', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const input = f.proposal();
    const { operationId, response } = await f.call({ name: 'ask_owner', input });
    assert.equal(response.statusCode, 200, response.body);
    const value = response.json();
    assert.equal(value.state, 'completed');
    assert.equal(value.result.kind, 'question');
    assert.deepEqual(
      { ...value.result.question, id: undefined },
      { ...input, id: undefined, revision: 1, state: 'open' },
    );
    const row = await f.operation(operationId);
    assert.equal(row?.request_hash, requestOracle('ask_owner', input));
    assert.deepEqual(row?.response, value);
    const after = await f.counts();
    assert.equal(after.questions, before.questions + 1);
    assert.equal(after.operations, before.operations + 1);
  }));

test('assistant tools: ask_owner without a ticket is 422 and a late failure rolls the row back', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const noTicket = await f.call({ name: 'ask_owner', input: f.proposal({ ticketId: null }) });
    assert.equal(noTicket.response.statusCode, 422);
    assert.equal(noTicket.response.json().error.code, 'WORKFLOW_QUESTION_TICKET_REQUIRED');
    // Failure after the pending row was written (conversation of another turn): all or nothing.
    const late = await f.call({ name: 'ask_owner', input: f.proposal({ conversationId: randomUUID() }) });
    assert.equal(late.response.statusCode, 409);
    assert.equal(await f.operation(late.operationId), undefined);
    assert.deepEqual(await f.counts(), before);
  }));

test('assistant tools: unreleased tools are rejected with a bound row and no effect', async () =>
  withTools({}, async (f) => {
    const tools = [
      {
        name: 'request_review',
        input: {
          runId: randomUUID(),
          implementationStepId: randomUUID(),
          implementationAttemptId: randomUUID(),
        },
      },
      { name: 'read_execution_candidates', input: { ticketId: f.root.id, runId: randomUUID() } },
      {
        name: 'request_dispatch',
        input: {
          stepId: randomUUID(),
          assessmentId: randomUUID(),
          chosen: { machineId: f.ids.b, runtime: 'claude', providerId: 'anthropic', modelId: 'claude-test' },
          priorAttemptId: null,
        },
      },
    ] as RoutingTool[];
    for (const tool of tools) {
      const before = await f.counts();
      const { operationId, response } = await f.call(tool);
      assert.equal(response.statusCode, 200, `${tool.name}: ${response.body}`);
      const expected = { operationId, state: 'rejected', result: null, errorCode: 'TOOL_NOT_RELEASED' };
      assert.deepEqual(response.json(), expected);
      const row = await f.operation(operationId);
      assert.equal(row?.state, 'rejected');
      assert.deepEqual(row?.response, expected);
      assert.equal(row?.request_hash, requestOracle(tool.name, tool.input));
      const after = await f.counts();
      assert.deepEqual(after, { ...before, operations: before.operations + 1, replies: before.replies + 1 });
    }
  }));

test('assistant tools: replay returns the stored result without writing; conflicting IDs are 409', async () =>
  withTools({}, async (f) => {
    const first = await f.call({ name: 'create_run', input: f.runInput } as RoutingTool);
    assert.equal(first.response.statusCode, 200);
    const stored = await f.operation(first.operationId);
    const after = await f.counts();
    // Response lost after commit: the exact retry reads the stored result back.
    const replay = await f.send(first);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body, first.response.body);
    assert.deepEqual(await f.operation(first.operationId), stored);
    assert.deepEqual(await f.counts(), after);
    const conflicts: [string, ReturnType<ToolsFixture['request']>, string][] = [
      [
        'same operation, other payload',
        { ...first, body: { ...first.body, call: catalog } },
        'IDEMPOTENCY_CONFLICT',
      ],
      [
        'same operation, other provider call',
        { ...first, providerCallId: 'toolu_other' },
        'IDEMPOTENCY_CONFLICT',
      ],
      [
        'same provider call, new operation',
        f.request(catalog, { providerCallId: first.providerCallId }),
        'ASSISTANT_OPERATION_CONFLICT',
      ],
      [
        'same client sequence, new operation',
        f.request(catalog, { clientSequence: first.body.clientSequence }),
        'ASSISTANT_OPERATION_CONFLICT',
      ],
    ];
    for (const [label, prepared, code] of conflicts) {
      const response = await f.send(prepared);
      assert.equal(response.statusCode, 409, label);
      assert.equal(response.json().error.code, code, label);
    }
    assert.deepEqual(await f.operation(first.operationId), stored);
    assert.deepEqual(await f.counts(), after);
  }));

test('assistant tools: a response lost before commit leaves no effect and the retry applies once', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const prepared = f.request({ name: 'create_run', input: f.runInput } as RoutingTool);
    f.hooks.failAfterWork = true;
    const lost = await f.send(prepared);
    assert.equal(lost.statusCode, 500);
    assert.deepEqual(await f.counts(), before);
    const retried = await f.send(prepared);
    assert.equal(retried.statusCode, 200, retried.body);
    const once = await f.counts();
    assert.equal(once.runs, before.runs + 1);
    assert.equal(once.operations, before.operations + 1);
    const again = await f.send(prepared);
    assert.equal(again.body, retried.body);
    assert.deepEqual(await f.counts(), once);
  }));

test('assistant tools: concurrent duplicates of one operation apply exactly once', async () =>
  withTools({}, async (f) => {
    const before = await f.counts();
    const prepared = f.request({ name: 'create_run', input: f.runInput } as RoutingTool);
    const responses = await Promise.all([f.send(prepared), f.send(prepared), f.send(prepared)]);
    for (const response of responses) {
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.body, responses[0]?.body);
    }
    const after = await f.counts();
    assert.equal(after.runs, before.runs + 1);
    assert.equal(after.operations, before.operations + 1);
  }));
