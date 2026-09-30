import { z } from 'zod';

/**
 * Signed hot updates of the desktop app's runtime bundle (the daemon host, its bundled daemon library, the role
 * prompt defaults and the renderer). The app binary — the "shell": Electron, the main process, the preload and
 * the native modules — does not change, so macOS keeps its privacy grants. A bundle is a gzipped tarball plus
 * `manifest.json` (every file's SHA-256, the tarball's SHA-256 and the shells it runs on) and a detached Ed25519
 * signature over the manifest's exact bytes. CI signs with a key kept only in a GitHub Actions secret; the shell
 * and the server trust the public keys below (a list, so a key can be rotated).
 */

/** Public Ed25519 keys (raw 32 bytes, base64) whose signatures the shell and the server accept. */
export const RUNTIME_SIGNING_KEYS: readonly { id: string; publicKey: string }[] = [
  { id: 'crew-runtime-2026-09', publicKey: 'rUKLkgJ6Fik9SGC+e+VhpovWDeZUXYdSnf5zo7v0YCs=' },
];

/** Release tag prefix on GitHub: `runtime-v<version>`. */
export const RUNTIME_TAG_PREFIX = 'runtime-v';
/** Release asset names of one runtime version (CI uploads them, the server imports them). */
export function runtimeAssetNames(version: string): { bundle: string; manifest: string; signature: string } {
  return {
    bundle: `crew-runtime-${version}.tar.gz`,
    manifest: `crew-runtime-${version}.manifest.json`,
    signature: `crew-runtime-${version}.manifest.sig`,
  };
}

/** Upper bounds for what the server stores and the shell downloads and unpacks. */
export const RUNTIME_LIMITS = {
  bundleBytes: 80 * 1024 * 1024,
  unpackedBytes: 300 * 1024 * 1024,
  files: 5_000,
  manifestBytes: 2 * 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Versions and ranges (a small semver subset: x.y.z with an optional prerelease)
// ---------------------------------------------------------------------------

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/;

export const RuntimeVersion = z.string().regex(VERSION_RE, 'versions look like 1.2.3 or 1.2.3-rc.1');
export type RuntimeVersion = z.infer<typeof RuntimeVersion>;

function parseVersion(version: string): [number, number, number, string | null] | null {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

/** Orders two versions (negative: a < b). A prerelease sorts before its release; invalid versions sort first. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] as number) - (y[i] as number);
    if (diff !== 0) return diff;
  }
  if (x[3] === y[3]) return 0;
  if (x[3] === null) return 1;
  if (y[3] === null) return -1;
  return x[3] < y[3] ? -1 : 1;
}

const COMPARATOR_RE = /^(>=|<=|>|<|=)?(\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?)$/;

/** A range is one or more space-separated comparators, all of which must hold: `>=0.3.0 <0.4.0`. */
export const VersionRange = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (range) => range.split(/\s+/).every((part) => COMPARATOR_RE.test(part)),
    'ranges look like ">=0.3.0 <0.4.0"',
  );

export function satisfiesRange(version: string, range: string): boolean {
  if (!parseVersion(version)) return false;
  const parts = range.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return false;
  return parts.every((part) => {
    const match = COMPARATOR_RE.exec(part);
    if (!match) return false;
    const cmp = compareVersions(version, match[2] as string);
    switch (match[1] ?? '=') {
      case '>=':
        return cmp >= 0;
      case '<=':
        return cmp <= 0;
      case '>':
        return cmp > 0;
      case '<':
        return cmp < 0;
      default:
        return cmp === 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** The shells a bundle runs on: app versions, and the Electron major (it fixes the native module ABI). */
export const RuntimeShellRange = z.object({
  app: VersionRange,
  electron: z.string().regex(/^\d{1,4}$/, 'an Electron major version, e.g. "44"'),
});
export type RuntimeShellRange = z.infer<typeof RuntimeShellRange>;

/** Top-level folders of a bundle: the daemon host (with its prompts) and the renderer. */
export const RUNTIME_ROOTS = ['host', 'renderer'] as const;

const SEGMENT_RE = /^[A-Za-z0-9_@+~-][A-Za-z0-9._@+~-]{0,127}$/;

/**
 * Why a bundle file path is refused (null: fine). Only relative POSIX paths under a runtime root, made of plain
 * segments: no absolute path, no `.`/`..`, no backslash, no control character, bounded length.
 */
export function runtimePathProblem(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 240) return 'bad length';
  if (path.startsWith('/')) return 'absolute path';
  const segments = path.split('/');
  if (!(RUNTIME_ROOTS as readonly string[]).includes(segments[0] as string) || segments.length < 2) {
    return 'outside host/ and renderer/';
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return 'relative segment';
    if (!SEGMENT_RE.test(segment)) return `bad segment "${segment.slice(0, 40)}"`;
  }
  return null;
}

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex SHA-256');

export const RuntimeFileEntry = z.object({
  sha256: Sha256,
  size: z.number().int().min(0).max(RUNTIME_LIMITS.unpackedBytes),
});

export const RuntimeManifest = z
  .object({
    format: z.literal(1),
    version: RuntimeVersion,
    /** Git commit the bundle was built from. */
    commit: z.string().max(64),
    createdAt: z.iso.datetime(),
    shellRange: RuntimeShellRange,
    /** The tarball (absent in the manifest of the runtime a shell ships with, which is never downloaded). */
    bundle: z
      .object({ sha256: Sha256, size: z.number().int().min(1).max(RUNTIME_LIMITS.bundleBytes) })
      .optional(),
    files: z.record(z.string(), RuntimeFileEntry),
  })
  .superRefine((manifest, ctx) => {
    const paths = Object.keys(manifest.files);
    if (paths.length === 0 || paths.length > RUNTIME_LIMITS.files) {
      ctx.addIssue({ code: 'custom', message: `a bundle has 1 to ${RUNTIME_LIMITS.files} files` });
    }
    for (const path of paths) {
      const problem = runtimePathProblem(path);
      if (problem) ctx.addIssue({ code: 'custom', path: ['files', path], message: problem });
    }
    if (
      !Object.hasOwn(manifest.files, 'host/index.js') ||
      !Object.hasOwn(manifest.files, 'renderer/index.html')
    ) {
      ctx.addIssue({ code: 'custom', message: 'a bundle needs host/index.js and renderer/index.html' });
    }
    const total = Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0);
    if (total > RUNTIME_LIMITS.unpackedBytes)
      ctx.addIssue({ code: 'custom', message: 'the bundle is too large' });
  });
export type RuntimeManifest = z.infer<typeof RuntimeManifest>;

/** Parses a manifest's exact bytes (as signed). Returns the problem instead of throwing. */
export function parseRuntimeManifest(text: string): { manifest: RuntimeManifest } | { error: string } {
  if (text.length > RUNTIME_LIMITS.manifestBytes) return { error: 'the manifest is too large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'the manifest is not JSON' };
  }
  const parsed = RuntimeManifest.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `invalid manifest: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() };
  }
  return { manifest: parsed.data };
}

/** Why this shell cannot run the bundle (null: it can). */
export function shellRangeProblem(
  range: RuntimeShellRange,
  shell: { appVersion: string; electronVersion: string },
): string | null {
  if (!satisfiesRange(shell.appVersion, range.app)) {
    return `cần bản app ${range.app} (máy đang có ${shell.appVersion})`;
  }
  const major = shell.electronVersion.split('.')[0];
  if (major !== range.electron)
    return `cần Electron ${range.electron} (app đang dùng ${shell.electronVersion})`;
  return null;
}

// ---------------------------------------------------------------------------
// Machine state (heartbeat) and server views
// ---------------------------------------------------------------------------

export const RuntimeUpdateState = z.enum([
  /** Running the newest runtime this machine should run. */
  'idle',
  'checking',
  'downloading',
  /** Verifying and unpacking a downloaded bundle. */
  'installing',
  /** Installed; waiting for running jobs before switching. */
  'waiting',
  'switching',
  /** The new runtime failed to start and the previous one runs again. */
  'rolled_back',
  /** The newest runtime needs a newer app (a dmg install). */
  'shell_update_required',
  /** A bundle failed its signature, hash or path checks and was refused. */
  'refused',
  'error',
  /** Updates are off (development build, or the machine is not paired). */
  'disabled',
]);
export type RuntimeUpdateState = z.infer<typeof RuntimeUpdateState>;

/** What the app runs and how its runtime update goes; the heartbeat carries it and the web shows it. */
export const MachineRuntimeState = z.object({
  /** The app (shell) version. */
  shellVersion: z.string().trim().min(1).max(50),
  /** The runtime version running now. */
  version: z.string().trim().min(1).max(50),
  /** `builtin`: the runtime the app ships with; `installed`: a verified hot update. */
  source: z.enum(['builtin', 'installed']),
  state: RuntimeUpdateState,
  /** The version being downloaded, installed or waited for, or the one refused or rolled back from. */
  target: z.string().max(50).nullable(),
  /** Vietnamese detail for the owner (why it waits, what was refused). */
  message: z.string().max(500).nullable(),
  checkedAt: z.iso.datetime().nullable(),
});
export type MachineRuntimeState = z.infer<typeof MachineRuntimeState>;

export const RuntimeRelease = z.object({
  version: RuntimeVersion,
  commit: z.string(),
  createdAt: z.iso.datetime(),
  publishedAt: z.iso.datetime(),
  shellRange: RuntimeShellRange,
  size: z.number().int(),
  bundleSha256: z.string(),
  /** `github`: imported from a `runtime-v*` GitHub Release; `upload`: sent to this server by the owner. */
  source: z.enum(['github', 'upload']),
  publishedBy: z.string(),
  /** The signing key that signed it. */
  keyId: z.string(),
});
export type RuntimeRelease = z.infer<typeof RuntimeRelease>;

/** A release with its exact manifest bytes and signature, which the shell verifies itself. */
export const RuntimeReleaseFiles = RuntimeRelease.extend({
  manifest: z.string().max(RUNTIME_LIMITS.manifestBytes),
  signature: z.string().max(200),
});
export type RuntimeReleaseFiles = z.infer<typeof RuntimeReleaseFiles>;

export const RuntimeReleaseListResponse = z.object({
  items: z.array(RuntimeRelease),
  /** The GitHub repository the server imports `runtime-v*` releases from (null: import is off). */
  githubRepo: z.string().nullable(),
});
export type RuntimeReleaseListResponse = z.infer<typeof RuntimeReleaseListResponse>;

export const RuntimeLatestResponse = z.object({ latest: RuntimeRelease.nullable() });
export type RuntimeLatestResponse = z.infer<typeof RuntimeLatestResponse>;

/** `GET /v1/daemon/runtime`: what this machine should run. */
export const DaemonRuntimeResponse = z.object({
  /** The pinned release, else the newest one this machine's app can run (null: none). */
  desired: RuntimeReleaseFiles.nullable(),
  pinnedVersion: RuntimeVersion.nullable(),
  /** The newest release overall, so the app can tell the owner that a newer one needs an app update. */
  latest: RuntimeRelease.nullable(),
});
export type DaemonRuntimeResponse = z.infer<typeof DaemonRuntimeResponse>;

/** `PUT /v1/machines/:id/runtime`: pin a machine to a release (a rollback when older), or null to follow the newest. */
export const PinRuntimeRequest = z.object({ version: RuntimeVersion.nullable() }).strict();
export type PinRuntimeRequest = z.infer<typeof PinRuntimeRequest>;
export const PinRuntimeResponse = z.object({
  machineId: z.string(),
  pinnedVersion: RuntimeVersion.nullable(),
});
export type PinRuntimeResponse = z.infer<typeof PinRuntimeResponse>;

/** `POST /v1/runtime/releases`: the owner uploads a signed bundle (base64) with its manifest and signature. */
export const PublishRuntimeRequest = z
  .object({
    manifest: z.string().min(2).max(RUNTIME_LIMITS.manifestBytes),
    signature: z.string().min(1).max(200),
    bundle: z
      .string()
      .min(4)
      .max(Math.ceil((RUNTIME_LIMITS.bundleBytes * 4) / 3) + 4),
  })
  .strict();
export type PublishRuntimeRequest = z.infer<typeof PublishRuntimeRequest>;

/** `POST /v1/runtime/releases/import`: what the GitHub import did. */
export const RuntimeImportResponse = z.object({
  imported: z.array(RuntimeVersion),
  skipped: z.array(z.object({ tag: z.string(), reason: z.string() })),
});
export type RuntimeImportResponse = z.infer<typeof RuntimeImportResponse>;

/** The owner's view of one machine's runtime: what it reports and what it is pinned to. */
export const MachineRuntimeView = z.object({
  reported: MachineRuntimeState.nullable(),
  pinnedVersion: RuntimeVersion.nullable(),
});
export type MachineRuntimeView = z.infer<typeof MachineRuntimeView>;
