import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiProviderConfig } from '../src/models/contracts.ts';
import { parseProtocol, validateEndpoint } from '../src/models/probe.ts';

const provider: ApiProviderConfig = {
  id: 'provider',
  endpoint: 'https://provider.example/v1/',
  protocol: 'responses',
  models: [{ id: 'chosen', declared: ['text', 'tools', 'vision'] }],
  credentialStatus: 'stored',
  localHttp: null,
};
test('model probe separates Responses and Chat Completions and rejects model/tool mismatches', () => {
  assert.deepEqual(
    parseProtocol(
      'responses',
      {
        model: 'chosen',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      },
      'chosen',
    ),
    ['text'],
  );
  assert.deepEqual(
    parseProtocol(
      'chat-completions',
      {
        model: 'chosen',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'crew_probe_echo', arguments: '{"value":"fixture"}' },
                },
              ],
            },
          },
        ],
      },
      'chosen',
    ),
    ['tools'],
  );
  assert.throws(() => parseProtocol('responses', { model: 'wrong', output: [] }, 'chosen'), /MODEL_MISMATCH/);
  assert.throws(
    () =>
      parseProtocol(
        'responses',
        {
          model: 'chosen',
          status: 'completed',
          output: [{ type: 'function_call', name: 'crew_probe_echo', call_id: 'x', arguments: 'invalid' }],
        },
        'chosen',
      ),
    /TOOL_PROTOCOL/,
  );
  assert.throws(
    () => parseProtocol('chat-completions', { model: 'chosen', output: [] }, 'chosen'),
    /PROTOCOL/,
  );
});
test('model probe mirrors server canonical endpoint/local HTTP policy', () => {
  assert.equal(validateEndpoint(provider).href, provider.endpoint);
  for (const endpoint of [
    'https://127.0.0.1/v1/',
    'https://localhost/v1/',
    'https://provider.example/v1/?x=1',
    'https://provider.example:443/v1/',
    'http://127.0.0.1:1234/v1/',
  ])
    assert.throws(() => validateEndpoint({ ...provider, endpoint }), /ENDPOINT_INVALID/);
  assert.equal(
    validateEndpoint({
      ...provider,
      endpoint: 'http://127.0.0.1:1234/v1/',
      localHttp: { enabled: true, allowedOrigin: 'http://127.0.0.1:1234' },
    }).port,
    '1234',
  );
});

import { initialStatus, type ProjectionPin, type SourcePin } from '../src/host/status.ts';
import { ModelInventory } from '../src/models/inventory.ts';
import { ModelProber, parseStream } from '../src/models/probe.ts';

const source: SourcePin = {
  name: 'bmad',
  version: '1',
  sourceRevision: 'revision',
  sourceUrl: 'https://example.com/source',
  payloadSha256: 'a'.repeat(64),
  packageIntegrity: null,
  sourceManifestSha256: 'b'.repeat(64),
  sourceTreeSha256: 'c'.repeat(64),
};
const projection: ProjectionPin = {
  runtime: 'api',
  sourceTreeSha256: source.sourceTreeSha256,
  manifestSha256: 'd'.repeat(64),
  treeSha256: 'e'.repeat(64),
  derivation: {
    tool: 'fixture',
    version: '1',
    options: [],
    layoutSchema: 'v1',
    policySha256: 'f'.repeat(64),
  },
};
const key = { machineId: 'machine', runtime: 'api' as const, providerId: 'provider', modelId: 'chosen' };
const context = {
  sourceTreeSha256: source.sourceTreeSha256,
  projectionManifestSha256: projection.manifestSha256,
  projectionTreeSha256: projection.treeSha256,
  derivationSha256: '9d1a1641d7e401d04351e03ec03ae84037d3c870ec8a680821c41bd63936d645',
  binarySha256: '2'.repeat(64),
  policySha256: 'f'.repeat(64),
  osVersion: 'fixture-os',
};
const reply = {
  model: 'chosen',
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'fixture' }] }],
};
const ports = { context: async () => ({ context, version: 'fixture' }), provider: () => provider };
test('model probe offline never grants capability; CLI missing and unauthorized live stay UNVERIFIED', async () => {
  const prober = new ModelProber({
    ...ports,
    offline: async () => ({ status: 200, body: reply, retryAfter: null, streamed: false }),
  });
  const result = await prober.probeModel(key, { source, projection }, 'offline');
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.capabilities, []);
  assert.equal(
    (await prober.probeModel(key, { source, projection }, 'authorized-live')).errorCode,
    'LIVE_NOT_AUTHORIZED',
  );
  const absent = new ModelProber({ ...ports, context: async () => null });
  assert.equal(
    (
      await absent.probeModel(
        { ...key, runtime: 'codex' },
        { source, projection: { ...projection, runtime: 'codex' } },
        'offline',
      )
    ).errorCode,
    'CLI_ABSENT',
  );
});
test('model probe authorized response maps auth/quota/network errors without leaking and bounds deadlines', async () => {
  for (const [status, code] of [
    [401, 'AUTH'],
    [429, 'QUOTA'],
    [503, 'TRANSIENT'],
  ] as const) {
    const prober = new ModelProber({
      ...ports,
      authorizedLive: {
        authorize: async () => true,
        call: async () => ({ status, body: 'private-provider-body', retryAfter: '2', streamed: false }),
      },
    });
    const result = await prober.probeModel(key, { source, projection }, 'authorized-live');
    assert.equal(result.errorCode, code);
    assert.equal(JSON.stringify(result).includes('private-provider-body'), false);
  }
  const prober = new ModelProber({
    ...ports,
    deadlineMs: 15,
    authorizedLive: {
      authorize: async () => true,
      call: async (_key, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('private-secret'))),
        ),
    },
  });
  const result = await prober.probeModel(key, { source, projection }, 'authorized-live');
  assert.equal(result.errorCode, 'TRANSIENT');
});
test('model probe text PASS does not infer files/vision/tools; tool execution requires exact correlation', async () => {
  const prober = new ModelProber({
    ...ports,
    authorizedLive: {
      authorize: async () => true,
      call: async () => ({ status: 200, body: reply, retryAfter: null, streamed: false }),
    },
  });
  assert.deepEqual((await prober.probeModel(key, { source, projection }, 'authorized-live')).capabilities, [
    'text',
  ]);
  const tools = {
    model: 'chosen',
    status: 'completed',
    output: [
      { type: 'function_call', name: 'crew_probe_echo', call_id: 'call-1', arguments: '{"value":"fixture"}' },
    ],
  };
  const bad = new ModelProber({
    ...ports,
    authorizedLive: {
      authorize: async () => true,
      call: async () => ({
        status: 200,
        body: tools,
        retryAfter: null,
        streamed: false,
        toolExecution: { callId: 'call-1', resultCallId: 'wrong', value: 'fixture' },
      }),
    },
  });
  assert.equal(
    (await bad.probeModel(key, { source, projection }, 'authorized-live')).errorCode,
    'TOOL_PROTOCOL',
  );
});
test('model probe inventory preserves owner API models, skips OFF/missing pair and invalidates context by bytes/pins', async () => {
  const workflows = initialStatus().workflows;
  workflows.bmad = {
    source: { state: 'current', installed: source, lastError: null, observedAt: null },
    projections: {
      ...workflows.bmad.projections,
      api: { state: 'current', installed: projection, lastError: null, observedAt: null },
    },
  };
  const inventory = new ModelInventory({
    machineId: 'machine',
    prober: new ModelProber(ports),
    catalogue: async () => ['catalogue-is-not-entitlement'],
  });
  const config = {
    revision: 1,
    enabled: { claude: false, codex: false, api: true },
    apiProviders: [provider],
  };
  const results = await inventory.collectInventory(config, workflows);
  assert.deepEqual(
    results.map((r) => r.key.modelId),
    ['chosen'],
  );
  assert.equal(results[0]?.status, 'unverified');
  assert.deepEqual(
    await inventory.collectInventory({ ...config, enabled: { ...config.enabled, api: false } }, workflows),
    [],
  );
  assert.deepEqual(await inventory.collectInventory(config, initialStatus().workflows), []);
  assert.equal(
    (
      await new ModelProber({
        ...ports,
        context: async () => ({
          context: { ...context, projectionTreeSha256: '0'.repeat(64) },
          version: 'fixture',
        }),
      }).probeModel(key, { source, projection }, 'offline')
    ).errorCode,
    'CONTEXT_MISMATCH',
  );
});
test('model probe stream parser requires complete bounded framing and exact model', () => {
  assert.deepEqual(
    parseStream(
      'responses',
      `data: ${JSON.stringify({ type: 'response.completed', response: reply })}\n\n`,
      'chosen',
    ),
    reply,
  );
  assert.throws(
    () =>
      parseStream(
        'responses',
        `data: ${JSON.stringify({ type: 'response.completed', response: reply })}`,
        'chosen',
      ),
    /STREAM_PROTOCOL/,
  );
  assert.throws(
    () =>
      parseStream(
        'responses',
        `data: ${JSON.stringify({ type: 'response.completed', response: { ...reply, model: 'wrong' } })}\n\n`,
        'chosen',
      ),
    /MODEL_MISMATCH/,
  );
});

import { assertPublicAddress, buildProbeRequest } from '../src/models/provider-transport.ts';

test('model probe DNS guard rejects private/reserved/mapped addresses and request pins owner model', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.2.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '192.0.2.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
  ])
    assert.throws(() => assertPublicAddress(address), /SSRF_DENIED/);
  assert.doesNotThrow(() => assertPublicAddress('8.8.8.8'));
  assert.doesNotThrow(() => assertPublicAddress('2606:4700:4700::1111'));
  const request = buildProbeRequest(provider, 'chosen') as { model: string };
  assert.equal(request.model, 'chosen');
  assert.throws(() => buildProbeRequest(provider, 'undeclared'), /MODEL_NOT_CONFIGURED/);
});

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { CredentialBroker } from '../src/models/credential-broker.ts';
import { PinnedProviderTransport } from '../src/models/provider-transport.ts';

test('model probe pinned transport uses one-use credential channel and bounded local HTTP response', async () => {
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    calls.push(JSON.parse(Buffer.concat(chunks).toString()));
    assert.equal(req.headers.authorization, 'Bearer transport-fixture');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port,
    origin = `http://127.0.0.1:${port}`;
  const transport = new PinnedProviderTransport({
    ...provider,
    endpoint: `${origin}/v1/`,
    localHttp: { enabled: true, allowedOrigin: origin },
  });
  const items = new Map<string, Buffer>();
  const broker = new CredentialBroker(
    randomUUID(),
    {
      read: async (s, a) => {
        const value = items.get(`${s}/${a}`);
        return value ? Buffer.from(value) : null;
      },
      put: async (s, a, b) => {
        items.set(`${s}/${a}`, Buffer.from(b));
      },
      remove: async (s, a) => {
        items.delete(`${s}/${a}`);
      },
    },
    [transport.deliver],
  );
  try {
    const ref = await broker.put(randomUUID(), Buffer.from('transport-fixture'));
    const result = await transport.call('chosen', broker, ref, AbortSignal.timeout(1000));
    assert.deepEqual(result.body, reply);
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { model: string }).model, 'chosen');
    await broker.remove(ref);
    assert.equal(items.size, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('model probe IPv6 guard canonicalizes zero-padded special ranges', () => {
  for (const address of ['2001:0db8::1', '2001:0000::1', '2001:0010::1', '3fff::1', '192.88.99.1'])
    assert.throws(() => assertPublicAddress(address), /SSRF_DENIED/);
  assert.doesNotThrow(() => assertPublicAddress('192.2.1.1'));
});
test('model probe correlated tools and explicit measured vision grant only their recorded capabilities', async () => {
  const body = {
    model: 'chosen',
    status: 'completed',
    output: [
      { type: 'function_call', name: 'crew_probe_echo', call_id: 'call-1', arguments: '{"value":"fixture"}' },
    ],
  };
  const prober = new ModelProber({
    ...ports,
    authorizedLive: {
      authorize: async () => true,
      call: async () => ({
        status: 200,
        body,
        retryAfter: null,
        streamed: false,
        toolExecution: { callId: 'call-1', resultCallId: 'call-1', value: 'fixture' },
        imageObserved: true,
      }),
    },
  });
  assert.deepEqual((await prober.probeModel(key, { source, projection }, 'authorized-live')).capabilities, [
    'tools',
    'vision',
  ]);
});
test('model probe Chat stream correlates fragments and requires done plus terminal reason', () => {
  const frame = (delta: unknown, finish_reason: string | null) =>
    `data: ${JSON.stringify({ model: 'chosen', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const text =
    frame({ role: 'assistant', content: 'fix' }, null) +
    frame({ content: 'ture' }, 'stop') +
    'data: [DONE]\n\n';
  assert.deepEqual(
    parseProtocol('chat-completions', parseStream('chat-completions', text, 'chosen'), 'chosen'),
    ['text'],
  );
  assert.throws(
    () => parseStream('chat-completions', text.replace('data: [DONE]\n\n', ''), 'chosen'),
    /STREAM_PROTOCOL/,
  );
});

import { pinnedLookup } from '../src/models/provider-transport.ts';

test('model probe pinned DNS socket lookup honors Node all-address contract without new DNS', () => {
  const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 });
  lookup('provider.example', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
  });
  lookup('provider.example', { family: 4 }, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '8.8.8.8');
    assert.equal(family, 4);
  });
});

function responseStreamEvents(): Record<string, unknown>[] {
  const fn = {
    id: 'fc-fixture',
    type: 'function_call',
    call_id: 'call-fixture',
    name: 'crew_probe_echo',
    arguments: '{"value":"fixture"}',
    status: 'completed',
  };
  const part = { type: 'output_text', text: 'fixture', annotations: [], logprobs: [] };
  const msg = { id: 'msg-fixture', type: 'message', role: 'assistant', status: 'completed', content: [part] };
  const response = { id: 'resp-fixture', model: 'chosen', status: 'in_progress', output: [] };
  return [
    { type: 'response.created', response },
    { type: 'response.in_progress', response },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...fn, arguments: '', status: 'in_progress' },
    },
    { type: 'response.function_call_arguments.delta', item_id: fn.id, output_index: 0, delta: '{"value":' },
    { type: 'response.function_call_arguments.delta', item_id: fn.id, output_index: 0, delta: '"fixture"}' },
    {
      type: 'response.function_call_arguments.done',
      item_id: fn.id,
      output_index: 0,
      arguments: fn.arguments,
    },
    { type: 'response.output_item.done', output_index: 0, item: fn },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: { ...msg, status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: msg.id,
      output_index: 1,
      content_index: 0,
      part: { ...part, text: '' },
    },
    {
      type: 'response.output_text.delta',
      item_id: msg.id,
      output_index: 1,
      content_index: 0,
      delta: 'fix',
      logprobs: [],
    },
    {
      type: 'response.output_text.delta',
      item_id: msg.id,
      output_index: 1,
      content_index: 0,
      delta: 'ture',
      logprobs: [],
    },
    {
      type: 'response.output_text.done',
      item_id: msg.id,
      output_index: 1,
      content_index: 0,
      text: 'fixture',
      logprobs: [],
    },
    { type: 'response.content_part.done', item_id: msg.id, output_index: 1, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 1, item: msg },
    {
      type: 'response.completed',
      response: { ...response, status: 'completed', output: [fn, msg], usage: { total_tokens: 5 } },
    },
  ];
}
function responseWire(events: Record<string, unknown>[]): string {
  return events
    .map(
      (event, sequence_number) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ sequence_number, ...event })}\n\n`,
    )
    .join('');
}
test('FIX1 R4 SSE accepts LF CRLF CR mixed endings and BOM but retains raw bound and final blank frame', () => {
  const responses = `data: ${JSON.stringify({ type: 'response.completed', response: reply })}\n\n`;
  const chat = `data: ${JSON.stringify({ model: 'chosen', choices: [{ index: 0, delta: { content: 'fixture' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  for (const [protocol, wire] of [
    ['responses', responses],
    ['chat-completions', chat],
  ] as const) {
    for (const ending of ['\n', '\r\n', '\r'])
      assert.doesNotThrow(() => parseStream(protocol, wire.replaceAll('\n', ending), 'chosen'));
    assert.doesNotThrow(() => parseStream(protocol, `\ufeff${wire.replace('\n', '\r\n')}`, 'chosen'));
    assert.throws(() => parseStream(protocol, wire.slice(0, -1), 'chosen'), /STREAM_PROTOCOL/);
    assert.throws(
      () => parseStream(protocol, `:${'x'.repeat(1048576)}\r\n\r\n${wire}`, 'chosen'),
      /STREAM_PROTOCOL/,
    );
  }
});
test('FIX1 R5 Responses correlates multi-fragment tool and text with lifecycle metadata and terminal body', () => {
  const events = responseStreamEvents(),
    completed = events.at(-1)?.response;
  assert.deepEqual(parseStream('responses', responseWire(events), 'chosen'), completed);
  assert.deepEqual(parseProtocol('responses', completed, 'chosen'), ['tools', 'text']);
});
test('FIX1 R5 nullable annotation metadata is correlated with final text', () => {
  const events = responseStreamEvents();
  for (const e of events) {
    const part = e.part as Record<string, unknown> | undefined;
    if (part) part.annotations = [null];
  }
  const msg = events[13]?.item as Record<string, unknown>;
  const content = (msg.content as Record<string, unknown>[])[0];
  assert.ok(content);
  content.annotations = [null];
  events.splice(11, 0, {
    type: 'response.output_text.annotation.added',
    item_id: msg.id,
    output_index: 1,
    content_index: 0,
    annotation_index: 0,
    annotation: null,
  });
  assert.doesNotThrow(() => parseStream('responses', responseWire(events), 'chosen'));
});
test('FIX1 R5 Responses rejects orphan duplicate conflicting and terminal-failure sequences', () => {
  const mutations: ((events: Record<string, unknown>[]) => void)[] = [
    (e) => {
      e.splice(3, 0, {
        type: 'response.function_call_arguments.delta',
        item_id: 'orphan',
        output_index: 99,
        delta: 'bad',
      });
    },
    (e) => {
      e.splice(3, 0, structuredClone(e[2] ?? {}));
    },
    (e) => {
      const r = e[1]?.response as Record<string, unknown>;
      r.id = 'other-response';
    },
    (e) => {
      const r = e[1]?.response as Record<string, unknown>;
      r.model = 'wrong';
    },
    (e) => {
      e[3] = { ...e[3], item_id: 'other-item' };
    },
    (e) => {
      e[4] = { ...e[4], delta: '"different"}' };
    },
    (e) => {
      e[5] = { ...e[5], arguments: '{"value":"different"}' };
    },
    (e) => {
      const item = e[6]?.item as Record<string, unknown>;
      item.call_id = 'other-call';
    },
    (e) => {
      e[10] = { ...e[10], delta: 'different' };
    },
    (e) => {
      const r = e.at(-1)?.response as Record<string, unknown>;
      r.id = 'other-response';
    },
    (e) => {
      e.splice(2, 0, {
        type: 'response.failed',
        response: { id: 'resp-fixture', model: 'chosen', status: 'failed' },
      });
    },
    (e) => {
      e.splice(2, 0, {
        type: 'response.incomplete',
        response: { id: 'resp-fixture', model: 'chosen', status: 'incomplete' },
      });
    },
    (e) => {
      e.splice(2, 0, { type: 'error', code: 'fixture-failed', message: 'fixture-sensitive' });
    },
    (e) => {
      e[4] = { ...e[4], sequence_number: 2 };
    },
    (e) => {
      e.splice(5, 1);
    },
    (e) => {
      e[3] = { ...e[3], response_id: 'other-response' };
    },
    (e) => {
      const r = e.at(-1)?.response as Record<string, unknown>;
      r.output = [];
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const events = structuredClone(responseStreamEvents());
    mutate(events);
    assert.throws(
      () => parseStream('responses', responseWire(events), 'chosen'),
      /STREAM_PROTOCOL|TOOL_PROTOCOL|MODEL_MISMATCH|PROTOCOL/,
      `mutation ${index}`,
    );
  }
});

test('FIX1 R6 broker transport prober preserves closed protocol/size/SSRF outcomes and redacts unknown errors', async () => {
  let mode = 'tool',
    hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (mode === 'network') {
      req.socket.destroy();
      return;
    }
    if (mode === '401' || mode === '429' || mode === '503') {
      res.statusCode = Number(mode);
      res.end('fixture-sensitive-response');
      return;
    }
    res.setHeader('content-type', 'application/json');
    const body =
      mode === 'tool'
        ? {
            ...reply,
            output: [
              {
                type: 'function_call',
                name: 'crew_probe_echo',
                call_id: 'x',
                arguments: 'fixture-sensitive-invalid-json',
              },
            ],
          }
        : mode === 'model'
          ? { ...reply, model: 'wrong' }
          : mode === 'size'
            ? { ...reply, padding: 'x'.repeat(1048576) }
            : reply;
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`,
    p = {
      ...provider,
      endpoint: `${origin}/v1/`,
      localHttp: { enabled: true as const, allowedOrigin: origin },
    };
  const local = new PinnedProviderTransport(p),
    denied = new PinnedProviderTransport({ ...provider, endpoint: 'https://localhost./v1/' });
  const values = new Map<string, Buffer>(),
    readBuffers: Buffer[] = [];
  const unsafe = async () => {
    throw new Error('fixture-sensitive-callback');
  };
  const broker = new CredentialBroker(
    randomUUID(),
    {
      read: async (s, a) => {
        const v = values.get(s + a);
        if (!v) return null;
        const b = Buffer.from(v);
        readBuffers.push(b);
        return b;
      },
      put: async (s, a, b) => {
        values.set(s + a, Buffer.from(b));
      },
      remove: async (s, a) => {
        values.delete(s + a);
      },
    },
    [local.deliver, denied.deliver, unsafe],
  );
  try {
    const ref = await broker.put(randomUUID(), Buffer.from('fixture-sensitive-secret'));
    for (const [kind, expected] of [
      ['tool', 'TOOL_PROTOCOL'],
      ['model', 'MODEL_MISMATCH'],
      ['size', 'RESPONSE_TOO_LARGE'],
      ['401', 'AUTH'],
      ['429', 'QUOTA'],
      ['503', 'TRANSIENT'],
      ['network', 'TRANSIENT'],
    ] as const) {
      mode = kind;
      const before = hits;
      const prober = new ModelProber({
        ...ports,
        provider: () => p,
        offline: (_key, signal) => local.call('chosen', broker, ref, signal),
        deadlineMs: 2000,
      });
      const result = await prober.probeModel(key, { source, projection }, 'offline');
      assert.equal(result.errorCode, expected, kind);
      assert.equal(hits, before + 1);
      assert.equal(JSON.stringify(result).includes('fixture-sensitive'), false);
      assert.ok(readBuffers.every((b) => b.every((n) => n === 0)));
    }
    const prober = new ModelProber({
      ...ports,
      provider: () => ({ ...provider, endpoint: 'https://localhost./v1/' }),
      offline: (_key, signal) => denied.call('chosen', broker, ref, signal),
      deadlineMs: 2000,
    });
    assert.equal((await prober.probeModel(key, { source, projection }, 'offline')).errorCode, 'SSRF_DENIED');
    await assert.rejects(broker.withSecret(ref, unsafe), /^Error: CREDENTIAL_TRANSPORT_FAILED$/);
    assert.ok(readBuffers.every((b) => b.every((n) => n === 0)));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('FIX1 R5 documented response_id and optional function status remain correlated', () => {
  const events = structuredClone(responseStreamEvents()).slice(2);
  for (const event of events) {
    event.response_id = 'resp-fixture';
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === 'function_call') delete item.status;
  }
  const response = events.at(-1)?.response as Record<string, unknown>;
  for (const item of response.output as Record<string, unknown>[])
    if (item.type === 'function_call') delete item.status;
  assert.doesNotThrow(() => parseStream('responses', responseWire(events), 'chosen'));
  events[1] = { ...events[1], response_id: 'foreign' };
  assert.throws(() => parseStream('responses', responseWire(events), 'chosen'), /STREAM_PROTOCOL/);
});
