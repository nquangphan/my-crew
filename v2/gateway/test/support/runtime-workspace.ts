import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IsolationWorkspace } from '../../src/isolation/workspace.ts';
import type { RuntimePin } from '../../src/runtime/contracts.ts';
import type { ProjectionPin, SourcePin } from '../../src/workflows/pins.ts';
import type { WorkflowRegistry } from '../../src/workflows/registry.ts';
import { isolationObservation } from './runtime-pins.ts';

/** Actual owned Git preparation and actual producer verification. Only model admission remains protocol-only. */
export async function runtimeWorkspaceFixture(
  root: string,
  registry: WorkflowRegistry,
  source: SourcePin,
  projection: ProjectionPin,
) {
  const service = await IsolationWorkspace.open(join(root, 'runtime-isolation'), registry);
  const owner = join(root, 'owner'),
    home = join(root, 'git-home');
  for (const path of [owner, home, join(home, 'template'), join(home, 'hooks')])
    await mkdir(path, { mode: 0o700 });
  const projectionRoot = (await registry.resolve(source, projection)).projectionRoot;
  const git = async (...args: string[]) => {
    const result = await service.measure(
      'owner-fixture',
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
        projectionRoot,
        extraRead: [owner, '/Library/Developer/CommandLineTools'],
        extraWrite: [owner],
        environment: [
          'GIT_CONFIG_NOSYSTEM=1',
          'GIT_CONFIG_GLOBAL=/dev/null',
          `GIT_TEMPLATE_DIR=${join(home, 'template')}`,
        ],
      },
    );
    console.log(
      JSON.stringify({
        action: 'runtime-workspace-git',
        argv: args,
        receipt: result.receipt,
        stageIdentity: result.stageIdentity,
      }),
    );
    assert.equal(result.receipt?.exitCode, 0, result.error ?? result.output);
    assert.equal(result.receipt?.forkObserved, false);
    assert.equal(result.receipt?.treeEmpty, true);
    return result.output.trim();
  };
  await git('init', owner);
  await writeFile(join(owner, 'owned.txt'), 'actual prepared runtime workspace');
  await git('-C', owner, 'add', '--all');
  await git(
    '-C',
    owner,
    '-c',
    'user.name=RuntimeFixture',
    '-c',
    'user.email=runtime@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-m',
    'fixture',
  );
  const commit = await git('-C', owner, 'rev-parse', 'HEAD');
  const attempts = new Set<string>();
  return {
    service,
    commit,
    async prepare(attemptId: string) {
      const record = await service.prepareWorkspace(owner, attemptId, source, projection);
      assert.equal(record.ownerCommit, commit);
      attempts.add(attemptId);
      return record;
    },
    async observe(pin: RuntimePin) {
      const observation = isolationObservation(pin),
        record = await service.get(pin.attemptId);
      observation.preflight.evidence.workspace = record?.workspace ?? '';
      observation.preflight.evidence.attemptHome = record?.attemptHome ?? '';
      return observation;
    },
    async close() {
      for (const attemptId of attempts) {
        if ((await service.get(attemptId))?.state !== 'deleted')
          assert.equal(await service.cleanup(attemptId), 'deleted');
      }
      await service.close();
    },
  };
}
