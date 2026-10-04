import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { buildApp } from '../../server/src/app.ts';
import { loadAttachmentConfig } from '../../server/src/attachments/config.ts';
import { bootstrapOwner } from '../../server/src/auth/bootstrap.ts';
import { connectDb } from '../../server/src/db/client.ts';
import { captureMigrations, migrate } from '../../server/src/db/migrate.ts';
import {
  boundedCleanupStep,
  type CleanupResult,
  closeOwnedResource,
  type FixtureHandle,
  type OwnedResource,
  withFixture,
} from '../e2e/support/fixture.ts';
import { createFixtureReceivers } from './e2e-attachment-receivers.ts';

const execFileAsync = promisify(execFile);
const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const frozenHashes = [
  'dda56a23030e01ee5025d61578969b53157f96fd19ffe6172108b652f6adfa76',
  '11806e8bb34e6aefb2f225d1499052d66d76c06f1ccd278021353fcc7fed78e9',
  '0949541124c0ff26fec05030b8693afe65705ff2d63887f7e452fa6d37487d5d',
  '1149012423551fb847c6a9adf3784906d466a6026d8edb67e079d433dcf8af4f',
  'b8351b54e99ae91a3d2476df812b8fc374860ae472cfe8b7459a4dfc61e41027',
  '8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae',
  '9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4',
  'd268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f',
  'fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a',
  'aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d',
  'fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841',
] as const;

type ContainerInspection = {
  Id: string;
  Image: string;
  Name: string;
  Config: { Image: string; Labels: Record<string, string> };
  State: { StartedAt: string; Running: boolean };
};

async function command(file: string, args: string[], signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout: 20_000, maxBuffer: 1024 * 1024, signal });
  return stdout.trim();
}

async function inspectContainer(id: string, signal?: AbortSignal): Promise<ContainerInspection | null> {
  try {
    const parsed = JSON.parse(await command('docker', ['inspect', id], signal)) as ContainerInspection[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

async function processIdentity(signal?: AbortSignal): Promise<string> {
  const started = await command('ps', ['-p', String(process.pid), '-o', 'lstart='], signal);
  if (!started) throw new Error('PROCESS_IDENTITY_UNKNOWN');
  return String(process.pid) + ':' + started;
}

async function listenLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('WEB_LISTENER_ADDRESS_UNKNOWN');
  return address.port;
}

type ScratchRemovalPort = {
  stat(path: string): Promise<{ dev: number; ino: number }>;
  rm(path: string, options: { recursive: true }): Promise<void>;
};

export function createScratchRemoval(
  scratchPath: string,
  scratchIdentity: string,
  port: ScratchRemovalPort = { stat, rm },
): (signal: AbortSignal) => Promise<boolean> {
  return async (signal) => {
    const entry = await port.stat(scratchPath);
    if (signal.aborted) return false;
    if (String(entry.dev) + ':' + String(entry.ino) !== scratchIdentity) return false;
    await port.rm(scratchPath, { recursive: true });
    return true;
  };
}

type ScratchTarget = { resource: OwnedResource; path: string; identity: string };

async function closeScratch(target: ScratchTarget, removal: ScratchRemovalPort, deadlineMs?: number) {
  return closeOwnedResource(target.resource, {
    deadlineMs,
    readStartIdentity: async () => {
      try {
        const entry = await stat(target.path);
        return String(entry.dev) + ':' + String(entry.ino);
      } catch {
        return null;
      }
    },
    stop: async () => true,
    confirmStopped: async () => true,
    remove: createScratchRemoval(target.path, target.identity, removal),
  });
}

/**
 * Removes the attachment storage root first (the registry that records it lives in the main scratch), then
 * the main scratch. Any UNKNOWN keeps the main scratch, and with it the registry, for reconciliation.
 */
export async function closeScratches(input: {
  main: ScratchTarget;
  attachment?: ScratchTarget;
  removal?: ScratchRemovalPort;
  deadlineMs?: number;
}): Promise<{ results: CleanupResult[]; phase: string }> {
  const removal = input.removal ?? { stat, rm };
  const results: CleanupResult[] = [];
  if (input.attachment) {
    const storage = await closeScratch(input.attachment, removal, input.deadlineMs);
    results.push(storage);
    if (storage.state === 'unknown') {
      results.push({
        resourceId: input.main.resource.id,
        state: 'unknown',
        reason: 'PREVIOUS_CLEANUP_UNKNOWN',
      });
      return { results, phase: 'unknown:ATTACHMENT_SCRATCH_REMOVE' };
    }
  }
  const main = await closeScratch(input.main, removal, input.deadlineMs);
  results.push(main);
  return { results, phase: main.state === 'unknown' ? 'unknown:SCRATCH_REMOVE' : 'stopped' };
}

type AttachmentScratchPort = {
  mkdtemp(prefix: string): Promise<string>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ dev: number; ino: number }>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
};

/**
 * Creates the private attachment storage root. If anything between `mkdtemp` and the caller registering
 * the resource fails, the directory just created is removed here, so no unregistered directory is leaked.
 */
export async function createAttachmentScratch(
  port: AttachmentScratchPort = { mkdtemp, realpath, stat, rm },
): Promise<{ path: string; identity: string }> {
  const made = await port.mkdtemp(join(tmpdir(), 'crew-v2-web-attachments-'));
  try {
    const path = await port.realpath(made);
    const entry = await port.stat(path);
    return { path, identity: String(entry.dev) + ':' + String(entry.ino) };
  } catch (error) {
    await port.rm(made, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function startOwnedFixture(): Promise<FixtureHandle> {
  const migrations = await captureMigrations(11);
  if (
    migrations.files.length !== frozenHashes.length ||
    migrations.files.some((file, index) => file.sha256 !== frozenHashes[index])
  ) {
    throw new Error('WEB_FIXTURE_MIGRATION_PREFIX_DRIFT');
  }

  const ownershipNonce = randomUUID();
  const ownerPassword = randomBytes(32).toString('hex');
  const scratchPath = await mkdtemp(join(tmpdir(), 'crew-v2-web-'));
  const scratchStat = await stat(scratchPath);
  const scratchIdentity = String(scratchStat.dev) + ':' + String(scratchStat.ino);
  const registryPath = join(scratchPath, 'registry.json');
  const containerName = 'crew-v2-web-' + ownershipNonce;
  const dbName = 'crew_v2_test_' + randomUUID().replaceAll('-', '');
  const resources: OwnedResource[] = [];
  const scratchResource: OwnedResource = {
    kind: 'scratch',
    id: scratchPath,
    ownershipNonce,
    startIdentity: scratchIdentity,
  };
  resources.push(scratchResource);

  let phase = 'starting';
  let workerIdentity = '';
  let containerId = '';
  let containerIdentity = '';
  let containerImageDigest = '';
  let dbPort = 0;
  let dbIdentity = '';
  let containerLaunchAttempted = false;
  let databaseCreateAttempted = false;
  let webListenAttempted = false;
  let apiListenAttempted = false;
  let admin: ReturnType<typeof connectDb> | undefined;
  let db: ReturnType<typeof connectDb> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let vite: ViteDevServer | undefined;
  let webServer: ReturnType<typeof createServer> | undefined;
  let webReady = false;
  let apiOrigin = '';
  let webOrigin = '';
  let attachmentScratchPath = '';
  let attachmentScratchIdentity = '';
  let attachmentScratchResource: OwnedResource | undefined;
  let containerResource: OwnedResource | undefined;
  let databaseResource: OwnedResource | undefined;
  let webResource: OwnedResource | undefined;
  let apiResource: OwnedResource | undefined;
  let signalHandler: (() => void) | undefined;
  let shuttingDown = false;
  const webSockets = new Set<Socket>();
  const apiSockets = new Set<Socket>();

  async function persist(): Promise<void> {
    const draft = join(scratchPath, 'registry-' + randomUUID() + '.tmp');
    await writeFile(
      draft,
      JSON.stringify({
        ownershipNonce,
        phase,
        workerIdentity,
        containerName,
        containerId,
        containerImageDigest,
        dbName,
        dbPort,
        containerLaunchAttempted,
        databaseCreateAttempted,
        webListenAttempted,
        apiListenAttempted,
        apiOrigin,
        webOrigin,
        resources,
      }),
      { mode: 0o600 },
    );
    await rename(draft, registryPath);
  }
  async function record(resource: OwnedResource): Promise<void> {
    resources.push(resource);
    await persist();
  }
  async function readContainerIdentity(signal?: AbortSignal): Promise<string | null> {
    if (!containerId) return null;
    const entry = await inspectContainer(containerId, signal);
    if (
      !entry ||
      entry.Id !== containerId ||
      entry.Name !== '/' + containerName ||
      entry.Config.Labels['crew.v2.run'] !== ownershipNonce
    )
      return null;
    return containerId + ':' + entry.State.StartedAt;
  }
  async function readDbIdentity(signal?: AbortSignal): Promise<string | null> {
    if (!admin || (await readContainerIdentity(signal)) !== containerIdentity || signal?.aborted) return null;
    const query = admin.unsafe('select oid from pg_database where datname = $1', [dbName]);
    const cancel = () => {
      try {
        query.cancel();
      } catch {
        // Identity cannot be trusted after a cancellation race; caller records UNKNOWN.
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) return null;
      const rows = await query;
      return rows.length === 1 ? containerId + ':' + String(rows[0]?.oid) : null;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
  async function readListenerIdentity(
    kind: 'web' | 'api',
    port: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if ((await processIdentity(signal)) !== workerIdentity) return null;
    const server = kind === 'web' ? webServer : app?.server;
    const address = server?.address();
    if (!server?.listening || !address || typeof address === 'string' || address.port !== port) return null;
    return workerIdentity + ':' + kind + ':' + String(port) + ':' + ownershipNonce;
  }

  let closePromise: Promise<readonly CleanupResult[]> | undefined;
  async function cleanup(): Promise<readonly CleanupResult[]> {
    if (signalHandler) {
      process.off('SIGTERM', signalHandler);
      process.off('SIGINT', signalHandler);
      signalHandler = undefined;
    }
    const results: CleanupResult[] = [];
    let blocked = false;
    const unknown = (resource: OwnedResource, reason: string): CleanupResult => ({
      resourceId: resource.id,
      state: 'unknown',
      reason,
    });
    const closeOne = async (
      resource: OwnedResource | undefined,
      port: Parameters<typeof closeOwnedResource>[1],
      allowAfterUnknown = false,
    ) => {
      if (!resource) return;
      const result =
        blocked && !allowAfterUnknown
          ? unknown(resource, 'PREVIOUS_CLEANUP_UNKNOWN')
          : await closeOwnedResource(resource, port);
      results.push(result);
      if (result.state === 'unknown') blocked = true;
    };
    const closePhase = async (id: string, operation: () => Promise<void>, milliseconds: number) => {
      try {
        await boundedCleanupStep(operation, milliseconds);
      } catch (error) {
        blocked = true;
        const reason =
          error instanceof Error && error.message === 'CLEANUP_DEADLINE' ? 'CLOSE_DEADLINE' : 'CLOSE_ERROR';
        results.push({ resourceId: id, state: 'unknown', reason });
        phase = 'unknown:' + id;
      }
    };

    phase = 'closing';
    await persist();
    shuttingDown = true;
    for (const socket of [...apiSockets, ...webSockets]) socket.destroy();
    for (const [attempted, resource, id] of [
      [containerLaunchAttempted, containerResource, containerName],
      [databaseCreateAttempted, databaseResource, dbName],
      [webListenAttempted, webResource, 'web:unrecorded'],
      [apiListenAttempted, apiResource, 'api:unrecorded'],
    ] as const) {
      if (attempted && !resource) {
        results.push({ resourceId: id, state: 'unknown', reason: 'START_IDENTITY_UNRECORDED' });
        blocked = true;
      }
    }
    const currentVite = vite;
    if (currentVite) {
      await closePhase('vite:middleware', () => currentVite.close(), 3_000);
    }
    const apiPort = apiResource ? Number(apiResource.id.slice(4)) : 0;
    await closeOne(
      apiResource,
      {
        deadlineMs: 3_000,
        readStartIdentity: (signal) => readListenerIdentity('api', apiPort, signal),
        stop: async () => {
          await app?.close();
          return true;
        },
        confirmStopped: async () => !app?.server.listening && app?.server.address() === null,
      },
      true,
    );
    const webPort = webResource ? Number(webResource.id.slice(4)) : 0;
    await closeOne(
      webResource,
      {
        deadlineMs: 3_000,
        readStartIdentity: (signal) => readListenerIdentity('web', webPort, signal),
        stop: async () => {
          if (!webServer) return false;
          await new Promise<void>((done, fail) =>
            webServer?.close((error) => (error ? fail(error) : done())),
          );
          return true;
        },
        confirmStopped: async () => !webServer?.listening && webServer?.address() === null,
      },
      true,
    );
    const pool = db;
    if (blocked && pool) await closePhase('database:pool', () => pool.end({ timeout: 2 }), 3_000);
    await closeOne(databaseResource, {
      deadlineMs: 5_000,
      readStartIdentity: readDbIdentity,
      stop: async () => {
        await db?.end({ timeout: 2 });
        return true;
      },
      confirmStopped: async (signal) => {
        if (!admin) return false;
        const query = admin.unsafe(
          'select count(*)::integer as count from pg_stat_activity where datname = $1',
          [dbName],
        );
        const cancel = () => {
          try {
            query.cancel();
          } catch {
            // The bounded step records UNKNOWN if cancellation does not settle.
          }
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) return false;
          const rows = await query;
          return rows[0]?.count === 0;
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      },
      remove: async (signal) => {
        const currentAdmin = admin;
        if (!currentAdmin || (await readDbIdentity(signal)) !== dbIdentity || signal.aborted) return false;
        const reserved = await currentAdmin.reserve();
        try {
          if (signal.aborted) return false;
          const setting = reserved.unsafe('set statement_timeout = 3000');
          const cancelSetting = () => {
            try {
              setting.cancel();
            } catch {
              // The next step is gated by the abort signal.
            }
          };
          signal.addEventListener('abort', cancelSetting, { once: true });
          try {
            if (signal.aborted) return false;
            await setting;
          } finally {
            signal.removeEventListener('abort', cancelSetting);
          }
          if (signal.aborted) return false;
          const dropping = reserved.unsafe('drop database "' + dbName + '"');
          const cancelDrop = () => {
            try {
              dropping.cancel();
            } catch {
              // The server-side statement_timeout bounds an in-flight DROP.
            }
          };
          signal.addEventListener('abort', cancelDrop, { once: true });
          try {
            if (signal.aborted) return false;
            await dropping;
            return true;
          } finally {
            signal.removeEventListener('abort', cancelDrop);
          }
        } finally {
          reserved.release();
        }
      },
    });
    const currentAdmin = admin;
    if (currentAdmin) await closePhase('admin:pool', () => currentAdmin.end({ timeout: 2 }), 3_000);
    await closeOne(containerResource, {
      deadlineMs: 8_000,
      readStartIdentity: readContainerIdentity,
      stop: async (signal) => {
        await command('docker', ['stop', '--time', '5', containerId], signal);
        return true;
      },
      confirmStopped: async (signal) =>
        (await inspectContainer(containerId, signal))?.State.Running === false,
      remove: async (signal) => {
        if ((await readContainerIdentity(signal)) !== containerIdentity || signal.aborted) return false;
        await command('docker', ['rm', containerId], signal);
        return true;
      },
    });
    if (blocked) {
      if (attachmentScratchResource)
        results.push(unknown(attachmentScratchResource, 'PREVIOUS_CLEANUP_UNKNOWN'));
      results.push(unknown(scratchResource, 'PREVIOUS_CLEANUP_UNKNOWN'));
      phase = phase.startsWith('unknown:') ? phase : 'unknown';
      await persist();
      webServer?.unref();
      app?.server.unref();
      return results;
    }
    phase = 'stopped';
    await persist();
    const closed = await closeScratches({
      main: { resource: scratchResource, path: scratchPath, identity: scratchIdentity },
      attachment: attachmentScratchResource
        ? {
            resource: attachmentScratchResource,
            path: attachmentScratchPath,
            identity: attachmentScratchIdentity,
          }
        : undefined,
    });
    results.push(...closed.results);
    if (closed.phase !== 'stopped') {
      phase = closed.phase;
      await persist();
    }
    return results;
  }

  try {
    await persist();
    workerIdentity = await processIdentity();
    phase = 'container-starting';
    await persist();
    containerLaunchAttempted = true;
    await persist();
    containerId = await command('docker', [
      'run',
      '-d',
      '--name',
      containerName,
      '--label',
      'crew.v2.run=' + ownershipNonce,
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--pids-limit',
      '64',
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '-e',
      'POSTGRES_DB=crew_v2_test',
      '-p',
      '127.0.0.1::5432',
      'postgres:18.6',
    ]);
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('WEB_FIXTURE_CONTAINER_ID_INVALID');
    containerIdentity = (await readContainerIdentity()) ?? '';
    if (!containerIdentity) throw new Error('WEB_FIXTURE_CONTAINER_IDENTITY_UNKNOWN');
    const inspection = await inspectContainer(containerId);
    containerImageDigest = inspection?.Image ?? '';
    if (inspection?.Config.Image !== 'postgres:18.6' || !/^sha256:[0-9a-f]{64}$/.test(containerImageDigest)) {
      throw new Error('WEB_FIXTURE_CONTAINER_IMAGE_UNKNOWN');
    }
    containerResource = {
      kind: 'container',
      id: containerId,
      ownershipNonce,
      startIdentity: containerIdentity,
    };
    await record(containerResource);
    const mapping = await command('docker', ['port', containerId, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
    if (!match || ['5432', '55432'].includes(match[1] ?? '')) throw new Error('WEB_FIXTURE_DB_PORT_UNSAFE');
    dbPort = Number(match[1]);
    await persist();
    const baseUrl = 'postgres://postgres@127.0.0.1:' + match[1] + '/crew_v2_test';
    admin = connectDb(baseUrl);
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      try {
        if ((await readContainerIdentity()) !== containerIdentity) {
          throw new Error('WEB_FIXTURE_CONTAINER_IDENTITY_UNKNOWN');
        }
        const rows = await admin.unsafe('select current_database() as name');
        if (rows[0]?.name !== 'crew_v2_test') throw new Error('WEB_FIXTURE_BASE_DB_UNKNOWN');
        break;
      } catch {
        if (Date.now() >= readyDeadline) throw new Error('WEB_FIXTURE_DB_NOT_READY');
        await delay(250);
      }
    }
    phase = 'database-creating';
    await persist();
    databaseCreateAttempted = true;
    await persist();
    await admin.unsafe('create database "' + dbName + '"');
    dbIdentity = (await readDbIdentity()) ?? '';
    if (!dbIdentity) throw new Error('WEB_FIXTURE_DB_IDENTITY_UNKNOWN');
    databaseResource = { kind: 'database', id: dbName, ownershipNonce, startIdentity: dbIdentity };
    await record(databaseResource);
    const logicalUrl = new URL(baseUrl);
    logicalUrl.pathname = '/' + dbName;
    db = connectDb(logicalUrl.toString());
    await migrate(db, migrations);
    await bootstrapOwner(db, ownerPassword);

    webServer = createServer((request, response) => {
      if (!webReady || !vite) {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Đang chuẩn bị');
        return;
      }
      vite.middlewares(request, response, () => {
        if (!response.writableEnded) {
          response.statusCode = 404;
          response.end();
        }
      });
    });
    webServer.on('connection', (socket) => {
      if (shuttingDown) {
        socket.destroy();
        return;
      }
      webSockets.add(socket);
      socket.once('close', () => webSockets.delete(socket));
    });
    phase = 'web-listener-starting';
    await persist();
    webListenAttempted = true;
    await persist();
    const webPort = await listenLoopback(webServer);
    webOrigin = 'http://127.0.0.1:' + String(webPort);
    webResource = {
      kind: 'listener',
      id: 'web:' + String(webPort),
      ownershipNonce,
      startIdentity: workerIdentity + ':web:' + String(webPort) + ':' + ownershipNonce,
    };
    await record(webResource);
    // Owned attachment storage root (private, resolved path); removed with the other scratch on close.
    const attachmentScratch = await createAttachmentScratch();
    attachmentScratchPath = attachmentScratch.path;
    attachmentScratchIdentity = attachmentScratch.identity;
    attachmentScratchResource = {
      kind: 'scratch',
      id: attachmentScratchPath,
      ownershipNonce,
      startIdentity: attachmentScratchIdentity,
    };
    await record(attachmentScratchResource);
    const attachmentConfig = loadAttachmentConfig({
      CREW_V2_ATTACHMENT_STORAGE_ROOT: attachmentScratchPath,
    });
    const storageHostId = randomUUID();
    app = await buildApp({
      db,
      attachments: {
        config: attachmentConfig,
        storageHostId,
        // Native Linux writer on Linux; otherwise the in-process closed-ACK fixture port. No extractor
        // version is certified, so submissions with files stay 503 EXTRACTION_NOT_CONFIGURED as designed.
        ...(process.platform === 'linux'
          ? {}
          : {
              receivers: createFixtureReceivers({
                db,
                root: attachmentScratchPath,
                storageHostId,
                now: () => new Date(),
              }),
            }),
      },
      publicOrigin: webOrigin,
      secureCookies: false,
      sessionEncryptionKey: randomBytes(32),
      now: () => new Date(),
    });
    app.server.on('connection', (socket) => {
      if (shuttingDown) {
        socket.destroy();
        return;
      }
      apiSockets.add(socket);
      socket.once('close', () => apiSockets.delete(socket));
    });
    phase = 'api-listener-starting';
    await persist();
    apiListenAttempted = true;
    await persist();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const apiAddress = app.server.address();
    if (!apiAddress || typeof apiAddress === 'string') throw new Error('WEB_FIXTURE_API_ADDRESS_UNKNOWN');
    apiOrigin = 'http://127.0.0.1:' + String(apiAddress.port);
    apiResource = {
      kind: 'listener',
      id: 'api:' + String(apiAddress.port),
      ownershipNonce,
      startIdentity: workerIdentity + ':api:' + String(apiAddress.port) + ':' + ownershipNonce,
    };
    await record(apiResource);
    vite = await createViteServer({
      configFile: false,
      root: webRoot,
      base: '/crew-v2/',
      plugins: [react()],
      logLevel: 'silent',
      appType: 'spa',
      server: {
        middlewareMode: true,
        hmr: false,
        proxy: { '/v2': { target: apiOrigin, changeOrigin: false } },
      },
    });
    webReady = true;
    phase = 'ready';
    await persist();

    const handle = {
      apiOrigin,
      webOrigin,
      dbName,
      dbPort,
      containerName,
      containerImageDigest,
      registryPath,
      get resources() {
        return Object.freeze([...resources]);
      },
      close() {
        if (!closePromise) closePromise = cleanup();
        return closePromise;
      },
    } as FixtureHandle;
    Object.defineProperty(handle, 'ownerPassword', { get: () => ownerPassword, enumerable: false });
    signalHandler = () => {
      void handle.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', signalHandler);
    process.once('SIGINT', signalHandler);
    return handle;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--preview') throw new Error('WEB_FIXTURE_MODE_UNKNOWN');
  await withFixture(async (handle) => {
    console.log(
      `preview-ready=${JSON.stringify({
        webOrigin: handle.webOrigin,
        apiOrigin: handle.apiOrigin,
        dbPort: handle.dbPort,
        dbName: handle.dbName,
        containerName: handle.containerName,
        containerImageDigest: handle.containerImageDigest,
        registryPath: handle.registryPath,
        resources: handle.resources,
      })}`,
    );
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let resolveSignal: () => void = () => undefined;
    const signaled = new Promise<void>((resolve) => {
      resolveSignal = resolve;
    });
    const onSignal = () => resolveSignal();
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    try {
      const closeFromInput = (async () => {
        for await (const line of input) {
          if (line.trim() === 'close') return;
        }
        throw new Error('WEB_FIXTURE_PREVIEW_INPUT_CLOSED');
      })();
      await Promise.race([closeFromInput, signaled]);
      const results = await handle.close();
      console.log(`preview-cleanup=${JSON.stringify(results)}`);
    } finally {
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      input.close();
    }
  });
}
