import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditWorkspace, classifyOrigin, discoveryReason } from '../src/isolation/inventory.ts';
import { isolationPolicy, routerPolicy } from '../src/isolation/policy.ts';
import { createIsolationPreflight, preflightSourceIsolation } from '../src/isolation/preflight.ts';
import { prepareWorkspace } from '../src/isolation/workspace.ts';

test('unbound isolation cannot accept caller supplied paths or proof', async () => {
  await assert.rejects(
    () => prepareWorkspace('/tmp/owner', 'attempt', {} as never, {} as never),
    /ISOLATION_NOT_BOUND/,
  );
  await assert.rejects(
    () =>
      preflightSourceIsolation({
        runtime: 'codex',
        source: {} as never,
        projection: {} as never,
        workspace: '/tmp/forged',
        attemptHome: '/tmp/forged',
      }),
    /ISOLATION_NOT_BOUND/,
  );
});
test('factory rejects a fake registry even when the caller reports a passing certificate', async () => {
  await assert.rejects(
    () =>
      createIsolationPreflight({
        root: '/private/tmp/unused',
        registry: { resolve: async () => ({ status: 'PASS' }) } as never,
      }),
    /TRUSTED_REGISTRY_REQUIRED/,
  );
});
test('discovery exclusions are explicit; ordinary product documents survive', () => {
  for (const path of [
    'AGENTS.md',
    'nested/CLAUDE.md',
    '.agents/skills/a/SKILL.md',
    '.claude/settings.json',
    '.codex/config.toml',
    '_bmad/agents/a.md',
    '.mcp.json',
  ])
    assert(discoveryReason(path), path);
  for (const path of ['docs/product.md', 'src/agents.ts', '.github/workflows/test.yml', 'README.md'])
    assert.equal(discoveryReason(path), null, path);
});
test('policy is deny-by-default for data, fork, network and router source', () => {
  const p = isolationPolicy({
    workspace: '/private/tmp/owned/w',
    attemptHome: '/private/tmp/owned/h',
    projectionRoot: '/private/tmp/P',
    executable: '/usr/bin/true',
    operationRoot: '/private/tmp/op',
  });
  assert(p.includes('(deny file-read*)'));
  assert(p.includes('(deny process-fork)'));
  assert(p.includes('(deny network*)'));
  assert(!routerPolicy().workflowSource);
  assert.equal(routerPolicy().productionEnabled, false);
  assert.throws(
    () =>
      isolationPolicy({
        workspace: '/tmp/a\n(bad)',
        attemptHome: '/tmp/h',
        projectionRoot: '/tmp/p',
        executable: '/bin/true',
        operationRoot: '/tmp/o',
      }),
    /UNSAFE_POLICY_PATH/,
  );
});
test('workspace audit rejects hardlink, external symlink and nested common-dir; keeps internal document alias', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-isolation-audit-')));
  try {
    const w = join(root, 'w');
    await mkdir(w);
    await writeFile(join(w, 'README.md'), 'product');
    assert.equal(
      (await classifyOrigin(join(root, 'foreign-secret'), 'skill', w, join(root, 'home'))).classification,
      'blocked',
    );
    assert.equal(
      (await classifyOrigin(join(w, 'README.md'), 'skill', w, join(root, 'home'))).classification,
      'selected',
    );
    await symlink('README.md', join(w, 'manual.md'));
    assert.equal((await auditWorkspace(w)).blockers.length, 0);
    await writeFile(join(root, 'canary'), 'foreign');
    await symlink('../canary', join(w, 'escape'));
    assert((await auditWorkspace(w)).blockers.some((b) => b.includes('SYMLINK_ORIGIN')));
    await link(join(root, 'canary'), join(w, 'hard'));
    assert((await auditWorkspace(w)).blockers.some((b) => b.includes('HARDLINK')));
    await mkdir(join(w, 'nested'));
    await writeFile(join(w, 'nested/.git'), 'gitdir: ../../foreign');
    assert((await auditWorkspace(w)).blockers.some((b) => b.includes('GIT_DISCOVERY')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
