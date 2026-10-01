import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleModels, type Model, type Selection } from '../src/model-policy.ts';
const model: Model = {
  id: 'claude:example',
  machineId: 'm1',
  runtime: 'claude',
  available: true,
  capabilities: ['tools', 'vision'],
};
const policy: Selection = {
  machineId: 'm1',
  required: ['tools', 'vision'],
  enabled: { claude: true, codex: true, api: true },
  desiredRevision: 2,
  appliedRevision: 2,
};
test('không lấy model cùng tên từ máy khác', () =>
  assert.deepEqual(eligibleModels([{ ...model, machineId: 'm2' }], policy), []));
test('nguồn tắt và config chưa áp dụng không dispatch', () => {
  assert.deepEqual(eligibleModels([model], { ...policy, enabled: { ...policy.enabled, claude: false } }), []);
  assert.deepEqual(eligibleModels([model], { ...policy, appliedRevision: 1 }), []);
});
test('fallback giữ tools và vision, không chọn model thiếu khả năng', () => {
  assert.deepEqual(
    eligibleModels(
      [
        { ...model, capabilities: ['tools'] },
        { ...model, available: false },
      ],
      policy,
    ),
    [],
  );
  assert.deepEqual(eligibleModels([model], policy), [model]);
});
