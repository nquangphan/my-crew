import test from 'node:test';
import assert from 'node:assert/strict';
import { canComplete, canDeploy, type Completion } from '../src/completion-policy.ts';
const request: Completion = {
  kind: 'code',
  mandatoryStepsPassed: true,
  evidenceReady: true,
  mergedCommit: 'merge-sha',
  docsCommit: 'old-sha',
};
test('merge xong nhưng docs chưa sync không đóng yêu cầu', () => {
  assert.equal(canComplete(request), false);
  assert.equal(canComplete({ ...request, docsCommit: 'merge-sha' }), true);
  assert.equal(canComplete({ ...request, mergedCommit: null, docsCommit: null }), false);
});
test('research không bắt buộc merge nhưng phải có artifact và đủ bước', () => {
  assert.equal(canComplete({ ...request, kind: 'research', mergedCommit: null, docsCommit: null }), true);
  assert.equal(canComplete({ ...request, kind: 'research', evidenceReady: false }), false);
});
test('deploy phải có approval hoặc ticket riêng, không kế thừa từ hoàn thành feature', () => {
  assert.equal(canDeploy({ hasDeployTicket: false, ownerApproved: false }), false);
  assert.equal(canDeploy({ hasDeployTicket: false, ownerApproved: true }), true);
  assert.equal(canDeploy({ hasDeployTicket: true, ownerApproved: false }), true);
});
