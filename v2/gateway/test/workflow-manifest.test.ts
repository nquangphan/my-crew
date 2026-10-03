import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkflowManifest } from '../src/assistant/workflow-manifest.ts';
import { type ProjectionPin, projectionTreeHash, type SourcePin } from '../src/workflows/pins.ts';
import type { WorkflowRegistry } from '../src/workflows/registry.ts';
import { manifest, manifestHash, parseArchive, validateFiles, writeTree } from '../src/workflows/stage.ts';

const fixtures = new URL('./fixtures/', import.meta.url);

async function officialFixtures() {
  const audits = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtures), 'utf8'));
  const builds = JSON.parse(
    await readFile(new URL('workflow-builder/real-projections.json', fixtures), 'utf8'),
  );
  return { audits, builds };
}

async function withOfficialSuperpowers(
  run: (
    resolver: Pick<WorkflowRegistry, 'resolve'>,
    source: SourcePin,
    projection: ProjectionPin,
  ) => Promise<void>,
) {
  const { audits } = await officialFixtures();
  const source = audits.superpowers.source.pin as SourcePin;
  const projectionAudit = audits.superpowers.projections.claude;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-manifest-')));
  try {
    const archive = await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtures));
    const files = await parseArchive(archive, audits.superpowers.source.executables);
    const projected = validateFiles(
      projectionAudit.mappings.flatMap((mapping: { from: string; to: string }) =>
        files
          .filter((file) => file.path === mapping.from || file.path.startsWith(`${mapping.from}/`))
          .map((file) => ({
            ...file,
            path: `${mapping.to}${file.path.slice(mapping.from.length)}`,
            body: Buffer.from(file.body),
          })),
      ),
    );
    assert.equal(manifestHash(manifest(files)), source.sourceManifestSha256);
    assert.equal(manifestHash(manifest(projected)), projectionAudit.expected.manifestSha256);
    const sourceRoot = join(root, 'source');
    const projectionRoot = join(root, 'projection');
    await writeTree(sourceRoot, files);
    await writeTree(projectionRoot, projected);
    // Unit-only resolver carrying actual pinned archive bytes and audited projection layout.
    const resolver: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async () => ({
        sourceRoot,
        projectionRoot,
        manifest: { source: manifest(files), projection: manifest(projected) },
      }),
    };
    await run(resolver, source, projectionAudit.expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('workflow manifest binds Superpowers skills to official source and selected projection bytes', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const adapter = createWorkflowManifest(resolver);
    const first = await adapter.loadDefinition(source, projection);
    const replay = await adapter.loadDefinition(source, projection);

    assert.match(first.sha256, /^[0-9a-f]{64}$/);
    assert.equal(first.sha256, replay.sha256);
    assert.equal(first.skills.length, 15);
    assert.deepEqual(first.skills[0], {
      path: 'skills/brainstorming/SKILL.md',
      sha256: 'a32d2255354775aa124855aa7100cf276bea096fff4ebb3a0edf57be216e6c72',
    });
    assert(
      first.skills.some(
        (skill) =>
          skill.path === 'skills/systematic-debugging/SKILL.md' &&
          skill.sha256 === '808fc5717aa88ad65efff312b11c186294d3e6ee301afb584e2f86599b137787',
      ),
    );
  });
});

test('workflow manifest rejects a projected skill hash that differs from its pinned source', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    // Unit-only compromised producer: a real WorkflowRegistry would reject a drifted manifest.
    const compromised = {
      resolve: async () => ({
        ...resolved,
        manifest: {
          ...resolved.manifest,
          projection: resolved.manifest.projection.map((entry) =>
            entry.path === 'skills/brainstorming/SKILL.md' ? { ...entry, sha256: '0'.repeat(64) } : entry,
          ),
        },
      }),
    };
    await assert.rejects(
      createWorkflowManifest(compromised).loadDefinition(source, projection),
      /WORKFLOW_SKILL_MISMATCH/,
    );
  });
});

test('workflow manifest re-reads exact skill bytes instead of trusting manifest hash claims', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    await writeFile(join(resolved.sourceRoot, 'skills/brainstorming/SKILL.md'), 'tampered');
    await assert.rejects(
      createWorkflowManifest(resolver).loadDefinition(source, projection),
      /WORKFLOW_SKILL_MISMATCH/,
    );
  });
});

test('workflow manifest rejects a projection bound to another source tree', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const base = { ...projection, sourceTreeSha256: '0'.repeat(64) };
    const foreign = { ...base, treeSha256: projectionTreeHash(base) };
    await assert.rejects(
      createWorkflowManifest(resolver).loadDefinition(source, foreign),
      /SOURCE_PROJECTION_MISMATCH/,
    );
  });
});

test('workflow manifest denies BMAD when no trusted renderer artifact reader is bound', async () => {
  const { audits, builds } = await officialFixtures();
  // Unit-only registry stub; the pinned npm source and generated projection identities are real.
  const unresolved = {
    resolve: async () => ({
      sourceRoot: '/unavailable',
      projectionRoot: '/unavailable',
      manifest: { source: [], projection: [] },
    }),
  };
  await assert.rejects(
    createWorkflowManifest(unresolved).loadDefinition(audits.bmad.source.pin, builds.bmad.claude.expected),
    /RENDER_ARTIFACT_REQUIRED/,
  );
});

test('workflow manifest keeps one validated snapshot across a deferred registry resolve', async () => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const originalSource = structuredClone(source);
    const originalProjection = structuredClone(projection);
    const baseline = await createWorkflowManifest(resolver).loadDefinition(
      originalSource,
      originalProjection,
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const deferred: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async (inputSource, inputProjection) => {
        // The real registry snapshots both inputs before its first await.
        const capturedSource = structuredClone(inputSource);
        const capturedProjection = structuredClone(inputProjection);
        entered.resolve();
        await release.promise;
        return resolver.resolve(capturedSource, capturedProjection);
      },
    };
    const pending = createWorkflowManifest(deferred).loadDefinition(source, projection);
    await entered.promise;
    source.name = 'bmad';
    projection.runtime = 'api';
    projection.derivation.options.push('changed-after-validation');
    release.resolve();
    assert.deepEqual(await pending, baseline);
  });
});

test('workflow manifest rejects a FIFO skill drift within a bounded reader deadline', async (context) => {
  await withOfficialSuperpowers(async (resolver, source, projection) => {
    const resolved = await resolver.resolve(source, projection);
    context.diagnostic(`fifo scratch root=${join(resolved.sourceRoot, '..')}`);
    const target = join(resolved.sourceRoot, 'skills/brainstorming/SKILL.md');
    await rm(target);
    const fifo = spawnSync('/usr/bin/mkfifo', [target], { timeout: 3000, encoding: 'utf8' });
    context.diagnostic(`mkfifo pid=${fifo.pid} status=${fifo.status} signal=${fifo.signal ?? 'none'}`);
    assert.equal(fifo.status, 0, fifo.stderr || String(fifo.error));
    const fixturePath = join(resolved.sourceRoot, '..', 'fifo-case.json');
    await writeFile(fixturePath, JSON.stringify({ resolved, source, projection }));

    const script = `
      import { readFile } from 'node:fs/promises';
      import { createWorkflowManifest } from ${JSON.stringify(new URL('../src/assistant/workflow-manifest.ts', import.meta.url).href)};
      const { resolved, source, projection } = JSON.parse(await readFile(process.argv[1], 'utf8'));
      const registry = { resolve: async () => { process.stdout.write('RESOLVED\\n'); return resolved; } };
      try {
        await createWorkflowManifest(registry).loadDefinition(source, projection);
        process.stderr.write('UNEXPECTED_SUCCESS\\n');
        process.exitCode = 2;
      } catch (error) {
        process.stderr.write(String(error?.message ?? error) + '\\n');
        process.exitCode = String(error?.message ?? error).includes('WORKFLOW_SKILL_MISMATCH') ? 0 : 3;
      }
    `;
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=128', '--input-type=module', '--eval', script, fixturePath],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { NODE_OPTIONS: '--max-old-space-size=128' },
      },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk.slice(0, 8192);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk.slice(0, 8192);
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveChild, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error);
            }
          }
        }, 3000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          resolveChild({ code, signal });
        });
      },
    );
    context.diagnostic(
      `fifo child pid=${child.pid} pgid=${child.pid} reaped=close code=${result.code} signal=${result.signal ?? 'none'} timedOut=${timedOut}`,
    );
    context.diagnostic(`fifo child boundary=${stdout.trim()}`);
    assert.match(stdout, /RESOLVED/, `child did not reach the reader: ${stderr}`);
    assert.equal(timedOut, false, `reader blocked on FIFO; child reaped by watchdog (${result.signal})`);
    assert.equal(result.code, 0, stderr);
    assert.match(stderr, /WORKFLOW_SKILL_MISMATCH/);
  });
});
