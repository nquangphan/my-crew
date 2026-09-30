import { PinRuntimeRequest, PublishRuntimeRequest, RUNTIME_LIMITS, RuntimeVersion } from '@crew/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireMachine } from '../auth/machine-auth.js';
import { ApiError } from '../errors.js';
import {
  desiredRuntime,
  importFromGithub,
  listReleases,
  pinRuntime,
  publishRelease,
  runtimeBundle,
  trustedRuntimeKeys,
} from '../services/runtime-service.js';
import { parseInput, type RouteDeps, uuidParam } from './route-deps.js';

/** Base64 of the largest bundle plus the manifest and the JSON around them. */
const UPLOAD_BODY_LIMIT =
  Math.ceil((RUNTIME_LIMITS.bundleBytes * 4) / 3) + RUNTIME_LIMITS.manifestBytes + 64 * 1024;

function ownerName(request: FastifyRequest): string {
  const session = request.ownerSession;
  if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
  return `owner:${session.username}`;
}

function versionParam(params: unknown): string {
  const parsed = RuntimeVersion.safeParse((params as { version?: unknown }).version);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'invalid runtime version');
  return parsed.data;
}

/** Owner routes: the published runtime bundles, uploads, the GitHub import and each machine's pin. */
export async function runtimeRoutes(app: FastifyInstance, { db, config }: RouteDeps): Promise<void> {
  app.get('/v1/runtime/releases', async () => ({
    items: await listReleases(db),
    githubRepo: config.runtimeReleasesRepo ?? null,
  }));

  app.get('/v1/runtime/latest', async () => ({ latest: (await listReleases(db))[0] ?? null }));

  app.post('/v1/runtime/releases', { bodyLimit: UPLOAD_BODY_LIMIT }, async (request, reply) => {
    const body = parseInput(PublishRuntimeRequest, request.body);
    const bundle = Buffer.from(body.bundle, 'base64');
    const { release, created } = await publishRelease(
      db,
      { manifest: body.manifest, signature: body.signature, bundle },
      { source: 'upload', publishedBy: ownerName(request), keys: trustedRuntimeKeys(config) },
    );
    return reply.status(created ? 201 : 200).send(release);
  });

  app.post('/v1/runtime/releases/import', async () => {
    const repo = config.runtimeReleasesRepo;
    if (!repo)
      throw new ApiError('VALIDATION_FAILED', 'the GitHub import is off (RUNTIME_RELEASES_REPO is empty)');
    return importFromGithub(db, { repo, keys: trustedRuntimeKeys(config) });
  });

  app.put('/v1/machines/:id/runtime', async (request) => {
    const body = parseInput(PinRuntimeRequest, request.body);
    return pinRuntime(db, uuidParam(request.params, 'machine'), body.version);
  });
}

/** Daemon routes: which runtime this machine should run, and its tarball. */
export async function daemonRuntimeRoutes(app: FastifyInstance, { db }: RouteDeps): Promise<void> {
  app.get('/v1/daemon/runtime', async (request) => desiredRuntime(db, requireMachine(request).machineId));

  app.get('/v1/daemon/runtime/:version/bundle', async (request, reply) => {
    requireMachine(request);
    const data = await runtimeBundle(db, versionParam(request.params));
    return reply.header('content-type', 'application/gzip').header('cache-control', 'no-store').send(data);
  });
}
