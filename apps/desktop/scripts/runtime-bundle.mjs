#!/usr/bin/env node
/**
 * The runtime bundle of the desktop app: the daemon host (`out/runtime/host`, with its role prompts) and the
 * renderer (`out/runtime/renderer`), built by `electron-vite build` and `electron-vite build -c
 * electron.vite.host.config.ts`. The shell (Electron, main process, preload, native modules) is not part of it.
 *
 *   node scripts/runtime-bundle.mjs builtin
 *     Writes `out/runtime/manifest.json`: the runtime the app ships with (inside the signed app, never
 *     downloaded, so it has no signature and no tarball).
 *   node scripts/runtime-bundle.mjs release [--out <dir>]
 *     Writes `crew-runtime-<version>.tar.gz`, `crew-runtime-<version>.manifest.json` and, when a signing key is
 *     set, `crew-runtime-<version>.manifest.sig` into `release/runtime/` (or `--out`). The key is the PEM of an
 *     Ed25519 private key in `CREW_RUNTIME_SIGNING_KEY` (CI: the GitHub Actions secret of that name) or in the
 *     file named by `CREW_RUNTIME_SIGNING_KEY_FILE`. Without a key the bundle is unsigned and every shell refuses
 *     it; the script says so and exits 0 (CI publishes it anyway so the missing secret is visible). A key whose
 *     public half is not in `RUNTIME_SIGNING_KEYS` (@crew/shared) fails the build.
 *
 *   node scripts/runtime-bundle.mjs verify [<dir>]
 *     Checks the release in `release/runtime/` (or `<dir>`) the way a shell does before installing it: the
 *     signature over the manifest by one of RUNTIME_SIGNING_KEYS, and the tarball's size and SHA-256.
 *
 * The version and the shells it runs on come from `crewRuntime` in apps/desktop/package.json; the Electron
 * major from the installed Electron (it fixes the native module ABI the host loads).
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const RUNTIME_DIR = join(root, 'out', 'runtime');
const ROOTS = ['host', 'renderer'];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Every file under `host/` and `renderer/` of a runtime folder, as sorted POSIX paths with their bytes. */
export function collectFiles(runtimeDir) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(relative(runtimeDir, path).split(sep).join('/'), readFileSync(path));
      else throw new Error(`not a plain file: ${path}`);
    }
  };
  for (const top of ROOTS) {
    const dir = join(runtimeDir, top);
    if (!existsSync(dir)) throw new Error(`${dir} is missing: build the app first`);
    walk(dir);
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

/** One ustar header for a regular file (deterministic: mode 0644, owner 0, mtime 0). */
function tarHeader(path, size) {
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100)
      throw new Error(`path too long for tar: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(size, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

/** A gzipped ustar archive of regular files only (the shell refuses every other entry type). */
export function packTarGz(files) {
  const parts = [];
  for (const [path, data] of files) {
    parts.push(tarHeader(path, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function runtimeConfig() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'));
  if (!pkg.crewRuntime?.version || !pkg.crewRuntime?.shell)
    throw new Error('package.json has no crewRuntime');
  return {
    version: pkg.crewRuntime.version,
    shellRange: { app: pkg.crewRuntime.shell, electron: electron.version.split('.')[0] },
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The manifest text of a runtime (exactly the bytes that get signed): every file's size and SHA-256, the
 * tarball's when there is one, the version and the shells it runs on.
 */
export function manifestText({ files, version, shellRange, commit = gitCommit(), createdAt, bundle }) {
  const manifest = {
    format: 1,
    version,
    commit,
    createdAt: createdAt ?? new Date().toISOString(),
    shellRange,
    ...(bundle ? { bundle: { sha256: sha256(bundle), size: bundle.length } } : {}),
    files: Object.fromEntries(
      [...files].map(([path, data]) => [path, { sha256: sha256(data), size: data.length }]),
    ),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Signs the manifest bytes with an Ed25519 private key (PEM text or KeyObject); returns base64. */
export function signManifest(text, key) {
  const privateKey = typeof key === 'string' ? createPrivateKey(key) : key;
  return sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');
}

/** The raw public key (base64) of an Ed25519 private key. */
export function publicKeyOf(key) {
  const privateKey = typeof key === 'string' ? createPrivateKey(key) : key;
  return createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
}

/** The public keys the shells trust, read from @crew/shared's RUNTIME_SIGNING_KEYS. */
export function trustedPublicKeys() {
  const source = readFileSync(
    join(root, '..', '..', 'packages', 'shared', 'src', 'runtime-schemas.ts'),
    'utf8',
  );
  return [...source.matchAll(/publicKey:\s*'([A-Za-z0-9+/=]{44})'/g)].map((match) => match[1]);
}

/** A release of the runtime in `runtimeDir`: tarball, manifest text and signature (null without a key). */
export function createRuntimeRelease({
  runtimeDir = RUNTIME_DIR,
  version,
  shellRange,
  signingKey = null,
  commit,
}) {
  const files = collectFiles(runtimeDir);
  const bundle = packTarGz(files);
  const manifest = manifestText({ files, version, shellRange, commit, bundle });
  return { bundle, manifest, signature: signingKey ? signManifest(manifest, signingKey) : null };
}

/** Checks a written release like a shell would (signature by a trusted key, tarball hash); throws otherwise. */
export function verifyRelease(dir, version, keys = trustedPublicKeys()) {
  const base = join(dir, `crew-runtime-${version}`);
  const manifest = readFileSync(`${base}.manifest.json`);
  if (!existsSync(`${base}.manifest.sig`)) throw new Error(`crew-runtime-${version} is unsigned`);
  const signature = Buffer.from(readFileSync(`${base}.manifest.sig`, 'utf8').trim(), 'base64');
  const spki = (raw) =>
    createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw, 'base64')]),
      format: 'der',
      type: 'spki',
    });
  if (!keys.some((key) => verify(null, manifest, spki(key), signature))) {
    throw new Error(`crew-runtime-${version}: the signature does not verify with RUNTIME_SIGNING_KEYS`);
  }
  const parsed = JSON.parse(manifest.toString('utf8'));
  const bundle = readFileSync(`${base}.tar.gz`);
  if (
    parsed.version !== version ||
    parsed.bundle?.size !== bundle.length ||
    parsed.bundle?.sha256 !== sha256(bundle)
  ) {
    throw new Error(`crew-runtime-${version}: the manifest does not match the tarball`);
  }
}

function signingKeyFromEnv() {
  const inline = process.env.CREW_RUNTIME_SIGNING_KEY?.trim();
  if (inline) return inline;
  const file = process.env.CREW_RUNTIME_SIGNING_KEY_FILE;
  return file ? readFileSync(file, 'utf8') : null;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const config = runtimeConfig();
  if (command === 'builtin') {
    const text = manifestText({ files: collectFiles(RUNTIME_DIR), ...config });
    writeFileSync(join(RUNTIME_DIR, 'manifest.json'), text);
    console.log(
      `builtin runtime ${config.version} (shell ${config.shellRange.app}, Electron ${config.shellRange.electron})`,
    );
    return;
  }
  if (command === 'verify') {
    const dir = rest[0] ?? join(root, 'release', 'runtime');
    verifyRelease(dir, config.version);
    console.log(
      `ok: crew-runtime-${config.version} in ${dir} is signed by a trusted key and matches its manifest`,
    );
    return;
  }
  if (command !== 'release')
    throw new Error('usage: runtime-bundle.mjs builtin | release [--out <dir>] | verify [<dir>]');
  const outIndex = rest.indexOf('--out');
  const out = outIndex >= 0 && rest[outIndex + 1] ? rest[outIndex + 1] : join(root, 'release', 'runtime');
  const key = signingKeyFromEnv();
  if (key && !trustedPublicKeys().includes(publicKeyOf(key))) {
    throw new Error(
      'the signing key is not one of RUNTIME_SIGNING_KEYS in packages/shared/src/runtime-schemas.ts',
    );
  }
  const release = createRuntimeRelease({ ...config, signingKey: key });
  const names = {
    bundle: `crew-runtime-${config.version}.tar.gz`,
    manifest: `crew-runtime-${config.version}.manifest.json`,
    signature: `crew-runtime-${config.version}.manifest.sig`,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, names.bundle), release.bundle);
  writeFileSync(join(out, names.manifest), release.manifest);
  if (release.signature) writeFileSync(join(out, names.signature), `${release.signature}\n`);
  const size = statSync(join(out, names.bundle)).size;
  console.log(`runtime ${config.version}: ${names.bundle} (${size} bytes) in ${out}`);
  if (!release.signature) {
    console.warn(
      'WARNING: no CREW_RUNTIME_SIGNING_KEY: this bundle is UNSIGNED and every 2P Crew app will refuse it. ' +
        'Add the secret (docs/flows/runtime-updates.md) and publish again.',
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
