import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import type { ApiCredentialBindings, ApiProviderConfig, SourceConfig } from '../src/models/contracts.ts';
import { CredentialBroker } from '../src/models/credential-broker.ts';
import { CurrentCredentialResolver } from '../src/models/current-credential-resolver.ts';
import { PinnedProviderTransport } from '../src/models/provider-transport.ts';

async function fixture() {
  const machineId = randomUUID(),
    providerId = randomUUID(),
    values = new Map<string, Buffer>();
  const provider: ApiProviderConfig = {
    id: providerId,
    endpoint: 'https://example.com/v1/',
    protocol: 'responses',
    models: [{ id: 'chosen', declared: ['text'] }],
    credentialStatus: 'stored',
    localHttp: null,
  };
  const desired: SourceConfig = {
    revision: 2,
    enabled: { claude: false, codex: false, api: true },
    apiProviders: [provider],
  };
  const binding: ApiCredentialBindings = {
    machineId,
    configRevision: 2,
    apiEnabled: true,
    providers: [
      {
        providerId,
        endpoint: provider.endpoint,
        protocol: provider.protocol,
        status: 'stored',
        credentialRef: null,
        currentOperationId: null,
      },
    ],
  };
  const bridge = {
    async put(s: string, a: string, b: Buffer) {
      values.set(s + a, Buffer.from(b));
    },
    async read(s: string, a: string) {
      const b = values.get(s + a);
      return b ? Buffer.from(b) : null;
    },
    async remove(s: string, a: string) {
      values.delete(s + a);
    },
  };
  const requests: string[] = [];
  let onRead: (path: string) => void = () => {};
  const read = async (path: string) => {
    requests.push(path);
    onRead(path);
    return structuredClone(path === '/v2/machine/model-sources' ? desired : binding);
  };
  const broker = new CredentialBroker(machineId, bridge, []);
  const currentBinding = binding.providers[0];
  assert.ok(currentBinding);
  currentBinding.credentialRef = await broker.put(providerId, Buffer.from('fixture-only'));
  return {
    machineId,
    provider,
    desired,
    binding,
    currentBinding,
    broker,
    bridge,
    read,
    requests,
    values,
    setOnRead(fn: typeof onRead) {
      onRead = fn;
    },
  };
}
const signal = () => AbortSignal.timeout(2000);
test('resolver reads fresh desired and current binding; stored ref with null operation survives revision and reconnect', async () => {
  const f = await fixture();
  const a = await new CurrentCredentialResolver(f.machineId, f.read, f.broker).resolve(
    f.provider,
    2,
    signal(),
  );
  assert.equal(a.credentialRef, f.currentBinding.credentialRef);
  await a.assertCurrent();
  assert.deepEqual(f.requests, [
    '/v2/machine/model-sources',
    '/v2/machine/api-credential-bindings',
    '/v2/machine/model-sources',
    '/v2/machine/api-credential-bindings',
  ]);
  assert.equal(
    (await new CurrentCredentialResolver(f.machineId, f.read, f.broker).resolve(f.provider, 2, signal()))
      .credentialRef,
    a.credentialRef,
  );
});
test('resolver rejects OFF, removal, pending, missing, foreign, revision, endpoint, protocol, and provider ref conflicts', async () => {
  const mutations: ((f: Awaited<ReturnType<typeof fixture>>) => void)[] = [
    (f) => {
      f.desired.enabled.api = false;
    },
    (f) => {
      f.binding.apiEnabled = false;
    },
    (f) => {
      f.desired.apiProviders = [];
    },
    (f) => {
      f.binding.providers = [];
    },
    (f) => {
      f.currentBinding.status = 'pending';
    },
    (f) => {
      f.currentBinding.status = 'missing';
    },
    (f) => {
      f.currentBinding.credentialRef = null;
    },
    (f) => {
      f.binding.machineId = randomUUID();
    },
    (f) => {
      f.binding.configRevision = 3;
    },
    (f) => {
      f.desired.revision = 3;
    },
    (f) => {
      f.currentBinding.endpoint = 'https://other.example/';
    },
    (f) => {
      f.currentBinding.protocol = 'chat-completions';
    },
    (f) => {
      f.currentBinding.credentialRef = `${f.machineId}_${randomUUID()}_${randomUUID()}`;
    },
    (f) => {
      f.values.clear();
    },
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(
      new CurrentCredentialResolver(f.machineId, f.read, f.broker).resolve(f.provider, 2, signal()),
      /CREDENTIAL_BINDING_UNAVAILABLE|CREDENTIAL_MISSING/,
    );
  }
});
test('resolver rejects observed ref changes even when both credentials remain stored', async () => {
  const f = await fixture(),
    resolver = new CurrentCredentialResolver(f.machineId, f.read, f.broker),
    current = await resolver.resolve(f.provider, 2, signal());
  f.currentBinding.credentialRef = await f.broker.put(f.provider.id, Buffer.from('new-fixture'));
  await assert.rejects(current.assertCurrent(), /CREDENTIAL_BINDING_CHANGED/);
});
test('current transport refuses changed state before headers and rejects a response when authority changes in flight', async () => {
  const f = await fixture();
  let hits = 0,
    onRequest = () => {};
  const server = createServer((_req, res) => {
    hits++;
    onRequest();
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        model: 'chosen',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'fixture' }] }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    f.provider.endpoint = `${origin}/v1/`;
    f.provider.localHttp = { enabled: true, allowedOrigin: origin };
    f.currentBinding.endpoint = f.provider.endpoint;
    const transport = new PinnedProviderTransport(f.provider),
      broker = new CredentialBroker(f.machineId, f.bridge, [transport.deliver]),
      resolver = new CurrentCredentialResolver(f.machineId, f.read, broker);
    assert.equal((await transport.callCurrent('chosen', broker, resolver, 2, signal())).status, 200);
    assert.equal(hits, 1);
    let reads = 0;
    f.setOnRead((path) => {
      if (path === '/v2/machine/model-sources' && ++reads === 2) f.desired.enabled.api = false;
    });
    await assert.rejects(transport.callCurrent('chosen', broker, resolver, 2, signal()));
    assert.equal(hits, 1);
    f.setOnRead(() => {});
    f.desired.enabled.api = true;
    onRequest = () => {
      f.currentBinding.status = 'pending';
      f.currentBinding.credentialRef = null;
    };
    await assert.rejects(transport.callCurrent('chosen', broker, resolver, 2, signal()));
    assert.equal(hits, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
