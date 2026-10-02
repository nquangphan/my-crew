import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hashBytes } from '../src/docs/checksum.ts';
import { legacyBundle, rehashBundle, validDocs } from './support/docs.ts';

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('TEST_FIXTURE_MISSING');
  return value;
}

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/docs-import.ts', import.meta.url));
async function fixture(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'crew-v2-docs-cli-'));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function exported(dir: string, artifactBytes = Buffer.from('# Thiết kế\r\nMáy Mac 😀\r\n')) {
  const input = legacyBundle({
    ...validDocs(),
    'docs/superpowers/specs/design.md': artifactBytes,
  });
  const sourceBackup = Buffer.from('fixture backup, no v1 connection\r\n');
  await writeFile(join(dir, 'source.backup'), sourceBackup);
  const project = present(input.inventory[0]);
  for (const file of project.files) {
    const path = join(dir, 'projects', project.legacyProjectId, file.path);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, Buffer.from(file.bytesBase64, 'base64'));
  }
  const manifest = {
    version: 1,
    sourceSystem: 'crew-v1',
    exportedAt: '2026-10-02T00:00:00Z',
    sourceBackup: { path: 'source.backup', sha256: hashBytes(sourceBackup) },
    projects: [
      {
        legacyProjectId: project.legacyProjectId,
        sourceCommit: project.sourceCommit,
        files: project.files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          size: Buffer.from(file.bytesBase64, 'base64').length,
          contentClass: file.contentClass,
        })),
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  input.backupManifestSha256 = hashBytes(bytes);
  rehashBundle(input);
  await writeFile(join(dir, 'backup.json'), bytes);
  await writeFile(join(dir, 'bundle.json'), JSON.stringify(input));
  return { input, manifest };
}
const run = (dir: string, extra: string[] = []) =>
  exec(
    process.execPath,
    [cli, '--bundle', join(dir, 'bundle.json'), '--backup-manifest', join(dir, 'backup.json'), ...extra],
    {
      env: {
        ...process.env,
        CREW_V2_OWNER_SESSION: 'SESSION_SENTINEL',
        CREW_V2_OWNER_CSRF: 'CSRF_SENTINEL',
        CREW_V2_SERVER_URL: 'https://invalid.localhost',
      },
    },
  );

test('CLI dry-run verifies backup and preserved files twice without writes or secret output', async () =>
  fixture(async (dir) => {
    const { input } = await exported(dir);
    const before = await Promise.all(
      present(input.inventory[0]).files.map((file) => readFile(join(dir, 'projects', 'legacy-1', file.path))),
    );
    for (let n = 0; n < 2; n++) {
      const { stdout, stderr } = await run(dir, ['--dry-run']);
      const summary = JSON.parse(stdout);
      assert.equal(summary.projects, 1);
      assert.equal(summary.files, 8);
      assert.equal(summary.violations, 0);
      assert.equal(stderr, '');
      assert(!stdout.includes('SESSION_SENTINEL'));
      assert(!stdout.includes('CSRF_SENTINEL'));
      assert(!stdout.includes('Thiết kế'));
    }
    const after = await Promise.all(
      present(input.inventory[0]).files.map((file) => readFile(join(dir, 'projects', 'legacy-1', file.path))),
    );
    assert(before.every((bytes, index) => bytes.equals(present(after[index]))));
  }));

test('CLI rejects backup/doc corruption, class disagreement and symlink without leaking credentials', async () =>
  fixture(async (dir) => {
    const { manifest } = await exported(dir);
    await writeFile(join(dir, 'source.backup'), 'corrupt');
    await assert.rejects(
      () => run(dir, ['--dry-run']),
      (error) => String((error as { stderr: string }).stderr).includes('BACKUP_CHECKSUM_MISMATCH'),
    );
    await exported(dir);
    await writeFile(join(dir, 'projects', 'legacy-1', 'docs', 'index.md'), 'corrupt');
    await assert.rejects(
      () => run(dir, ['--dry-run']),
      (error) => String((error as { stderr: string }).stderr).includes('BACKUP_FILE_MISMATCH'),
    );
    const fresh = await exported(dir);
    present(present(fresh.manifest.projects[0]).files[0]).contentClass = 'workflow_artifact';
    const bytes = Buffer.from(JSON.stringify(fresh.manifest));
    fresh.input.backupManifestSha256 = hashBytes(bytes);
    rehashBundle(fresh.input);
    await writeFile(join(dir, 'backup.json'), bytes);
    await writeFile(join(dir, 'bundle.json'), JSON.stringify(fresh.input));
    await assert.rejects(
      () => run(dir, ['--dry-run']),
      (error) => String((error as { stderr: string }).stderr).includes('BACKUP_INVENTORY_MISMATCH'),
    );
    await exported(dir);
    await rm(join(dir, 'source.backup'));
    await writeFile(join(dir, 'outside'), randomUUID());
    await symlink(join(dir, 'outside'), join(dir, 'source.backup'));
    await assert.rejects(
      () => run(dir, ['--dry-run']),
      (error) => String((error as { stderr: string }).stderr).includes('BACKUP_PATH_INVALID'),
    );
    assert.equal(manifest.sourceSystem, 'crew-v1');
  }));

test('CLI transport takes credentials only from env/stdin and rejects credentials in arguments', async () =>
  fixture(async (dir) => {
    await exported(dir);
    await assert.rejects(
      () => run(dir, ['--session', 'SESSION_SENTINEL']),
      (error) => {
        const stderr = String((error as { stderr: string }).stderr);
        return stderr.includes('CLI_ARGUMENT_INVALID') && !stderr.includes('SESSION_SENTINEL');
      },
    );
  }));

test('CLI uploads only to explicit owner origin with stable retry key and never logs server secrets', async () =>
  fixture(async (dir) => {
    const { createServer } = await import('node:http');
    const { input } = await exported(dir);
    let received = 0;
    const server = createServer(async (request, response) => {
      received++;
      assert.equal(request.url, '/v2/docs/imports');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.cookie, 'SESSION_SENTINEL');
      assert.equal(request.headers['x-csrf-token'], 'CSRF_SENTINEL');
      assert.equal(request.headers['idempotency-key'], `docs-import-${input.bundleSha256}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.equal(JSON.parse(Buffer.concat(chunks).toString()).bundleSha256, input.bundleSha256);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ secret: 'SERVER_SECRET_SENTINEL' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('LISTEN_FAILED');
    try {
      for (let n = 0; n < 2; n++) {
        const { stdout, stderr }: { stdout: string; stderr: string } = await exec(
          process.execPath,
          [cli, '--bundle', join(dir, 'bundle.json'), '--backup-manifest', join(dir, 'backup.json')],
          {
            env: {
              ...process.env,
              CREW_V2_SERVER_URL: `http://127.0.0.1:${address.port}`,
              CREW_V2_OWNER_SESSION: 'SESSION_SENTINEL',
              CREW_V2_OWNER_CSRF: 'CSRF_SENTINEL',
            },
          },
        );
        assert.equal(JSON.parse(stdout).uploaded, true);
        assert.equal(stderr, '');
        assert(!/SESSION_SENTINEL|CSRF_SENTINEL|SERVER_SECRET_SENTINEL/.test(stdout));
      }
      const pending = exec(
        process.execPath,
        [cli, '--bundle', join(dir, 'bundle.json'), '--backup-manifest', join(dir, 'backup.json')],
        {
          env: {
            ...process.env,
            CREW_V2_SERVER_URL: `http://127.0.0.1:${address.port}`,
            CREW_V2_OWNER_SESSION: '',
            CREW_V2_OWNER_CSRF: '',
          },
        },
      );
      pending.child.stdin?.end(
        JSON.stringify({ sessionCookie: 'SESSION_SENTINEL', csrfToken: 'CSRF_SENTINEL' }),
      );
      const fromStdin = await pending;
      assert.equal(JSON.parse(fromStdin.stdout).uploaded, true);
      assert(
        !/SESSION_SENTINEL|CSRF_SENTINEL|SERVER_SECRET_SENTINEL/.test(fromStdin.stdout + fromStdin.stderr),
      );
      assert.equal(received, 3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }));

test('CLI never forwards owner credentials through a redirect or logs failed response content', async () =>
  fixture(async (dir) => {
    const { createServer } = await import('node:http');
    await exported(dir);
    let count = 0;
    let port = 0;
    const server = createServer((_request, response) => {
      count++;
      response.writeHead(302, { Location: `http://127.0.0.1:${port}/stolen` });
      response.end('SESSION_SENTINEL CSRF_SENTINEL SERVER_SECRET_SENTINEL');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('LISTEN_FAILED');
    port = address.port;
    try {
      await assert.rejects(
        () =>
          exec(
            process.execPath,
            [cli, '--bundle', join(dir, 'bundle.json'), '--backup-manifest', join(dir, 'backup.json')],
            {
              env: {
                ...process.env,
                CREW_V2_SERVER_URL: `http://127.0.0.1:${port}`,
                CREW_V2_OWNER_SESSION: 'SESSION_SENTINEL',
                CREW_V2_OWNER_CSRF: 'CSRF_SENTINEL',
              },
            },
          ),
        (error) => {
          const output =
            String((error as { stdout: string }).stdout) + String((error as { stderr: string }).stderr);
          return (
            output.includes('IMPORT_UPLOAD_FAILED') &&
            !/SESSION_SENTINEL|CSRF_SENTINEL|SERVER_SECRET_SENTINEL/.test(output)
          );
        },
      );
      assert.equal(count, 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }));

test('CLI dry-run reports NUL projection and bounded FTS while keeping complete export bytes', async () =>
  fixture(async (dir) => {
    const raws = [
      Buffer.from('# Artifact\u0000 heading\nbody\u0000 tail'),
      Buffer.from(Array.from({ length: 120000 }, (_, i) => `w${i.toString(36)}`).join(' ')),
    ];
    for (const raw of raws) {
      const { input } = await exported(dir, raw);
      const path = join(dir, 'projects', 'legacy-1', 'docs', 'superpowers', 'specs', 'design.md');
      const before = await readFile(path);
      const { stdout, stderr } = await run(dir, ['--dry-run']);
      assert.equal(stderr, '');
      const summary = JSON.parse(stdout);
      assert.equal(summary.violations, 0);
      assert.equal(summary.warnings, 2);
      assert.equal(summary.bundleSha256, input.bundleSha256);
      assert(before.equals(raw));
      assert((await readFile(path)).equals(before));
    }
  }));
