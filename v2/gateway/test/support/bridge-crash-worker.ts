import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Attempt } from '../../src/commands/contracts.ts';
import { TicketCommandBridge } from '../../src/execution/ticket-command-bridge.ts';
import { atomicWrite } from '../../src/journal/atomic-records.ts';
import { HttpOperationJournal } from '../../src/journal/http-operations.ts';
import { commandFixture, workflowFixture } from './bridge-fixture.ts';

const [root, target] = process.argv.slice(2);
const w = await workflowFixture(root);
await w.install();
const { command, permit } = await commandFixture(w);
let attempt: Attempt | null = null;
const pause = async (stage: string) => {
  if (stage !== target) return;
  await atomicWrite(join(root, 'fixture-server.json'), { formatVersion: 1, command, permit, attempt });
  process.send?.({ stage });
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
    return { status: 200, body: attempt };
  }
  if (req.phase === 'projection') {
    await pause('companion');
    return { status: 200, body: { attemptId: attempt?.id, ...(req.canonicalBody as object) } };
  }
  return { status: 200, body: command };
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
});
await bridge.reserve(command);
await pause('reserved');
await bridge.handle(command);
await bridge.wait(command.id);
throw new Error('CRASH_STAGE_NOT_REACHED');
