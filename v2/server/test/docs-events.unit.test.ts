import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateEventInput } from '../src/journal/event-contracts.ts';
import type { EventInput } from '../src/platform/contracts.ts';

test('docs events accept bounded metadata and reject content or false audit claims', () => {
  const imported: EventInput = {
    type: 'docs.imported',
    projectId: null,
    ticketId: null,
    audienceMachineId: null,
    data: { importId: randomUUID(), projectCount: 1 },
  };
  const synced: EventInput = {
    type: 'docs.synced',
    projectId: randomUUID(),
    ticketId: null,
    audienceMachineId: null,
    data: { snapshotId: randomUUID(), sourceCommit: 'a'.repeat(40), auditState: 'unverified' },
  };
  assert.doesNotThrow(() => validateEventInput(imported));
  assert.doesNotThrow(() => validateEventInput(synced));
  for (const bad of [
    { ...imported, data: { ...imported.data, bytes: 'docs' } },
    { ...imported, data: { ...imported.data, projectCount: 101 } },
    { ...synced, data: { ...synced.data, auditState: 'current' } },
    { ...synced, projectId: null },
    { ...synced, data: { ...synced.data, issues: [] } },
  ])
    assert.throws(() => validateEventInput(bad), { code: 'EVENT_INVALID' });
});
