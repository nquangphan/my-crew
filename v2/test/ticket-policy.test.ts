import test from 'node:test';
import assert from 'node:assert/strict';
import { transition, recordRepairFailure } from '../src/ticket-policy.ts';

test('mất mạng không đủ để running được start hoặc resume lần nữa', () => {
  assert.throws(() => transition('running', 'start'), /INVALID_TICKET_TRANSITION/);
  assert.throws(() => transition('running', 'resume'), /INVALID_TICKET_TRANSITION/);
  assert.equal(transition('running', 'reconciled_stopped'), 'pending');
});

test('pause chỉ xác nhận sau dừng, resume phải đánh giá điều kiện lại', () => {
  assert.equal(transition('running', 'pause_confirmed'), 'paused');
  assert.equal(transition('paused', 'resume'), 'pending');
  assert.throws(() => transition('done', 'start'), /INVALID_TICKET_TRANSITION/);
});

test('thất bại vòng năm hỏi owner, không vượt hoặc reset bộ đếm', () => {
  assert.deepEqual(recordRepairFailure(3), { cycles: 4, action: 'repair' });
  assert.deepEqual(recordRepairFailure(4), { cycles: 5, action: 'ask_owner' });
  assert.deepEqual(recordRepairFailure(5), { cycles: 5, action: 'ask_owner' });
  assert.throws(() => recordRepairFailure(-1), /INVALID_REPAIR_COUNT/);
});
