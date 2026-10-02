import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AtomicRecords, readRecord } from '../src/journal/atomic-records.ts';
import { ProcessJournal } from '../src/journal/process-journal.ts';
import { type ExecutionReceipt, OwnedOperations } from '../src/workflows/operations.ts';
import { WorkflowRegistry } from '../src/workflows/registry.ts';
import { fixture, projectionAudit } from './support/workflow-archives.ts';

test('workflow durable operation recovers killed reserve/create/rename/quarantine checkpoints', async () => {
  for (const phase of ['reserve', 'create', 'rename', 'quarantine', 'executor']) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-crash-')));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./support/workflow-crash-worker.ts', import.meta.url)), root, phase],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    let output = '';
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (b) => {
        output += b.toString();
        if (output.includes('CHECKPOINT')) resolve();
      });
      child.once('close', (code) => reject(new Error(`checkpoint absent ${phase}: ${code}`)));
    });
    child.kill('SIGKILL');
    await exit;
    let r: WorkflowRegistry | undefined;
    for (let retry = 0; retry < 20; retry++) {
      try {
        r = await WorkflowRegistry.open(root, { sources: [], projections: [] });
        break;
      } catch (error) {
        if (!String(error).includes('Host guard unavailable')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!r) throw new Error('WRITER_LEASE_NOT_RELEASED');
    try {
      const recovered = await r.stagingInventory();
      if (phase === 'executor')
        for (let retry = 0; retry < 80; retry++) {
          if (await readRecord(join(root, 'workflows/receipts/crash-operation.json'))) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      if (phase === 'rename') {
        assert.equal(recovered[0].state, 'published');
        assert.equal(await r.current('bmad'), null);
      } else {
        assert.equal((await r.reclaim()).retained.length, 0);
        assert.equal((await r.stagingInventory())[0].state, 'deleted');
      }
    } finally {
      await r.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});
test('workflow operation native timeout yields real stop receipt and fork remains UNKNOWN', async () => {
  const retained: string[] = [];
  for (const scenario of ['timeout', 'fork']) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-lifetime-')));
    const path = join(root, 'workflows');
    const store = await AtomicRecords.open(path);
    const ops = await OwnedOperations.open(path, store);
    const id = `${scenario}-operation`;
    const identity = await ops.create(id);
    const stage = join(path, 'stages', id);
    await store.put(`stage-${id}`, {
      formatVersion: 1,
      kind: 'stage',
      id,
      operationKind: 'projection',
      state: 'owned',
      lifetime: 'subprocess',
      complete: false,
      deletionEligible: false,
      location: stage,
      payloadBytes: 0,
      bytes: null,
      reason: 'executor-active',
      identity,
    });
    try {
      if (scenario === 'timeout') {
        const receipt = await ops.execute(
          id,
          identity,
          stage,
          [process.execPath, '-e', 'setInterval(()=>{},1000)'],
          1,
        );
        assert.equal(receipt.timedOut, true);
        assert.equal(receipt.treeEmpty, true);
        assert.equal(receipt.operationId, id);
      } else {
        await assert.rejects(
          () => ops.execute(id, identity, stage, ['/bin/sh', '-c', '/bin/true & wait'], 2),
          /EXECUTOR_LIFETIME_UNKNOWN/,
        );
        const receipt = await readRecord<ExecutionReceipt>(join(path, 'receipts', `${id}.json`));
        assert.equal(receipt?.forkObserved, true);
        assert.equal(receipt?.treeEmpty, false);
      }
    } finally {
      await store.close();
    }
    const r = await WorkflowRegistry.open(root, { sources: [], projections: [] });
    try {
      const result = await r.reclaim();
      if (scenario === 'timeout') {
        assert.equal(result.deleted.length, 1);
        assert.equal(result.retained.length, 0);
      } else {
        assert.equal(result.deleted.length, 0);
        assert.equal(result.retained.length, 1);
        retained.push(root);
      }
    } finally {
      await r.close();
      if (scenario === 'timeout') await rm(root, { recursive: true, force: true });
    }
  }
  console.log('Retained genuine fork UNKNOWN fixtures:', JSON.stringify(retained));
});
test('workflow no-follow deletion unlinks symlink itself and rejects hardlink aliases', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-native-')));
  const store = await AtomicRecords.open(root);
  const ops = await OwnedOperations.open(root, store);
  try {
    await writeFile(join(root, 'outside'), 'retain');
    const one = await ops.create('symlink-operation');
    await symlink(join(root, 'outside'), join(root, 'stages/symlink-operation/escape'));
    assert((await ops.inspect('stages', 'symlink-operation', one)) > 0);
    await ops.remove('stages', 'symlink-operation', one);
    assert.equal(await readFile(join(root, 'outside'), 'utf8'), 'retain');
    const two = await ops.create('hardlink-operation');
    await link(join(root, 'outside'), join(root, 'stages/hardlink-operation/alias'));
    await assert.rejects(() => ops.remove('stages', 'hardlink-operation', two));
    assert.equal(await readFile(join(root, 'outside'), 'utf8'), 'retain');
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow published GC releases registry reference but preserves recovered unready process reference', async () => {
  const f = await fixture();
  const a = projectionAudit(f, 'claude');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-gc-')));
  const journal = await ProcessJournal.open(root);
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [a],
    processJournal: journal,
  });
  try {
    await r.installSource(f.source, f.stream());
    const pin = await r.deriveProjection(f.source, 'claude', a.recipe);
    await r.retain('run', f.source, pin);
    await r.release('run', f.source, pin);
    await journal.reserve({
      commandId: 'command',
      ticketId: 'ticket',
      processInstanceId: 'instance',
      source: f.source,
      projection: pin,
    });
    const out = await r.collectPublished();
    assert.equal(out.deleted.length, 0);
    assert.equal(out.retained.length, 2);
    assert(await r.exists(f.source, pin));
    const inventory = await r.retentionInventory();
    assert.equal(inventory[0].reason, 'accepted-finalization-producer-unavailable');
    assert((inventory[0].sourceBytes ?? 0) > 0);
    assert((inventory[0].projectionBytes ?? 0) > 0);
    assert.equal(inventory[0].releaseRequirement?.authorization, null);
  } finally {
    await r.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
  const free = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-gc-')));
  const r2 = await WorkflowRegistry.open(free, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [a],
  });
  try {
    await r2.installSource(f.source, f.stream());
    const pin = await r2.deriveProjection(f.source, 'claude', a.recipe);
    await r2.retain('run', f.source, pin);
    await r2.release('run', f.source, pin);
    const out = await r2.collectPublished();
    assert.equal(out.deleted.length, 1);
    assert.equal(out.retained.length, 1);
    assert.equal(await r2.exists(f.source, pin), false);
  } finally {
    await r2.close();
    await rm(free, { recursive: true, force: true });
  }
});
