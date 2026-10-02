import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkflowRegistry } from '../src/workflows/registry.ts';
import { fixture } from './support/workflow-archives.ts';

test('workflow registry installs verified immutable source', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const f = await fixture();
  const registry = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [],
  });
  try {
    assert.deepEqual(await registry.installSource(f.source, f.stream()), f.source);
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fetchSource } from '../src/workflows/fetch.ts';
import { sourceTreeHash } from '../src/workflows/pins.ts';
import { archive, canonical, entries, projectionAudit, sha } from './support/workflow-archives.ts';

async function withFixture(
  action: (r: WorkflowRegistry, f: Awaited<ReturnType<typeof fixture>>, root: string) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const f = await fixture();
  const sp = await fixture('superpowers');
  const r = await WorkflowRegistry.open(root, {
    sources: [
      { pin: f.source, executables: f.executables },
      { pin: sp.source, executables: sp.executables },
    ],
    projections: [
      projectionAudit(f, 'claude'),
      projectionAudit(f, 'codex'),
      projectionAudit(f, 'codex', ['new']),
    ],
  });
  try {
    await action(r, f, root);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
}
test('workflow registry separates runtime roots and retains old immutable pairs through restart', async () =>
  withFixture(async (r, f, root) => {
    const sp = await fixture('superpowers');
    await Promise.all([
      r.installSource(f.source, f.stream()),
      r.installSource(f.source, f.stream()),
      r.installSource(sp.source, sp.stream()),
    ]);
    const ca = projectionAudit(f, 'claude');
    const co = projectionAudit(f, 'codex');
    const [claude, codex] = await Promise.all([
      r.deriveProjection(f.source, 'claude', ca.recipe),
      r.deriveProjection(f.source, 'codex', co.recipe),
    ]);
    const c = await r.resolve(f.source, claude);
    const d = await r.resolve(f.source, codex);
    assert.equal(c.sourceRoot, d.sourceRoot);
    assert.notEqual(c.projectionRoot, d.projectionRoot);
    assert.equal(
      await readFile(join(c.projectionRoot, '.claude/skills/build/SKILL.md'), 'utf8'),
      '# Official fixture skill\n',
    );
    await r.retain('run-1', f.source, claude);
    await r.deriveProjection(f.source, 'codex', projectionAudit(f, 'codex', ['new']).recipe);
    await assert.rejects(
      () => r.installSource({ ...f.source, payloadSha256: '0'.repeat(64) }, f.stream()),
      /CHECKSUM_MISMATCH|SOURCE_NOT_AUDITED/,
    );
    assert.deepEqual(await r.current('bmad'), f.source);
    assert.equal(await r.exists(f.source, claude), true);
    await r.close();
    const recovered = await WorkflowRegistry.open(root, {
      sources: [{ pin: f.source, executables: f.executables }],
      projections: [ca, co],
    });
    try {
      assert.equal((await recovered.retained()).length, 1);
      await recovered.release('run-1', f.source, claude);
      assert.equal((await recovered.retained()).length, 0);
      assert.equal(await recovered.exists(f.source, claude), true);
    } finally {
      await recovered.close();
    }
  }));
test('workflow registry rejects source and projection tampering on every resolve', async () =>
  withFixture(async (r, f) => {
    await r.installSource(f.source, f.stream());
    const pin = await r.deriveProjection(f.source, 'claude', projectionAudit(f, 'claude').recipe);
    const paths = await r.resolve(f.source, pin);
    await writeFile(join(paths.projectionRoot, 'render.sh'), 'changed');
    await assert.rejects(() => r.resolve(f.source, pin), /CHECKSUM_MISMATCH/);
    await writeFile(join(paths.projectionRoot, 'render.sh'), '#!/bin/sh\nprintf fixture\n');
    await chmod(join(paths.sourceRoot, 'render.sh'), 0o644);
    await assert.rejects(() => r.resolve(f.source, pin), /CHECKSUM_MISMATCH/);
  }));
test('workflow registry rejects unknown runtime recipes and expected projection mismatch', async () =>
  withFixture(async (r, f) => {
    await r.installSource(f.source, f.stream());
    await assert.rejects(
      () => r.deriveProjection(f.source, 'api', projectionAudit(f, 'api').recipe),
      /PROJECTION_UNAVAILABLE/,
    );
    const recipe = projectionAudit(f, 'claude').recipe;
    await assert.rejects(
      () => r.deriveProjection(f.source, 'claude', { ...recipe, officialEntrypoints: ['owner/prompt.md'] }),
      /PROJECTION_UNAVAILABLE/,
    );
  }));
test('workflow registry rejects malicious archives before activating and keeps old current', async () => {
  const f = await fixture();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const malicious = [
    [{ path: '../escape', body: 'bad' }],
    [
      { path: 'A', body: 'a' },
      { path: 'a', body: 'b' },
    ],
    [
      { path: 'é', body: 'a' },
      { path: 'e\u0301', body: 'b' },
    ],
    [
      { path: 'ß', body: 'a' },
      { path: 'ss', body: 'b' },
    ],
    [{ path: 'bad', type: 'symlink' as const, target: '../../escape' }],
    [{ path: 'bad.sh', body: 'bad', mode: 0o755 }],
  ];
  for (const input of malicious) {
    const bytes = await archive(input);
    const pin = {
      ...f.source,
      payloadSha256: sha(bytes),
      packageIntegrity: null,
      sourceUrl: `https://github.com/bmad-code-org/BMAD-METHOD/archive/${f.source.sourceRevision}.tar.gz`,
    };
    pin.sourceTreeSha256 = sourceTreeHash(pin);
    const r = await WorkflowRegistry.open(root, { sources: [{ pin, executables: [] }], projections: [] });
    try {
      await assert.rejects(
        () => r.installSource(pin, Readable.from([bytes])),
        /UNSAFE_ARCHIVE_PATH|DUPLICATE_ARCHIVE_PATH|SYMLINK_ESCAPE|MODE_DRIFT/,
      );
      assert.equal(await r.current('bmad'), null);
    } finally {
      await r.close();
    }
  }
  await rm(root, { recursive: true, force: true });
});
test('workflow registry detects truncated extraction and wrong npm integrity', async () => {
  const f = await fixture();
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const bytes = f.bytes.subarray(0, f.bytes.length - 9);
  const pin = {
    ...f.source,
    payloadSha256: sha(bytes),
    packageIntegrity: null,
    sourceUrl: `https://github.com/bmad-code-org/BMAD-METHOD/archive/${f.source.sourceRevision}.tar.gz`,
  };
  pin.sourceTreeSha256 = sourceTreeHash(pin);
  const wrong = { ...f.source, packageIntegrity: `sha512-${Buffer.alloc(64).toString('base64')}` };
  wrong.sourceTreeSha256 = sourceTreeHash(wrong);
  const r = await WorkflowRegistry.open(root, {
    sources: [
      { pin, executables: f.executables },
      { pin: wrong, executables: f.executables },
    ],
    projections: [],
  });
  try {
    await assert.rejects(() => r.installSource(pin, Readable.from([bytes])));
    await assert.rejects(() => r.installSource(wrong, f.stream()), /PACKAGE_INTEGRITY_MISMATCH/);
    assert.equal(await r.current('bmad'), null);
    const stages = await r.stagingInventory();
    assert.equal(stages.length, 1);
    assert.equal(stages[0]?.state, 'failed');
    assert.equal(stages[0]?.deletionEligible, true);
    assert.equal(stages[0]?.payloadBytes, bytes.length);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry rejects unapproved download URL and redirect and bounds response', async () => {
  const f = await fixture();
  await assert.rejects(
    () => fetchSource({ ...f.source, sourceUrl: 'https://evil.example/source.tgz' }),
    /UNAPPROVED_URL/,
  );
  const redirect: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example/source.tgz' } });
  await assert.rejects(() => fetchSource(f.source, { transport: redirect }), /UNAPPROVED_URL/);
  const transport: typeof fetch = async () => new Response(new Uint8Array(f.bytes));
  await assert.rejects(() => fetchSource(f.source, { transport, maxBytes: 2 }), /ARCHIVE_SIZE_LIMIT/);
  assert((await fetchSource(f.source, { transport })).equals(f.bytes));
});
test('workflow registry canonical manifest ignores archive order and ownership times', async () => {
  const a = await fixture();
  const b = await fixture(
    'bmad',
    entries.toReversed().map((e) => ({ ...e, mtime: 987654321, uid: 77 })),
  );
  assert.equal(a.source.sourceManifestSha256, b.source.sourceManifestSha256);
  assert.notEqual(a.source.payloadSha256, b.source.payloadSha256);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [a, b].map((f) => ({ pin: f.source, executables: f.executables })),
    projections: [],
  });
  try {
    await r.installSource(a.source, a.stream());
    await r.installSource(b.source, b.stream());
    assert.equal((await readdir(join(root, 'workflows/sources'))).length, 2);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { auditSuperpowersClaude, buildSourceAudit } from '../src/workflows/audit.ts';

test('workflow registry audit builder checks pinned payload and materializes official Claude layout', async () => {
  const f = await fixture('superpowers');
  assert.deepEqual((await buildSourceAudit(f.source, f.bytes, f.executables)).pin, f.source);
  await assert.rejects(
    () => auditSuperpowersClaude(f.source, f.bytes, f.executables),
    /OFFICIAL_MANIFEST_MISSING/,
  );
});

import { randomUUID } from 'node:crypto';
import { ProcessJournal } from '../src/journal/process-journal.ts';
import type { ProjectionAudit, SourceAudit } from '../src/workflows/registry.ts';

test('workflow registry API projection contains official fixture skill/script and audited policy', async () => {
  const f = await fixture();
  const a = projectionAudit(f, 'api');
  const policy = canonical({ tools: ['read', 'shell'], denyOtherWorkflow: true });
  a.recipe.policySha256 = sha(policy);
  a.expected.derivation.policySha256 = sha(policy);
  const projected = f.entries.map((e) => ({ ...e }));
  projected.push({
    path: 'adapter-policy.json',
    type: 'file',
    mode: 0o644,
    bytes: Buffer.byteLength(policy),
    sha256: sha(policy),
  });
  projected.sort((x, y) => Buffer.compare(Buffer.from(x.path), Buffer.from(y.path)));
  a.expected.manifestSha256 = sha(canonical(projected));
  a.expected.treeSha256 = sha(
    canonical({
      runtime: 'api',
      sourceTreeSha256: f.source.sourceTreeSha256,
      manifestSha256: a.expected.manifestSha256,
      derivation: a.expected.derivation,
    }),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [{ ...a, policy }],
  });
  try {
    await r.installSource(f.source, f.stream());
    const p = await r.deriveProjection(f.source, 'api', a.recipe);
    const paths = await r.resolve(f.source, p);
    assert.equal(await readFile(join(paths.projectionRoot, 'adapter-policy.json'), 'utf8'), policy);
    assert.equal(
      await readFile(join(paths.projectionRoot, 'render.sh'), 'utf8'),
      '#!/bin/sh\nprintf fixture\n',
    );
    assert(!paths.manifest.projection.some((e) => /role|prompt/.test(e.path)));
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry derivation version/options/layout/policy independently change projection pin', async () => {
  const f = await fixture();
  const original = projectionAudit(f, 'claude');
  const audits = ['tool', 'version', 'options', 'layoutSchema', 'policySha256'].map((key) => {
    const a = structuredClone(original);
    if (key === 'options') {
      a.recipe.options = ['changed'];
      a.expected.derivation.options = ['changed'];
    } else {
      const value = key === 'policySha256' ? sha('new policy') : 'changed';
      Object.assign(a.recipe, { [key]: value });
      Object.assign(a.expected.derivation, { [key]: value });
    }
    a.expected.treeSha256 = sha(
      canonical({
        runtime: a.expected.runtime,
        sourceTreeSha256: a.expected.sourceTreeSha256,
        manifestSha256: a.expected.manifestSha256,
        derivation: a.expected.derivation,
      }),
    );
    return a;
  });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [original, ...audits],
  });
  try {
    await r.installSource(f.source, f.stream());
    const before = await r.deriveProjection(f.source, 'claude', original.recipe);
    for (const a of audits) {
      const p = await r.deriveProjection(f.source, 'claude', a.recipe);
      assert.equal(p.sourceTreeSha256, before.sourceTreeSha256);
      assert.equal(p.manifestSha256, before.manifestSha256);
      assert.notEqual(p.treeSha256, before.treeSha256);
    }
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry accepts internal symlink', async () => {
  const f = await fixture('superpowers', [
    ...entries,
    { path: 'link', type: 'symlink', target: 'render.sh' },
  ]);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [],
  });
  try {
    await r.installSource(f.source, f.stream());
    assert.deepEqual(await r.current('superpowers'), f.source);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry source update preserves retained source and old runtime pair', async () => {
  const old = await fixture();
  const next = await fixture(
    'bmad',
    entries.map((e) => ({ ...e, body: e.path === 'render.sh' ? '#!/bin/sh\nprintf new\n' : e.body })),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const ca = projectionAudit(old, 'claude');
  const r = await WorkflowRegistry.open(root, {
    sources: [old, next].map((f) => ({ pin: f.source, executables: f.executables })),
    projections: [ca],
  });
  try {
    await r.installSource(old.source, old.stream());
    const p = await r.deriveProjection(old.source, 'claude', ca.recipe);
    await r.retain('run-old', old.source, p);
    await r.installSource(next.source, next.stream());
    assert.deepEqual(await r.current('bmad'), next.source);
    assert.equal(await r.exists(old.source, p), true);
    assert.equal((await r.retained())[0]?.source.sourceTreeSha256, old.source.sourceTreeSha256);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry expected projection checksum failure never publishes runtime tree', async () => {
  const f = await fixture();
  const a = projectionAudit(f, 'claude');
  a.expected.manifestSha256 = '0'.repeat(64);
  a.expected.treeSha256 = sha(
    canonical({
      runtime: a.expected.runtime,
      sourceTreeSha256: a.expected.sourceTreeSha256,
      manifestSha256: a.expected.manifestSha256,
      derivation: a.expected.derivation,
    }),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [a],
  });
  try {
    await r.installSource(f.source, f.stream());
    await assert.rejects(() => r.deriveProjection(f.source, 'claude', a.recipe), /CHECKSUM_MISMATCH/);
    assert.deepEqual(await readdir(join(root, 'workflows/projections')), []);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry recovers ProcessJournal pair after registry release', async () => {
  const f = await fixture();
  const a = projectionAudit(f, 'claude');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  let journal = await ProcessJournal.open(root);
  const options = {
    sources: [{ pin: f.source, executables: f.executables }],
    projections: [a],
    processJournal: journal,
  };
  let r = await WorkflowRegistry.open(root, options);
  try {
    await r.installSource(f.source, f.stream());
    const p = await r.deriveProjection(f.source, 'claude', a.recipe);
    const record = await journal.reserve({
      commandId: randomUUID(),
      ticketId: randomUUID(),
      processInstanceId: randomUUID(),
      source: f.source,
      projection: p,
    });
    await r.retain('run', f.source, p);
    await r.release('run', f.source, p);
    await r.close();
    await journal.close();
    journal = await ProcessJournal.open(root);
    r = await WorkflowRegistry.open(root, { ...options, processJournal: journal });
    const refs = await r.retained();
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.authority, 'process-journal');
    assert.equal(refs[0]?.runId, record.launchId);
  } finally {
    await r.close();
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry pinned official npm and Git archives verify distinct provenance and Claude bytes', async () => {
  const base = new URL('./fixtures/workflows/', import.meta.url);
  const audits = JSON.parse(await readFile(new URL('official-audits.json', base), 'utf8')) as {
    bmad: { source: SourceAudit };
    superpowers: { source: SourceAudit; projections: { claude: ProjectionAudit } };
  };
  const bmad = await readFile(new URL('bmad-6.12.0.tgz', base));
  const sp = await readFile(new URL('superpowers-6.4.2.tgz', base));
  const candidate = await buildSourceAudit(audits.bmad.source.pin, bmad, audits.bmad.source.executables);
  assert.deepEqual(candidate, audits.bmad.source);
  const recipe = await auditSuperpowersClaude(
    audits.superpowers.source.pin,
    sp,
    audits.superpowers.source.executables,
  );
  assert.deepEqual(recipe, audits.superpowers.projections.claude);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-official-workflow-')));
  const r = await WorkflowRegistry.open(root, {
    sources: [audits.bmad.source, audits.superpowers.source],
    projections: [recipe],
  });
  try {
    await r.installSource(audits.bmad.source.pin, Readable.from([bmad]));
    await r.installSource(audits.superpowers.source.pin, Readable.from([sp]));
    const pin = await r.deriveProjection(audits.superpowers.source.pin, 'claude', recipe.recipe);
    const paths = await r.resolve(audits.superpowers.source.pin, pin);
    for (const path of recipe.recipe.officialEntrypoints)
      assert(
        (await readFile(join(paths.sourceRoot, path))).equals(
          await readFile(join(paths.projectionRoot, path)),
        ),
      );
    assert.equal((await readdir(paths.projectionRoot)).includes('.codex-plugin'), false);
    await assert.rejects(
      () =>
        r.deriveProjection(audits.superpowers.source.pin, 'codex', {
          ...recipe.recipe,
          layoutSchema: 'superpowers-codex-native',
        }),
      /PROJECTION_UNAVAILABLE/,
    );
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow registry cancellation before publish preserves previous active source', async () => {
  const old = await fixture();
  const next = await fixture(
    'bmad',
    entries.map((e) => ({ ...e, body: e.path === 'render.sh' ? '#!/bin/sh\nprintf new\n' : e.body })),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-workflow-')));
  const abort = new AbortController();
  const r = await WorkflowRegistry.open(root, {
    sources: [old, next].map((f) => ({ pin: f.source, executables: f.executables })),
    projections: [],
    signal: abort.signal,
  });
  try {
    await r.installSource(old.source, old.stream());
    abort.abort();
    await assert.rejects(() => r.installSource(next.source, next.stream()), { name: 'AbortError' });
    assert.deepEqual(await r.current('bmad'), old.source);
    assert.equal((await r.stagingInventory()).filter((s) => s.state === 'failed').length, 0);
  } finally {
    await r.close();
    await rm(root, { recursive: true, force: true });
  }
});
