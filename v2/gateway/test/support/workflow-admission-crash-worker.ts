import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProcessJournal } from '../../src/journal/process-journal.ts';
import { WorkflowRegistry } from '../../src/workflows/registry.ts';
import { fixture, projectionAudit } from './workflow-archives.ts';

const [root, phase] = process.argv.slice(2);
const f = await fixture(),
  audit = projectionAudit(f, 'claude');
const journal = await ProcessJournal.open(root);
const registry = await WorkflowRegistry.open(root, {
  sources: [{ pin: f.source, executables: f.executables }],
  projections: [audit],
  processJournal: journal,
});
await registry.installSource(f.source, f.stream());
const projection = await registry.deriveProjection(f.source, 'claude', audit.recipe);
const input = {
  commandId: 'crash-admission',
  ticketId: 'ticket',
  processInstanceId: 'instance',
  source: f.source,
  projection,
};
const checkpoint = async () => {
  console.log('CHECKPOINT');
  await new Promise(() => {});
};
if (phase === 'admission') {
  const store = Reflect.get(journal, 'store'),
    original = store.put.bind(store);
  store.put = async (id: string, value: unknown) => {
    if (id === input.commandId) await checkpoint();
    return original(id, value);
  };
  await journal.reserve(input);
} else if (phase === 'committed') {
  await journal.reserve(input);
  await checkpoint();
} else {
  const operations = Reflect.get(registry, 'operations'),
    helper = Reflect.get(operations, 'helper');
  const original = helper.run.bind(helper);
  let paused = false;
  helper.run = async (args: string[]) => {
    const result = await original(args);
    if (!paused && args[0] === 'quarantine') {
      paused = true;
      const state = await lstat(join(registry.root, 'quarantine', args[7]));
      console.log('Actual quarantine inode:', state.ino);
      void journal.reserve(input).catch(() => {}); // Waiting on GC's actual journal barrier, no intent yet.
      await checkpoint();
    }
    return result;
  };
  await registry.collectPublished();
}
