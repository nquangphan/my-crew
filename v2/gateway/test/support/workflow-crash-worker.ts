import { lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { AtomicRecords } from '../../src/journal/atomic-records.ts';
import { OwnedOperations } from '../../src/workflows/operations.ts';
import type { StageRecord } from '../../src/workflows/registry.ts';

const [root, phase] = process.argv.slice(2);
const path = join(root, 'workflows');
const store = await AtomicRecords.open(path);
const operations = await OwnedOperations.open(path, store);
const id = 'crash-operation';
let record: StageRecord = {
  formatVersion: 1,
  kind: 'stage',
  id,
  operationKind: 'source',
  state: 'reserved',
  lifetime: 'pure',
  complete: false,
  location: join(path, 'stages', id),
  payloadBytes: 0,
  bytes: null,
  reason: 'operation-unresolved',
  deletionEligible: false,
};
await store.put(`stage-${id}`, record);
if (phase !== 'reserve') {
  const identity = await operations.create(id);
  if (phase !== 'create') {
    record = { ...record, identity, state: 'owned' };
    await store.put(`stage-${id}`, record);
    if (phase === 'executor') {
      record = { ...record, lifetime: 'subprocess' };
      await store.put(`stage-${id}`, record);
      void operations
        .execute(
          id,
          identity,
          join(path, 'stages', id),
          [process.execPath, '-e', 'setInterval(()=>{},1000)'],
          2,
        )
        .catch(() => {});
      for (let retry = 0; retry < 200; retry++) {
        if (
          await lstat(join(path, 'stages', id, 'execution.log')).then(
            () => true,
            () => false,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      console.log('CHECKPOINT');
      await new Promise(() => {});
    }
    if (phase === 'quarantine')
      await operations.remove('stages', id, identity, async () => {
        console.log('CHECKPOINT');
        await new Promise(() => {});
      });
    else {
      record = { ...record, publication: { parent: 'sources', name: 'crash-published' } };
      await store.put(`stage-${id}`, record);
      await rename(join(path, 'stages', id), join(path, 'sources', 'crash-published'));
    }
  }
}
console.log('CHECKPOINT');
await new Promise(() => {});
