import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type RuntimeManifest, RuntimeVersion } from '@crew/shared';
import { z } from 'zod';
import { readRuntimeTarball, runtimeFile, writeRuntimeFiles } from './runtime-archive.js';
import {
  RuntimeRefused,
  type ShellFacts,
  type SigningKey,
  sha256,
  verifyManifest,
  verifyTarball,
} from './runtime-verify.js';

const MANIFEST = 'manifest.json';
const SIGNATURE = 'manifest.sig';
const NODE_MODULES = 'node_modules';

const Probation = z.object({
  version: RuntimeVersion,
  /** The installed version to go back to (null: the runtime the app ships with). */
  previous: RuntimeVersion.nullable(),
  startedAt: z.iso.datetime(),
  readyTimeouts: z.number().int().min(0),
  /** When the new host crashed (ms since epoch). */
  crashes: z.array(z.number()),
});
export type Probation = z.infer<typeof Probation>;

const StateFile = z.object({
  /** The installed version the app starts (null: the one it ships with). */
  active: RuntimeVersion.nullable().default(null),
  /** Installed versions that were active before, newest first (rollback targets). */
  history: z.array(RuntimeVersion).default([]),
  /** Versions that failed to start here, with why; never switched to again automatically. */
  bad: z.record(z.string(), z.string()).default({}),
  /** A version just switched to, watched until it proves it starts and stays up. */
  probation: Probation.nullable().default(null),
});
export type RuntimeStateFile = z.infer<typeof StateFile>;

export interface InstalledRuntime {
  version: string;
  dir: string;
  manifest: RuntimeManifest;
}

/**
 * The verified runtime bundles on this machine: `~/.crew/runtime/<version>/` (the user's own, 0700) with the
 * signed `manifest.json` and `manifest.sig` next to `host/` and `renderer/`, plus `state.json` (which one is
 * active, the history, the failures and the probation of a fresh switch). Every load verifies the signature,
 * the shell range and every file's hash again, so a bundle changed on disk never runs.
 */
export class RuntimeStore {
  readonly root: string;
  readonly incoming: string;
  private readonly stateFile: string;

  constructor(
    home: string,
    private readonly keys: readonly SigningKey[],
    private readonly shell: ShellFacts,
  ) {
    this.root = join(home, 'runtime');
    this.incoming = join(this.root, '.incoming');
    this.stateFile = join(this.root, 'state.json');
  }

  /** Creates the folder, or tightens it back to 0700; refuses one owned by another user. */
  ensureRoot(): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const stat = statSync(this.root);
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw new RuntimeRefused(
        `Thư mục ${this.root} không thuộc người dùng này nên không dùng bản runtime nào trong đó.`,
      );
    }
    if ((stat.mode & 0o077) !== 0) chmodSync(this.root, 0o700);
  }

  read(): RuntimeStateFile {
    try {
      return StateFile.parse(JSON.parse(readFileSync(this.stateFile, 'utf8')));
    } catch {
      return StateFile.parse({});
    }
  }

  write(state: RuntimeStateFile): RuntimeStateFile {
    this.ensureRoot();
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.stateFile);
    return state;
  }

  update(patch: (state: RuntimeStateFile) => RuntimeStateFile): RuntimeStateFile {
    return this.write(patch(this.read()));
  }

  dir(version: string): string {
    if (!RuntimeVersion.safeParse(version).success)
      throw new RuntimeRefused(`Phiên bản runtime không hợp lệ: ${version}.`);
    return join(this.root, version);
  }

  /**
   * Verifies an installed version completely (signature, shell range, owner, every file's hash, nothing extra)
   * and returns it; throws `RuntimeRefused` with the reason otherwise.
   */
  load(version: string): InstalledRuntime {
    this.ensureRoot();
    const dir = this.dir(version);
    if (!existsSync(join(dir, MANIFEST))) throw new RuntimeRefused(`Bản runtime ${version} chưa được cài.`);
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new RuntimeRefused(`Thư mục bản runtime ${version} không hợp lệ.`);
    }
    const text = readFileSync(join(dir, MANIFEST), 'utf8');
    const signature = existsSync(join(dir, SIGNATURE)) ? readFileSync(join(dir, SIGNATURE), 'utf8') : null;
    const manifest = verifyManifest(text, signature, this.keys, this.shell);
    if (manifest.version !== version)
      throw new RuntimeRefused(`Thư mục ${version} chứa bản ${manifest.version}.`);
    const expected = new Set(Object.keys(manifest.files));
    for (const [path, entry] of Object.entries(manifest.files)) {
      const file = runtimeFile(dir, path);
      const fileStat = existsSync(file) ? lstatSync(file) : null;
      if (!fileStat?.isFile()) throw new RuntimeRefused(`Bản runtime ${version} thiếu file ${path}.`);
      if (fileStat.size !== entry.size || sha256(readFileSync(file)) !== entry.sha256) {
        throw new RuntimeRefused(`File ${path} của bản runtime ${version} đã bị sửa trên máy.`);
      }
    }
    for (const top of ['host', 'renderer']) {
      for (const path of listFiles(join(dir, top))) {
        const rel = relative(dir, path).split(sep).join('/');
        if (!expected.has(rel)) throw new RuntimeRefused(`Bản runtime ${version} có file lạ: ${rel}.`);
      }
    }
    return { version, dir, manifest };
  }

  /**
   * Installs a downloaded release: checks the signature and shell range, the tarball's hash, then every entry
   * while reading it; writes into a fresh staging folder and moves it into place only when all of it checked
   * out. Nothing of the bundle runs before this returns.
   */
  install(manifestText: string, signature: string | null, tarball: Buffer): InstalledRuntime {
    const manifest = verifyManifest(manifestText, signature, this.keys, this.shell);
    verifyTarball(tarball, manifest);
    const files = readRuntimeTarball(tarball, manifest);
    this.ensureRoot();
    const staging = mkdtempSync(join(this.root, '.staging-'));
    try {
      chmodSync(staging, 0o700);
      writeRuntimeFiles(files, staging);
      writeFileSync(join(staging, MANIFEST), manifestText, { mode: 0o600 });
      writeFileSync(join(staging, SIGNATURE), `${(signature ?? '').trim()}\n`, { mode: 0o600 });
      const dir = this.dir(manifest.version);
      rmSync(dir, { recursive: true, force: true });
      renameSync(staging, dir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return this.load(manifest.version);
  }

  /**
   * Points `<version>/node_modules` at the shell's own node_modules, so the host resolves the native modules
   * and SDKs the app ships (the bundle carries none). Refreshed at every launch: the app may have moved.
   */
  linkNodeModules(dir: string, target: string): void {
    const link = join(dir, NODE_MODULES);
    let current: string | null = null;
    try {
      current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : '';
    } catch {
      current = null;
    }
    if (current === target) return;
    if (current !== null) rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link, 'dir');
  }

  /** Removes installed versions not in `keep`, and leftovers of interrupted installs and downloads. */
  prune(keep: readonly string[]): string[] {
    if (!existsSync(this.root)) return [];
    const removed: string[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      const path = join(this.root, entry.name);
      if (entry.name.startsWith('.staging-')) rmSync(path, { recursive: true, force: true });
      else if (
        entry.isDirectory() &&
        RuntimeVersion.safeParse(entry.name).success &&
        !keep.includes(entry.name)
      ) {
        rmSync(path, { recursive: true, force: true });
        removed.push(entry.name);
      }
    }
    if (existsSync(this.incoming)) {
      for (const name of readdirSync(this.incoming)) rmSync(join(this.incoming, name), { force: true });
    }
    return removed;
  }

  /** A downloaded tarball in the incoming folder (read once, then deleted). */
  takeIncoming(path: string): Buffer {
    const resolved = join(this.incoming, relative(this.incoming, path));
    if (!resolved.startsWith(this.incoming + sep))
      throw new RuntimeRefused('Tệp tải về nằm ngoài thư mục runtime.');
    try {
      return readFileSync(resolved);
    } finally {
      try {
        unlinkSync(resolved);
      } catch {
        // already gone
      }
    }
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}
