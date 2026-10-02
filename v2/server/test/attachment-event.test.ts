import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateEventInput } from '../src/journal/event-contracts.ts';
import type { EventInput } from '../src/platform/contracts.ts';

const attachmentId = randomUUID();
const event = (data: Record<string, unknown>, scope: Partial<EventInput> = {}): EventInput => ({
  type: 'attachment.changed',
  projectId: null,
  ticketId: null,
  audienceMachineId: null,
  data,
  ...scope,
});
const metadata = { attachmentId, state: 'ready', extraction: 'pending' };

test('attachment metadata event accepts exact owner draft and linked ticket scope', () => {
  assert.doesNotThrow(() => validateEventInput(event(metadata)));
  assert.doesNotThrow(() =>
    validateEventInput(event(metadata, { projectId: randomUUID(), ticketId: randomUUID() })),
  );
});

test('attachment metadata event rejects content paths compose identifiers and undeclared fields', () => {
  for (const extra of [
    { composeSessionId: randomUUID() },
    { path: '/private/storage/original' },
    { bytes: [1, 2] },
    { text: 'nội dung' },
    { payload: { nested: 'data' } },
    { sha256: 'a'.repeat(64) },
  ]) {
    assert.throws(() => validateEventInput(event({ ...metadata, ...extra })), { code: 'EVENT_INVALID' });
  }
});

test('attachment metadata event rejects invalid ids states extraction and partial or targeted scope', () => {
  for (const data of [
    { ...metadata, attachmentId: 'guessed' },
    { ...metadata, state: 'done' },
    { ...metadata, extraction: 'fully-read' },
    { attachmentId, state: 'ready' },
    { ...metadata, state: true },
    { ...metadata, state: ['ready'] },
    { ...metadata, extraction: ['pending'] },
  ]) {
    assert.throws(() => validateEventInput(event(data)), { code: 'EVENT_INVALID' });
  }
  for (const scope of [
    { projectId: randomUUID() },
    { ticketId: randomUUID() },
    { audienceMachineId: randomUUID() },
    { projectId: randomUUID(), ticketId: randomUUID(), audienceMachineId: randomUUID() },
  ]) {
    assert.throws(() => validateEventInput(event(metadata, scope)), { code: 'EVENT_INVALID' });
  }
});
