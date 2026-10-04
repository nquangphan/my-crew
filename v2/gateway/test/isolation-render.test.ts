import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { ExecutableIdentity, RenderPrerequisites } from '../src/assistant/render-executor.ts';
import { createWorkflowManifest, type WorkflowDefinition } from '../src/assistant/workflow-manifest.ts';
import { auditWorkspace } from '../src/isolation/inventory.ts';
import { IsolationWorkspace } from '../src/isolation/workspace.ts';
import { AtomicRecords } from '../src/journal/atomic-records.ts';
import type { ProjectionPin, SourcePin } from '../src/workflows/pins.ts';
import { type ProjectionAudit, type SourceAudit, WorkflowRegistry } from '../src/workflows/registry.ts';
import {
  manifest,
  manifestHash,
  parseArchive,
  type TreeFile,
  validateFiles,
} from '../src/workflows/stage.ts';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const git = '/Library/Developer/CommandLineTools/usr/bin/git';
const skill = '.claude/skills/bmad-build';

// A synthetic copy projection of the pinned BMAD 6.12.0 source. Token-free markdown stands in for the
// skill so the renderer double's identity output passes the artifact inspector; the projection also
// ships scripts and files the render subset must never copy (memlog/resolve_*, `.gitignore`, a
// non-markdown file in the skill directory).
const mappings = [
  { from: 'src/bmm-skills/ship/bmad-build/SKILL.md', to: `${skill}/SKILL.md` },
  { from: 'src/bmm-skills/ship/bmad-build/spec-template.md', to: `${skill}/workflow.md` },
  { from: 'src/bmm-skills/ship/bmad-build/references', to: `${skill}/references` },
  { from: 'src/bmm-skills/ship/bmad-build/customize.toml', to: `${skill}/customize.toml` },
  { from: 'src/scripts/memlog.py', to: `${skill}/notes.py` },
  { from: 'src/scripts', to: '_bmad/scripts' },
  { from: 'src/bmm-skills/agents/bmad-agent-pm/customize.toml', to: '_bmad/config.toml' },
  { from: 'src/bmm-skills/plan/bmad-prd/customize.toml', to: '_bmad/custom/config.toml' },
  { from: 'src/bmm-skills/ship/bmad-build/references/claims-check.md', to: '_bmad/custom/.gitignore' },
];
const expectedFiles = [
  '.claude/skills/bmad-build/SKILL.md',
  '.claude/skills/bmad-build/customize.toml',
  '.claude/skills/bmad-build/references/claims-check.md',
  '.claude/skills/bmad-build/references/deletion-check.md',
  '.claude/skills/bmad-build/workflow.md',
  '_bmad/config.toml',
  '_bmad/custom/config.toml',
  '_bmad/scripts/config_utils.py',
  '_bmad/scripts/render_skill.py',
];

async function copyProjection(source: SourceAudit, archive: Buffer): Promise<ProjectionAudit> {
  const files = await parseArchive(archive, source.executables);
  const out: TreeFile[] = [];
  for (const { from, to } of mappings)
    for (const file of files)
      if (file.path === from || file.path.startsWith(`${from}/`))
        out.push({ ...file, path: `${to}${file.path.slice(from.length)}`, body: Buffer.from(file.body) });
  const recipe = {
    tool: 'synthetic-audited-copy',
    version: '1',
    options: [],
    layoutSchema: 'fixture-claude-bmad-render-v1',
    policySha256: sha256('fixture policy'),
    officialEntrypoints: ['src/bmm-skills/ship/bmad-build/SKILL.md', 'src/scripts/render_skill.py'],
  };
  const { officialEntrypoints: _entries, ...derivation } = recipe;
  const base = {
    runtime: 'claude' as const,
    sourceTreeSha256: source.pin.sourceTreeSha256,
    manifestSha256: manifestHash(manifest(validateFiles(out))),
    derivation,
  };
  const { projectionTreeHash } = await import('../src/workflows/pins.ts');
  const expected: ProjectionPin = { ...base, treeSha256: projectionTreeHash(base) };
  return { sourceTreeSha256: source.pin.sourceTreeSha256, runtime: 'claude', recipe, expected, mappings };
}

/** Relative paths of every regular file below `root/prefix`. */
async function filesBelow(root: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesBelow(root, path)));
    else found.push(path);
  }
  return found.sort();
}

/** A stand-in `uv` executable: requires `UV_PYTHON` to name `expectedPython`, then renders like BMAD. */
async function fakeUv(path: string, expectedPython: string): Promise<void> {
  const entry = new URL('./support/bmad-render-double.ts', import.meta.url).href;
  await writeFile(
    path,
    `#!${process.execPath}\nimport(${JSON.stringify(entry)}).then((m) => m.fakeUvMain(${JSON.stringify(expectedPython)}));\n`,
    { mode: 0o755 },
  );
}

async function identity(path: string, version: string): Promise<ExecutableIdentity> {
  const resolved = await realpath(path);
  return { path, realpath: resolved, sha256: sha256(await readFile(resolved)), version };
}

test('isolation workspace materializes and renders BMAD inputs inside prepare', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-s6b-ii-')));
  const audits = JSON.parse(
    await readFile(new URL('./fixtures/workflows/official-audits.json', import.meta.url), 'utf8'),
  );
  const sourceAudit: SourceAudit = audits.bmad.source;
  const archive = await readFile(new URL('./fixtures/workflows/bmad-6.12.0.tgz', import.meta.url));
  const projectionAudit = await copyProjection(sourceAudit, archive);
  const registry = await WorkflowRegistry.open(join(root, 'registry'), {
    sources: [sourceAudit],
    projections: [projectionAudit],
  });
  let service = await IsolationWorkspace.open(join(root, 'isolation'), registry);
  try {
    const pin: SourcePin = sourceAudit.pin;
    await registry.installSource(pin, Readable.from([archive]));
    const projection = await registry.deriveProjection(pin, 'claude', projectionAudit.recipe);
    const definition: WorkflowDefinition = await createWorkflowManifest(registry).loadDefinition(
      pin,
      projection,
    );
    assert(definition.render);
    const pinned: Record<string, string> = { ...definition.render.selectedProjectionSha256 };
    for (const [path, digest] of Object.entries(definition.render.layers)) if (digest) pinned[path] = digest;
    assert.deepEqual(Object.keys(pinned).sort(), expectedFiles);

    // Two owner checkouts: `owner` tracks only `.claude` (excluded from the clone, then the render subset
    // is materialized); `trackedOwner` also tracks `_bmad`, which a BMAD prepare must refuse.
    const owner = join(root, 'owner');
    const trackedOwner = join(root, 'tracked-owner');
    const home = join(root, 'fixture-home');
    for (const path of [owner, trackedOwner, home, join(home, 'template'), join(home, 'hooks')])
      await mkdir(path, { mode: 0o700 });
    const projectionRoot = (await registry.resolve(pin, projection)).projectionRoot;
    const repoGit = async (repo: string, ...args: string[]) => {
      const e = await service.measure(
        'fixture',
        repo,
        git,
        [
          '-c',
          `core.hooksPath=${join(home, 'hooks')}`,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'gc.auto=0',
          ...args,
        ],
        {
          workspace: repo,
          attemptHome: home,
          projectionRoot,
          extraRead: [repo, '/Library/Developer/CommandLineTools'],
          extraWrite: [repo],
          environment: [
            'GIT_CONFIG_NOSYSTEM=1',
            'GIT_CONFIG_GLOBAL=/dev/null',
            `GIT_TEMPLATE_DIR=${join(home, 'template')}`,
          ],
        },
      );
      assert.equal(e.receipt?.exitCode, 0, e.output || e.error || 'missing receipt');
      return e.output.trim();
    };
    const commitOwner = async (repo: string, files: Record<string, string>) => {
      await repoGit(repo, 'init', repo);
      for (const [path, body] of Object.entries(files)) {
        await mkdir(join(repo, path, '..'), { recursive: true });
        await writeFile(join(repo, path), body);
      }
      await repoGit(repo, '-C', repo, 'add', '--all');
      await repoGit(
        repo,
        '-C',
        repo,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '-m',
        'fixture',
      );
    };
    await commitOwner(owner, {
      'docs/product.md': 'product specifications remain\n',
      '.claude/settings.json': '{"owner":true}\n',
    });
    await commitOwner(trackedOwner, {
      'docs/product.md': 'product specifications remain\n',
      '_bmad/legacy.toml': 'owner = "tracked"\n',
      '.claude/settings.json': '{"owner":true}\n',
    });

    // Install-report prerequisites: `uv` and a Homebrew-style linked interpreter.
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'cellar'));
    const pythonReal = join(root, 'cellar', 'python3.13');
    await writeFile(pythonReal, 'python 3.13 fixture bytes\n', { mode: 0o755 });
    await symlink(pythonReal, join(root, 'bin', 'python3'));
    await fakeUv(join(root, 'bin', 'uv'), pythonReal);
    await fakeUv(join(root, 'bin', 'uv-elsewhere'), join(root, 'cellar', 'python3.12'));
    const prerequisites: RenderPrerequisites = {
      uv: await identity(join(root, 'bin', 'uv'), 'uv 0.12.13'),
      python: await identity(join(root, 'bin', 'python3'), '3.13.5'),
    };
    const render = { definition, prerequisites };

    await t.test('a prepare without a render request is unchanged', async () => {
      const w = await service.prepareWorkspace(trackedOwner, 'plain-attempt', pin, projection);
      assert.equal('injected' in w, false);
      assert.equal('render' in w, false);
      assert(w.exclusions.some((e) => e.path === '_bmad/legacy.toml'));
      assert(w.exclusions.some((e) => e.path === '.claude/settings.json'));
      assert.equal(await lstat(join(w.workspace, '_bmad')).catch(() => null), null);
      assert.equal(await lstat(join(w.workspace, '.claude')).catch(() => null), null);
      assert.deepEqual(await service.renders('plain-attempt'), []);
      await service.verify(w.workspace, w.attemptHome, pin, projection);
      assert.equal(await service.cleanup('plain-attempt'), 'deleted');
    });

    await t.test(
      'BMAD prepare copies exactly the definition subset and renders before the audit',
      async () => {
        const attemptId = randomUUID();
        const w = await service.prepareWorkspace(owner, attemptId, pin, projection, render);
        // Only the subset derived from `definition.render`, as single-link regular files.
        const skillFiles = await filesBelow(w.workspace, skill);
        const bmadFiles = (await filesBelow(w.workspace, '_bmad')).filter(
          (p) => !p.startsWith('_bmad/render/'),
        );
        assert.deepEqual([...skillFiles, ...bmadFiles].sort(), expectedFiles);
        for (const path of expectedFiles) {
          const stat = await lstat(join(w.workspace, path));
          assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, path);
          assert.equal(sha256(await readFile(join(w.workspace, path))), pinned[path], path);
        }
        for (const omitted of [
          'memlog.py',
          'resolve_config.py',
          'resolve_customization.py',
          '.gitignore',
          'notes.py',
        ])
          assert(!w.entries.some((e) => e.path.endsWith(`/${omitted}`)), omitted);
        // An untracked `_bmad` in the owner checkout is materialized as before; `.claude` is excluded.
        assert(w.exclusions.some((e) => e.path === '.claude/settings.json'));
        assert(!w.exclusions.some((e) => e.path.startsWith('_bmad')));

        assert(w.injected);
        assert.deepEqual(Object.keys(w.injected.files).sort(), expectedFiles);
        assert(w.injected.directories.includes('_bmad/render'));
        assert.equal(w.injected.generated, '_bmad/render');

        // The receipt is the renderer's, for this workspace, with the pinned interpreter as witness.
        assert(w.render?.receipt);
        assert.equal(w.render.halt, null);
        const { data } = w.render.receipt;
        assert.equal(w.render.receipt.attemptId, attemptId);
        assert.equal(data.projectRoot, w.workspace);
        assert.equal(data.definitionSha256, definition.sha256);
        assert.equal(data.witness.operationId, w.render.operationId);
        assert.equal(data.witness.argv[0], prerequisites.uv.realpath);
        assert.deepEqual(data.witness.python, {
          path: prerequisites.python.path,
          sha256: prerequisites.python.sha256,
          version: '3.13.5',
        });
        assert(data.generationPath.startsWith(`${w.workspace}/_bmad/render/bmad-build/workspace-`));

        // The after audit already contains the generation, every injected path classified as selected.
        const generated = `${data.generationPath.slice(w.workspace.length + 1)}/workflow.md`;
        assert(w.entries.some((e) => e.path === generated && e.classification === 'selected'));
        for (const entry of w.entries.filter((e) => /^(_bmad|\.claude)(\/|$)/.test(e.path)))
          assert.equal(entry.classification, 'selected', entry.path);

        // Durable stage record: closure proven, stage and leader record reclaimed, receipt kept.
        const [record] = await service.renders(attemptId);
        assert.equal(record.state, 'deleted');
        assert.equal(record.operationId, w.render.operationId);
        assert.equal(record.receipt?.mode, 'tree');
        assert.match(record.leader ?? '', /^\d+ \d+\.\d{6}$/);
        const receipts = join(service.root, 'operations', 'receipts');
        assert.equal(
          await lstat(join(receipts, `render-${record.operationId}.leader`)).catch(() => null),
          null,
        );
        assert(await lstat(join(receipts, `render-${record.operationId}.json`)));

        await service.verify(w.workspace, w.attemptHome, pin, projection);
        await writeFile(join(w.workspace, '_bmad/config.toml'), 'project_name = "changed"\n');
        await assert.rejects(() => service.verify(w.workspace, w.attemptHome, pin, projection));
        assert.equal(await service.cleanup(attemptId), 'deleted');
      },
    );

    await t.test(
      'a halted render fails prepare closed and still declares the render destination',
      async () => {
        const attemptId = randomUUID();
        const elsewhere = {
          ...prerequisites,
          uv: await identity(join(root, 'bin', 'uv-elsewhere'), 'uv 0.12.13'),
        };
        await assert.rejects(
          () =>
            service.prepareWorkspace(owner, attemptId, pin, projection, {
              definition,
              prerequisites: elsewhere,
            }),
          /RENDER_HALTED:RENDER_EXIT_NONZERO/,
        );
        const record = await service.get(attemptId);
        assert(record?.render?.halt && record.injected);
        assert.equal(record.state, 'retained');
        assert.equal(record.render.receipt, null);
        assert.equal(record.render.halt.reason, 'RENDER_EXIT_NONZERO');
        assert.match(record.render.halt.log?.lastLine ?? '', /No interpreter found/);
        assert(record.injected.directories.includes('_bmad/render'));
        const audit = await auditWorkspace(
          record.workspace,
          undefined,
          [],
          join(record.workspace, '.git'),
          record.injected,
        );
        assert.deepEqual(audit.blockers, []);
        assert(audit.entries.some((e) => e.path === '_bmad/render' && e.classification === 'selected'));
        assert.deepEqual(
          (await service.renders(attemptId)).map((r) => r.state),
          ['deleted'],
        );
        assert.equal(await service.cleanup(attemptId), 'deleted');
      },
    );

    await t.test(
      'a BMAD prepare refuses an owner checkout that tracks _bmad and leaves it in place',
      async () => {
        const attemptId = randomUUID();
        await assert.rejects(
          () => service.prepareWorkspace(trackedOwner, attemptId, pin, projection, render),
          /BMAD_TRACKED_IN_CHECKOUT/,
        );
        const record = await service.get(attemptId);
        assert(record);
        assert.equal(record.state, 'retained');
        assert.equal('injected' in record, false);
        assert.equal('render' in record, false);
        assert.deepEqual(record.exclusions, []);
        // Nothing of the owner's `_bmad` was moved, removed or replaced, in the clone or the checkout.
        assert.equal(
          await readFile(join(record.workspace, '_bmad/legacy.toml'), 'utf8'),
          'owner = "tracked"\n',
        );
        assert.deepEqual(await filesBelow(record.workspace, '_bmad'), ['_bmad/legacy.toml']);
        assert.equal(await readFile(join(trackedOwner, '_bmad/legacy.toml'), 'utf8'), 'owner = "tracked"\n');
        assert.deepEqual(await service.renders(attemptId), []);
        assert.equal(await service.cleanup(attemptId), 'deleted');
      },
    );

    await t.test('cleanup treats a proven render stage that is already gone as reclaimed', async () => {
      const attemptId = randomUUID();
      const w = await service.prepareWorkspace(owner, attemptId, pin, projection, render);
      const [done] = await service.renders(attemptId);
      assert.equal(done.state, 'deleted');
      assert(done.stageIdentity);
      // As if the stage was removed but the leader cleanup or the `deleted` record write failed.
      await service.close();
      const journal = await AtomicRecords.open(join(root, 'isolation', 'journal'));
      try {
        await journal.put(`render-${done.operationId}`, { ...done, state: 'complete' });
      } finally {
        await journal.close();
      }
      service = await IsolationWorkspace.open(join(root, 'isolation'), registry);
      assert.equal(await service.cleanup(attemptId), 'deleted');
      assert.deepEqual(
        (await service.renders(attemptId)).map((r) => r.state),
        ['deleted'],
      );
      assert.equal(await lstat(w.workspace).catch(() => null), null);
    });

    await t.test('an undeclared or altered injected path is an audit blocker', async () => {
      const attemptId = randomUUID();
      const w = await service.prepareWorkspace(owner, attemptId, pin, projection, render);
      assert(w.injected);
      await writeFile(join(w.workspace, '_bmad/scripts/json.py'), 'import os\n');
      await writeFile(join(w.workspace, `${skill}/workflow.md`), 'Changed.\n');
      await rm(join(w.workspace, '_bmad/custom/config.toml'));
      const audit = await auditWorkspace(w.workspace, undefined, [], join(w.workspace, '.git'), w.injected);
      assert(audit.blockers.includes('UNDECLARED_INJECTION:_bmad/scripts/json.py'), audit.blockers.join());
      assert(audit.blockers.includes(`INJECTED_BYTES:${skill}/workflow.md`), audit.blockers.join());
      assert(audit.blockers.includes('INJECTED_MISSING:_bmad/custom/config.toml'), audit.blockers.join());
      await assert.rejects(
        () => service.verify(w.workspace, w.attemptHome, pin, projection),
        /CROSS_WORKFLOW_SOURCE/,
      );
      assert.equal(await service.cleanup(attemptId), 'deleted');
    });

    await t.test('requests that cannot render stop before any render stage is reserved', async () => {
      const wrongPython = { ...prerequisites, python: { ...prerequisites.python, sha256: '0'.repeat(64) } };
      const attemptId = randomUUID();
      await assert.rejects(
        () =>
          service.prepareWorkspace(owner, attemptId, pin, projection, {
            definition,
            prerequisites: wrongPython,
          }),
        /RENDER_HALTED:RENDER_PYTHON_UNAVAILABLE/,
      );
      assert.deepEqual(await service.renders(attemptId), []);
      assert.equal(await service.cleanup(attemptId), 'deleted');

      const otherPin = structuredClone(definition);
      assert(otherPin.render);
      otherPin.render.projection = { ...otherPin.render.projection, treeSha256: '0'.repeat(64) };
      const unbound = randomUUID();
      await assert.rejects(
        () =>
          service.prepareWorkspace(owner, unbound, pin, projection, { definition: otherPin, prerequisites }),
        /RENDER_DEFINITION_BINDING_MISMATCH/,
      );
      assert.equal(await service.get(unbound), null);
      const superpowers = { ...definition, render: undefined };
      await assert.rejects(
        () =>
          service.prepareWorkspace(owner, randomUUID(), pin, projection, {
            definition: superpowers,
            prerequisites,
          }),
        /RENDER_DEFINITION_BINDING_MISMATCH/,
      );
      await assert.rejects(
        () => service.prepareWorkspace(owner, 'not-a-uuid', pin, projection, render),
        /INVALID_ATTEMPT_ID/,
      );
      assert.equal(await service.get('not-a-uuid'), null);
    });

    await t.test('a render stage left pending by a crash becomes unknown and blocks renders', async () => {
      const attemptId = randomUUID();
      const w = await service.prepareWorkspace(owner, attemptId, pin, projection, render);
      await service.close();
      const crashed = randomUUID();
      const journal = await AtomicRecords.open(join(root, 'isolation', 'journal'));
      try {
        await journal.put(`render-${crashed}`, {
          formatVersion: 1,
          kind: 'isolation-render',
          attemptId,
          operationId: crashed,
          state: 'pending',
          stageIdentity: null,
          leader: null,
          receipt: null,
          error: null,
        });
      } finally {
        await journal.close();
      }
      service = await IsolationWorkspace.open(join(root, 'isolation'), registry);
      const states = Object.fromEntries(
        (await service.renders(attemptId)).map((r) => [r.operationId, r.state]),
      );
      assert.equal(states[crashed], 'unknown');
      assert.equal(states[w.render?.operationId ?? ''], 'deleted');
      await assert.rejects(
        () => service.verify(w.workspace, w.attemptHome, pin, projection),
        /PROCESS_CLOSURE_UNVERIFIED/,
      );
      assert.equal(await service.cleanup(attemptId), 'retained');
      await assert.rejects(
        () => service.prepareWorkspace(owner, randomUUID(), pin, projection, render),
        /RENDER_HALTED:RENDER_RECONCILE_REQUIRED/,
      );
      // A workspace without a render request does not depend on render reconciliation.
      const plain = await service.prepareWorkspace(owner, 'plain-after-crash', pin, projection);
      assert.equal(plain.state, 'prepared');
    });
  } finally {
    await service.close();
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});
