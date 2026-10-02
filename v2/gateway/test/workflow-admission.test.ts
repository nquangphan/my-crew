import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ProcessJournal } from '../src/journal/process-journal.ts';
import { WorkflowRegistry } from '../src/workflows/registry.ts';
import { fixture, projectionAudit } from './support/workflow-archives.ts';

function barrier() {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
const ownedRoots = new Map<string, Awaited<ReturnType<typeof lstat>>>();
async function ownedRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  ownedRoots.set(root, await lstat(root));
  return root;
}
async function cleanupOwnedRoot(root: string): Promise<void> {
  const identity = ownedRoots.get(root);
  assert(identity);
  const current = await lstat(root);
  assert.equal(current.dev, identity.dev);
  assert.equal(current.ino, identity.ino);
  assert.equal(current.uid, identity.uid);
  await rm(root, { recursive: true, force: true });
  assert.equal(
    await lstat(root).then(
      () => true,
      () => false,
    ),
    false,
  );
  console.log(
    'Admission owned cleanup:',
    JSON.stringify({
      root,
      device: String(identity.dev),
      inode: String(identity.ino),
      ownerUid: identity.uid,
      deleted: true,
    }),
  );
}
for (const boundary of ['snapshot', 'quarantine', 'delete'] as const) {
  test(`workflow admission GC-first at ${boundary} denies reserve or preserves its resolvable pair`, async () => {
    const f = await fixture();
    const audit = projectionAudit(f, 'claude');
    const root = await ownedRoot('crew-task4-admission-');
    const journal = await ProcessJournal.open(root);
    const registry = await WorkflowRegistry.open(root, {
      sources: [{ pin: f.source, executables: f.executables }],
      projections: [audit],
      processJournal: journal,
    });
    const entered = barrier(),
      proceed = barrier();
    let used = false;
    const pause = async () => {
      if (!used) {
        used = true;
        entered.release();
        await proceed.wait;
      }
    };
    try {
      await registry.installSource(f.source, f.stream());
      const projection = await registry.deriveProjection(f.source, 'claude', audit.recipe);
      if (boundary === 'snapshot') {
        const original = journal.processes.bind(journal);
        journal.processes = async () => {
          const snapshot = await original();
          await pause();
          return snapshot;
        };
      } else {
        const operations = Reflect.get(registry, 'operations');
        const helper = Reflect.get(operations, 'helper');
        const original = helper.run.bind(helper);
        helper.run = async (args: string[]) => {
          if (args[0] === boundary) await pause();
          return original(args);
        };
      }
      const collection = registry.collectPublished();
      await entered.wait;
      const reservation = journal
        .reserve({
          commandId: 'concurrent',
          ticketId: 'ticket',
          processInstanceId: 'instance',
          source: f.source,
          projection,
        })
        .then(
          (record) => ({ record, error: null }),
          (error: Error) => ({ record: null, error }),
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
      proceed.release();
      await collection;
      const outcome = await reservation;
      if (outcome.record) await registry.resolve(f.source, projection);
      else {
        assert(outcome.error);
        assert.equal((await journal.processes()).length, 0);
      }
      console.log(
        'Admission boundary:',
        boundary,
        outcome.record ? 'durable-and-resolvable' : outcome.error?.message,
      );
    } finally {
      proceed.release();
      await registry.close();
      await journal.close();
      await cleanupOwnedRoot(root);
    }
  });
}

test('workflow admission reserve-first holds GC until real journal commit and survives cached replay', async () => {
  const f = await fixture(),
    audit = projectionAudit(f, 'claude');
  const root = await ownedRoot('crew-task4-admission-');
  const journal = await ProcessJournal.open(root);
  const registry = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [audit],
    processJournal: journal,
  });
  const entered = barrier(),
    proceed = barrier();
  try {
    await registry.installSource(f.source, f.stream());
    const projection = await registry.deriveProjection(f.source, 'claude', audit.recipe);
    const store = Reflect.get(journal, 'store');
    const original = store.put.bind(store);
    store.put = async (id: string, value: unknown) => {
      if (id === 'held-commit') {
        entered.release();
        await proceed.wait;
      }
      return original(id, value);
    };
    const input = {
      commandId: 'held-commit',
      ticketId: 'ticket',
      processInstanceId: 'instance',
      source: f.source,
      projection,
    };
    const reserve = journal.reserve(input);
    await entered.wait;
    assert.equal((await journal.processes()).length, 0);
    assert.equal((await journal.pendingPinAdmissions()).length, 1);
    let gcFinished = false;
    const gc = registry.collectPublished().then((result) => {
      gcFinished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(gcFinished, false);
    proceed.release();
    const record = await reserve,
      result = await gc;
    assert.equal(result.deleted.length, 0);
    assert.equal(result.retained.length, 2);
    assert.equal((await journal.pendingPinAdmissions()).length, 0);
    assert.deepEqual(await journal.reserve(input), record);
    await registry.resolve(f.source, projection);
  } finally {
    proceed.release();
    await registry.close();
    await journal.close();
    await cleanupOwnedRoot(root);
  }
});

test('workflow admission managed unbound/reopened writers deny until bound and legacy records retain v1 shape', async () => {
  const f = await fixture(),
    audit = projectionAudit(f, 'claude');
  const root = await ownedRoot('crew-task4-admission-');
  let journal = await ProcessJournal.open(root);
  let registry = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [audit],
  });
  try {
    await registry.installSource(f.source, f.stream());
    const projection = await registry.deriveProjection(f.source, 'claude', audit.recipe);
    const input = {
      commandId: 'bound-command',
      ticketId: 'ticket',
      processInstanceId: 'instance',
      source: f.source,
      projection,
    };
    await assert.rejects(() => journal.reserve(input), /PIN_ADMISSION_NOT_BOUND/);
    await assert.rejects(() => registry.collectPublished(), /PIN_ADMISSION_NOT_BOUND/);
    await registry.close();
    registry = await WorkflowRegistry.open(root, {
      sources: [{ pin: f.source, executables: f.executables }],
      projections: [audit],
      processJournal: journal,
    });
    const record = await journal.reserve(input);
    assert.equal(record.formatVersion, 1);
    await assert.rejects(() => ProcessJournal.open(root), /Host guard unavailable/);
    await assert.rejects(
      () => WorkflowRegistry.open(root, { sources: [], projections: [] }),
      /Host guard unavailable/,
    );
    await registry.close();
    await journal.close();
    journal = await ProcessJournal.open(root);
    await assert.rejects(() => journal.reserve(input), /PIN_ADMISSION_NOT_BOUND/);
    registry = await WorkflowRegistry.open(root, {
      sources: [{ pin: f.source, executables: f.executables }],
      projections: [audit],
      processJournal: journal,
    });
    assert.deepEqual(await journal.reserve(input), record);
    await registry.resolve(f.source, projection);
    assert.equal((await registry.retained()).length, 1);
  } finally {
    await registry.close();
    await journal.close();
    await cleanupOwnedRoot(root);
  }
});

test('workflow admission bind waits for an in-flight standalone v1 reservation before GC', async () => {
  const f = await fixture(),
    audit = projectionAudit(f, 'claude');
  const root = await ownedRoot('crew-task4-admission-');
  const journal = await ProcessJournal.open(root);
  const entered = barrier(),
    proceed = barrier();
  let registry: WorkflowRegistry | undefined;
  try {
    const store = Reflect.get(journal, 'store'),
      original = store.put.bind(store);
    store.put = async (id: string, value: unknown) => {
      if (id === 'legacy') {
        entered.release();
        await proceed.wait;
      }
      return original(id, value);
    };
    const input = {
      commandId: 'legacy',
      ticketId: 'ticket',
      processInstanceId: 'instance',
      source: f.source,
      projection: audit.expected,
    };
    const reserve = journal.reserve(input);
    await entered.wait;
    let bound = false;
    const opening = WorkflowRegistry.open(root, {
      sources: [{ pin: f.source, executables: f.executables }],
      projections: [audit],
      processJournal: journal,
    }).then((value) => {
      bound = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(bound, false);
    proceed.release();
    const legacy = await reserve;
    registry = await opening;
    await registry.installSource(f.source, f.stream());
    await registry.deriveProjection(f.source, 'claude', audit.recipe);
    assert.deepEqual(await journal.reserve(input), legacy);
    assert.equal((await registry.collectPublished()).deleted.length, 0);
    await registry.resolve(f.source, audit.expected);
  } finally {
    proceed.release();
    await registry?.close();
    await journal.close();
    await cleanupOwnedRoot(root);
  }
});

for (const phase of ['admission', 'committed', 'quarantine'] as const) {
  test(`workflow admission crash at ${phase} retains unknown intent or denies a deleted pair after restart`, async () => {
    const f = await fixture(),
      audit = projectionAudit(f, 'claude');
    const root = await ownedRoot('crew-task4-admission-crash-');
    const identity = await lstat(root);
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./support/workflow-admission-crash-worker.ts', import.meta.url)), root, phase],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    let output = '',
      errors = '';
    child.stderr.on('data', (bytes) => {
      errors += bytes.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (bytes) => {
        output += bytes.toString();
        if (output.includes('CHECKPOINT')) resolve();
      });
      child.once('close', (code) => reject(new Error(`checkpoint missing: ${code} ${errors}`)));
    });
    child.kill('SIGKILL');
    await exit;
    let journal: ProcessJournal | undefined;
    let registry: WorkflowRegistry | undefined;
    try {
      for (let retry = 0; retry < 30; retry++) {
        try {
          journal = await ProcessJournal.open(root);
          break;
        } catch (error) {
          if (!String(error).includes('Host guard unavailable')) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (!journal) throw new Error('WRITER_LEASE_NOT_RELEASED');
      const boundJournal = journal;
      const input = {
        commandId: 'crash-admission',
        ticketId: 'ticket',
        processInstanceId: 'instance',
        source: f.source,
        projection: audit.expected,
      };
      await assert.rejects(() => boundJournal.reserve(input), /PIN_ADMISSION_NOT_BOUND/);
      registry = await WorkflowRegistry.open(root, {
        sources: [{ pin: f.source, executables: f.executables }],
        projections: [audit],
        processJournal: journal,
      });
      if (phase === 'quarantine') {
        assert.equal((await journal.processes()).length, 0);
        assert.equal((await journal.pendingPinAdmissions()).length, 0);
        const entered = barrier(),
          proceed = barrier();
        const operations = Reflect.get(registry, 'operations'),
          helper = Reflect.get(operations, 'helper');
        const original = helper.run.bind(helper);
        helper.run = async (args: string[]) => {
          if (args[0] === 'delete') {
            entered.release();
            await proceed.wait;
          }
          return original(args);
        };
        const reclaim = registry.reclaim();
        await entered.wait;
        const reserve = journal.reserve(input).then(
          () => null,
          (error: Error) => error,
        );
        proceed.release();
        assert.equal((await reclaim).deleted.length, 1);
        assert(await reserve, 'missing pair must reject before LaunchRecord commit');
        assert.equal((await journal.processes()).length, 0);
      } else {
        const intents = await journal.pendingPinAdmissions();
        assert.equal(intents.length, phase === 'admission' ? 1 : 0);
        const inventory = await registry.retentionInventory();
        assert.equal(inventory.length, 1);
        assert.equal(
          inventory[0].reason,
          phase === 'admission'
            ? 'durable-pin-admission-intent'
            : 'accepted-finalization-producer-unavailable',
        );
        assert((inventory[0].sourceBytes ?? 0) > 0 && (inventory[0].projectionBytes ?? 0) > 0);
        assert.equal((await registry.collectPublished()).deleted.length, 0);
        await registry.resolve(f.source, audit.expected);
        const record = await journal.reserve(input);
        assert.equal(record.formatVersion, 1);
        assert.equal((await journal.pendingPinAdmissions()).length, 0);
        assert.equal((await registry.retained()).length, 1);
      }
      console.log(
        'Recovered admission checkpoint:',
        phase,
        'source pair protected or reservation denied; no process launched',
      );
    } finally {
      await registry?.close();
      await journal?.close();
      const after = await lstat(root);
      assert.equal(after.ino, identity.ino);
      assert.equal(after.dev, identity.dev);
      await cleanupOwnedRoot(root);
      assert.equal(
        await lstat(root).then(
          () => true,
          () => false,
        ),
        false,
      );
    }
  });
}
