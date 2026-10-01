import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSkillAllowed, type Pin, workflowsReady } from '../src/workflow-policy.ts';

const sp: Pin = { workflow: 'superpowers', version: '6.4.1', revision: 'sp-rev', checksum: 'sp-check' };
const bm: Pin = { workflow: 'bmad', version: 'test-version', revision: 'bm-rev', checksum: 'bm-check' };
test('cần đủ hai bộ đúng version revision checksum', () => {
  assert.equal(workflowsReady([sp, bm], [sp]), false);
  assert.equal(workflowsReady([sp, bm], [sp, { ...bm, checksum: 'different' }]), false);
  assert.equal(workflowsReady([sp, bm], [sp, bm]), true);
  assert.equal(workflowsReady([sp, sp, bm], [sp, bm]), false);
});
test('skill bộ khác hoặc revision khác bị chặn, kể cả khi tên skill giống', () => {
  assert.throws(() => assertSkillAllowed(sp, bm), /WORKFLOW_SOURCE_MISMATCH/);
  assert.throws(() => assertSkillAllowed(sp, { ...sp, revision: 'new' }), /WORKFLOW_SOURCE_MISMATCH/);
  assert.doesNotThrow(() => assertSkillAllowed(sp, { ...sp }));
});
