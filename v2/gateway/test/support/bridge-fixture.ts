import assert from 'node:assert/strict';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessJournal } from '../../src/journal/process-journal.ts';
import { WorkflowRegistry } from '../../src/workflows/registry.ts';
import { canonical, fixture, projectionAudit, sha } from './workflow-archives.ts';
export async function bridgeRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task5-bridge-')));
  const identity = await lstat(root);
  console.log(
    'Task5 owned root',
    JSON.stringify({ root, device: String(identity.dev), inode: String(identity.ino), uid: identity.uid }),
  );
  return {
    root,
    async cleanup() {
      const current = await lstat(root);
      assert.equal(current.dev, identity.dev);
      assert.equal(current.ino, identity.ino);
      assert.equal(current.uid, identity.uid);
      await rm(root, { recursive: true });
      console.log(
        'Task5 owned cleanup',
        JSON.stringify({
          root,
          device: String(identity.dev),
          inode: String(identity.ino),
          uid: identity.uid,
          deleted: true,
        }),
      );
    },
  };
}
export async function workflowFixture(root: string) {
  const sources = await Promise.all([fixture('bmad'), fixture('superpowers')]);
  const projections = sources.flatMap((f) =>
    ['claude', 'codex', 'api'].map((runtime) => {
      const audit = projectionAudit(f, runtime as 'claude' | 'codex' | 'api');
      if (runtime !== 'api') return audit;
      const policy = canonical({ fixture: true, modelExecution: false });
      const entries = [
        ...f.entries,
        {
          path: 'adapter-policy.json',
          type: 'file',
          mode: 0o644,
          bytes: Buffer.byteLength(policy),
          sha256: sha(policy),
        },
      ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
      const recipe = { ...audit.recipe, policySha256: sha(policy) };
      const { officialEntrypoints: _entries, ...derivation } = recipe;
      const base = {
        runtime: 'api' as const,
        sourceTreeSha256: f.source.sourceTreeSha256,
        manifestSha256: sha(canonical(entries)),
        derivation,
      };
      return { ...audit, recipe, policy, expected: { ...base, treeSha256: sha(canonical(base)) } };
    }),
  );
  const journal = await ProcessJournal.open(root);
  const registry = await WorkflowRegistry.open(root, {
    processJournal: journal,
    sources: sources.map((f) => ({ pin: f.source, executables: f.executables })),
    projections,
  });
  const desired = Object.fromEntries(
    sources.map((f) => [
      f.source.name,
      {
        source: f.source,
        projections: Object.fromEntries(
          projections
            .filter((a) => a.sourceTreeSha256 === f.source.sourceTreeSha256)
            .map((a) => [a.runtime, a.expected]),
        ),
      },
    ]),
  );
  return {
    journal,
    registry,
    sources,
    projections,
    desired,
    async install() {
      for (const f of sources) await registry.installSource(f.source, f.stream());
      for (const a of projections)
        await registry.deriveProjection(
          sources.find((f) => f.source.sourceTreeSha256 === a.sourceTreeSha256)!.source,
          a.runtime,
          a.recipe,
        );
    },
    async close() {
      await registry.close();
      await journal.close();
    },
  };
}

export async function commandFixture(w: Awaited<ReturnType<typeof workflowFixture>>) {
  const { randomUUID } = await import('node:crypto');
  const { toDomainPin } = await import('../../src/commands/contracts.ts');
  const source = w.sources[1].source;
  const projection = w.projections.find(
    (a) => a.sourceTreeSha256 === source.sourceTreeSha256 && a.runtime === 'codex',
  );
  assert(projection);
  const selection = {
    runtime: 'codex' as const,
    sourceTreeSha256: source.sourceTreeSha256,
    projectionManifestSha256: projection.expected.manifestSha256,
    projectionTreeSha256: projection.expected.treeSha256,
    installReportId: randomUUID(),
    configRevision: 1,
    decisionId: randomUUID(),
  };
  const command: import('../../src/commands/contracts.ts').Command = {
    id: randomUUID(),
    machineId: randomUUID(),
    ticketId: randomUUID(),
    type: 'start',
    payload: { selection },
    state: 'queued',
    result: null,
  };
  const permit = {
    commandId: command.id,
    machineId: command.machineId,
    ticketId: command.ticketId,
    bindingRevision: 1,
    ticketRevision: 1,
    workflow: toDomainPin(source),
    decisionId: selection.decisionId,
    telemetryId: randomUUID(),
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  return { command, permit };
}
