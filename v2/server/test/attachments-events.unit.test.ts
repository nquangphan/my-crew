import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateEventInput } from '../src/journal/event-contracts.ts';
import type { EventInput } from '../src/platform/contracts.ts';

test('attachment inbox events accept metadata and enforce owner-only creation', () => {
  const created: EventInput = {
    type: 'assistant.message.created',
    projectId: null,
    ticketId: null,
    audienceMachineId: null,
    data: { messageId: randomUUID(), inputRevision: '1' },
  };
  assert.doesNotThrow(() => validateEventInput(created));
  for (const value of [
    { ...created, audienceMachineId: randomUUID() },
    { ...created, projectId: randomUUID() },
    { ...created, ticketId: randomUUID() },
    { ...created, data: { ...created.data, text: 'private' } },
    { ...created, data: { ...created.data, path: '/private/original' } },
    { ...created, data: { ...created.data, messageId: 'invalid' } },
  ])
    assert.throws(() => validateEventInput(value), { code: 'EVENT_INVALID' });
  for (const inputRevision of ['0', '-1', '01', '', '9223372036854775808', 1]) {
    assert.throws(() => validateEventInput({ ...created, data: { ...created.data, inputRevision } }), {
      code: 'EVENT_INVALID',
    });
  }
});

test('attachment input wake events require exact target and specific machine audience', () => {
  const ticketId = randomUUID();
  const changed: EventInput = {
    type: 'attachment.input.changed',
    projectId: randomUUID(),
    ticketId,
    audienceMachineId: randomUUID(),
    data: { targetKind: 'ticket', targetId: ticketId, inputRevision: '2' },
  };
  assert.doesNotThrow(() => validateEventInput(changed));
  const message: EventInput = {
    ...changed,
    projectId: null,
    ticketId: null,
    data: { targetKind: 'message', targetId: randomUUID(), inputRevision: '1' },
  };
  assert.doesNotThrow(() => validateEventInput(message));
  for (const value of [
    { ...changed, audienceMachineId: null },
    { ...changed, projectId: null },
    { ...changed, data: { ...changed.data, targetId: randomUUID() } },
    { ...changed, data: { ...changed.data, targetKind: 'project' } },
    { ...changed, data: { ...changed.data, bytes: 'private' } },
    { ...message, projectId: randomUUID() },
    { ...message, ticketId: randomUUID() },
  ])
    assert.throws(() => validateEventInput(value), { code: 'EVENT_INVALID' });
});
