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
