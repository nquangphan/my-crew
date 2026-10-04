import assert from 'node:assert/strict';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessJournal } from '../../../../../v2/gateway/src/journal/process-journal.ts';
import { WorkflowRegistry } from '../../../../../v2/gateway/src/workflows/registry.ts';
import { fixture, projectionAudit } from '../../../../../v2/gateway/test/support/workflow-archives.ts';

const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task4-rereview-gc-')));
const identity = await lstat(root);
const f = await fixture();
const a = projectionAudit(f, 'claude');
let journal, registry;
let deleted = false;
try {
  journal = await ProcessJournal.open(root);
  registry = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [a],
    processJournal: journal,
  });
  await registry.installSource(f.source, f.stream());
  const projection = await registry.deriveProjection(f.source, 'claude', a.recipe);
  const originalProcesses = journal.processes.bind(journal);
  let barrierUsed = false;
  journal.processes = async () => {
    const snapshot = await originalProcesses();
    if (!barrierUsed) {
      barrierUsed = true;
      assert.equal(snapshot.length, 0);
      // Deterministic interleaving: the real reader has read, then a real independent
      // journal transaction reserves the pair, then the reader returns its snapshot.
      await journal.reserve({
        commandId: 'review-concurrent-command',
        ticketId: 'review-owned-ticket',
        processInstanceId: 'review-unstarted-process',
        source: f.source,
        projection,
      });
    }
    return snapshot;
  };
  const collection = await registry.collectPublished();
  journal.processes = originalProcesses;
  const references = await registry.retained();
  const exists = await registry.exists(f.source, projection);
  let resolveError;
  try { await registry.resolve(f.source, projection); }
  catch (error) { resolveError = error.code ?? error.message; }
  assert.equal(references.length, 1);
  assert.equal(references[0].authority, 'process-journal');
  assert.equal(collection.deleted.length, 1);
  assert.equal(exists, false);
  assert.equal(resolveError, 'CHECKSUM_MISMATCH');
  console.log(JSON.stringify({
    finding: 'GC_DELETED_DURABLY_RESERVED_PROJECTION',
    root, device: String(identity.dev), inode: String(identity.ino), uid: identity.uid,
    collection, durableReferenceCount: references.length, exists, resolveError,
    processesSpawned: 0, nativeRuntimeCertificate: 'UNVERIFIED',
  }, null, 2));
} finally {
  await registry?.close();
  await journal?.close();
  const after = await lstat(root);
  assert.equal(after.dev, identity.dev);
  assert.equal(after.ino, identity.ino);
  await rm(root, { recursive: true, force: true });
  deleted = await lstat(root).then(() => false, error => error.code === 'ENOENT');
  assert(deleted);
  console.log(JSON.stringify({ cleanup: 'exact-owned-root-deleted', root, deleted }));
}
