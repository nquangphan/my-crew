import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { hash, readRecord } from '../src/journal/atomic-records.ts';
import { auditSuperpowersApi } from '../src/workflows/audit.ts';
import { WorkflowRegistry } from '../src/workflows/registry.ts';

const fixtures = new URL('./fixtures/', import.meta.url);
async function audits() {
  const original = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
  const real = JSON.parse(
    await readFile(new URL('workflow-builder/real-projections.json', fixtures), 'utf8'),
  );
  const dependencies = await readFile(new URL('workflow-builder/dependencies.tgz', fixtures));
  for (const p of [real.bmad.claude, real.bmad.api]) p.build.dependencies = dependencies;
  return { original, real };
}
test('workflow real official BMAD installer builds deterministic Claude and API artifacts', async () => {
  const { original, real } = await audits();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-builder-test-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [original.bmad.source],
    projections: [real.bmad.claude, real.bmad.api],
  });
  try {
    await r.installSource(
      original.bmad.source.pin,
      Readable.from(await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtures))),
    );
    for (const runtime of ['claude', 'api'] as const) {
      const audit = real.bmad[runtime];
      const pin = await r.deriveProjection(original.bmad.source.pin, runtime, audit.recipe);
      assert.deepEqual(pin, audit.expected);
      const path = await r.resolve(original.bmad.source.pin, pin);
      const renderer = await readFile(join(path.projectionRoot, '_bmad/scripts/render_skill.py'));
      assert.equal(
        hash(renderer),
        hash(await readFile(join(path.sourceRoot, 'src/scripts/render_skill.py'))),
      );
      const policy = JSON.parse(await readFile(join(path.projectionRoot, 'adapter-policy.json'), 'utf8'));
      if (runtime === 'api') {
        assert.equal(policy.modelRequestsEnabled, false);
        assert.equal(policy.toolExecutionEnabled, false);
        assert(policy.skills.some((s: { path: string }) => s.path === '.claude/skills/bmad-build/SKILL.md'));
        assert(policy.scripts.some((s: { path: string }) => s.path === '_bmad/scripts/render_skill.py'));
      }
      assert.deepEqual(await r.deriveProjection(original.bmad.source.pin, runtime, audit.recipe), pin);
    }
    const inventory = await r.stagingInventory();
    const builders = inventory.filter((s) => s.lifetime === 'subprocess');
    assert.equal(builders.length, 4);
    assert(builders.every((s) => s.state === 'deleted' && s.complete && s.bytes === 0));
    console.log(
      'BMAD independent supervised builds:',
      JSON.stringify(
        await Promise.all(
          builders.map(async (s) => ({
            id: s.id,
            identity: s.identity,
            receipt: await readRecord(join(r.root, 'receipts', `${s.id}.json`)),
          })),
        ),
      ),
    );
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow real Superpowers API preserves exact official scripts and pins tool policy', async () => {
  const { original, real } = await audits();
  const bytes = await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures));
  assert.deepEqual(
    await auditSuperpowersApi(
      original.superpowers.source.pin,
      bytes,
      original.superpowers.source.executables,
    ),
    real.superpowers.api,
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-builder-test-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [original.superpowers.source],
    projections: [real.superpowers.api],
  });
  try {
    await r.installSource(original.superpowers.source.pin, Readable.from(bytes));
    const p = await r.deriveProjection(original.superpowers.source.pin, 'api', real.superpowers.api.recipe);
    assert.deepEqual(p, real.superpowers.api.expected);
    const paths = await r.resolve(original.superpowers.source.pin, p);
    const policy = JSON.parse(await readFile(join(paths.projectionRoot, 'adapter-policy.json'), 'utf8'));
    assert(policy.skills.length > 0);
    assert(policy.scripts.length > 0);
    for (const path of [
      'skills/subagent-driven-development/scripts/sdd-workspace',
      'skills/subagent-driven-development/scripts/review-package',
    ])
      assert(policy.scripts.some((entry: { path: string }) => entry.path === path));
    assert.equal(policy.isolationCertificate, null);
    for (const entry of policy.officialInventory)
      assert.equal(hash(await readFile(join(paths.projectionRoot, entry.path))), entry.sha256);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow frozen builder rejects dependency and uv tampering before execution', async () => {
  for (const scenario of ['dependency', 'uv', 'policy']) {
    const { original, real } = await audits();
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-builder-test-')));
    if (scenario === 'dependency') real.bmad.claude.build.dependencies = Buffer.from('tampered');
    if (scenario === 'uv') real.bmad.claude.build.uvPath = join(root, 'missing-uv');
    if (scenario === 'policy') real.bmad.claude.build.lockSha256 = '0'.repeat(64);
    const r = await WorkflowRegistry.open(root, {
      sources: [original.bmad.source],
      projections: [real.bmad.claude],
    });
    try {
      await r.installSource(
        original.bmad.source.pin,
        Readable.from(await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtures))),
      );
      await assert.rejects(
        () => r.deriveProjection(original.bmad.source.pin, 'claude', real.bmad.claude.recipe),
        scenario === 'dependency'
          ? /BUILDER_INPUT_MISMATCH/
          : scenario === 'uv'
            ? /ENOENT/
            : /BUILDER_POLICY_MISMATCH/,
      );
      assert(
        (await r.stagingInventory())
          .filter((s) => s.operationKind === 'projection')
          .every((s) => s.state === 'deleted' && s.lifetime === 'pure'),
      );
    } finally {
      await r.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});
