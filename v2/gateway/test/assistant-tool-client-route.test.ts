import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerAssistantRoutes } from '../../server/src/assistant/routes.ts';
import { createAssistantTools } from '../../server/src/assistant/tools.ts';
import { bootstrapOwner } from '../../server/src/auth/bootstrap.ts';
import { provisionMachine } from '../../server/src/auth/machine.ts';
import { createAuthenticator } from '../../server/src/auth/routes.ts';
import { canonicalJson } from '../../server/src/journal/canonical.ts';
import { createMutator } from '../../server/src/journal/mutation.ts';
import type { Db, RouteDependencies, ServerOptions } from '../../server/src/platform/contracts.ts';
import { ApiError } from '../../server/src/platform/errors.ts';
import { assistantFixture, fixtureVerifierBuildSha256 } from '../../server/test/support/assistant.ts';
import { databaseFixture } from '../../server/test/support/db.ts';
import { inputTicket, owner } from '../../server/test/support/tickets.ts';
import {
  createToolClient,
  type RoutingEvent,
  ToolClientError,
  type ToolTurn,
} from '../src/assistant/tool-client.ts';

// The real `POST /v2/assistant/turns/:id/tools` route (server/src/assistant/tools.ts) on real
// Fastify with the real authenticator, journal mutator, error handler mapping and PostgreSQL,
// driven over TCP by the gateway tool client. Fastify lives in the server package, so it is
// resolved from there instead of adding a dependency to the gateway.
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
type ReplyLike = { code(status: number): { send(body: unknown): unknown } };
type AppLike = {
  setErrorHandler(handler: (error: unknown, request: unknown, reply: ReplyLike) => unknown): void;
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<void>;
  server: { address(): unknown };
};
const Fastify = serverRequire('fastify') as (options: unknown) => AppLike;

const withDatabase = databaseFixture(11);
const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
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

async function routeFixture(db: Db, options: { tools?: string[]; maxToolsPerTurn?: number } = {}) {
  const f = await assistantFixture(db);
  await bootstrapOwner(db, randomBytes(24).toString('hex'));
  const machines = await f.mutation(randomUUID(), async (tx) => ({
    a: await provisionMachine(tx, 'Assistant A'),
    c: await provisionMachine(tx, 'Other C'),
  }));
  const root = await f.mutation(randomUUID(), (tx) =>
    f.services.createTicket(
      tx,
      inputTicket(f.project.id, 'request', null, { kind: 'code', title: 'Yêu cầu chạy workflow' }),
      owner,
    ),
  );
  const submitted = await f.submitMessage();
  const seeded = await f.seedAdmittedTurn({
    conversationId: submitted.conversation.id,
    messageId: null,
    target: { kind: 'ticket', id: root.id },
    machineId: machines.a.machine.id,
    snapshotCanonical: { required: [] },
  });
  const fence = seeded.fence;
  await db`insert into assistant_scopes(id,turn_id,root_ticket_id,message_id,project_id,actions,tool_names,input_snapshot_id,
    scope_sha256,owner_authorization_id,expires_at)
    values(${randomUUID()},${fence.turnId},${root.id},null,${f.project.id},${db.json(['create_ticket', 'dependency'])},
    ${db.json(options.tools ?? allTools)},${seeded.snapshotId},${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '10 minutes')`;
  await db`update assistant_config set policy=policy||${db.json({ maxToolsPerTurn: options.maxToolsPerTurn ?? 64 })}
    where singleton=true`;
  const [snapshot] = await db`select sha256 from attachment_input_snapshots where id=${seeded.snapshotId}`;
  const turn: ToolTurn = {
    fence,
    inputSnapshot: {
      snapshotId: String(seeded.snapshotId),
      snapshotSha256: String(snapshot?.sha256),
      inputRevision: '1',
      selectionSha256: sha([]),
    },
  };
  const serverOptions: ServerOptions = {
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
    // Same options and error mapping as buildApp.
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: 1024 * 1024,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error && typeof error === 'object' && ('validation' in error || 'statusCode' in error))
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Dữ liệu không hợp lệ' } });
    return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } });
  });
  const deps: RouteDependencies = {
    auth: createAuthenticator(db, serverOptions),
    mutator: createMutator(db),
  };
  registerAssistantRoutes(app as never, serverOptions, deps, {
    tools: createAssistantTools({ verifierBuildSha256: fixtureVerifierBuildSha256 }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const stateRoot = await mkdtemp(join(await realpath(tmpdir()), 'crew-b3b-route-'));
  const seedDocs = async (path = 'docs/index.md', text = '# Tài liệu\n') => {
    const snapshot = randomUUID();
    const bytes = Buffer.from(text, 'utf8');
    await db`insert into docs_snapshots(id,project_id,import_id,source_commit,snapshot_sha,source_kind,audit_state,audit_report,content_class)
      values(${snapshot},${f.project.id},null,${'a'.repeat(40)},${createHash('sha256').update(snapshot).digest('hex')},
      'checkout_sync','verified','{}','implemented')`;
    await db`update projects set latest_verified_snapshot_id=${snapshot} where id=${f.project.id}`;
    await db`insert into docs_files(snapshot_id,path,content_class,bytes,sha,title,search_text)
      values(${snapshot},${path},'implemented',${bytes},${createHash('sha256').update(bytes).digest('hex')},'Tài liệu',${text})`;
    return { projectId: f.project.id as string, snapshotId: snapshot, path };
  };
  const clients: { close(): Promise<void> }[] = [];
  const client = async (bearer: string) => {
    const c = await createToolClient({ root: stateRoot, baseUrl, bearer });
    clients.push(c);
    return c;
  };
  return {
    db,
    turn,
    projectId: f.project.id as string,
    tokens: { a: machines.a.token as string, c: machines.c.token as string },
    seedDocs,
    client,
    async close() {
      for (const c of clients) await c.close().catch(() => undefined);
      await app.close();
      await rm(stateRoot, { recursive: true, force: true });
      await f.close();
    },
  };
}
type RouteFixture = Awaited<ReturnType<typeof routeFixture>>;
async function withRoute(
  options: Parameters<typeof routeFixture>[1],
  fn: (f: RouteFixture) => Promise<void>,
) {
  await withDatabase(async (db) => {
    const f = await routeFixture(db, options);
    try {
      await fn(f);
    } finally {
      await f.close();
    }
  });
}
const tool = (call: unknown, providerCallId: string, sequence: string) =>
  ({ kind: 'tool', providerCallId, sequence, call }) as RoutingEvent;
const catalog = (providerCallId = 'toolu_cat', sequence = '1') =>
  tool({ name: 'read_catalog', input: {} }, providerCallId, sequence);
const failure = (kind: string, serverCode: string) => (error: unknown) => {
  assert.ok(error instanceof ToolClientError, String(error));
  assert.equal(error.kind, kind);
  assert.equal(error.serverCode, serverCode);
  return true;
};

test('real route: read_catalog and read_docs complete with the matching values and replay after restart', () =>
  withRoute({}, async (f) => {
    const c = await f.client(f.tokens.a);
    const listed = await c.execute(f.turn, catalog());
    assert.equal(listed.state, 'completed');
    assert.equal(listed.result?.kind, 'catalog');
    assert.equal(listed.result?.truncated, false);
    const items = listed.result?.items as { projectId: string }[];
    assert.ok(items.some((item) => item.projectId === f.projectId));
    const docs = await f.seedDocs();
    const read = await c.execute(
      f.turn,
      tool(
        {
          name: 'read_docs',
          input: { projectId: docs.projectId, snapshotId: docs.snapshotId, path: docs.path },
        },
        'toolu_docs',
        '2',
      ),
    );
    assert.equal(read.state, 'completed');
    assert.equal(read.result?.kind, 'docs');
    assert.match(String(read.result?.readReceiptId), /^[0-9a-f-]{36}$/);
    await c.close();
    const again = await (await f.client(f.tokens.a)).execute(f.turn, catalog());
    assert.deepEqual(again, listed);
  }));

test('real route: an upper-case turn fence is normalised and gives the same operation', () =>
  withRoute({}, async (f) => {
    const c = await f.client(f.tokens.a);
    const first = await c.execute(f.turn, catalog());
    const upper: ToolTurn = {
      ...f.turn,
      fence: {
        ...f.turn.fence,
        turnId: f.turn.fence.turnId.toUpperCase(),
        designationId: f.turn.fence.designationId.toUpperCase(),
        processInstanceId: f.turn.fence.processInstanceId.toUpperCase(),
      },
    };
    assert.deepEqual(await c.execute(upper, catalog()), first);
    const [row] = await f.db`select count(*)::int as n from assistant_tool_operations`;
    assert.equal(row?.n, 1);
  }));

test('real route: an unreleased tool is a rejected result, not an error', () =>
  withRoute({}, async (f) => {
    const c = await f.client(f.tokens.a);
    const result = await c.execute(
      f.turn,
      tool(
        { name: 'read_execution_candidates', input: { ticketId: randomUUID(), runId: randomUUID() } },
        'toolu_x',
        '1',
      ),
    );
    assert.equal(result.state, 'rejected');
    assert.equal(result.errorCode, 'TOOL_NOT_RELEASED');
  }));

test('real route: wrong bearer is 401 unauthorized, not recorded, and the corrected bearer reuses the operation', () =>
  withRoute({}, async (f) => {
    const wrong = await f.client('0'.repeat(64));
    await assert.rejects(wrong.execute(f.turn, catalog()), failure('unauthorized', 'UNAUTHENTICATED'));
    await wrong.close();
    const right = await f.client(f.tokens.a);
    assert.equal((await right.execute(f.turn, catalog())).state, 'completed');
  }));

test('real route: another machine and a stale turn authority are one 404 not_found', () =>
  withRoute({}, async (f) => {
    const other = await f.client(f.tokens.c);
    await assert.rejects(other.execute(f.turn, catalog()), failure('not_found', 'ASSISTANT_SCOPE_NOT_FOUND'));
    await other.close();
    const c = await f.client(f.tokens.a);
    const staleFence: ToolTurn = { ...f.turn, fence: { ...f.turn.fence, generation: '9' } };
    await assert.rejects(
      c.execute(staleFence, catalog('toolu_s', '2')),
      failure('not_found', 'ASSISTANT_SCOPE_NOT_FOUND'),
    );
  }));

test('real route: a stale input pin is 409 stale; a tool outside the scope is 403 forbidden', () =>
  withRoute({ tools: ['read_catalog'] }, async (f) => {
    const c = await f.client(f.tokens.a);
    const stale: ToolTurn = {
      ...f.turn,
      inputSnapshot: { ...f.turn.inputSnapshot, snapshotSha256: sha('other') },
    };
    await assert.rejects(c.execute(stale, catalog()), failure('stale', 'ASSISTANT_INPUT_STALE'));
    await assert.rejects(
      c.execute(
        f.turn,
        tool(
          { name: 'read_docs', input: { projectId: f.projectId, snapshotId: randomUUID(), path: 'a.md' } },
          'toolu_o',
          '2',
        ),
      ),
      failure('forbidden', 'ASSISTANT_TOOL_NOT_IN_SCOPE'),
    );
  }));

test('real route: the per-turn budget is 409 budget for a new call, and a committed call still replays', () =>
  withRoute({ maxToolsPerTurn: 1 }, async (f) => {
    const c = await f.client(f.tokens.a);
    const first = await c.execute(f.turn, catalog());
    await assert.rejects(
      c.execute(f.turn, catalog('toolu_2', '2')),
      failure('budget', 'ASSISTANT_TOOL_BUDGET_EXHAUSTED'),
    );
    assert.deepEqual(await c.execute(f.turn, catalog()), first);
  }));

test('real route: a repeated sequence under another provider call is 409 conflict', () =>
  withRoute({}, async (f) => {
    const c = await f.client(f.tokens.a);
    await c.execute(f.turn, catalog('toolu_1', '1'));
    await assert.rejects(
      c.execute(f.turn, catalog('toolu_2', '1')),
      failure('conflict', 'ASSISTANT_OPERATION_CONFLICT'),
    );
  }));
