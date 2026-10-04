import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createToolClient,
  type RoutingEvent,
  type ToolClient,
  ToolClientError,
  type ToolTurn,
  toolOperationId,
} from '../src/assistant/tool-client.ts';

// Contract-faithful fake of `POST /v2/assistant/turns/:id/tools` (server/src/assistant/tools.ts):
// bearer machine, exactly one `x-crew-provider-call-id` header (visible ASCII, no comma, 1-4096),
// body of exactly five fields, idempotency by operationId over {providerCallId, request}, one
// provider call and one client sequence per turn, and stored byte-identical replies. It is not
// the real Fastify/PostgreSQL route; that route has its own suite.
const bearer = 'machine-bearer-secret-token-0123456789';
const providerPattern = /^[\x21-\x2b\x2d-\x7e]{1,4096}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

type Seen = { url: string; providerHeaders: string[]; auth: string | undefined; body: any };
type Behavior =
  | { kind: 'status'; status: number; body?: unknown; raw?: string; headers?: Record<string, string> }
  | { kind: 'drop' }
  | { kind: 'commit-then-drop' };
type Stored = {
  turnId: string;
  fingerprint: string;
  clientSequence: string;
  providerCallId: string;
  reply: unknown;
};

async function fakeServer() {
  const seen: Seen[] = [];
  const queue: Behavior[] = [];
  const stored = new Map<string, Stored>();
  const hooks: {
    transform?: (reply: any, body: any) => any;
    bearer: string;
    /** Turns whose authority is gone: authorize fails before any replay, like a stale resolver. */
    revoked: Set<string>;
  } = { bearer, revoked: new Set() };
  const sockets = new Set<import('node:net').Socket>();
  const read = (request: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  const server: Server = createServer(async (request, response) => {
    const text = await read(request);
    const providerHeaders: string[] = [];
    for (let i = 0; i + 1 < request.rawHeaders.length; i += 2)
      if (request.rawHeaders[i]?.toLowerCase() === 'x-crew-provider-call-id')
        providerHeaders.push(String(request.rawHeaders[i + 1]));
    const body = JSON.parse(text);
    seen.push({ url: request.url ?? '', providerHeaders, auth: request.headers.authorization, body });
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(payload));
    };
    const fail = (status: number, code: string) => send(status, { error: { code, message: 'x' } });
    const behavior = queue.shift();
    if (behavior?.kind === 'drop') return request.socket.destroy();
    if (behavior?.kind === 'status' && behavior.raw !== undefined) {
      response.writeHead(behavior.status, { 'content-type': 'text/html', ...behavior.headers });
      return response.end(behavior.raw);
    }
    if (behavior?.kind === 'status')
      return send(behavior.status, behavior.body ?? { error: { code: 'X' } }, behavior.headers);
    // Same order as the real route: body schema, bearer, machine, provider header, authorize
    // (turn authority, before any replay), then idempotency and the fresh-operation clash.
    const keys = Object.keys(body).sort().join(',');
    if (keys !== 'call,clientSequence,fence,inputSnapshot,operationId' || !uuidPattern.test(body.operationId))
      return fail(400, 'INVALID_INPUT');
    if (request.headers.authorization !== `Bearer ${hooks.bearer}`) return fail(401, 'UNAUTHENTICATED');
    const [providerCallId] = providerHeaders;
    if (providerHeaders.length !== 1 || !providerPattern.test(providerCallId ?? ''))
      return fail(400, 'PROVIDER_CALL_ID_INVALID');
    const turnId = String(body.fence.turnId).toLowerCase();
    if (request.url?.toLowerCase() !== `/v2/assistant/turns/${turnId}/tools` || hooks.revoked.has(turnId))
      return fail(404, 'ASSISTANT_SCOPE_NOT_FOUND');
    const operationId = String(body.operationId).toLowerCase();
    const fingerprint = canon({ providerCallId, request: body });
    const old = stored.get(operationId);
    if (old) {
      if (old.fingerprint !== fingerprint) return fail(409, 'IDEMPOTENCY_CONFLICT');
      return send(200, old.reply);
    }
    for (const other of stored.values())
      if (
        other.turnId === turnId &&
        (other.clientSequence === body.clientSequence || other.providerCallId === providerCallId)
      )
        return fail(409, 'ASSISTANT_OPERATION_CONFLICT');
    const name = body.call.name as string;
    const released: Record<string, unknown> = {
      read_catalog: { kind: 'catalog', items: [], truncated: false },
      read_docs: {
        kind: 'docs',
        page: { path: body.call.input.path, text: '# Tài liệu' },
        readReceiptId: randomUUID(),
      },
      create_run: { kind: 'run', run: { id: randomUUID() } },
      ask_owner: { kind: 'question', question: { id: randomUUID(), revision: 1, state: 'open' } },
    };
    const reply = released[name]
      ? { operationId, state: 'completed', result: released[name], errorCode: null }
      : { operationId, state: 'rejected', result: null, errorCode: 'TOOL_NOT_RELEASED' };
    const final = hooks.transform ? hooks.transform(reply, body) : reply;
    stored.set(operationId, {
      turnId,
      fingerprint,
      clientSequence: body.clientSequence,
      providerCallId: providerCallId as string,
      reply: final,
    });
    if (behavior?.kind === 'commit-then-drop') return request.socket.destroy();
    return send(200, final);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    queue,
    stored,
    hooks,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');
const turn = (): ToolTurn => ({
  fence: {
    turnId: randomUUID(),
    designationId: randomUUID(),
    designationRevision: 3,
    generation: '7',
    processInstanceId: randomUUID(),
  },
  inputSnapshot: {
    snapshotId: randomUUID(),
    snapshotSha256: sha('snapshot'),
    inputRevision: '1',
    selectionSha256: sha('selection'),
  },
});
const catalogEvent = (
  providerCallId = 'toolu_01',
  sequence = '1',
): Extract<RoutingEvent, { kind: 'tool' }> => ({
  kind: 'tool',
  providerCallId,
  sequence,
  call: { name: 'read_catalog', input: {} },
});

async function harness(options: { maxAttempts?: number } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-b3b-'));
  const server = await fakeServer();
  const clock = { now: 1_000_000 };
  const auth = { current: bearer };
  const sleeps: number[] = [];
  const open = () =>
    createToolClient({
      root,
      baseUrl: server.url,
      bearer: () => auth.current,
      now: () => clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.now += ms;
      },
      ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
    });
  const clients: ToolClient[] = [];
  const client = async () => {
    const c = await open();
    clients.push(c);
    return c;
  };
  const journalFiles = async () =>
    (await readdir(root, { recursive: true }).catch(() => []))
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(root, name));
  return {
    root,
    server,
    clock,
    auth,
    sleeps,
    client,
    journalFiles,
    async done() {
      for (const c of clients) await c.close().catch(() => undefined);
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const kind = (expected: string) => (error: unknown) =>
  error instanceof ToolClientError && error.kind === expected;

test('tool client: read_catalog posts the exact request with the provider header and returns the matching value', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const result = await c.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.deepEqual(result.result, { kind: 'catalog', items: [], truncated: false });
    assert.equal(h.server.seen.length, 1);
    const [seen] = h.server.seen;
    assert.equal(seen?.url, `/v2/assistant/turns/${t.fence.turnId}/tools`);
    assert.deepEqual(seen?.providerHeaders, ['toolu_01']);
    assert.equal(seen?.auth, `Bearer ${bearer}`);
    assert.deepEqual(seen?.body, {
      fence: t.fence,
      operationId: toolOperationId(t.fence.turnId, 'toolu_01', '1'),
      clientSequence: '1',
      inputSnapshot: t.inputSnapshot,
      call: { name: 'read_catalog', input: {} },
    });
    assert.equal(result.operationId, seen?.body.operationId);
  } finally {
    await h.done();
  }
});

test('tool client: operation ID is a deterministic UUID of turn, provider call and sequence', () => {
  const turnId = randomUUID();
  const id = toolOperationId(turnId, 'toolu_a', '5');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(toolOperationId(turnId.toUpperCase(), 'toolu_a', '5'), id);
  assert.notEqual(toolOperationId(turnId, 'toolu_b', '5'), id);
  assert.notEqual(toolOperationId(turnId, 'toolu_a', '6'), id);
  assert.notEqual(toolOperationId(randomUUID(), 'toolu_a', '5'), id);
});

test('tool client: a completed call replays from the journal after restart without a new request', async () => {
  const h = await harness();
  try {
    const t = turn();
    const first = await h.client();
    const result = await first.execute(t, catalogEvent());
    await first.close();
    const second = await h.client();
    assert.deepEqual(await second.execute(t, catalogEvent()), result);
    assert.equal(h.server.seen.length, 1);
  } finally {
    await h.done();
  }
});

test('tool client: the operation is durable before the HTTP call and a restart reuses its ID and body', async () => {
  const h = await harness();
  try {
    const t = turn();
    h.server.queue.push({ kind: 'drop' });
    const first = await h.client();
    await assert.rejects(first.execute(t, catalogEvent(), { maxAttempts: 1 }), kind('unavailable'));
    assert.equal(h.server.seen.length, 1);
    assert.ok((await h.journalFiles()).length > 0, 'journal record exists after the lost send');
    await first.close();
    const second = await h.client();
    const result = await second.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.equal(h.server.seen.length, 2);
    assert.equal(canon(h.server.seen[0]?.body), canon(h.server.seen[1]?.body));
    assert.equal(h.server.seen[1]?.body.operationId, toolOperationId(t.fence.turnId, 'toolu_01', '1'));
  } finally {
    await h.done();
  }
});

test('tool client: invalid events are rejected before any I/O', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const tool = (call: unknown, extra: Record<string, unknown> = {}) =>
      ({ kind: 'tool', providerCallId: 'toolu_x', sequence: '1', call, ...extra }) as unknown as RoutingEvent;
    const docs = { projectId: randomUUID(), snapshotId: randomUUID(), path: 'docs/index.md' };
    const cases: [string, RoutingEvent][] = [
      ['unknown tool', tool({ name: 'delete_everything', input: {} })],
      ['extra input field', tool({ name: 'read_catalog', input: { extra: 1 } })],
      ['extra call field', tool({ name: 'read_catalog', input: {}, forged: true })],
      ['extra event field', tool({ name: 'read_catalog', input: {} }, { approved: true })],
      ['bad uuid', tool({ name: 'read_docs', input: { ...docs, projectId: 'nope' } })],
      ['empty path', tool({ name: 'read_docs', input: { ...docs, path: '' } })],
      ['missing field', tool({ name: 'read_docs', input: { projectId: docs.projectId } })],
      [
        'confidence range',
        tool({
          name: 'route_message',
          input: {
            messageId: randomUUID(),
            expectedInputRevision: '1',
            expectedRouteRevision: 0,
            ticket: {},
            confidence: 2,
            rationale: 'r',
            docReadIds: [],
          },
        }),
      ],
      ['finished is not a tool call', { kind: 'finished', outcome: 'completed' }],
      ['empty provider id', { ...catalogEvent(), providerCallId: '' }],
      ['comma provider id', { ...catalogEvent(), providerCallId: 'a,b' }],
      ['space provider id', { ...catalogEvent(), providerCallId: 'a b' }],
      ['non-ascii provider id', { ...catalogEvent(), providerCallId: 'toolé' }],
      ['newline provider id', { ...catalogEvent(), providerCallId: 'a\r\nx: y' }],
      ['long provider id', { ...catalogEvent(), providerCallId: 'a'.repeat(4097) }],
      ['sequence zero', { ...catalogEvent(), sequence: '0' }],
      ['sequence leading zero', { ...catalogEvent(), sequence: '01' }],
      ['sequence over bigint', { ...catalogEvent(), sequence: '9223372036854775808' }],
      [
        'unexpected key `token` outside the ask_owner shape (shape check, not a secret scan)',
        tool({
          name: 'ask_owner',
          input: {
            conversationId: randomUUID(),
            ticketId: null,
            runId: null,
            stepId: null,
            gateId: null,
            cycleId: null,
            artifactSha256: null,
            question: 'q',
            options: [],
            scopeSha256: sha('s'),
            token: 'leak',
          },
        }),
      ],
    ];
    for (const [label, event] of cases) await assert.rejects(c.execute(t, event), kind('invalid'), label);
    await assert.rejects(
      c.execute({ ...t, fence: { ...t.fence, generation: '0' } }, catalogEvent()),
      kind('invalid'),
    );
    await assert.rejects(
      c.execute({ ...t, fence: { ...t.fence, extra: 1 } as never }, catalogEvent()),
      kind('invalid'),
    );
    await assert.rejects(
      c.execute({ ...t, inputSnapshot: { ...t.inputSnapshot, snapshotSha256: 'zz' } }, catalogEvent()),
      kind('invalid'),
    );
    assert.equal(h.server.seen.length, 0);
    assert.deepEqual(await h.journalFiles(), []);
  } finally {
    await h.done();
  }
});

test('tool client: valid payloads of every released and unreleased tool are accepted', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const key = { machineId: randomUUID(), runtime: 'claude', providerId: 'p', modelId: 'm' };
    const pin = t.inputSnapshot;
    const calls = [
      { name: 'read_docs', input: { projectId: randomUUID(), snapshotId: randomUUID(), path: 'docs/a.md' } },
      { name: 'read_execution_candidates', input: { ticketId: randomUUID(), runId: randomUUID() } },
      {
        name: 'assess_ticket',
        input: {
          ticketId: randomUUID(),
          candidateReadOperationId: randomUUID(),
          input: pin,
          complexity: 'bounded',
          risk: [],
          uncertainty: [],
          required: [],
          strengthRationale: 'r',
          sources: [],
          candidateReasons: [],
          chosen: key,
          choiceRationale: 'c',
        },
      },
      {
        name: 'create_run',
        input: { rootTicketId: randomUUID(), path: 'bounded', definitionSha256: sha('d') },
      },
      {
        name: 'request_dispatch',
        input: { stepId: randomUUID(), assessmentId: randomUUID(), chosen: key, priorAttemptId: null },
      },
      {
        name: 'request_review',
        input: {
          runId: randomUUID(),
          implementationStepId: randomUUID(),
          implementationAttemptId: randomUUID(),
        },
      },
      {
        name: 'publish_reply',
        input: {
          messageId: randomUUID(),
          inputRevision: '1',
          snapshotId: randomUUID(),
          receiptIds: [],
          text: 'xin chào',
          sources: [{ kind: 'docs', id: randomUUID() }],
        },
      },
    ];
    let sequence = 1;
    for (const call of calls) {
      const result = await c.execute(t, {
        kind: 'tool',
        providerCallId: `toolu_${sequence}`,
        sequence: String(sequence++),
        call,
      } as unknown as RoutingEvent);
      if (call.name === 'read_docs' || call.name === 'create_run') {
        assert.equal(result.state, 'completed', call.name);
        assert.equal(result.result?.kind, call.name === 'read_docs' ? 'docs' : 'run');
        continue;
      }
      assert.equal(result.state, 'rejected', call.name);
      assert.equal(result.errorCode, 'TOOL_NOT_RELEASED');
      assert.equal(result.result, null);
    }
    assert.equal(h.server.seen.length, calls.length);
  } finally {
    await h.done();
  }
});

test('tool client: 5xx and network loss retry the identical request with bounded backoff', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    h.server.queue.push({ kind: 'status', status: 503 }, { kind: 'drop' }, { kind: 'status', status: 500 });
    const result = await c.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.equal(h.server.seen.length, 4);
    assert.equal(new Set(h.server.seen.map((s) => canon(s.body))).size, 1);
    assert.ok(
      h.server.seen.every((s) => s.providerHeaders.length === 1 && s.providerHeaders[0] === 'toolu_01'),
    );
    assert.ok(
      h.sleeps.length >= 3 &&
        h.sleeps.every((ms, i) => ms >= 1000 && (i === 0 || ms >= (h.sleeps[i - 1] ?? 0))),
    );
    assert.ok(h.sleeps.every((ms) => ms <= 61_000));
  } finally {
    await h.done();
  }
});

test('tool client: a reply lost after the server committed is read back from the stored result', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    h.server.queue.push({ kind: 'commit-then-drop' });
    const result = await c.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.equal(h.server.stored.size, 1);
    assert.equal(h.server.seen.length, 2);
  } finally {
    await h.done();
  }
});

test('tool client: persistent outage is bounded and retryable, then recovers with the same operation', async () => {
  const h = await harness({ maxAttempts: 3 });
  try {
    const c = await h.client();
    const t = turn();
    for (let i = 0; i < 20; i += 1) h.server.queue.push({ kind: 'status', status: 503 });
    await assert.rejects(c.execute(t, catalogEvent()), (error) => {
      assert.ok(error instanceof ToolClientError);
      assert.equal(error.kind, 'unavailable');
      assert.equal(error.retryable, true);
      return true;
    });
    assert.equal(h.server.seen.length, 3, 'one request per attempt, none wasted');
    h.server.queue.length = 0;
    await c.close();
    const second = await h.client();
    h.clock.now += 120_000;
    const result = await second.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.equal(new Set(h.server.seen.map((s) => s.body.operationId)).size, 1);
  } finally {
    await h.done();
  }
});

test('tool client: terminal HTTP statuses are not retried and are replayed after restart without I/O', async () => {
  const table: [number, string, string][] = [
    [400, 'INVALID_INPUT', 'invalid'],
    [400, 'ASSISTANT_FENCE_INVALID', 'invalid'],
    [400, 'PROVIDER_CALL_ID_INVALID', 'invalid'],
    [403, 'ASSISTANT_MACHINE_REQUIRED', 'forbidden'],
    [403, 'ASSISTANT_TOOL_NOT_IN_SCOPE', 'forbidden'],
    [404, 'ASSISTANT_SCOPE_NOT_FOUND', 'not_found'],
    [404, 'NOT_FOUND', 'not_found'],
    [409, 'ASSISTANT_INPUT_STALE', 'stale'],
    [409, 'IDEMPOTENCY_CONFLICT', 'conflict'],
    [409, 'ASSISTANT_OPERATION_CONFLICT', 'conflict'],
    [409, 'WORKFLOW_RUN_EXISTS', 'conflict'],
    [409, 'ASSISTANT_TOOL_BUDGET_EXHAUSTED', 'budget'],
    [422, 'WORKFLOW_QUESTION_TICKET_REQUIRED', 'rejected'],
  ];
  for (const [status, code, expected] of table) {
    const h = await harness();
    try {
      const c = await h.client();
      const t = turn();
      h.server.queue.push({ kind: 'status', status, body: { error: { code, message: 'secret-detail' } } });
      await assert.rejects(c.execute(t, catalogEvent()), (error) => {
        assert.ok(error instanceof ToolClientError);
        assert.equal(error.kind, expected, `${status} ${code}`);
        assert.equal(error.status, status);
        assert.equal(error.serverCode, code);
        assert.equal(error.retryable, false);
        assert.ok(!error.message.includes('secret-detail'));
        return true;
      });
      assert.equal(h.server.seen.length, 1, `${status} ${code} not retried`);
      await c.close();
      const second = await h.client();
      await assert.rejects(second.execute(t, catalogEvent()), kind(expected));
      assert.equal(h.server.seen.length, 1, 'recorded terminal response replays without I/O');
    } finally {
      await h.done();
    }
  }
});

test('tool client: only the matching result kind and a well-formed envelope are accepted', async () => {
  const bad: [string, (reply: any) => unknown][] = [
    ['wrong kind', (r) => ({ ...r, result: { kind: 'docs', page: {}, readReceiptId: randomUUID() } })],
    ['wrong operation id', (r) => ({ ...r, operationId: randomUUID() })],
    ['completed without result', (r) => ({ ...r, result: null })],
    ['extra field', (r) => ({ ...r, extra: 1 })],
    ['extra value field', (r) => ({ ...r, result: { ...r.result, extra: 1 } })],
    ['truncated missing', (r) => ({ ...r, result: { kind: 'catalog', items: [] } })],
    ['items not array', (r) => ({ ...r, result: { kind: 'catalog', items: {}, truncated: false } })],
    ['errorCode on completed', (r) => ({ ...r, errorCode: 'X' })],
    ['unknown state', (r) => ({ ...r, state: 'done' })],
    ['not an object', () => 'ok'],
  ];
  for (const [label, mutate] of bad) {
    const h = await harness();
    try {
      h.server.hooks.transform = (reply) => mutate(reply);
      const c = await h.client();
      await assert.rejects(c.execute(turn(), catalogEvent()), kind('response_invalid'), label);
    } finally {
      await h.done();
    }
  }
  const h = await harness();
  try {
    // rejected needs an error code and no value; pending carries no value.
    h.server.hooks.transform = (reply, body) => ({
      ...reply,
      state: 'pending',
      result: null,
      errorCode: null,
      operationId: body.operationId,
    });
    const c = await h.client();
    const pending = await c.execute(turn(), catalogEvent());
    assert.equal(pending.state, 'pending');
  } finally {
    await h.done();
  }
});

test('tool client: the same provider call with a different payload is a local conflict without I/O', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    await c.execute(t, {
      kind: 'tool',
      providerCallId: 'toolu_dup',
      sequence: '1',
      call: { name: 'read_docs', input: { projectId: randomUUID(), snapshotId: randomUUID(), path: 'a.md' } },
    });
    const sent = h.server.seen.length;
    await assert.rejects(
      c.execute(t, {
        kind: 'tool',
        providerCallId: 'toolu_dup',
        sequence: '1',
        call: {
          name: 'read_docs',
          input: { projectId: randomUUID(), snapshotId: randomUUID(), path: 'b.md' },
        },
      }),
      kind('conflict'),
    );
    assert.equal(h.server.seen.length, sent);
  } finally {
    await h.done();
  }
});

test('tool client: the bearer never reaches durable files or error messages', async () => {
  const h = await harness({ maxAttempts: 2 });
  try {
    const c = await h.client();
    h.server.queue.push(
      { kind: 'status', status: 503 },
      { kind: 'status', status: 503 },
      { kind: 'status', status: 503 },
    );
    const error = await c.execute(turn(), catalogEvent()).catch((e) => e);
    assert.ok(error instanceof ToolClientError);
    assert.ok(!String(error.message).includes(bearer));
    assert.ok(!JSON.stringify(error).includes(bearer));
    for (const file of await h.journalFiles()) assert.ok(!(await readFile(file, 'utf8')).includes(bearer));
  } finally {
    await h.done();
  }
});

test('tool client: unsafe server URLs are refused', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-b3b-'));
  try {
    for (const url of ['http://example.com', 'ftp://127.0.0.1', 'http://localhost:1'])
      await assert.rejects(createToolClient({ root, baseUrl: url, bearer }), /UNSAFE_SERVER_URL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type Harness = Awaited<ReturnType<typeof harness>>;
const sent = (h: Harness) => h.server.seen.length;
const rotated = 'rotated-bearer-secret-token-9876543210';

test('tool client: 401 is not recorded; with a refreshed credential the same operation is sent again', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    h.server.hooks.bearer = rotated;
    await assert.rejects(c.execute(t, catalogEvent()), (error) => {
      assert.ok(error instanceof ToolClientError);
      assert.equal(error.kind, 'unauthorized');
      assert.equal(error.status, 401);
      assert.equal(error.serverCode, 'UNAUTHENTICATED');
      assert.equal(error.retryable, true);
      return true;
    });
    assert.equal(sent(h), 1, '401 is not retried inside one call');
    h.auth.current = rotated;
    const result = await c.execute(t, catalogEvent());
    assert.equal(result.state, 'completed');
    assert.equal(sent(h), 2);
    assert.equal(canon(h.server.seen[0]?.body), canon(h.server.seen[1]?.body));
    assert.equal(h.server.seen[1]?.auth, `Bearer ${rotated}`);
    for (const file of await h.journalFiles()) {
      const text = await readFile(file, 'utf8');
      assert.ok(!text.includes('rotated-bearer') && !text.includes(bearer));
    }
  } finally {
    await h.done();
  }
});

test('tool client: 408, 425, 429 and plain 503 retry with exact attempt counts and never close the operation', async () => {
  for (const [status, code] of [
    [408, 'REQUEST_TIMEOUT'],
    [425, 'TOO_EARLY'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ] as const) {
    const h = await harness();
    try {
      const c = await h.client();
      const t = turn();
      for (let i = 0; i < 4; i += 1)
        h.server.queue.push({ kind: 'status', status, body: { error: { code, message: 'x' } } });
      await assert.rejects(c.execute(t, catalogEvent(), { maxAttempts: 3 }), (error) => {
        assert.ok(error instanceof ToolClientError);
        assert.equal(error.kind, 'unavailable', String(status));
        assert.equal(error.retryable, true);
        return true;
      });
      assert.equal(sent(h), 3, `${status}: one request per attempt`);
      assert.equal(h.sleeps.length, 2);
      await assert.rejects(c.execute(t, catalogEvent(), { maxAttempts: 1 }), kind('unavailable'));
      assert.equal(sent(h), 4, `${status}: a single attempt sends exactly one request`);
      assert.equal((await c.execute(t, catalogEvent())).state, 'completed', `${status}: not poisoned`);
      assert.equal(new Set(h.server.seen.map((s) => canon(s.body))).size, 1);
    } finally {
      await h.done();
    }
  }
});

test('tool client: 429 honours Retry-After seconds, capped at one minute', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    h.server.queue.push(
      { kind: 'status', status: 429, headers: { 'retry-after': '7' } },
      { kind: 'status', status: 429, headers: { 'retry-after': '3600' } },
    );
    const result = await c.execute(turn(), catalogEvent());
    assert.equal(result.state, 'completed');
    assert.deepEqual(h.sleeps, [7000, 60000]);
    assert.equal(sent(h), 3);
  } finally {
    await h.done();
  }
});

test('tool client: 413 and unlisted 4xx are infrastructure errors that do not close the operation', async () => {
  for (const status of [413, 405, 410]) {
    const h = await harness();
    try {
      const c = await h.client();
      const t = turn();
      h.server.queue.push({
        kind: 'status',
        status,
        body: { error: { code: 'BODY_TOO_LARGE', message: 'x' } },
      });
      await assert.rejects(c.execute(t, catalogEvent()), (error) => {
        assert.ok(error instanceof ToolClientError);
        assert.equal(error.kind, 'rejected');
        assert.equal(error.status, status);
        assert.equal(error.retryable, false);
        return true;
      });
      assert.equal(sent(h), 1);
      assert.equal((await c.execute(t, catalogEvent())).state, 'completed', `${status}: not poisoned`);
    } finally {
      await h.done();
    }
  }
});

test('tool client: 503 not-configured stops retrying but keeps the operation open', async () => {
  for (const code of ['ASSISTANT_TOOLS_NOT_CONFIGURED', 'ASSISTANT_POLICY_INVALID']) {
    const h = await harness();
    try {
      const c = await h.client();
      const t = turn();
      h.server.queue.push({ kind: 'status', status: 503, body: { error: { code, message: 'x' } } });
      await assert.rejects(c.execute(t, catalogEvent()), (error) => {
        assert.ok(error instanceof ToolClientError);
        assert.equal(error.kind, 'not_configured');
        assert.equal(error.serverCode, code);
        assert.equal(error.retryable, false);
        return true;
      });
      assert.equal(sent(h), 1);
      assert.deepEqual(h.sleeps, []);
      await c.close();
      const later = await h.client();
      assert.equal((await later.execute(t, catalogEvent())).state, 'completed');
      assert.equal(sent(h), 2);
      assert.equal(canon(h.server.seen[0]?.body), canon(h.server.seen[1]?.body));
    } finally {
      await h.done();
    }
  }
});

test('tool client: a redirect is a terminal configuration error, not retried and not recorded', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    h.server.queue.push({ kind: 'status', status: 302, headers: { location: 'http://127.0.0.1:1/x' } });
    await assert.rejects(c.execute(t, catalogEvent()), (error) => {
      assert.ok(error instanceof ToolClientError);
      assert.equal(error.kind, 'misconfigured');
      assert.equal(error.status, 302);
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(sent(h), 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal((await c.execute(t, catalogEvent())).state, 'completed');
  } finally {
    await h.done();
  }
});

test('tool client: released tools complete with their matching docs, run and question values', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const docs = await c.execute(t, {
      kind: 'tool',
      providerCallId: 'toolu_d',
      sequence: '1',
      call: {
        name: 'read_docs',
        input: { projectId: randomUUID(), snapshotId: randomUUID(), path: 'docs/a.md' },
      },
    });
    assert.equal(docs.result?.kind, 'docs');
    const run = await c.execute(t, {
      kind: 'tool',
      providerCallId: 'toolu_r',
      sequence: '2',
      call: {
        name: 'create_run',
        input: { rootTicketId: randomUUID(), path: 'bounded', definitionSha256: sha('d') },
      },
    });
    assert.equal(run.result?.kind, 'run');
    const question = await c.execute(t, {
      kind: 'tool',
      providerCallId: 'toolu_q',
      sequence: '3',
      call: {
        name: 'ask_owner',
        input: {
          conversationId: randomUUID(),
          ticketId: randomUUID(),
          runId: null,
          stepId: null,
          gateId: null,
          cycleId: null,
          artifactSha256: null,
          question: 'Chọn phạm vi nào?',
          options: ['a', 'b'],
          scopeSha256: sha('scope'),
        },
      },
    });
    assert.equal(question.result?.kind, 'question');
  } finally {
    await h.done();
  }
});

test('tool client: a UUID fence in upper case is normalised, so the same turn never conflicts with itself', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const upper: ToolTurn = {
      fence: {
        ...t.fence,
        turnId: t.fence.turnId.toUpperCase(),
        designationId: t.fence.designationId.toUpperCase(),
        processInstanceId: t.fence.processInstanceId.toUpperCase(),
      },
      inputSnapshot: { ...t.inputSnapshot, snapshotId: t.inputSnapshot.snapshotId.toUpperCase() },
    };
    const first = await c.execute(upper, catalogEvent());
    const second = await c.execute(t, catalogEvent());
    assert.deepEqual(second, first);
    assert.equal(sent(h), 1, 'the second spelling replays from the journal');
    assert.deepEqual(h.server.seen[0]?.body.fence, t.fence);
    assert.equal(h.server.seen[0]?.url, `/v2/assistant/turns/${t.fence.turnId}/tools`);
    assert.equal(h.server.seen[0]?.body.operationId, toolOperationId(t.fence.turnId, 'toolu_01', '1'));
  } finally {
    await h.done();
  }
});

test('tool client: secret-looking keys of business payloads are allowed', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const ticket = { title: 't', criteria: { password: 'rotate-me', secret: { token: 'x' } } };
    const result = await c.execute(turn(), {
      kind: 'tool',
      providerCallId: 'toolu_s',
      sequence: '1',
      call: {
        name: 'route_message',
        input: {
          messageId: randomUUID(),
          expectedInputRevision: '1',
          expectedRouteRevision: 0,
          ticket,
          confidence: 0.5,
          rationale: 'r',
          docReadIds: [],
        },
      },
    });
    assert.equal(result.state, 'rejected');
    assert.deepEqual(h.server.seen[0]?.body.call.input.ticket, ticket);
  } finally {
    await h.done();
  }
});

test('tool client: a changed fence or pin for an already journaled call is a local conflict without I/O', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    await c.execute(t, catalogEvent());
    for (const changed of [
      { ...t, fence: { ...t.fence, generation: '8' } },
      { ...t, inputSnapshot: { ...t.inputSnapshot, inputRevision: '2' } },
    ])
      await assert.rejects(c.execute(changed, catalogEvent()), kind('conflict'));
    assert.equal(sent(h), 1);
  } finally {
    await h.done();
  }
});

test('tool client: a turn without current authority is 404 not_found even for a new operation', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    await c.execute(t, catalogEvent());
    h.server.hooks.revoked.add(t.fence.turnId.toLowerCase());
    await assert.rejects(c.execute(t, catalogEvent('toolu_02', '2')), (error) => {
      assert.ok(error instanceof ToolClientError);
      assert.equal(error.kind, 'not_found');
      assert.equal(error.serverCode, 'ASSISTANT_SCOPE_NOT_FOUND');
      return true;
    });
  } finally {
    await h.done();
  }
});

test('tool client: concurrent executes of one call agree on a single stored result', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    const t = turn();
    const [a, b] = await Promise.all([c.execute(t, catalogEvent()), c.execute(t, catalogEvent())]);
    assert.deepEqual(a, b);
    assert.equal(h.server.stored.size, 1);
  } finally {
    await h.done();
  }
});

test('tool client: a root already opened by another client is refused', async () => {
  const h = await harness();
  try {
    await h.client();
    await assert.rejects(h.client());
  } finally {
    await h.done();
  }
});

test('tool client: 404, 403, 400 and 409 without a route error code are not recorded and keep the operation open', async () => {
  const fastify404 = {
    message: 'Route POST:/v2/assistant/turns/x/tools not found',
    error: 'Not Found',
    statusCode: 404,
  };
  const cases: [string, Behavior][] = [
    ['fastify default 404', { kind: 'status', status: 404, body: fastify404 }],
    ['404 empty json', { kind: 'status', status: 404, body: {} }],
    ['403 without a code', { kind: 'status', status: 403, body: { message: 'Forbidden' } }],
    ['400 html from a proxy', { kind: 'status', status: 400, raw: '<html><body>Bad Request</body></html>' }],
    [
      '409 foreign code',
      { kind: 'status', status: 409, body: { error: { code: 'PROXY_CONFLICT', message: 'x' } } },
    ],
    ['422 without a code', { kind: 'status', status: 422, raw: 'nope' }],
    [
      '404 with a code of another status',
      { kind: 'status', status: 404, body: { error: { code: 'ASSISTANT_INPUT_STALE' } } },
    ],
  ];
  for (const [label, behavior] of cases) {
    const h = await harness();
    try {
      const c = await h.client();
      const t = turn();
      h.server.queue.push(behavior);
      await assert.rejects(c.execute(t, catalogEvent()), (error) => {
        assert.ok(error instanceof ToolClientError, label);
        assert.equal(error.kind, 'misconfigured', label);
        assert.equal(error.retryable, false, label);
        return true;
      });
      assert.equal(sent(h), 1, `${label}: not retried`);
      assert.deepEqual(h.sleeps, []);
      assert.equal((await c.execute(t, catalogEvent())).state, 'completed', `${label}: not poisoned`);
      assert.equal(sent(h), 2);
    } finally {
      await h.done();
    }
  }
});

test('tool client: Retry-After never shortens the backoff', async () => {
  const h = await harness();
  try {
    const c = await h.client();
    h.server.queue.push(
      { kind: 'status', status: 429, headers: { 'retry-after': '0' } },
      { kind: 'status', status: 429, headers: { 'retry-after': '0' } },
      { kind: 'status', status: 429, headers: { 'retry-after': '1' } },
    );
    assert.equal((await c.execute(turn(), catalogEvent())).state, 'completed');
    assert.deepEqual(h.sleeps, [1000, 2000, 4000]);
  } finally {
    await h.done();
  }
});

test('tool client: an invalid credential is unauthorized, never sent and never retried', async () => {
  for (const credential of ['', 'abc\r\nx-evil: 1', 'a b', 'tok\u00e9n', 'x\n']) {
    const h = await harness();
    try {
      const c = await h.client();
      h.auth.current = credential;
      await assert.rejects(c.execute(turn(), catalogEvent()), (error) => {
        assert.ok(error instanceof ToolClientError);
        assert.equal(error.kind, 'unauthorized', JSON.stringify(credential));
        assert.equal(error.retryable, true);
        assert.ok(!error.message.includes('evil'));
        return true;
      });
      assert.equal(sent(h), 0);
      assert.deepEqual(h.sleeps, []);
    } finally {
      await h.done();
    }
  }
});
