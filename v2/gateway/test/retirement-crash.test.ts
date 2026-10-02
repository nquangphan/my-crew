import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { FinalizedPinAuthority } from '../src/journal/process-journal.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

for (const stage of ['before-write', 'after-write', 'after-filter'])
  test(`terminal retirement SIGKILL ${stage} preserves durable proof and reference authority`, async () => {
    const owned = await bridgeRoot();
    const child = fork(
      new URL('./support/pin-retirement-crash-worker.ts', import.meta.url),
      [owned.root, stage],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`TIMEOUT ${stderr}`)), 10000);
        child.once('message', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`EARLY_EXIT ${stderr}`));
        });
      });
      const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await ended;
      const w = await workflowFixture(owned.root);
      try {
        const [record] = await w.journal.processes();
        assert(record);
        assert.equal((await w.journal.activePinReferences()).length, stage === 'before-write' ? 1 : 0);
        const prior = await w.journal.pinRetirement(record);
        assert.equal(prior === null, stage === 'before-write');
        const ready = prior?.stop ?? (await w.journal.ready(record));
        assert(ready);
        assert.equal(await w.journal.identity.groupEmpty(ready.processGroupId), true);
        const state = JSON.parse(await readFile(join(owned.root, 'fixture-authority.json'), 'utf8')) as {
          authority: FinalizedPinAuthority;
        };
        await w.journal.bindPinRetirementAuthority(async () => state.authority);
        const receipt = await w.journal.retirePinReference(record);
        if (prior) assert.deepEqual(receipt, prior);
        assert.equal((await w.journal.activePinReferences()).length, 0);
        assert.equal((await w.journal.processes()).length, 1);
        assert.equal((await w.journal.pendingPinAdmissions()).length, 0);
        await assert.rejects(w.journal.reserve(receipt.input), /PIN_REFERENCE_RETIRED/);
        assert.equal((await w.registry.collectPublished()).failed.length, 0);
        await assert.rejects(w.registry.resolve(record.source, record.projection), /CHECKSUM_MISMATCH/);
      } finally {
        await w.close();
      }
      await owned.cleanup();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL');
        await ended;
      }
    }
  });
