import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workspace v2 không có dependency ứng dụng v1', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@crew-v2/domain');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});
