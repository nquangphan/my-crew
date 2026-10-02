import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { toDomainPin } from '../src/commands/contracts.ts';
import { TicketCommandBridge } from '../src/execution/ticket-command-bridge.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

for (const droppedPhase of ['claim', 'projection'] as const)
  test(`execution bridge lost ${droppedPhase} replay keeps one READY identity before release`, async () => {
    const owned = await bridgeRoot(),
      f = await workflowFixture(owned.root);
    await f.install();
    const source = f.sources[1].source,
      projection = f.projections.find(
        (a) => a.sourceTreeSha256 === source.sourceTreeSha256 && a.runtime === 'codex',
      )!.expected;
    const selection = {
      runtime: 'codex',
      sourceTreeSha256: source.sourceTreeSha256,
      projectionManifestSha256: projection.manifestSha256,
      projectionTreeSha256: projection.treeSha256,
      installReportId: randomUUID(),
      configRevision: 1,
      decisionId: randomUUID(),
    };
    const command = {
      id: randomUUID(),
      machineId: randomUUID(),
      ticketId: randomUUID(),
      type: 'start',
      payload: { selection },
      state: 'queued',
      result: null,
    };
    const permit = {
      commandId: command.id,
      machineId: command.machineId,
      ticketId: command.ticketId,
      bindingRevision: 1,
      ticketRevision: 1,
      workflow: toDomainPin(source),
      decisionId: selection.decisionId,
      telemetryId: randomUUID(),
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 20000).toISOString(),
    };
    let attempt: any = null,
      companion: any = null,
      drop = true;
    const requests: any[] = [];
    const receipts = new Map<string, any>();
    let released = 0;
    const read = async (route: string) =>
      route === '/v2/gateway/config'
        ? { desired: f.desired }
        : route.includes('/commands/')
          ? structuredClone(command)
          : structuredClone(attempt);
    const http = await HttpOperationJournal.open(owned.root, async (req) => {
      requests.push(structuredClone(req));
      if (receipts.has(req.idempotencyKey)) return receipts.get(req.idempotencyKey);
      const body = req.canonicalBody as any;
      let result: import('../src/journal/http-operations.ts').HttpResponse;
      if (req.phase === 'claim') {
        const launch = (await f.journal.processes())[0];
        assert(await f.journal.ready(launch));
        assert.equal(await f.journal.observe(launch), 'running');
        attempt = {
          id: randomUUID(),
          commandId: command.id,
          ticketId: command.ticketId,
          machineId: command.machineId,
          fence: '1',
          processInstanceId: body.processInstanceId,
          state: 'active',
          workflowPin: permit.workflow,
          finalizedAt: null,
          stoppedAt: null,
          terminalResult: null,
        };
        result = { status: 200, body: structuredClone(attempt) };
      } else if (req.phase === 'projection') {
        companion = { attemptId: attempt.id, ...body };
        result = { status: 200, body: structuredClone(companion) };
      } else {
        result = { status: 200, body: structuredClone(attempt) };
      }
      receipts.set(req.idempotencyKey, result);
      if (req.phase === droppedPhase && drop) {
        drop = false;
        throw new Error('LOST_REPLY');
      }
      return result;
    });
    const options = {
      machineId: command.machineId,
      journal: f.journal,
      registry: f.registry,
      http,
      read,
      permit: async () => permit,
      command: ['/usr/bin/true'],
      recheckCapacity: async () => true,
      onDurableStage: async (stage: string) => {
        if (stage === 'released') released++;
      },
    };
    const bridge = await TicketCommandBridge.open(owned.root, options);
    try {
      await assert.rejects(bridge.handle(command), /LOST_REPLY/);
      assert.equal(released, 0);
      const original = (await f.journal.processes())[0];
      await bridge.handle(command);
      assert.equal((await f.journal.processes()).length, 1);
      assert.equal((await f.journal.processes())[0].processInstanceId, original.processInstanceId);
      assert.equal(released, 1);
      assert.deepEqual(companion.sourceTreeSha256, source.sourceTreeSha256);
      const phaseRequests = requests.filter((r) => r.phase === droppedPhase);
      assert.equal(phaseRequests.length, 2);
      assert.deepEqual(phaseRequests[0], phaseRequests[1]);
      await bridge.wait(command.id);
      assert.equal(await f.journal.observe(original), 'stopped');
    } finally {
      await bridge.close();
      await http.close();
      await f.close();
      await owned.cleanup();
    }
  });

test('execution bridge production permit default denies before reserving a launch', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  const http = await HttpOperationJournal.open(owned.root, async () => {
    throw new Error('NETWORK_NOT_EXPECTED');
  });
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    ticketId: randomUUID(),
    type: 'start',
    payload: {},
    state: 'queued',
    result: null,
  };
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId: command.machineId,
    journal: f.journal,
    registry: f.registry,
    http,
    read: async () => command,
  });
  try {
    await assert.rejects(bridge.handle(command), /DISPATCH_NOT_CONFIGURED/);
    assert.equal((await f.journal.processes()).length, 0);
  } finally {
    await bridge.close();
    await http.close();
    await f.close();
    await owned.cleanup();
  }
});

test('execution bridge authenticates reconcile command and durably acknowledges same command once', async () => {
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    ticketId: randomUUID(),
    type: 'reconcile',
    payload: {},
    state: 'queued',
    result: null,
  };
  let foreign = true;
  const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
  const http = await HttpOperationJournal.open(owned.root, async (request) => {
    sent.push(structuredClone(request));
    return { status: 200, body: command };
  });
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId: command.machineId,
    journal: w.journal,
    registry: w.registry,
    http,
    read: async () => ({ ...command, machineId: foreign ? randomUUID() : command.machineId }),
  });
  try {
    await assert.rejects(bridge.handle(command), /COMMAND_SCOPE_MISMATCH/);
    assert.equal(sent.length, 0);
    foreign = false;
    await bridge.handle(command);
    await bridge.handle(command);
    assert.deepEqual(
      sent.map((r) => r.phase),
      ['ticket-received', 'ticket-completed'],
    );
  } finally {
    await bridge.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});

test('execution bridge reconnect resets UUID page anchor and sees later lower UUID command', async () => {
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root),
    machineId = randomUUID();
  const commands: import('../src/commands/contracts.ts').Command[] = [
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      machineId,
      ticketId: randomUUID(),
      type: 'reconcile',
      payload: {},
      state: 'queued',
      result: null,
    },
  ];
  const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
  const http = await HttpOperationJournal.open(owned.root, async (req) => {
    sent.push(structuredClone(req));
    return { status: 200, body: commands.find((c) => req.route.includes(c.id)) };
  });
  const pages: string[] = [];
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId,
    journal: w.journal,
    registry: w.registry,
    http,
    read: async (route) => {
      if (route.startsWith('/v2/machine/commands?')) {
        pages.push(route);
        return { items: route.includes('&after=') ? [] : structuredClone(commands), nextCursor: null };
      }
      const command = commands.find((c) => route.endsWith(c.id));
      assert(command);
      return structuredClone(command);
    },
  });
  try {
    await bridge.reconnect();
    commands.push({ ...commands[0], id: '00000000-0000-4000-8000-000000000001' });
    await bridge.reconnect();
    assert.deepEqual(pages, ['/v2/machine/commands?limit=50', '/v2/machine/commands?limit=50']);
    assert.equal(sent.length, 4);
    assert.equal(sent.filter((r) => r.route.includes(commands[1].id)).length, 2);
  } finally {
    await bridge.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});
