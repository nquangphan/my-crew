import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createIsolationPreflight } from '../src/isolation/preflight.ts';
import { IsolationWorkspace } from '../src/isolation/workspace.ts';
import { AtomicRecords } from '../src/journal/atomic-records.ts';
import { WorkflowRegistry } from '../src/workflows/registry.ts';

test('actual exact clone preserves product docs, quarantines discovery and revalidates selected pins', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/crew6-w-'));
  const st = await lstat(root);
  const creation = { nonce: randomUUID(), root, device: st.dev, inode: st.ino, ownerUid: st.uid };
  console.log('Task6 owned fixture creation', JSON.stringify(creation));
  const original = JSON.parse(
    await readFile(new URL('./fixtures/workflows/official-audits.json', import.meta.url), 'utf8'),
  ).superpowers;
  const sourceAudit = original.source;
  const real = JSON.parse(
    await readFile(new URL('./fixtures/workflow-builder/real-projections.json', import.meta.url), 'utf8'),
  ).superpowers;
  const audit = real.codex;
  const registry = await WorkflowRegistry.open(join(root, 'registry'), {
    sources: [sourceAudit],
    projections: [audit, real.api, original.projections.claude],
  });
  let service = await IsolationWorkspace.open(join(root, 'isolation'), registry);
  let bound: Awaited<ReturnType<typeof createIsolationPreflight>> | undefined;
  try {
    await registry.installSource(
      sourceAudit.pin,
      Readable.from(await readFile(new URL('./fixtures/workflows/superpowers-6.4.2.tgz', import.meta.url))),
    );
    const projection = await registry.deriveProjection(sourceAudit.pin, 'codex', audit.recipe);
    const owner = join(root, 'owner'),
      home = join(root, 'fixture-home');
    for (const p of [owner, home, join(home, 'template'), join(home, 'hooks')])
      await mkdir(p, { mode: 0o700 });
    const git = async (...args: string[]) => {
      const e = await service.measure(
        'fixture',
        owner,
        '/Library/Developer/CommandLineTools/usr/bin/git',
        [
          '-c',
          `core.hooksPath=${join(home, 'hooks')}`,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'gc.auto=0',
          '-c',
          'maintenance.auto=false',
          ...args,
        ],
        {
          workspace: owner,
          attemptHome: home,
          projectionRoot: (await registry.resolve(sourceAudit.pin, projection)).projectionRoot,
          extraRead: [owner, '/Library/Developer/CommandLineTools'],
          extraWrite: [owner],
          environment: [
            'GIT_CONFIG_NOSYSTEM=1',
            'GIT_CONFIG_GLOBAL=/dev/null',
            `GIT_TEMPLATE_DIR=${join(home, 'template')}`,
          ],
        },
      );
      console.log('Task6 fixture Git', JSON.stringify(e));
      assert.equal(e.receipt?.exitCode, 0, e.output || e.error || 'missing receipt');
      return e.output.trim();
    };
    await git('init', owner);
    await mkdir(join(owner, 'docs'));
    await mkdir(join(owner, '.agents/skills/foreign'), { recursive: true });
    await writeFile(join(owner, 'docs/product.md'), 'product specifications remain');
    await writeFile(join(owner, 'AGENTS.md'), 'foreign instructions');
    await writeFile(join(owner, '.agents/skills/foreign/SKILL.md'), 'foreign skill');
    await git('-C', owner, 'add', '--all');
    await git(
      '-C',
      owner,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-m',
      'fixture',
    );
    const commit = await git('-C', owner, 'rev-parse', 'HEAD');
    const workspace = await service.prepareWorkspace(owner, 'clone-test', sourceAudit.pin, projection);
    assert.equal(workspace.ownerCommit, commit);
    assert.equal(
      await readFile(join(workspace.workspace, 'docs/product.md'), 'utf8'),
      'product specifications remain',
    );
    assert(workspace.exclusions.some((e) => e.path === 'AGENTS.md'));
    assert(workspace.exclusions.some((e) => e.path === '.agents/skills/foreign/SKILL.md'));
    assert.equal(await readFile(join(owner, 'AGENTS.md'), 'utf8'), 'foreign instructions');
    await service.verify(workspace.workspace, workspace.attemptHome, sourceAudit.pin, projection);
    await service.close();
    const missingRuntime = await createIsolationPreflight({
      root: join(root, 'isolation'),
      registry,
      executables: { codex: join(root, 'missing-runtime') },
    });
    bound = missingRuntime;
    const input = {
      runtime: 'codex' as const,
      source: sourceAudit.pin,
      projection,
      workspace: workspace.workspace,
      attemptHome: workspace.attemptHome,
    };
    const missing = await missingRuntime.preflightSourceIsolation(input);
    console.log('Task6 missing runtime evidence', JSON.stringify(missing));
    assert.equal(missing.status, 'UNVERIFIED');
    assert.equal(missing.evidence.productionEnabled, false);
    assert(
      missing.evidence.surfaces
        .filter((s) => s.surface.startsWith('shell-'))
        .every((s) => s.status === 'PASS'),
    );
    const foreign = join(root, 'foreign-canary');
    await writeFile(foreign, 'foreign workflow');
    const removeOwned = async (path: string, identity: Awaited<ReturnType<typeof lstat>>) => {
      const current = await lstat(path);
      assert.equal(current.dev, identity.dev);
      assert.equal(current.ino, identity.ino);
      assert.equal(current.uid, identity.uid);
      if (identity.isDirectory()) await rmdir(path);
      else await unlink(path);
    };
    const denyHomeMetadata = async (label: string) => {
      const denied = await missingRuntime.preflightSourceIsolation(input);
      console.log('Task6 FIX1 HOME metadata gate', JSON.stringify({ label, result: denied }));
      assert.equal(denied.status, 'FAIL');
      assert(denied.blockers.includes('CROSS_WORKFLOW_SOURCE'));
      assert.equal(denied.evidence.commands.length, 0);
    };
    const homeGit = join(workspace.attemptHome, '.git');
    await mkdir(homeGit, { mode: 0o700 });
    const homeGitIdentity = await lstat(homeGit);
    const homeHardlink = join(homeGit, 'foreign-skill');
    await link(foreign, homeHardlink);
    const homeHardlinkIdentity = await lstat(homeHardlink);
    try {
      await denyHomeMetadata('HOME/.git/foreign-skill hardlink');
    } finally {
      await removeOwned(homeHardlink, homeHardlinkIdentity);
      await removeOwned(homeGit, homeGitIdentity);
    }
    await symlink(foreign, homeGit);
    const homeSymlinkIdentity = await lstat(homeGit);
    try {
      await denyHomeMetadata('HOME/.git symlink');
    } finally {
      await removeOwned(homeGit, homeSymlinkIdentity);
    }
    const nestedGit = join(workspace.attemptHome, 'cache/.git');
    await symlink(foreign, nestedGit);
    const nestedGitIdentity = await lstat(nestedGit);
    try {
      await denyHomeMetadata('HOME/cache/.git nested symlink');
    } finally {
      await removeOwned(nestedGit, nestedGitIdentity);
    }
    for (const [name, create] of [
      ['hardlink', link],
      ['symlink', symlink],
    ] as const) {
      const target = join(workspace.workspace, name);
      await create(foreign, target);
      const denied = await missingRuntime.preflightSourceIsolation(input);
      assert.equal(denied.status, 'FAIL');
      assert(denied.blockers.includes('CROSS_WORKFLOW_SOURCE'));
      assert(denied.blockers.includes('NATIVE_READ_UNVERIFIED'));
      assert.equal(denied.evidence.commands.length, 0);
      await unlink(target);
    }
    const homeAlias = join(workspace.attemptHome, 'foreign');
    await symlink(foreign, homeAlias);
    assert.equal((await missingRuntime.preflightSourceIsolation(input)).status, 'FAIL');
    await unlink(homeAlias);
    const privateConfig = join(workspace.attemptHome, 'codex/config.toml'),
      configBytes = await readFile(privateConfig);
    await writeFile(privateConfig, '[mcp_servers.foreign]\ncommand="foreign"\n');
    assert(
      (await missingRuntime.preflightSourceIsolation(input)).blockers.includes('PRIVATE_CONFIG_CHANGED'),
    );
    await writeFile(privateConfig, configBytes);
    const gitConfig = join(workspace.workspace, '.git/config'),
      gitBytes = await readFile(gitConfig);
    await writeFile(gitConfig, '[core]\nworktree = /foreign\n');
    assert((await missingRuntime.preflightSourceIsolation(input)).blockers.includes('GIT_METADATA_CHANGED'));
    await writeFile(gitConfig, gitBytes);
    const metadataGit = join(workspace.workspace, '.git/.git');
    await symlink(foreign, metadataGit);
    const metadataIdentity = await lstat(metadataGit);
    try {
      const denied = await missingRuntime.preflightSourceIsolation(input);
      assert(denied.blockers.includes('GIT_METADATA_CHANGED'));
      assert.equal(denied.evidence.commands.length, 0);
    } finally {
      await removeOwned(metadataGit, metadataIdentity);
    }
    const packDirectory = join(workspace.workspace, '.git/objects/pack');
    const packName = (await readdir(packDirectory)).find((name) => name.endsWith('.pack'));
    assert(packName);
    const packPath = join(packDirectory, packName),
      packBytes = await readFile(packPath);
    await writeFile(packPath, 'tampered object database');
    try {
      const denied = await missingRuntime.preflightSourceIsolation(input);
      assert(denied.blockers.includes('GIT_METADATA_CHANGED'));
      assert.equal(denied.evidence.commands.length, 0);
    } finally {
      await writeFile(packPath, packBytes);
    }
    const restored = await missingRuntime.preflightSourceIsolation(input);
    assert.equal(restored.status, 'UNVERIFIED');
    assert.equal(
      restored.evidence.surfaces.find((surface) => surface.surface === 'shell-git-objectdb-denial')?.status,
      'PASS',
    );
    assert.equal(
      (
        await missingRuntime.preflightSourceIsolation({
          ...input,
          projection: { ...projection, treeSha256: '0'.repeat(64) },
        })
      ).status,
      'FAIL',
    );
    const selected = await registry.resolve(sourceAudit.pin, projection),
      selectedPath = join(selected.projectionRoot, 'AGENTS.md'),
      selectedBytes = await readFile(selectedPath);
    await writeFile(selectedPath, 'tampered selected bytes');
    assert.equal((await missingRuntime.preflightSourceIsolation(input)).status, 'FAIL');
    await writeFile(selectedPath, selectedBytes);
    await missingRuntime.close();
    const live = await createIsolationPreflight({
      root: join(root, 'isolation'),
      registry,
      executables: {
        codex: '/Users/phannhatquang/.local/bin/codex',
        claude: '/Users/phannhatquang/.local/bin/claude',
      },
    });
    bound = live;
    if (
      process.env.CREW_ISOLATION_SKIP_DISCOVERY !== '1' &&
      process.env.CREW_ISOLATION_PROBE_RUNTIME !== 'claude'
    ) {
      const codex = await live.preflightSourceIsolation(input);
      console.log('Task6 Codex no-model evidence', JSON.stringify(codex));
      assert.equal(codex.status, 'UNVERIFIED');
    }
    for (const runtime of ['claude', 'api'] as const) {
      if (process.env.CREW_ISOLATION_SKIP_DISCOVERY === '1') continue;
      if (runtime === 'claude' && process.env.CREW_ISOLATION_PROBE_RUNTIME === 'codex') continue;
      const a = runtime === 'api' ? real.api : original.projections.claude;
      const pin = await registry.deriveProjection(sourceAudit.pin, runtime, a.recipe);
      const w = await live.prepareWorkspace(owner, `${runtime}-probe`, sourceAudit.pin, pin);
      const result = await live.preflightSourceIsolation({
        runtime,
        source: sourceAudit.pin,
        projection: pin,
        workspace: w.workspace,
        attemptHome: w.attemptHome,
      });
      console.log(`Task6 ${runtime} no-model evidence`, JSON.stringify(result));
      assert.equal(result.status, 'UNVERIFIED');
      assert.equal(result.evidence.productionEnabled, false);
      assert.equal(await live.cleanup(`${runtime}-probe`), 'deleted');
    }
    await live.close();
    service = await IsolationWorkspace.open(join(root, 'isolation'), registry, [
      '/Users/phannhatquang/.local/bin/codex',
      '/Users/phannhatquang/.local/bin/claude',
    ]);
    await assert.rejects(
      () =>
        service.verify(workspace.workspace, workspace.attemptHome, sourceAudit.pin, {
          ...projection,
          treeSha256: '0'.repeat(64),
        }),
      /BINDING_MISMATCH/,
    );
    await writeFile(join(workspace.workspace, 'docs/product.md'), 'changed');
    await assert.rejects(
      () => service.verify(workspace.workspace, workspace.attemptHome, sourceAudit.pin, projection),
      /BYTES_CHANGED/,
    );
    assert.equal(await service.cleanup('clone-test'), 'deleted');
    // Negative crash fixture: durable reserved intent, no process or STOP receipt is invented.
    const pending = await service.prepareWorkspace(owner, 'pending-crash', sourceAudit.pin, projection);
    await service.close();
    const journal = await AtomicRecords.open(join(root, 'isolation/journal'));
    const operationId = randomUUID();
    try {
      await journal.put(`command-${operationId}`, {
        formatVersion: 1,
        kind: 'isolation-command',
        attemptId: 'pending-crash',
        identity: null,
        state: 'reserved',
        evidence: {
          operationId,
          argv: [],
          executable: '<never-started-negative-fixture>',
          executableSha256: '',
          policySha256: '',
          policy: '',
          stageIdentity: null,
          output: '',
          receipt: null,
          error: 'DURABLE_INTENT_CRASH_FIXTURE',
          numericPidStart: 'unavailable-in-reviewed-receipt',
        },
      });
    } finally {
      await journal.close();
    }
    bound = await createIsolationPreflight({ root: join(root, 'isolation'), registry });
    const unresolved = await bound.preflightSourceIsolation({
      ...input,
      workspace: pending.workspace,
      attemptHome: pending.attemptHome,
    });
    assert.equal(unresolved.status, 'UNVERIFIED');
    assert(unresolved.blockers.includes('PROCESS_CLOSURE_UNVERIFIED'));
    assert.equal(unresolved.evidence.commands.length, 0);
    assert.equal(await bound.cleanup('pending-crash'), 'retained');
    assert((await registry.retained()).some((ref) => ref.runId === 'isolation:pending-crash'));
    console.log(
      'Task6 durable pending retained',
      JSON.stringify({
        attemptId: 'pending-crash',
        operationId,
        workspace: pending.workspace,
        identity: pending.identity,
        result: unresolved,
      }),
    );
    await bound.close();
    service = await IsolationWorkspace.open(join(root, 'isolation'), registry);
    assert.equal(await service.cleanup('pending-crash'), 'retained');
    assert.equal((await service.get('pending-crash'))?.state, 'prepared');
  } finally {
    console.log('Task6 fixture commands', JSON.stringify(await service.commands('clone-test')));
    console.log('Task6 fixture retained root', JSON.stringify(creation));
    await bound?.close();
    await service.close();
    await registry.close();
  }
});
