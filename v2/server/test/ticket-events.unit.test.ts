import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateEventInput } from '../src/journal/event-contracts.ts';

const projectId = randomUUID();
const ticketId = randomUUID();
const envelope = (type: string, data: Record<string, unknown>) => ({
  type,
  projectId,
  ticketId,
  audienceMachineId: null,
  data,
});

test('ticket metadata events accept exact fields and reject content', () => {
  validateEventInput(envelope('ticket.created', { revision: 1, status: 'pending' }));
  validateEventInput(envelope('ticket.changed', { revision: 2, status: 'ready' }));
  validateEventInput(envelope('dependency.added', { predecessorId: randomUUID(), revision: 2 }));
  validateEventInput(envelope('comment.created', { commentId: randomUUID() }));
  validateEventInput(envelope('decision.created', { decisionId: randomUUID(), kind: 'assessment' }));
  validateEventInput(
    envelope('repair.recorded', {
      cycleId: randomUUID(),
      classification: 'repair_review',
      passed: false,
      repairCycles: 1,
    }),
  );
  assert.throws(
    () => validateEventInput(envelope('comment.created', { commentId: randomUUID(), text: 'secret' })),
    { code: 'EVENT_INVALID' },
  );
  assert.throws(
    () => validateEventInput(envelope('ticket.changed', { revision: 1, status: 'pretend_done' })),
    { code: 'EVENT_INVALID' },
  );
});
