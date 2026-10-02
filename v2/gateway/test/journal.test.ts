import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProjectionPin, SourcePin } from '../src/host/status.ts';
import { Launcher, ProcessJournal } from '../src/journal/process-journal.ts';

const source: SourcePin = {
  name: 'bmad',
  version: 'fixture',
  sourceRevision: 'fixture',
  sourceUrl: 'https://example.invalid',
  payloadSha256: 'a'.repeat(64),
  packageIntegrity: null,
  sourceManifestSha256: 'b'.repeat(64),
  sourceTreeSha256: 'c'.repeat(64),
};
const projection: ProjectionPin = {
  runtime: 'api',
  sourceTreeSha256: source.sourceTreeSha256,
  manifestSha256: 'd'.repeat(64),
  treeSha256: 'e'.repeat(64),
  derivation: { tool: 'fixture', version: '1', options: [], layoutSchema: '1', policySha256: 'f'.repeat(64) },
};
export const launchInput = {
  commandId: 'command',
  ticketId: 'ticket',
  processInstanceId: 'instance',
  source,
  projection,
};
test('journal command reservation survives restart and concurrent journal writer is rejected', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-journal-'));
  let journal = await ProcessJournal.open(root);
  try {
    const record = await journal.reserve(launchInput);
    assert.equal(await journal.observe(record), 'unknown');
    await assert.rejects(ProcessJournal.open(root));
    await journal.close();
    journal = await ProcessJournal.open(root);
    assert.equal((await journal.reserve(launchInput)).launchId, record.launchId);
    await assert.rejects(journal.reserve({ ...launchInput, ticketId: 'different' }), /CONFLICT/);
  } finally {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('journal READY child cannot run side effects until exact projection authorization and durable release', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-gated-'));
  const journal = await ProcessJournal.open(root);
  const marker = join(root, 'marker');
  const launcher = new Launcher(journal, {
    recheckCapacity: async () => true,
    command: [
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'released')`,
    ],
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
  });
  try {
    const record = await journal.reserve(launchInput);
    const identity = await launcher.spawnGated(record);
    assert.ok(identity.startIdentity);
    await assert.rejects(readFile(marker));
    assert.equal(await journal.observe(record), 'running');
    await launcher.release(record, '1', 'attempt');
    await launcher.wait(record);
    assert.equal(await readFile(marker, 'utf8'), 'released');
    assert.equal(await journal.observe(record), 'stopped');
    await assert.rejects(journal.markStopped({ ...record, launchId: 'fabricated' }));
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal crash windows retain reservation, require READY identity and never release before authorization', async () => {
  const { fork } = await import('node:child_process');
  const { setTimeout: delay } = await import('node:timers/promises');
  for (const stage of [
    'reserved',
    'spawned',
    'ready',
    'claim_request',
    'claim_reply',
    'authorized',
    'released',
  ]) {
    const root = await mkdtemp(join(await realpath(tmpdir()), `crew-crash-${stage}-`));
    const child = fork(new URL('./support/journal-fixture.ts', import.meta.url), [root, stage], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const received = await new Promise<{ record: import('../src/journal/process-journal.ts').LaunchRecord }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`fixture stage timeout ${stage}`)), 7000);
        child.once('message', (value) => {
          clearTimeout(timer);
          resolve(value as { record: import('../src/journal/process-journal.ts').LaunchRecord });
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`premature fixture exit ${stage}`));
        });
      },
    );
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await ended;
    await delay(100);
    const journal = await ProcessJournal.open(root);
    try {
      const replay = await journal.reserve(launchInput);
      assert.equal(replay.launchId, received.record.launchId);
      if (stage !== 'released') await assert.rejects(readFile(join(root, 'side-effect')));
      const ready = await journal.ready(replay);
      const observation = await journal.observe(replay);
      assert.notEqual(observation, 'stopped'); // No exact wait survives a killed host.
      if (!ready) assert.equal(observation, 'unknown');
      const launcher = new Launcher(journal);
      if (stage !== 'reserved') await assert.rejects(launcher.spawnGated(replay), /RECONCILE_REQUIRED/);
      if (ready) {
        const p = await journal.identity.probe(ready.pid);
        if (
          p &&
          p.processGroupId === ready.pid &&
          `${replay.launchId}:${p.pid}:${p.birth}:${p.processGroupId}:${p.uid}` === ready.startIdentity
        ) {
          process.kill(-ready.processGroupId, 'SIGTERM');
          for (let i = 0; i < 100 && !(await journal.identity.groupEmpty(ready.processGroupId)); i++)
            await delay(20);
          assert.equal(await journal.identity.groupEmpty(ready.processGroupId), true);
        }
      }
    } finally {
      await journal.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('journal PID birth mismatch and capacity/projection failure remain gated and unknown', async () => {
  const { atomicWrite } = await import('../src/journal/atomic-records.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-identity-'));
  const journal = await ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  const launcher = new Launcher(journal, {
    command: [process.execPath, '-e', 'process.exit(0)'],
    recheckCapacity: async () => false,
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
  });
  try {
    await launcher.spawnGated(record);
    await assert.rejects(launcher.release(record, '1', 'attempt'), /CAPACITY_BLOCKED/);
    assert.equal((await journal.exact(record)).authorization, null);
    const ready = await journal.ready(record);
    assert.ok(ready);
    await atomicWrite(journal.proofPath(record, 'ready'), {
      ...ready,
      startIdentity: `${ready.startIdentity}-reused`,
    });
    assert.equal(await journal.observe(record), 'unknown');
    await atomicWrite(journal.proofPath(record, 'ready'), ready);
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal descendant that escapes the dedicated process group leaves tree unknown', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-tree-'));
  const journal = await ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  const escapedScript = 'setTimeout(()=>process.exit(0),1000)';
  const command = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(escapedScript)}],{detached:true,stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100);`;
  const launcher = new Launcher(journal, {
    command: [process.execPath, '-e', command],
    recheckCapacity: async () => true,
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
  });
  try {
    await launcher.spawnGated(record);
    await launcher.release(record, '1', 'attempt');
    await launcher.wait(record);
    assert.equal(await journal.observe(record), 'unknown');
    await assert.rejects(journal.markStopped(record), /EXACT_EXIT_PROOF_REQUIRED/);
    await launcher.close();
    await journal.close();
    const recovered = await ProcessJournal.open(root);
    try {
      assert.equal(await recovered.observe(record), 'unknown');
      assert.equal((await recovered.exact(record)).lastError, 'PROCESS_TREE_UNKNOWN');
      await assert.rejects(new Launcher(recovered).spawnGated(record), /RECONCILE_REQUIRED/);
    } finally {
      await recovered.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal concurrent launcher calls reserve one dormant child and never a second process', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-spawn-race-'));
  const journal = await ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  let spawned = 0;
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onDurableStage = async (stage: string) => {
    if (stage === 'spawned') spawned++;
    if (stage === 'before_spawn_commit') {
      if (++arrived === 2) release();
      await barrier;
    }
  };
  const a = new Launcher(journal, { onDurableStage });
  const b = new Launcher(journal, { onDurableStage });
  try {
    const outcomes = await Promise.allSettled([a.spawnGated(record), b.spawnGated(record)]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(spawned, 1, 'no rejected READY may hide a duplicate child');
  } finally {
    await a.close();
    await b.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal native binary tamper fails closed and cannot become exit proof', async () => {
  const { readdir, writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-native-tamper-'));
  const journal = await ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  const launcher = new Launcher(journal);
  try {
    const ready = await launcher.spawnGated(record);
    const cache = join(journal.root, 'native');
    const entries = await readdir(cache);
    assert.equal(entries.length, 1);
    await writeFile(join(cache, entries[0], 'helper'), 'tampered');
    assert.equal(await journal.identity.probe(ready.pid), null);
    assert.equal(await journal.observe(record), 'unknown');
    await assert.rejects(journal.markStopped(record), /EXACT_EXIT_PROOF_REQUIRED/);
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal built entrypoint resolves the gated helper and owned native source without a global install', async () => {
  const modulePath = new URL('../dist/src/journal/process-journal.js', import.meta.url).href;
  const built = (await import(modulePath)) as typeof import('../src/journal/process-journal.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-built-journal-'));
  const journal = await built.ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  const launcher = new built.Launcher(journal, {
    command: [process.execPath, '-e', 'process.exit(0)'],
    recheckCapacity: async () => true,
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
  });
  try {
    await launcher.spawnGated(record);
    await launcher.release(record, '1', 'attempt');
    await launcher.wait(record);
    assert.equal(await journal.observe(record), 'stopped');
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal concurrent releases for the same fenced claim execute the workflow side effect once', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-release-race-'));
  const journal = await ProcessJournal.open(root);
  const record = await journal.reserve(launchInput);
  const marker = join(root, 'effect');
  let arrived = 0;
  let unblock: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const launcher = new Launcher(journal, {
    command: [
      process.execPath,
      '-e',
      `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x');setTimeout(()=>{},100)`,
    ],
    recheckCapacity: async () => true,
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
    onDurableStage: async (stage) => {
      if (stage === 'authorized') {
        if (++arrived === 2) unblock();
        await barrier;
      }
    },
  });
  try {
    await launcher.spawnGated(record);
    await Promise.all([launcher.release(record, '1', 'attempt'), launcher.release(record, '1', 'attempt')]);
    await launcher.wait(record);
    assert.equal(await readFile(marker, 'utf8'), 'x');
    assert.equal(await journal.observe(record), 'stopped');
  } finally {
    await launcher.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
