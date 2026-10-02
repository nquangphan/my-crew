import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { hash } from '../src/journal/atomic-records.ts';
import { auditSuperpowersNative, NATIVE_SKILLS, nativeFiles } from '../src/workflows/native-projection.ts';
import { WorkflowRegistry } from '../src/workflows/registry.ts';
import { parseArchive } from '../src/workflows/stage.ts';

test('workflow audited native Superpowers candidate has its independent artifact pin', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/workflow-builder/real-projections.json', import.meta.url), 'utf8'),
  );
  assert(fixture.superpowers.codex, 'NATIVE_ARTIFACT_CANDIDATE_MISSING');
  assert.equal(
    fixture.superpowers.codex.expected.derivation.layoutSchema,
    'superpowers-codex-native-skills-v1',
  );
});
test('workflow native full-tree artifact preserves bytes and modes with two real build roots and fixed discovery geometry', async () => {
  const fixtures = new URL('./fixtures/', import.meta.url);
  const original = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
  const frozen = JSON.parse(
    await readFile(new URL('workflow-builder/real-projections.json', fixtures), 'utf8'),
  );
  const audit = frozen.superpowers.codex;
  const bytes = await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures));
  const policy = JSON.parse(audit.policy);
  assert.deepEqual(
    await auditSuperpowersNative(
      original.superpowers.source.pin,
      bytes,
      original.superpowers.source.executables,
      policy.protocol.evidenceSha256,
    ),
    audit,
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-native-build-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [original.superpowers.source],
    projections: [audit],
  });
  try {
    await r.installSource(original.superpowers.source.pin, Readable.from(bytes));
    const pin = await r.deriveProjection(original.superpowers.source.pin, 'codex', audit.recipe);
    assert.deepEqual(pin, audit.expected);
    const resolved = await r.resolve(original.superpowers.source.pin, pin);
    for (const entry of resolved.manifest.source)
      assert.deepEqual(
        resolved.manifest.projection.find((p) => p.path === entry.path),
        entry,
      );
    assert.equal(resolved.manifest.projection.length - resolved.manifest.source.length, 16);
    assert.equal(resolved.manifest.projection.filter((p) => p.path === '.agents').length, 1);
    assert.equal(resolved.manifest.projection.filter((p) => p.type === 'symlink').length, 15);
    const scratch = join(root, 'scratch');
    await mkdir(scratch);
    await mkdir(join(scratch, '.agents'));
    await symlink(join(resolved.projectionRoot, '.agents/skills'), join(scratch, '.agents/skills'));
    assert(!scratch.startsWith(`${resolved.projectionRoot}/`));
    for (const name of NATIVE_SKILLS) {
      assert.equal(
        await realpath(join(scratch, '.agents/skills', name)),
        join(resolved.projectionRoot, 'skills', name),
      );
      assert.equal(
        hash(await readFile(join(scratch, '.agents/skills', name, 'SKILL.md'))),
        hash(await readFile(join(resolved.sourceRoot, 'skills', name, 'SKILL.md'))),
      );
    }
    for (const path of [
      'subagent-driven-development/scripts/sdd-workspace',
      'subagent-driven-development/scripts/review-package',
      'requesting-code-review/code-reviewer.md',
    ])
      assert.equal(
        await realpath(join(scratch, '.agents/skills', path)),
        join(resolved.projectionRoot, 'skills', path),
      );
    assert.equal(policy.runtimeStatus, 'UNVERIFIED');
    assert.equal(policy.officialMarketplaceEquivalent, false);
    assert.equal(policy.isolationCertificate, null);
    const builds = (await r.stagingInventory()).filter(
      (s) => s.operationKind === 'projection' && s.state === 'deleted',
    );
    assert.equal(builds.length, 2);
    console.log(
      'Native independent build identities:',
      JSON.stringify(builds.map((s) => ({ id: s.id, identity: s.identity, pin }))),
    );
    const files = await parseArchive(bytes, original.superpowers.source.executables);
    assert.throws(
      () =>
        nativeFiles([...files, { path: '.agents/skills', type: 'dir', mode: 0o755, body: Buffer.alloc(0) }]),
      /NATIVE_DISCOVERY_COLLISION/,
    );
    await writeFile(join(resolved.projectionRoot, 'AGENTS.md'), 'tampered');
    await assert.rejects(() => r.resolve(original.superpowers.source.pin, pin), /CHECKSUM_MISMATCH/);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
