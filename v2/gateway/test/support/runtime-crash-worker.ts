import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Attempt } from '../../src/commands/contracts.ts';
import { TicketCommandBridge } from '../../src/execution/ticket-command-bridge.ts';
import { atomicWrite, canonicalJson, hash } from '../../src/journal/atomic-records.ts';
import { HttpOperationJournal } from '../../src/journal/http-operations.ts';
import { probeContextHash, RuntimeIsolation } from '../../src/runtime/isolation.ts';
import { RuntimeLaunch } from '../../src/runtime/launch.ts';
import { commandFixture, workflowFixture } from './bridge-fixture.ts';
import { isolationObservation, runtimePinFixture } from './runtime-pins.ts';
import { runtimeWorkspaceFixture } from './runtime-workspace.ts';

const [root, target] = process.argv.slice(2);
const w = await workflowFixture(root);
await w.install();
const { command, permit } = await commandFixture(w);
const template = runtimePinFixture();
template.modelChoice.model.machineId = command.machineId;
template.source = w.sources[1].source;
const audit = w.projections.find(
  (p) => p.sourceTreeSha256 === template.source.sourceTreeSha256 && p.runtime === 'api',
);
assert(audit);
template.projection = audit.expected;
template.modelChoice.model.runtime = 'api';
command.payload.selection = {
  ...(command.payload.selection as object),
  runtime: 'api',
  projectionManifestSha256: template.projection.manifestSha256,
  projectionTreeSha256: template.projection.treeSha256,
};
const prepared = await runtimeWorkspaceFixture(root, w.registry, template.source, template.projection);
template.workspaceCommit = prepared.commit;
template.isolationPolicyHash = template.projection.derivation.policySha256;
template.modelChoice.probeContextSha256 = probeContextHash(isolationObservation(template).context);
command.payload.modelChoice = template.modelChoice;
command.payload.certificationAdmission =
  template.admission.kind === 'test-certification'
    ? { challengeId: template.admission.challengeId, nonce: template.admission.nonce }
    : null;
let attempt: Attempt | null = null;
const pause = async (stage: string) => {
  if (stage !== target) return;
  await atomicWrite(join(root, 'fixture-server.json'), { formatVersion: 1, command, permit, attempt });
  process.send?.({ stage, identity: await w.journal.identity.probe(process.pid), argv: process.argv });
  await new Promise(() => {});
};
const http = await HttpOperationJournal.open(root, async (req) => {
  if (req.phase === 'claim') {
    attempt = {
      id: randomUUID(),
      commandId: command.id,
      ticketId: command.ticketId,
      machineId: command.machineId,
      fence: '1',
      processInstanceId: (req.canonicalBody as { processInstanceId: string }).processInstanceId,
      state: 'active',
      workflowPin: permit.workflow,
      finalizedAt: null,
      stoppedAt: null,
      terminalResult: null,
    };
    await pause('claim');
    await prepared.prepare(attempt.id);
    return { status: 200, body: attempt };
  }
  if (req.phase === 'projection') {
    await pause('companion');
    return { status: 200, body: { attemptId: attempt?.id, ...(req.canonicalBody as object) } };
  }
  return { status: 200, body: command };
});
const skillPath = 'skills/build/SKILL.md';
const pair = await w.registry.resolve(template.source, template.projection);
const entry = pair.manifest.projection.find((item) => item.path === skillPath);
assert(entry);
const runtime = await RuntimeLaunch.open(root, {
  journal: w.journal,
  registry: w.registry,
  entrypoint: async () => ({
    relativePath: skillPath,
    sha256: entry.sha256,
    sourceTreeSha256: template.source.sourceTreeSha256,
    projectionManifestSha256: template.projection.manifestSha256,
    projectionTreeSha256: template.projection.treeSha256,
    derivationSha256: hash(canonicalJson(template.projection.derivation)),
  }),
  isolation: new RuntimeIsolation({ observe: prepared.observe, workspaces: prepared.service }),
  binding: async (context) => ({
    pin: {
      ...template,
      commandId: command.id,
      attemptId: context.attempt.id,
      processInstanceId: context.record.processInstanceId,
      fence: context.attempt.fence,
      attemptProjection: structuredClone(context.companion),
      selection: command.payload.selection as import('../../src/commands/contracts.ts').Selection,
    },
    input: { skillName: 'fixture', skillPath, checkpoint: null },
  }),
});
const bridge = await TicketCommandBridge.open(root, {
  machineId: command.machineId,
  journal: w.journal,
  registry: w.registry,
  http,
  read: async (route) =>
    route === '/v2/gateway/config'
      ? { desired: w.desired }
      : route.includes('/commands/')
        ? command
        : attempt,
  permit: async () => permit,
  command: [
    process.execPath,
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'side-effect'))},'released');setTimeout(()=>{},500)`,
  ],
  recheckCapacity: async () => true,
  onDurableStage: pause,
  beforeRelease: async (context) => {
    await runtime.beforeRelease(context);
    await pause('runtime-pin');
  },
});
await bridge.reserve(command);
await pause('reserved');
await bridge.handle(command);
await bridge.wait(command.id);
throw new Error('CRASH_STAGE_NOT_REACHED');
