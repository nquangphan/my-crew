import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  compareVersions,
  type DaemonRuntimeResponse,
  parseRuntimeManifest,
  RUNTIME_LIMITS,
  RUNTIME_SIGNING_KEYS,
  RUNTIME_TAG_PREFIX,
  type RuntimeImportResponse,
  type RuntimeManifest,
  type RuntimeRelease,
  type RuntimeReleaseFiles,
  RuntimeVersion,
  runtimeAssetNames,
  satisfiesRange,
} from '@crew/shared';
import { eq, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Executor } from '../db/client.js';
import { machines, type RuntimeReleaseRow, runtimeBundles, runtimeReleases } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents } from './event-service.js';

export interface SigningKey {
  id: string;
  /** Raw Ed25519 public key, base64. */
  publicKey: string;
}

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The built-in runtime signing keys plus the server's extra ones (a staging or test key). */
export function trustedRuntimeKeys(config: Pick<AppConfig, 'runtimeExtraKeys'>): SigningKey[] {
  return [...RUNTIME_SIGNING_KEYS, ...(config.runtimeExtraKeys ?? [])];
}

/** The id of the key whose Ed25519 signature over `message` is `signature` (base64), or null. */
export function signedBy(message: Buffer, signature: string, keys: readonly SigningKey[]): string | null {
  const sig = Buffer.from(signature.trim(), 'base64');
  if (sig.length !== 64) return null;
  for (const key of keys) {
    const raw = Buffer.from(key.publicKey, 'base64');
    if (raw.length !== 32) continue;
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
      });
      if (verify(null, message, publicKey, sig)) return key.id;
    } catch {
      // a malformed key never verifies anything
    }
  }
  return null;
}

export interface ReleaseInput {
  /** The manifest's exact bytes, as signed. */
  manifest: string;
  /** Detached Ed25519 signature over the manifest, base64. */
  signature: string;
  bundle: Buffer;
}

/**
 * Checks a bundle before the server keeps it: the manifest parses, a trusted key signed it, and the tarball is
 * the one it names (size and SHA-256). The shell repeats every check before it runs anything.
 */
export function checkRelease(
  input: ReleaseInput,
  keys: readonly SigningKey[],
): { manifest: RuntimeManifest; keyId: string } {
  const parsed = parseRuntimeManifest(input.manifest);
  if ('error' in parsed) throw new ApiError('VALIDATION_FAILED', parsed.error);
  const { manifest } = parsed;
  const keyId = signedBy(Buffer.from(input.manifest, 'utf8'), input.signature, keys);
  if (!keyId) throw new ApiError('VALIDATION_FAILED', 'the runtime manifest is not signed by a trusted key');
  if (!manifest.bundle) throw new ApiError('VALIDATION_FAILED', 'the manifest does not name its tarball');
  if (input.bundle.length !== manifest.bundle.size) {
    throw new ApiError('VALIDATION_FAILED', 'the tarball size does not match the manifest');
  }
  if (createHash('sha256').update(input.bundle).digest('hex') !== manifest.bundle.sha256) {
    throw new ApiError('VALIDATION_FAILED', 'the tarball hash does not match the manifest');
  }
  return { manifest, keyId };
}

function toReleaseDto(row: Omit<RuntimeReleaseRow, 'manifest' | 'signature'>): RuntimeRelease {
  return {
    version: row.version,
    commit: row.commit,
    createdAt: row.builtAt.toISOString(),
    publishedAt: row.publishedAt.toISOString(),
    shellRange: row.shellRange,
    size: row.size,
    bundleSha256: row.bundleSha256,
    source: row.source,
    publishedBy: row.publishedBy,
    keyId: row.keyId,
  };
}

const releaseColumns = {
  version: runtimeReleases.version,
  keyId: runtimeReleases.keyId,
  commit: runtimeReleases.commit,
  shellRange: runtimeReleases.shellRange,
  bundleSha256: runtimeReleases.bundleSha256,
  size: runtimeReleases.size,
  source: runtimeReleases.source,
  publishedBy: runtimeReleases.publishedBy,
  builtAt: runtimeReleases.builtAt,
  publishedAt: runtimeReleases.publishedAt,
};

/** Every release, newest version first. */
export async function listReleases(db: Executor): Promise<RuntimeRelease[]> {
  const rows = await db.select(releaseColumns).from(runtimeReleases);
  return rows.map(toReleaseDto).sort((a, b) => compareVersions(b.version, a.version));
}

async function releaseFiles(db: Executor, version: string): Promise<RuntimeReleaseFiles | null> {
  const [row] = await db.select().from(runtimeReleases).where(eq(runtimeReleases.version, version));
  return row ? { ...toReleaseDto(row), manifest: row.manifest, signature: row.signature } : null;
}

/**
 * Stores a checked release and tells the owner and every machine. Publishing the same tarball again is a no-op;
 * another tarball under a published version is refused (versions are immutable).
 */
export async function publishRelease(
  db: Executor,
  input: ReleaseInput,
  meta: { source: 'github' | 'upload'; publishedBy: string; keys: readonly SigningKey[] },
): Promise<{ release: RuntimeRelease; created: boolean }> {
  const { manifest, keyId } = checkRelease(input, meta.keys);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select(releaseColumns)
      .from(runtimeReleases)
      .where(eq(runtimeReleases.version, manifest.version))
      .for('update');
    if (existing) {
      if (existing.bundleSha256 === manifest.bundle?.sha256) {
        return { release: toReleaseDto(existing), created: false };
      }
      throw new ApiError('CONFLICT', `runtime ${manifest.version} is already published with another bundle`);
    }
    const [row] = await tx
      .insert(runtimeReleases)
      .values({
        version: manifest.version,
        manifest: input.manifest,
        signature: input.signature.trim(),
        keyId,
        commit: manifest.commit,
        shellRange: manifest.shellRange,
        bundleSha256: manifest.bundle?.sha256 ?? '',
        size: input.bundle.length,
        source: meta.source,
        publishedBy: meta.publishedBy,
        builtAt: new Date(manifest.createdAt),
      })
      .returning(releaseColumns);
    if (!row) throw new Error('runtime release insert returned no row');
    await tx.insert(runtimeBundles).values({ version: manifest.version, data: input.bundle });
    const live = await tx.select({ id: machines.id }).from(machines).where(isNull(machines.revokedAt));
    const data = { version: manifest.version };
    await appendEvents(tx, [
      { payload: { type: 'runtime.published', data } },
      ...live.map(({ id }) => ({
        payload: { type: 'runtime.published' as const, data },
        targetMachineId: id,
      })),
    ]);
    return { release: toReleaseDto(row), created: true };
  });
}

/**
 * What a machine should run: the release the owner pinned it to, else the newest one whose shell range admits
 * the app version the machine reported. `latest` is the newest release overall, so an app too old for it can
 * tell the owner a dmg install is needed.
 */
export async function desiredRuntime(db: Executor, machineId: string): Promise<DaemonRuntimeResponse> {
  const [machine] = await db
    .select({
      pinned: machines.runtimePinnedVersion,
      runtime: machines.runtimeState,
      appVersion: machines.appVersion,
    })
    .from(machines)
    .where(eq(machines.id, machineId));
  if (!machine) throw notFound('machine');
  const releases = await listReleases(db);
  const shellVersion = machine.runtime?.shellVersion ?? machine.appVersion;
  const pick = machine.pinned
    ? releases.find((release) => release.version === machine.pinned)
    : releases.find(
        (release) => shellVersion !== null && satisfiesRange(shellVersion, release.shellRange.app),
      );
  return {
    desired: pick ? await releaseFiles(db, pick.version) : null,
    pinnedVersion: machine.pinned,
    latest: releases[0] ?? null,
  };
}

/** Pins a machine to a published release (older = a rollback), or with null lets it follow the newest. */
export async function pinRuntime(
  db: Executor,
  machineId: string,
  version: string | null,
): Promise<{ machineId: string; pinnedVersion: string | null }> {
  return db.transaction(async (tx) => {
    const [machine] = await tx
      .select({ id: machines.id, revokedAt: machines.revokedAt })
      .from(machines)
      .where(eq(machines.id, machineId))
      .for('update');
    if (!machine) throw notFound('machine');
    if (machine.revokedAt) throw new ApiError('CONFLICT', 'the machine was revoked');
    if (version !== null) {
      const [release] = await tx
        .select({ version: runtimeReleases.version })
        .from(runtimeReleases)
        .where(eq(runtimeReleases.version, version));
      if (!release) throw notFound(`runtime ${version}`);
    }
    await tx.update(machines).set({ runtimePinnedVersion: version }).where(eq(machines.id, machineId));
    const data = { machineId, version };
    await appendEvents(tx, [
      { payload: { type: 'runtime.pinned', data } },
      { payload: { type: 'runtime.pinned', data }, targetMachineId: machineId },
    ]);
    return { machineId, pinnedVersion: version };
  });
}

export async function runtimeBundle(db: Executor, version: string): Promise<Buffer> {
  const [row] = await db.select().from(runtimeBundles).where(eq(runtimeBundles.version, version));
  if (!row) throw notFound(`runtime ${version}`);
  return row.data;
}

// ---------------------------------------------------------------------------
// Import from GitHub Releases
// ---------------------------------------------------------------------------

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  draft: boolean;
  assets: GithubAsset[];
}

async function download(fetchImpl: typeof fetch, url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/octet-stream', 'user-agent': '2p-crew-server' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error(`${url} is larger than ${maxBytes} bytes`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes) throw new Error(`${url} is larger than ${maxBytes} bytes`);
  return body;
}

/**
 * Imports the `runtime-v*` releases of a GitHub repository this server does not have yet. A release without a
 * signature, or whose signature or hashes do not check out, is skipped with its reason (never stored).
 */
export async function importFromGithub(
  db: Executor,
  options: { repo: string; keys: readonly SigningKey[]; fetch?: typeof fetch },
): Promise<RuntimeImportResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`https://api.github.com/repos/${options.repo}/releases?per_page=30`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': '2p-crew-server' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new ApiError('CONFLICT', `GitHub answered HTTP ${response.status} for ${options.repo}`);
  const releases = (await response.json()) as GithubRelease[];
  const known = new Set(
    (await db.select({ version: runtimeReleases.version }).from(runtimeReleases)).map((r) => r.version),
  );
  const result: RuntimeImportResponse = { imported: [], skipped: [] };
  for (const release of Array.isArray(releases) ? releases : []) {
    const tag = String(release.tag_name ?? '');
    if (!tag.startsWith(RUNTIME_TAG_PREFIX) || release.draft) continue;
    const version = tag.slice(RUNTIME_TAG_PREFIX.length);
    if (!RuntimeVersion.safeParse(version).success) {
      result.skipped.push({ tag, reason: 'not a version' });
      continue;
    }
    if (known.has(version)) continue;
    const names = runtimeAssetNames(version);
    const asset = (name: string) => release.assets?.find((item) => item.name === name);
    const bundle = asset(names.bundle);
    const manifest = asset(names.manifest);
    const signature = asset(names.signature);
    if (!bundle || !manifest) {
      result.skipped.push({ tag, reason: 'missing the bundle or its manifest' });
      continue;
    }
    if (!signature) {
      result.skipped.push({ tag, reason: 'unsigned (CREW_RUNTIME_SIGNING_KEY was not set in CI)' });
      continue;
    }
    if (bundle.size > RUNTIME_LIMITS.bundleBytes) {
      result.skipped.push({ tag, reason: 'the bundle is too large' });
      continue;
    }
    try {
      const [manifestBytes, signatureBytes, bundleBytes] = await Promise.all([
        download(fetchImpl, manifest.browser_download_url, RUNTIME_LIMITS.manifestBytes),
        download(fetchImpl, signature.browser_download_url, 1_024),
        download(fetchImpl, bundle.browser_download_url, RUNTIME_LIMITS.bundleBytes),
      ]);
      const text = manifestBytes.toString('utf8');
      const parsed = parseRuntimeManifest(text);
      if ('manifest' in parsed && parsed.manifest.version !== version) {
        result.skipped.push({ tag, reason: `the manifest is for ${parsed.manifest.version}` });
        continue;
      }
      await publishRelease(
        db,
        { manifest: text, signature: signatureBytes.toString('utf8'), bundle: bundleBytes },
        { source: 'github', publishedBy: `github:${options.repo}`, keys: options.keys },
      );
      result.imported.push(version);
    } catch (error) {
      result.skipped.push({ tag, reason: (error as Error).message.slice(0, 300) });
    }
  }
  return result;
}
