import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateEventInput } from '../src/journal/event-contracts.ts';

test('execution event whitelist accepts identifiers and rejects sensitive result data', () => {
  const projectId = randomUUID(),
    ticketId = randomUUID(),
    machineId = randomUUID(),
    commandId = randomUUID();
  assert.doesNotThrow(() =>
    validateEventInput({
      type: 'command.created',
      projectId,
      ticketId,
      audienceMachineId: machineId,
      data: { commandId, type: 'start' },
    }),
  );
  assert.throws(
    () =>
      validateEventInput({
        type: 'command.created',
        projectId,
        ticketId,
        audienceMachineId: machineId,
        data: { commandId, type: 'start', token: 'secret' },
      }),
    { code: 'EVENT_INVALID' },
  );
});
