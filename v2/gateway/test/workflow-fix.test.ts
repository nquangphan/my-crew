import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkflowRegistry } from '../src/workflows/registry.ts';
import { entries, fixture, projectionAudit } from './support/workflow-archives.ts';

test('workflow fix cancellation cannot rewind existing A after B activation', async () => {
  const a = await fixture();
  const b = await fixture(
    'bmad',
    entries.map((e) => ({ ...e, body: e.path === 'render.sh' ? '#!/bin/sh\nprintf B\n' : e.body })),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-fix-')));
  const controller = new AbortController();
  const recipe = projectionAudit(a, 'claude');
  const r = await WorkflowRegistry.open(root, {
    sources: [a, b].map((f) => ({ pin: f.source, executables: f.executables })),
    projections: [recipe],
    signal: controller.signal,
  });
  try {
    await r.installSource(a.source, a.stream());
    await r.deriveProjection(a.source, 'claude', recipe.recipe);
    await r.installSource(b.source, b.stream());
    controller.abort();
    await assert.rejects(() => r.installSource(a.source, a.stream()), { name: 'AbortError' });
    assert.deepEqual(await r.current('bmad'), b.source);
    await assert.rejects(() => r.deriveProjection(a.source, 'claude', recipe.recipe), { name: 'AbortError' });
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow fix abort during existing verification preserves B activation', async () => {
  const a = await fixture();
  const b = await fixture(
    'bmad',
    entries.map((e) => ({ ...e, body: e.path === 'render.sh' ? '#!/bin/sh\nprintf B\n' : e.body })),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-fix-')));
  const controller = new AbortController();
  const r = await WorkflowRegistry.open(root, {
    sources: [a, b].map((f) => ({ pin: f.source, executables: f.executables })),
    projections: [],
    signal: controller.signal,
  });
  try {
    await r.installSource(a.source, a.stream());
    await r.installSource(b.source, b.stream());
    const verify = Reflect.get(r, 'sourceVerified').bind(r);
    Reflect.set(r, 'sourceVerified', async (pin: unknown) => {
      await verify(pin);
      controller.abort();
    });
    await assert.rejects(() => r.installSource(a.source, a.stream()), { name: 'AbortError' });
    assert.deepEqual(await r.current('bmad'), b.source);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow fix repeated completed malformed operations reclaim exact stages', async () => {
  const f = await fixture('superpowers', [
    ...entries,
    { path: 'dangling', type: 'symlink', target: 'absent' },
  ]);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-fix-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [],
  });
  try {
    for (let i = 0; i < 3; i++)
      await assert.rejects(() => r.installSource(f.source, f.stream()), /SYMLINK_ESCAPE/);
    const out = await r.reclaim();
    assert.equal(out.retained.length, 0);
    assert.equal(out.failed.length, 0);
    const stages = await r.stagingInventory();
    assert(stages.every((s) => s.state === 'deleted'));
    assert(stages.every((s) => s.bytes === 0));
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
