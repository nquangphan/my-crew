import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AtomicRecords, readRecord } from '../../src/journal/atomic-records.ts';
import { NativeHelper } from '../../src/journal/native.ts';
import type { ExecutionReceipt, OwnedIdentity } from '../../src/workflows/operations.ts';

const results = [];
for (const root of process.argv.slice(2)) {
  const store = await AtomicRecords.open(root);
  try {
    const probe = await store.get<{ formatVersion: 1; id: string; identity: OwnedIdentity }>('probe');
    const layout = await store.get<{
      formatVersion: 1;
      root: OwnedIdentity;
      parents: { stages: OwnedIdentity; quarantine: OwnedIdentity };
    }>('operation-layout');
    if (!probe || !layout) throw new Error('PROBE_AUTHORITY_MISSING');
    const stage = join(root, 'stages', probe.id);
    const receipt = await readRecord<ExecutionReceipt>(join(root, 'receipts', `${probe.id}.json`));
    if (
      !receipt?.treeEmpty ||
      receipt.forkObserved ||
      receipt.operationId !== probe.id ||
      receipt.device !== probe.identity.device ||
      receipt.inode !== probe.identity.inode
    )
      throw new Error('PROBE_STOP_UNKNOWN');
    const actual = await lstat(stage);
    if (
      String(actual.dev) !== probe.identity.device ||
      String(actual.ino) !== probe.identity.inode ||
      actual.uid !== probe.identity.ownerUid
    )
      throw new Error('PROBE_IDENTITY_MISMATCH');
    const marker = await readFile(join(stage, '.operation-owner'), 'utf8');
    if (marker !== `${probe.id} ${probe.identity.device} ${probe.identity.inode}\n`)
      throw new Error('PROBE_MARKER_MISMATCH');
    const helper = await NativeHelper.build(
      root,
      new URL('../../src/workflows/operation-native.c', import.meta.url).pathname,
    );
    const prefix = [
      root,
      layout.root.device,
      layout.root.inode,
      'stages',
      layout.parents.stages.device,
      layout.parents.stages.inode,
      probe.id,
      probe.identity.device,
      probe.identity.inode,
      String(probe.identity.linkCount),
    ];
    const bytes = (JSON.parse(await helper.run(['inspect', ...prefix])) as OwnedIdentity).bytes;
    const log = await readFile(join(stage, 'execution.log'), 'utf8');
    await writeFile(
      join(root, 'proven-build-receipt.json'),
      JSON.stringify({ receipt, identity: probe.identity, bytes, logTail: log.slice(-8192) }, null, 2),
      { mode: 0o600 },
    );
    await helper.run([
      'quarantine',
      ...prefix,
      layout.parents.quarantine.device,
      layout.parents.quarantine.inode,
    ]);
    await helper.run([
      'delete',
      root,
      layout.root.device,
      layout.root.inode,
      'quarantine',
      layout.parents.quarantine.device,
      layout.parents.quarantine.inode,
      probe.id,
      probe.identity.device,
      probe.identity.inode,
      String(probe.identity.linkCount),
    ]);
    await store.put('probe-cleanup', {
      formatVersion: 1,
      receipt,
      identity: probe.identity,
      bytes: 0,
      reason: 'REAL_NO_FORK_WAIT_RECEIPT_AND_FD_IDENTITY_RECLAIMED',
    });
    results.push({ root, deletedStage: probe.id, reclaimedBytes: bytes, remainingBytes: 0, receipt });
  } finally {
    await store.close();
  }
}
await writeFile(
  new URL(
    '../../../../plans/261002-0002-crew-v2/execution-phase03/task-4-evidence/probe-cleanup.json',
    import.meta.url,
  ),
  JSON.stringify(results, null, 2),
);
console.log(
  'Reclaimed proven build stage bytes:',
  results.reduce((sum, r) => sum + (r.reclaimedBytes ?? 0), 0),
);
