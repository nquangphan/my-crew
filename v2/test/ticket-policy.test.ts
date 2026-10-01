import assert from 'node:assert/strict';
import test from 'node:test';
import { recordRepairFailure, type Signal, type Status, transition } from '../src/ticket-policy.ts';

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

test('từ chối tên status hoặc signal kế thừa từ prototype', () => {
  assert.throws(() => transition('pending', 'toString' as Signal), /INVALID_TICKET_TRANSITION/);
  assert.throws(() => transition('pending', 'constructor' as Signal), /INVALID_TICKET_TRANSITION/);
  assert.throws(() => transition('toString' as Status, 'call' as Signal), /INVALID_TICKET_TRANSITION/);
  assert.throws(
    () => transition('constructor' as Status, 'prototype' as Signal),
    /INVALID_TICKET_TRANSITION/,
  );
});
