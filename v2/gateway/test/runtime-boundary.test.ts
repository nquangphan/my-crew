import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { Attempt } from '../src/commands/contracts.ts';
import { type BridgeOptions, TicketCommandBridge } from '../src/execution/ticket-command-bridge.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import type { AttemptProjectionPin } from '../src/journal/process-journal.ts';
import { commandFixture, workflowFixture } from './support/bridge-fixture.ts';
import { runtimeRoot } from './support/runtime-fixture.ts';

test('runtime boundary captured bridge hook denies before RELEASE after actual accepted companion', async () => {
  const owned = await runtimeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const { command, permit } = await commandFixture(w);
  let attempt: Attempt | null = null,
    companion: AttemptProjectionPin | null = null,
    released = 0,
    invoked = 0;
  const read = async (route: string) =>
    structuredClone(
      route === '/v2/gateway/config'
        ? { desired: w.desired }
        : route.includes('/commands/')
          ? command
          : attempt,
    );
  const http = await HttpOperationJournal.open(owned.root, async (request) => {
    const body = request.canonicalBody as Record<string, unknown>;
    if (request.phase === 'claim')
      attempt = {
        id: randomUUID(),
        commandId: command.id,
        machineId: command.machineId,
        ticketId: command.ticketId,
        fence: '1',
        processInstanceId: String(body.processInstanceId),
        state: 'active',
        workflowPin: permit.workflow,
        finalizedAt: null,
        stoppedAt: null,
        terminalResult: null,
      };
    if (request.phase === 'projection') {
      assert(attempt);
      companion = { attemptId: attempt.id, ...body } as AttemptProjectionPin;
    }
    return { status: 200, body: request.phase === 'projection' ? companion : attempt };
  });
  const options: BridgeOptions = {
    machineId: command.machineId,
    journal: w.journal,
    registry: w.registry,
    read,
    http,
    permit: async () => permit,
    command: ['/usr/bin/true'],
    recheckCapacity: async () => true,
    onDurableStage: async (stage) => {
      if (stage === 'released') released++;
    },
    beforeRelease: async (context) => {
      invoked++;
      assert(companion);
      assert.deepEqual(context.companion, companion);
      assert.deepEqual(context.attempt, attempt);
      assert(Object.isFrozen(context));
      assert(Object.isFrozen(context.command.payload));
      assert(Object.isFrozen(context.record.projection.derivation));
      assert.equal(context.record.processInstanceId, attempt?.processInstanceId);
      throw new Error('RUNTIME_DENIED');
    },
  };
  const bridge = await TicketCommandBridge.open(owned.root, options);
  options.beforeRelease = async () => {};
  try {
    await assert.rejects(bridge.handle(command), /RUNTIME_DENIED/);
    assert.equal(invoked, 1);
    assert.equal(released, 0);
    const records = await w.journal.processes();
    assert.equal(records.length, 1);
    assert.equal(records[0].authorization, null);
    await assert.rejects(bridge.handle(command), /RUNTIME_DENIED/);
    assert.equal(invoked, 2);
    assert.equal((await w.journal.processes()).length, 1);
  } finally {
    await bridge.close();
    for (const record of await w.journal.processes())
      assert.equal(await w.journal.observe(record), 'stopped');
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});

import { canonicalJson, hash } from '../src/journal/atomic-records.ts';
import { probeContextHash, RuntimeIsolation } from '../src/runtime/isolation.ts';
import { RuntimeLaunch } from '../src/runtime/launch.ts';
import { isolationObservation, runtimePinFixture } from './support/runtime-pins.ts';
import { runtimeWorkspaceFixture } from './support/runtime-workspace.ts';

test('runtime boundary RuntimePin durable before RELEASE and replay immutable across store reopen', async () => {
  const owned = await runtimeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const { command, permit } = await commandFixture(w);
  const template = runtimePinFixture();
  template.modelChoice.model.machineId = command.machineId;
  const source = w.sources[1].source;
  const audit = w.projections.find(
    (p) => p.sourceTreeSha256 === source.sourceTreeSha256 && p.runtime === 'api',
  );
  assert(audit);
  const projection = audit.expected;
  template.source = source;
  template.projection = projection;
  template.modelChoice.model.runtime = 'api';
  command.payload.selection = {
    ...(command.payload.selection as object),
    runtime: 'api',
    projectionManifestSha256: projection.manifestSha256,
    projectionTreeSha256: projection.treeSha256,
  };
  const prepared = await runtimeWorkspaceFixture(owned.root, w.registry, source, projection);
  template.workspaceCommit = prepared.commit;
  template.isolationPolicyHash = projection.derivation.policySha256;
  template.modelChoice.probeContextSha256 = probeContextHash(isolationObservation(template).context);
  command.payload.modelChoice = structuredClone(template.modelChoice);
  command.payload.certificationAdmission =
    template.admission.kind === 'test-certification'
      ? { challengeId: template.admission.challengeId, nonce: template.admission.nonce }
      : null;
  let attempt: Attempt | null = null,
    companion: AttemptProjectionPin | null = null,
    released = 0,
    failAfterPin = true,
    mismatch = true;
  const read = async (route: string) =>
    structuredClone(
      route === '/v2/gateway/config'
        ? { desired: w.desired }
        : route.includes('/commands/')
          ? command
          : attempt,
    );
  const http = await HttpOperationJournal.open(owned.root, async (request) => {
    const body = request.canonicalBody as Record<string, unknown>;
    if (request.phase === 'claim') {
      attempt = {
        id: randomUUID(),
        commandId: command.id,
        machineId: command.machineId,
        ticketId: command.ticketId,
        fence: '1',
        processInstanceId: String(body.processInstanceId),
        state: 'active',
        workflowPin: permit.workflow,
        finalizedAt: null,
        stoppedAt: null,
        terminalResult: null,
      };
      await prepared.prepare(attempt.id);
    }
    if (request.phase === 'projection') {
      assert(attempt);
      companion = { attemptId: attempt.id, ...body } as AttemptProjectionPin;
    }
    return { status: 200, body: request.phase === 'projection' ? companion : attempt };
  });
  let skillPath = 'skills/build/SKILL.md';
  const pair = await w.registry.resolve(source, projection);
  const skillEntry = pair.manifest.projection.find((entry) => entry.path === skillPath);
  assert(skillEntry);
  let entrypointHash = skillEntry.sha256;
  let catalogEnabled = true;
  const runtimeOptions = {
    journal: w.journal,
    registry: w.registry,
    entrypoint: async () =>
      catalogEnabled
        ? {
            relativePath: 'skills/build/SKILL.md',
            sha256: entrypointHash,
            sourceTreeSha256: source.sourceTreeSha256,
            projectionManifestSha256: projection.manifestSha256,
            projectionTreeSha256: projection.treeSha256,
            derivationSha256: hash(canonicalJson(projection.derivation)),
          }
        : null,
    isolation: new RuntimeIsolation({
      observe: prepared.observe,
      workspaces: prepared.service,
    }),
    binding: async (context: import('../src/execution/ticket-command-bridge.ts').BeforeReleaseContext) => ({
      pin: {
        ...template,
        commandId: command.id,
        attemptId: context.attempt.id,
        processInstanceId: context.record.processInstanceId,
        fence: mismatch ? '999' : context.attempt.fence,
        attemptProjection: structuredClone(context.companion),
        selection: structuredClone(
          command.payload.selection,
        ) as import('../src/commands/contracts.ts').Selection,
      },
      input: { skillName: 'fixture', skillPath, checkpoint: null },
    }),
  };
  let runtime = await RuntimeLaunch.open(owned.root, runtimeOptions);
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId: command.machineId,
    journal: w.journal,
    registry: w.registry,
    read,
    http,
    permit: async () => permit,
    command: ['/usr/bin/true'],
    recheckCapacity: async () => true,
    beforeRelease: async (context) => {
      await runtime.beforeRelease(context);
      if (failAfterPin) throw new Error('AFTER_PIN_FSYNC');
    },
    onDurableStage: async (stage, record) => {
      if (stage === 'released') {
        assert(await runtime.read(record.launchId));
        released++;
      }
    },
  });
  try {
    await assert.rejects(
      runtime.startReleased(template, { skillName: 'fake', skillPath: 'fake', checkpoint: null }),
      /BRIDGE_HOOK_REQUIRED/,
    );
    await assert.rejects(bridge.handle(command), /RUNTIME_PIN_MISMATCH/);
    mismatch = false;
    template.modelChoice.model.machineId = randomUUID();
    await assert.rejects(bridge.handle(command), /RUNTIME_PIN_MISMATCH/);
    template.modelChoice.model.machineId = command.machineId;
    catalogEnabled = false;
    await assert.rejects(bridge.handle(command), /ENTRYPOINT_AUTHORITY_NOT_BOUND/);
    catalogEnabled = true;
    skillPath = '../escape';
    await assert.rejects(bridge.handle(command), /SKILL_PATH_INVALID/);
    skillPath = 'render.sh';
    await assert.rejects(bridge.handle(command), /ENTRYPOINT_MISMATCH/);
    skillPath = 'skills/build/SKILL.md';
    entrypointHash = '0'.repeat(64);
    await assert.rejects(bridge.handle(command), /ENTRYPOINT_MISMATCH/);
    entrypointHash = skillEntry.sha256;
    const selectedFile = join(pair.projectionRoot, skillPath);
    const originalBytes = await readFile(selectedFile);
    try {
      await writeFile(selectedFile, 'tampered selected entrypoint');
      await assert.rejects(bridge.handle(command), /CHECKSUM_MISMATCH/);
    } finally {
      await writeFile(selectedFile, originalBytes);
    }
    template.workspaceCommit = '0'.repeat(40);
    await assert.rejects(bridge.handle(command), /RUNTIME_WORKSPACE_MISMATCH/);
    template.workspaceCommit = prepared.commit;
    await assert.rejects(bridge.handle(command), /AFTER_PIN_FSYNC/);
    assert.equal(released, 0);
    const record = (await w.journal.processes())[0],
      stored = await runtime.read(record.launchId);
    assert(stored);
    assert.equal(stored.workspace.ownerCommit, prepared.commit);
    assert.equal(stored.workspace.attemptId, (await prepared.service.get(stored.pin.attemptId))?.attemptId);
    assert.deepEqual(stored.workspace.identity, (await prepared.service.get(stored.pin.attemptId))?.identity);
    const original = hash(canonicalJson(stored));
    await runtime.close();
    runtime = await RuntimeLaunch.open(owned.root, runtimeOptions);
    template.credentialRef = 'changed';
    await assert.rejects(bridge.handle(command), /RUNTIME_PIN_CONFLICT/);
    template.credentialRef = null;
    failAfterPin = false;
    await bridge.handle(command);
    await bridge.wait(command.id);
    assert.equal(released, 1);
    assert.equal((await w.journal.processes()).length, 1);
    assert.equal(hash(canonicalJson(await runtime.read(record.launchId))), original);
  } finally {
    await bridge.close();
    for (const record of await w.journal.processes())
      assert.equal(await w.journal.observe(record), 'stopped');
    await runtime.close();
    await http.close();
    await prepared.close();
    await w.close();
    await owned.cleanup();
  }
});
