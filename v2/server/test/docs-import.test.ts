import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { promisify } from 'node:util';
import { captureMigrations, migrate } from '../src/db/migrate.ts';
import { bundleHash, hashBytes, sourceTreeHash } from '../src/docs/checksum.ts';
import type { DocsSync } from '../src/docs/contracts.ts';
import { authorizeDocsSync, importDocs, syncDocs } from '../src/docs/import.ts';
import { claimAttempt } from '../src/execution/attempts.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Db } from '../src/platform/contracts.ts';
import { createProject } from '../src/projects/service.ts';
import { databaseFixture } from './support/db.ts';
import { importWithKey, legacyBundle, rehashBundle, validDocs } from './support/docs.ts';
import { executionFixture, openPeerDb } from './support/execution.ts';
import { owner } from './support/tickets.ts';

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('TEST_FIXTURE_MISSING');
  return value;
}

const withDatabase = databaseFixture(6);
function hashBundleOnly(input: ReturnType<typeof legacyBundle>) {
  const { bundleSha256: _, ...body } = input;
  input.bundleSha256 = bundleHash(body);
  return input;
}

test('import giữ CRLF/Unicode, null commit và chạy lại không trùng', async (t) =>
  withDatabase(async (db) => {
    t.diagnostic(`owned-test-container=${process.env.CREW_V2_TEST_CONTAINER_ID}`);
    t.diagnostic(`owned-test-url=${process.env.CREW_V2_TEST_DATABASE_URL}`);
    const raw = Buffer.from('# Tài liệu\r\nNội dung tiếng Việt 😀\r\n');
    const input = legacyBundle({ 'docs/index.md': raw });
    const first = await importWithKey(db, input, 'a');
    const cursor = (await db`select value from event_cursor`)[0]?.value;
    const second = await importWithKey(db, input, 'b');
    assert.deepEqual(first, second);
    assert.equal(first.projects[0]?.auditState, 'invalid');
    const [file] = await db`select bytes,sha from docs_files`;
    assert(Buffer.from(file?.bytes).equals(raw));
    assert.equal(file?.sha, hashBytes(raw));
    const [project] = await db`select machine_id,checkout_path from projects`;
    assert.equal(project?.machine_id, null);
    assert.equal(project?.checkout_path, null);
    assert.equal((await db`select source_commit from docs_snapshots`)[0]?.source_commit, null);
    assert.equal((await db`select count(*)::int n from docs_imports`)[0]?.n, 1);
    assert.equal((await db`select value from event_cursor`)[0]?.value, cursor);
  }));

test('structural valid legacy remains unverified and mixed classes retain bytes and link occurrences', async () =>
  withDatabase(async (db) => {
    const spec = Buffer.from('# Thiết kế dự kiến\r\nMáy Mac chưa triển khai');
    const input = legacyBundle(
      {
        ...validDocs(),
        'docs/superpowers/specs/design.md': spec,
        'docs/a.md': Buffer.from('[Một](b.md#one) [Sai](b.md#absent) [Lặp](b.md#one)'),
        'docs/b.md': Buffer.from('# One'),
      },
      { 'docs/a.md': 'implemented', 'docs/b.md': 'implemented' },
    );
    const result = await importWithKey(db, input, 'mixed');
    assert.equal(result.projects[0]?.auditState, 'invalid');
    assert.equal((await db`select content_class from docs_snapshots`)[0]?.content_class, 'mixed');
    const [saved] =
      await db`select bytes,content_class from docs_files where path='docs/superpowers/specs/design.md'`;
    assert(Buffer.from(saved?.bytes).equals(spec));
    assert.equal(saved?.content_class, 'workflow_artifact');
    await importWithKey(db, input, 'mixed-again');
    const links =
      await db`select occurrence,status from docs_links where from_path='docs/a.md' order by occurrence`;
    assert.deepEqual(
      links.map((x) => [x.occurrence, x.status]),
      [
        [0, 'ok'],
        [1, 'missing'],
        [2, 'ok'],
      ],
    );
    const clean = rehashBundle({
      ...input,
      inventory: [
        {
          ...present(input.inventory[0]),
          files: present(input.inventory[0]).files.filter(
            (x) => !['docs/a.md', 'docs/b.md'].includes(x.path),
          ),
        },
      ],
    });
    const cleanResult = await importWithKey(db, clean, 'clean');
    assert.equal(cleanResult.projects[0]?.auditState, 'unverified');
    assert.equal(
      (await db`select latest_verified_snapshot_id from projects`)[0]?.latest_verified_snapshot_id,
      null,
    );
  }));

test('bad checksum, unknown fields, class and unsafe paths reject atomically even in later project', async () =>
  withDatabase(async (db) => {
    const bad = legacyBundle({ 'docs/index.md': Buffer.from('# Docs') });
    present(present(bad.inventory[0]).files[0]).sha256 = '0'.repeat(64);
    hashBundleOnly(bad);
    await assert.rejects(() => importWithKey(db, bad, 'hash'), { code: 'CHECKSUM_MISMATCH' });
    for (const extra of ['token', 'machine', 'ticket']) {
      await assert.rejects(
        () =>
          importWithKey(
            db,
            Object.assign(legacyBundle(validDocs()), { [extra]: 'secret' }),
            `extra-${extra}`,
          ),
        { code: 'VALIDATION', status: 400 },
      );
    }
    for (const path of ['docs/../x.md', 'docs/%2e%2e/x.md', 'docs//x.md', '/docs/x.md', 'docs/a\\b.md']) {
      const bundle = legacyBundle({ 'docs/index.md': Buffer.from('# Docs') });
      bundle.inventory.push({
        ...present(bundle.inventory[0]),
        legacyProjectId: 'second',
        key: 'SECOND',
        files: [{ ...present(present(bundle.inventory[0]).files[0]), path }],
      });
      rehashBundle(bundle);
      await assert.rejects(() => importWithKey(db, bundle, `path-${randomUUID()}`), { code: 'PATH_INVALID' });
    }
    const badClass = legacyBundle(
      { 'docs/superpowers/plans/p.md': Buffer.from('# plan') },
      { 'docs/superpowers/plans/p.md': 'implemented' },
    );
    await assert.rejects(() => importWithKey(db, badClass, 'class'), { code: 'CONTENT_CLASS_MISMATCH' });
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 0);
    assert.equal((await db`select count(*)::int n from docs_imports`)[0]?.n, 0);
  }));

test('corrupt base64, UTF8, bundle/snapshot hash and oversized file reject before writes', async () =>
  withDatabase(async (db) => {
    for (const [bytes, code] of [
      [Buffer.from([0xff]), 'INVALID_UTF8'],
      [Buffer.alloc(1024 * 1024 + 1), 'FILE_TOO_LARGE'],
    ] as const) {
      const input = legacyBundle({ 'docs/index.md': Buffer.from('# Docs') });
      present(present(input.inventory[0]).files[0]).bytesBase64 = bytes.toString('base64');
      present(present(input.inventory[0]).files[0]).sha256 = hashBytes(bytes);
      hashBundleOnly(input);
      await assert.rejects(() => importWithKey(db, input, code), { code });
    }
    const input = legacyBundle(validDocs());
    present(present(input.inventory[0]).files[0]).bytesBase64 += '\n';
    hashBundleOnly(input);
    await assert.rejects(() => importWithKey(db, input, 'base64'), { code: 'INVALID_BASE64' });
    const wrong = legacyBundle(validDocs());
    wrong.bundleSha256 = '0'.repeat(64);
    await assert.rejects(() => importWithKey(db, wrong, 'bundle'), { code: 'BUNDLE_CHECKSUM_MISMATCH' });
    const snapshot = legacyBundle(validDocs());
    present(snapshot.inventory[0]).snapshotSha256 = '0'.repeat(64);
    hashBundleOnly(snapshot);
    await assert.rejects(() => importWithKey(db, snapshot, 'snapshot'), {
      code: 'SNAPSHOT_CHECKSUM_MISMATCH',
    });
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 0);
  }));

test('provenance collision never adopts unrelated project and later collision rolls back first project', async () =>
  withDatabase(async (db) => {
    await db.begin((tx) => createProject(tx, { key: 'OCCUPIED', name: 'Original', repositoryUrl: null }));
    const input = legacyBundle(validDocs());
    input.inventory.push({ ...present(input.inventory[0]), key: 'OCCUPIED', legacyProjectId: 'second' });
    rehashBundle(input);
    await assert.rejects(() => importWithKey(db, input, 'collision'), { code: 'PROJECT_KEY_CONFLICT' });
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 1);
    assert.equal((await db`select count(*)::int n from legacy_projects`)[0]?.n, 0);
    assert.equal((await db`select count(*)::int n from docs_imports`)[0]?.n, 0);
  }));

test('new backup reuses snapshot, new commit keeps history, import cannot change verified pointer', async () =>
  withDatabase(async (db) => {
    const input = legacyBundle(validDocs());
    const a = await importWithKey(db, input, 'initial');
    input.backupManifestSha256 = 'c'.repeat(64);
    rehashBundle(input);
    const b = await importWithKey(db, input, 'backup');
    assert.equal(a.projects[0]?.snapshotId, b.projects[0]?.snapshotId);
    await db`update projects set latest_verified_snapshot_id=${present(a.projects[0]).snapshotId}`;
    present(input.inventory[0]).sourceCommit = 'a'.repeat(40);
    rehashBundle(input);
    const c = await importWithKey(db, input, 'commit');
    assert.notEqual(c.projects[0]?.snapshotId, a.projects[0]?.snapshotId);
    assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 2);
    assert.equal(
      (await db`select latest_verified_snapshot_id from projects`)[0]?.latest_verified_snapshot_id,
      a.projects[0]?.snapshotId,
    );
  }));

test('independent pools race duplicate bundle and provenance with one snapshot per identity', async () =>
  withDatabase(async (db) => {
    const left = await openPeerDb(db),
      right = await openPeerDb(db);
    try {
      const input = legacyBundle(validDocs());
      const [a, b] = await Promise.all([
        importWithKey(left, input, 'left'),
        importWithKey(right, input, 'right'),
      ]);
      assert.equal(a.importId, b.importId);
      const changed = rehashBundle({ ...input, backupManifestSha256: 'c'.repeat(64) });
      await Promise.all([
        importWithKey(left, changed, 'new-left'),
        importWithKey(right, changed, 'new-right'),
      ]);
      assert.equal((await db`select count(*)::int n from docs_imports`)[0]?.n, 2);
      assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 1);
      assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 1);
    } finally {
      await left.end();
      await right.end();
    }
  }));

async function syncSetup(db: Db) {
  const x = await executionFixture(db);
  const attempt = await db.begin((tx) =>
    claimAttempt(
      tx,
      x.command.id,
      { processInstanceId: randomUUID(), permit: x.permit },
      x.actor,
      x.authorize,
    ),
  );
  const evidenceId = randomUUID();
  const commit = 'a'.repeat(40);
  await db`update tickets set merged_commit=${commit} where id=${x.f.a.id}`;
  await db`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${evidenceId},${x.f.a.id},${attempt.id},'docs_verification',${db.json({ sourceCommit: commit, sourceTreeSha256: sourceTreeHash(['src/a.ts']), verification: 'verified' })})`;
  const bundle = legacyBundle(validDocs());
  const input: DocsSync = {
    sourceCommit: commit,
    snapshotSha256: present(bundle.inventory[0]).snapshotSha256,
    files: present(bundle.inventory[0]).files,
    attemptId: attempt.id,
    fence: attempt.fence,
    trackedSourcePaths: ['src/a.ts'],
    sourceTreeSha256: sourceTreeHash(['src/a.ts']),
    verificationEvidenceId: evidenceId,
  };
  const sync = (key: string, data = input) =>
    mutate(
      db,
      {
        actor: x.actor,
        route: `/v2/projects/${x.f.project.id}/docs/snapshots`,
        key,
        body: data,
        authorize: (tx) => authorizeDocsSync(tx, x.f.project.id, data, x.actor),
      },
      async (tx) => ({ status: 201, body: await syncDocs(tx, x.f.project.id, data, x.actor) }),
    );
  return { x, attempt, input, sync };
}

test('sync structural snapshot is unverified by default and exact receipt replays without new event', async () =>
  withDatabase(async (db) => {
    const { input, sync, x } = await syncSetup(db);
    const a = await sync('a');
    const cursor = (await db`select value from event_cursor`)[0]?.value;
    const b = await sync('b');
    assert.equal(a.body, b.body);
    assert.equal((await db`select audit_state from docs_snapshots`)[0]?.audit_state, 'unverified');
    assert.equal(
      (await db`select latest_verified_snapshot_id from projects where id=${x.f.project.id}`)[0]
        ?.latest_verified_snapshot_id,
      null,
    );
    assert.equal((await db`select value from event_cursor`)[0]?.value, cursor);
    const modified = { ...input, verificationEvidenceId: randomUUID() };
    await assert.rejects(() => sync('changed', modified), { code: 'DOCS_PROVENANCE_INVALID' });
  }));

test('sync rejects wrong project/commit/fence/guard/binding and stale authority even on idempotency replay', async () =>
  withDatabase(async (db) => {
    const { x, attempt, input, sync } = await syncSetup(db);
    await sync('cached');
    await assert.rejects(() => db.begin((tx) => syncDocs(tx, randomUUID(), input, x.actor)), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(() => sync('commit', { ...input, sourceCommit: 'b'.repeat(40) }), {
      code: 'DOCS_COMMIT_MISMATCH',
    });
    await assert.rejects(() => sync('fence', { ...input, fence: '99' }), { code: 'STALE_FENCE' });
    await db`update execution_guards set active_attempt_id=null where ticket_id=${x.f.a.id}`;
    await assert.rejects(() => sync('cached'), { code: 'STALE_FENCE' });
    await db`update execution_guards set active_attempt_id=${attempt.id} where ticket_id=${x.f.a.id}`;
    await db`update projects set binding_revision=3 where id=${x.f.project.id}`;
    await assert.rejects(() => sync('cached'), { code: 'STALE_BINDING' });
    assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 1);
  }));

test('invalid sync and source-list checksum rollback while reserved finalizing can sync', async () =>
  withDatabase(async (db) => {
    const { attempt, input, sync } = await syncSetup(db);
    await assert.rejects(() => sync('tree', { ...input, sourceTreeSha256: '0'.repeat(64) }), {
      code: 'SOURCE_TREE_CHECKSUM_MISMATCH',
    });
    const broken = legacyBundle({ 'docs/index.md': Buffer.from('# broken') });
    await assert.rejects(
      () =>
        sync('invalid', {
          ...input,
          files: present(broken.inventory[0]).files,
          snapshotSha256: present(broken.inventory[0]).snapshotSha256,
        }),
      { code: 'DOCS_INVALID' },
    );
    assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 0);
    await db`update attempts set state='finalizing',stopped_at=now() where id=${attempt.id}`;
    assert.equal(typeof (await sync('finalizing')).body, 'string');
    await db`update attempts set terminal_intent='cancel' where id=${attempt.id}`;
    await assert.rejects(() => sync('after-cancel'), { code: 'DOCS_SYNC_NOT_ALLOWED' });
  }));

test('sync reused immutable snapshot across another attempt has its own stable receipt', async () =>
  withDatabase(async (db) => {
    const { x, attempt, input, sync } = await syncSetup(db);
    const initial = await sync('first');
    await db`update attempts set state='stopped',stopped_at=now(),finalized_at=now() where id=${attempt.id}`;
    await db`update execution_guards set active_attempt_id=null where ticket_id=${x.f.a.id}`;
    const second = randomUUID(),
      commandId = randomUUID(),
      evidenceId = randomUUID();
    await db`insert into commands(id,machine_id,ticket_id,type,payload,state,binding_revision) values(${commandId},${x.actor.id},${x.f.a.id},'start','{}','queued',2)`;
    await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin) values(${second},${x.f.a.id},${x.actor.id},${commandId},2,2,${randomUUID()},'active',now()+interval '60 seconds','{}')`;
    await db`update execution_guards set active_attempt_id=${second},fence=2 where ticket_id=${x.f.a.id}`;
    await db`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${evidenceId},${x.f.a.id},${second},'docs_verification',${db.json({ sourceCommit: input.sourceCommit, sourceTreeSha256: input.sourceTreeSha256 })})`;
    const next = { ...input, attemptId: second, fence: '2', verificationEvidenceId: evidenceId };
    const first = await sync('second-a', next);
    const replay = await sync('second-b', next);
    assert.equal(first.body, initial.body);
    assert.equal(replay.body, initial.body);
    assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 1);
    assert.equal((await db`select count(*)::int n from docs_sync_receipts`)[0]?.n, 2);
    assert.equal((await db`select count(*)::int n from events where type='docs.synced'`)[0]?.n, 2);
  }));

test('sync concurrent receipt serializes independent pools and conflicts on changed file bytes', async () =>
  withDatabase(async (db) => {
    const { x, input } = await syncSetup(db);
    const left = await openPeerDb(db),
      right = await openPeerDb(db);
    try {
      const call = (pool: typeof db, key: string, data = input) =>
        mutate(
          pool,
          {
            actor: x.actor,
            route: '/sync',
            key,
            body: data,
            authorize: (tx) => authorizeDocsSync(tx, x.f.project.id, data, x.actor),
          },
          async (tx) => ({ status: 201, body: await syncDocs(tx, x.f.project.id, data, x.actor) }),
        );
      const [a, b] = await Promise.all([call(left, 'left'), call(right, 'right')]);
      assert.equal(a.body, b.body);
      const changed = legacyBundle({
        ...validDocs(),
        'docs/architecture.md': Buffer.from('# Kiến trúc mới'),
      });
      await assert.rejects(
        () =>
          call(right, 'changed', {
            ...input,
            files: present(changed.inventory[0]).files,
            snapshotSha256: present(changed.inventory[0]).snapshotSha256,
          }),
        { code: 'DOCS_SYNC_CONFLICT' },
      );
      assert.equal((await db`select count(*)::int n from docs_sync_receipts`)[0]?.n, 1);
    } finally {
      await left.end();
      await right.end();
    }
  }));

test('immutable snapshots/files/links/imports cannot be changed and cross-project pointers reject', async () =>
  withDatabase(async (db) => {
    const result = await importWithKey(db, legacyBundle(validDocs()), 'immutable');
    await assert.rejects(() => db`update docs_files set bytes='changed'`, { code: '55000' });
    await assert.rejects(() => db`delete from docs_snapshots`, { code: '55000' });
    await assert.rejects(() => db`update docs_imports set report='{}'`, { code: '55000' });
    const project = await db.begin((tx) =>
      createProject(tx, { key: 'SECOND', name: 'Second', repositoryUrl: null }),
    );
    await assert.rejects(
      () =>
        db`update projects set latest_imported_snapshot_id=${present(result.projects[0]).snapshotId} where id=${project.id}`,
      { code: '23503' },
    );
  }));

test('backup restore rehearsal covers prefix5 before 006 and preserved prefix6 after import', async () =>
  databaseFixture(6, { migrate: false })(async (source) => {
    await migrate(source, await captureMigrations(5));
    const [sourceName] = await source`select current_database() name`;
    const container = present(process.env.CREW_V2_TEST_CONTAINER_ID);
    const exec = promisify(execFile);
    const dump = () =>
      exec(
        'docker',
        ['exec', container, 'pg_dump', '-U', 'postgres', '--format=custom', '-d', String(sourceName?.name)],
        { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
      );
    const before = await dump();
    const restore = async (db: typeof source, bytes: Buffer) => {
      const [name] = await db`select current_database() name`;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'docker',
          [
            'exec',
            '-i',
            container,
            'pg_restore',
            '-U',
            'postgres',
            '--exit-on-error',
            '-d',
            String(name?.name),
          ],
          { stdio: ['pipe', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`RESTORE_FAILED: ${stderr}`)),
        );
        child.stdin.on('error', reject);
        child.stdin.end(bytes);
      });
    };
    await databaseFixture(6, { migrate: false })(async (target) => {
      await restore(target, before.stdout);
      assert.equal((await target`select max(version) n from schema_migrations`)[0]?.n, 5);
      await migrate(target, await captureMigrations(6));
      assert.equal((await target`select max(version) n from schema_migrations`)[0]?.n, 6);
    });
    await migrate(source, await captureMigrations(6));
    const raw = Buffer.from('# Tài liệu\r\nMáy Mac 😀\r\n');
    const bundle = legacyBundle({ ...validDocs(), 'docs/superpowers/specs/design.md': raw });
    const result = await importWithKey(source, bundle, 'backup-rehearsal');
    const after = await dump();
    await databaseFixture(6, { migrate: false })(async (target) => {
      await restore(target, after.stdout);
      const restored = await importWithKey(target, bundle, 'restore-retry');
      assert.deepEqual(restored, result);
      const [file] =
        await target`select bytes,sha,content_class from docs_files where path='docs/superpowers/specs/design.md'`;
      assert(Buffer.from(file?.bytes).equals(raw));
      assert.equal(file?.sha, hashBytes(raw));
      assert.equal(file?.content_class, 'workflow_artifact');
      assert.equal((await target`select count(*)::int n from docs_snapshots`)[0]?.n, 1);
      assert.equal((await target`select count(*)::int n from docs_imports`)[0]?.n, 1);
    });
  }));

test('import limits, duplicate identities and security links fail closed without keys or snapshots', async () =>
  withDatabase(async (db) => {
    const source = legacyBundle(validDocs());
    const extraFile = { ...present(present(source.inventory[0]).files[0]), token: 'secret' };
    await assert.rejects(
      () =>
        importWithKey(
          db,
          { ...source, inventory: [{ ...present(source.inventory[0]), files: [extraFile] }] },
          'field',
        ),
      { code: 'VALIDATION' },
    );
    const duplicate = {
      ...source,
      inventory: [
        {
          ...present(source.inventory[0]),
          files: [
            present(present(source.inventory[0]).files[0]),
            present(present(source.inventory[0]).files[0]),
          ],
        },
      ],
    };
    await assert.rejects(() => importWithKey(db, duplicate, 'duplicate'), { code: 'DUPLICATE_PATH' });
    await assert.rejects(
      () =>
        importWithKey(
          db,
          { ...source, inventory: Array.from({ length: 101 }, () => present(source.inventory[0])) },
          'projects',
        ),
      { code: 'PROJECT_COUNT_LIMIT', status: 413 },
    );
    await assert.rejects(
      () =>
        importWithKey(
          db,
          {
            ...source,
            inventory: [
              {
                ...present(source.inventory[0]),
                files: Array.from({ length: 2001 }, () => present(present(source.inventory[0]).files[0])),
              },
            ],
          },
          'files',
        ),
      { code: 'FILE_COUNT_LIMIT', status: 413 },
    );
    await assert.rejects(
      () =>
        importWithKey(
          db,
          { ...source, inventory: [present(source.inventory[0]), present(source.inventory[0])] },
          'same-project',
        ),
      { code: 'DUPLICATE_PROJECT' },
    );
    const traversal = legacyBundle(
      { ...validDocs(), 'docs/x.md': Buffer.from('[escape](../../secret)') },
      { 'docs/x.md': 'implemented' },
    );
    await assert.rejects(() => importWithKey(db, traversal, 'link-traversal'), { code: 'LINK_PATH_ESCAPE' });
    await assert.rejects(
      () => db.begin((tx) => importDocs(tx, source, { kind: 'machine', id: randomUUID() })),
      { code: 'OWNER_REQUIRED' },
    );
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 0);
    assert.equal((await db`select count(*)::int n from idempotency`)[0]?.n, 0);
  }));

test('distinct case-sensitive paths survive DB, source provenance mapping refuses reassignment', async () =>
  withDatabase(async (db) => {
    const input = legacyBundle(
      { ...validDocs(), 'docs/Page.md': Buffer.from('# Upper'), 'docs/page.md': Buffer.from('# Lower') },
      { 'docs/Page.md': 'implemented', 'docs/page.md': 'implemented' },
    );
    await importWithKey(db, input, 'case');
    const rows =
      await db`select path,title from docs_files where path in ('docs/Page.md','docs/page.md') order by path collate "C"`;
    assert.deepEqual(
      rows.map((row) => [row.path, row.title]),
      [
        ['docs/Page.md', 'Upper'],
        ['docs/page.md', 'Lower'],
      ],
    );
    present(input.inventory[0]).key = 'OTHER';
    rehashBundle(input);
    await assert.rejects(() => importWithKey(db, input, 'remap'), { code: 'LEGACY_PROVENANCE_CONFLICT' });
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 1);
  }));

test('transaction failure after import rolls back bytes/events/key and same key retries once', async () =>
  withDatabase(async (db) => {
    const input = legacyBundle(validDocs());
    const context = { actor: owner, route: '/v2/docs/imports', key: 'rollback-retry', body: input };
    await assert.rejects(
      () =>
        mutate(db, context, async (tx) => {
          await importDocs(tx, input, owner);
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        }),
      /SIMULATED_TRANSACTION_FAILURE/,
    );
    for (const table of [
      'projects',
      'legacy_projects',
      'docs_imports',
      'docs_snapshots',
      'docs_files',
      'events',
      'idempotency',
    ])
      assert.equal((await db.unsafe(`select count(*)::int n from ${table}`))[0]?.n, 0);
    const result = await importWithKey(db, input, 'rollback-retry');
    const repeated = await importWithKey(db, input, 'rollback-retry');
    assert.deepEqual(result, repeated);
    assert.equal((await db`select count(*)::int n from docs_imports`)[0]?.n, 1);
  }));

test('same checkout bytes at a new merged commit retain separate immutable provenance', async () =>
  withDatabase(async (db) => {
    const { x, input, sync } = await syncSetup(db);
    const a = await sync('commit-a');
    const commit = 'b'.repeat(40),
      evidenceId = randomUUID();
    await db`update tickets set merged_commit=${commit} where id=${x.f.a.id}`;
    await db`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${evidenceId},${x.f.a.id},${input.attemptId},'docs_verification',${db.json({ sourceCommit: commit, sourceTreeSha256: input.sourceTreeSha256 })})`;
    const b = await sync('commit-b', { ...input, sourceCommit: commit, verificationEvidenceId: evidenceId });
    assert.notEqual(a.body, b.body);
    const rows = await db`select source_commit,snapshot_sha from docs_snapshots order by source_commit`;
    assert.deepEqual(
      rows.map((row) => row.source_commit),
      ['a'.repeat(40), 'b'.repeat(40)],
    );
    assert.equal(rows[0]?.snapshot_sha, rows[1]?.snapshot_sha);
  }));

test('machine revocation racing cached sync waits for identity lock and denies replay', async () =>
  withDatabase(async (db) => {
    const { x, sync } = await syncSetup(db);
    await sync('cached');
    const peer = await openPeerDb(db);
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve)),
      started = new Promise<void>((resolve) => (locked = resolve));
    const revoking = peer.begin(async (tx) => {
      await tx`select id from machines where id=${x.actor.id} for update`;
      locked();
      await gate;
      await tx`update machines set revoked_at=now() where id=${x.actor.id}`;
    });
    try {
      await started;
      const rejected = assert.rejects(() => sync('cached'), { code: 'NOT_FOUND' });
      // Observe the real wait rather than guessing transaction scheduling from a timer.
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [row] =
          await db`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%machines%' and pid<>pg_backend_pid()) blocked`;
        if (row?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(blocked, true);
      release();
      await revoking;
      await rejected;
      assert.equal((await db`select count(*)::int n from docs_snapshots`)[0]?.n, 1);
    } finally {
      release();
      await revoking;
      await peer.end();
    }
  }));

test('legacy NUL body/heading/link/fragment/audit metadata preserve raw bytes in mixed batch and replay', async () =>
  withDatabase(async (db) => {
    const raw = Buffer.from(
      '# Heading\u0000tail\nvalid UTF-8\u0000tail\n[External](https://example.invalid/a\u0000b) [Fragment](#heading%00tail) [Custom](probe:\u0000tail)\n',
    );
    const input = legacyBundle(validDocs());
    const artifact = legacyBundle({ 'docs/superpowers/specs/probe.md': raw });
    input.inventory.push({ ...present(artifact.inventory[0]), legacyProjectId: 'nul-project', key: 'NUL' });
    const encodedRaw = Buffer.from('# Normal\n[Missing](#absent%00tail)');
    const encoded = legacyBundle({ 'docs/superpowers/specs/probe.md': encodedRaw });
    input.inventory.push({
      ...present(encoded.inventory[0]),
      legacyProjectId: 'encoded-project',
      key: 'ENCODED',
    });
    rehashBundle(input);
    const first = await importWithKey(db, input, 'nul-a');
    const cursor = (await db`select value from event_cursor`)[0]?.value;
    const second = await importWithKey(db, input, 'nul-b');
    assert.deepEqual(first, second);
    const [saved] =
      await db`select bytes,sha,title,search_text from docs_files where snapshot_id=${present(first.projects[1]).snapshotId} and path='docs/superpowers/specs/probe.md'`;
    assert(Buffer.from(saved?.bytes).equals(raw));
    assert.equal(saved?.sha, hashBytes(raw));
    assert.equal(saved?.title, 'Heading\\u0000tail');
    assert.equal(saved?.search_text, raw.toString().replaceAll('\u0000', '\\u0000'));
    const [snapshot] =
      await db`select audit_report from docs_snapshots where id=${present(first.projects[1]).snapshotId}`;
    assert(
      snapshot?.audit_report.issues.some(
        (issue: { code: string }) => issue.code === 'STORAGE_NUL_PROJECTION',
      ),
    );
    assert.equal(snapshot?.audit_report.storageProjection.nulEncoding, 'literal-backslash-u0000');
    const links =
      await db`select original_href,to_path,fragment,status from docs_links where snapshot_id=${present(first.projects[1]).snapshotId} order by occurrence`;
    assert.equal(links.length, 3);
    assert.equal(links[0]?.original_href, 'https://example.invalid/a\\u0000b');
    assert.equal(links[0]?.to_path, 'https://example.invalid/a\\u0000b');
    assert.equal(links[1]?.fragment, 'heading\\u0000tail');
    assert(
      snapshot?.audit_report.issues.some((issue: { message: string }) =>
        issue.message.includes('probe:\\u0000tail'),
      ),
    );
    const safeJson = (value: unknown): boolean =>
      typeof value === 'string'
        ? !value.includes('\u0000')
        : value !== null && typeof value === 'object'
          ? Object.values(value).every(safeJson)
          : true;
    assert(safeJson(snapshot?.audit_report));
    assert.equal(present(first.projects[2]).auditState, 'invalid');
    assert(present(first.projects[2]).issues.some((issue) => issue.code === 'STORAGE_NUL_PROJECTION'));
    const [encodedSaved] =
      await db`select bytes from docs_files where snapshot_id=${present(first.projects[2]).snapshotId}`;
    assert(Buffer.from(encodedSaved?.bytes).equals(encodedRaw));
    const [encodedLink] =
      await db`select fragment from docs_links where snapshot_id=${present(first.projects[2]).snapshotId}`;
    assert.equal(encodedLink?.fragment, 'absent\\u0000tail');
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 3);
    assert.equal((await db`select value from event_cursor`)[0]?.value, cursor);
  }));

test('high-lexeme 672011-byte artifact imports within 1MiB with prefix FTS and full literal fallback', async () =>
  withDatabase(async (db) => {
    const raw = Buffer.from(Array.from({ length: 120000 }, (_, i) => `w${i.toString(36)}`).join(' '));
    assert.equal(raw.length, 672011);
    const input = legacyBundle(validDocs());
    const artifact = legacyBundle({ 'docs/superpowers/specs/probe.md': raw });
    input.inventory.push({
      ...present(artifact.inventory[0]),
      legacyProjectId: 'large-project',
      key: 'LARGE',
    });
    rehashBundle(input);
    const first = await importWithKey(db, input, 'fts-a');
    const second = await importWithKey(db, input, 'fts-b');
    assert.deepEqual(first, second);
    const [saved] =
      await db`select bytes,sha,search_text,pg_column_size(search_vector) vector_size from docs_files where path='docs/superpowers/specs/probe.md'`;
    assert(Buffer.from(saved?.bytes).equals(raw));
    assert.equal(saved?.sha, hashBytes(raw));
    assert.equal(saved?.search_text, raw.toString());
    assert(Number(saved?.vector_size) < 1048575);
    assert.equal(
      (
        await db`select count(*)::int n from docs_files where path='docs/superpowers/specs/probe.md' and search_vector @@ plainto_tsquery('simple','w1')`
      )[0]?.n,
      1,
    );
    assert.equal(
      (
        await db`select count(*)::int n from docs_files where path='docs/superpowers/specs/probe.md' and search_vector @@ plainto_tsquery('simple','w2klb')`
      )[0]?.n,
      0,
    );
    const rows =
      await db`select path from docs_files where snapshot_id=${present(first.projects[1]).snapshotId} and (search_vector @@ plainto_tsquery('simple','w2klb') or strpos(lower(search_text),lower('w2klb'))>0) order by path limit 1`;
    assert.equal(rows[0]?.path, 'docs/superpowers/specs/probe.md');
    await db.begin(async (tx) => {
      await tx`set local enable_seqscan=off`;
      const [plan] =
        await tx`explain (format json) select path from docs_files where search_vector @@ plainto_tsquery('simple','w1')`;
      assert(JSON.stringify(plan).includes('docs_files_search'));
      const indexed =
        await tx`select path from docs_files where search_vector @@ plainto_tsquery('simple','w1')`;
      assert.equal(indexed[0]?.path, 'docs/superpowers/specs/probe.md');
    });
    assert(present(first.projects[1]).issues.some((issue) => issue.code === 'FTS_PREFIX_ONLY'));
    assert.equal((await db`select count(*)::int n from projects`)[0]?.n, 2);
  }));

test('checkout NUL representation does not upgrade structural validity or verification and keeps raw identity', async () =>
  withDatabase(async (db) => {
    const { x, input, sync } = await syncSetup(db);
    const raw = Buffer.from('# Artifact\u0000 title\nbody\u0000 tail\n');
    const bundle = legacyBundle({ ...validDocs(), 'docs/superpowers/specs/probe.md': raw });
    const project = present(bundle.inventory[0]);
    const id = (
      await sync('nul-sync', { ...input, files: project.files, snapshotSha256: project.snapshotSha256 })
    ).body;
    const [saved] =
      await db`select bytes,sha from docs_files where snapshot_id=${id} and path='docs/superpowers/specs/probe.md'`;
    assert(Buffer.from(saved?.bytes).equals(raw));
    assert.equal(saved?.sha, hashBytes(raw));
    const [state] = await db`select snapshot_sha,audit_state,audit_report from docs_snapshots where id=${id}`;
    assert.equal(state?.snapshot_sha, project.snapshotSha256);
    assert.equal(state?.audit_state, 'unverified');
    assert(
      state?.audit_report.issues.some((issue: { code: string }) => issue.code === 'STORAGE_NUL_PROJECTION'),
    );
    assert.equal(
      (await db`select latest_verified_snapshot_id from projects where id=${x.f.project.id}`)[0]
        ?.latest_verified_snapshot_id,
      null,
    );
    const broken = legacyBundle({ ...validDocs(), 'docs/flows/sample.md': Buffer.from('# Bad\u0000\n') });
    const brokenProject = present(broken.inventory[0]);
    await assert.rejects(
      () =>
        sync('nul-broken', {
          ...input,
          sourceCommit: input.sourceCommit,
          files: brokenProject.files,
          snapshotSha256: brokenProject.snapshotSha256,
        }),
      { code: 'DOCS_INVALID' },
    );
  }));
