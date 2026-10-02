import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, readlink, realpath, symlink } from 'node:fs/promises';
import { join, posix, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { canonicalJson, hash, syncDirectory } from '../journal/atomic-records.ts';
import type { ManifestEntry } from './pins.ts';
export const MAX_TREE_BYTES = 128 * 1024 * 1024;
export const MAX_ENTRIES = 20_000;
export type TreeFile = {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  mode: 0o644 | 0o755 | null;
  body: Buffer;
  target?: string;
};
const hasControl = (s: string) => Array.from(s).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export function safeRelative(path: string): string {
  const p = path.normalize('NFC');
  if (
    !p ||
    p.startsWith('/') ||
    p.includes('\\') ||
    hasControl(p) ||
    p.length > 2048 ||
    p.split('/').some((x) => !x || x === '.' || x === '..')
  )
    throw new Error('UNSAFE_ARCHIVE_PATH');
  return p;
}
const folded = (s: string) => s.normalize('NFC').toUpperCase().toLowerCase();
export function validateFiles(files: TreeFile[]): TreeFile[] {
  const seen = new Map<string, string>();
  const explicit = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    f.path = safeRelative(f.path);
    if (explicit.has(f.path)) throw new Error('DUPLICATE_ARCHIVE_PATH');
    explicit.add(f.path);
    const parts = f.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      const old = seen.get(folded(p));
      if (old && old !== p) throw new Error('DUPLICATE_ARCHIVE_PATH');
      seen.set(folded(p), p);
      if (seen.size > MAX_ENTRIES) throw new Error('TREE_SIZE_LIMIT');
    }
    bytes += f.body.length;
    if (bytes > MAX_TREE_BYTES || files.length > MAX_ENTRIES) throw new Error('TREE_SIZE_LIMIT');
    if (f.type === 'symlink') {
      const target = f.target?.normalize('NFC');
      if (!target || target.startsWith('/') || target.includes('\\') || hasControl(target))
        throw new Error('SYMLINK_ESCAPE');
      const resolved = posix.normalize(posix.join(posix.dirname(f.path), target));
      if (resolved === '..' || resolved.startsWith('../')) throw new Error('SYMLINK_ESCAPE');
      f.target = target;
      f.body = Buffer.from(target);
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      const old = byPath.get(p);
      if (old && old.type !== 'dir') throw new Error('UNSAFE_ARCHIVE_PATH');
      if (!old) byPath.set(p, { path: p, type: 'dir', mode: 0o755, body: Buffer.alloc(0) });
    }
  }
  return [...byPath.values()].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
export async function parseArchive(bytes: Buffer, executables: readonly string[]): Promise<TreeFile[]> {
  const extract = tar.extract();
  const gunzip = createGunzip();
  const input = Readable.from([bytes]);
  const files: TreeFile[] = [];
  let total = 0;
  let prefix: string | undefined;
  // Error forwarding is essential: malformed/truncated gzip must not leave the iterator hung.
  let expanded = 0;
  const bound = new Transform({
    transform(chunk, _encoding, callback) {
      expanded += chunk.length;
      callback(expanded > MAX_TREE_BYTES + 16 * 1024 * 1024 ? new Error('TREE_SIZE_LIMIT') : null, chunk);
    },
  });
  input.on('error', (e) => extract.destroy(e));
  gunzip.on('error', (e) => extract.destroy(e));
  bound.on('error', (e) => extract.destroy(e));
  input.pipe(gunzip).pipe(bound).pipe(extract);
  try {
    for await (const entry of extract) {
      const h = entry.header;
      const raw = h.name.replace(/\/$/, '');
      const parts = raw.split('/');
      if (!prefix) prefix = parts[0];
      if (parts[0] !== prefix) throw new Error('ARCHIVE_ROOT_MISMATCH');
      safeRelative(raw);
      if (parts.length === 1) {
        if (h.type !== 'directory') throw new Error('ARCHIVE_ROOT_MISMATCH');
        entry.resume();
        continue;
      }
      const path = safeRelative(parts.slice(1).join('/'));
      if (!['file', 'directory', 'symlink'].includes(h.type ?? ''))
        throw new Error('UNSUPPORTED_ARCHIVE_ENTRY');
      if (((h.mode ?? 0) & 0o7000) !== 0) throw new Error('MODE_DRIFT');
      const executable = executables.includes(path);
      if (h.type === 'file' && Boolean((h.mode ?? 0) & 0o111) !== executable) throw new Error('MODE_DRIFT');
      if (h.size !== undefined && (h.size > MAX_TREE_BYTES || h.size < 0)) throw new Error('TREE_SIZE_LIMIT');
      const chunks: Buffer[] = [];
      for await (const chunk of entry) {
        const b = Buffer.from(chunk);
        total += b.length;
        if (total > MAX_TREE_BYTES) throw new Error('TREE_SIZE_LIMIT');
        chunks.push(b);
      }
      const type = h.type === 'directory' ? 'dir' : h.type === 'symlink' ? 'symlink' : 'file';
      files.push({
        path,
        type,
        mode: type === 'symlink' ? null : type === 'dir' || executable ? 0o755 : 0o644,
        body: Buffer.concat(chunks),
        ...(type === 'symlink' ? { target: h.linkname ?? undefined } : {}),
      });
      if (files.length > MAX_ENTRIES) throw new Error('TREE_SIZE_LIMIT');
    }
  } finally {
    input.destroy();
    gunzip.destroy();
    bound.destroy();
    extract.destroy();
  }
  return validateFiles(files);
}
export async function writeTree(root: string, files: TreeFile[]): Promise<void> {
  const validated = validateFiles(files);
  await mkdir(root, { mode: 0o755 });
  await chmod(root, 0o755);
  for (const f of validated
    .filter((f) => f.type === 'dir')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
    const p = join(root, f.path);
    await mkdir(p, { mode: 0o755 });
    await chmod(p, 0o755);
  }
  for (const f of validated.filter((f) => f.type === 'file')) {
    const fd = await open(
      join(root, f.path),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      f.mode ?? 0o644,
    );
    try {
      await fd.writeFile(f.body);
      await fd.chmod(f.mode ?? 0o644);
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  for (const f of validated.filter((f) => f.type === 'symlink'))
    await symlink(f.target ?? '', join(root, f.path));
  await scanTree(root);
  for (const f of validated.filter((f) => f.type === 'dir').reverse())
    await syncDirectory(join(root, f.path));
  await syncDirectory(root);
}
export async function scanTree(root: string): Promise<ManifestEntry[]> {
  const canonical = await realpath(root);
  if (canonical !== resolve(root)) throw new Error('UNSAFE_TREE');
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.()) throw new Error('UNSAFE_TREE');
  const files: TreeFile[] = [];
  let total = 0;
  async function walk(rel: string) {
    for (const name of await readdir(join(root, rel))) {
      const path = rel ? `${rel}/${name}` : name;
      if (safeRelative(path) !== path) throw new Error('UNSAFE_TREE');
      const abs = join(root, path);
      const s = await lstat(abs);
      if (s.uid !== process.getuid?.()) throw new Error('UNSAFE_TREE');
      if (s.isSymbolicLink()) {
        const target = await readlink(abs);
        const real = await realpath(abs).catch(() => {
          throw new Error('SYMLINK_ESCAPE');
        });
        if (real !== canonical && !real.startsWith(canonical + sep)) throw new Error('SYMLINK_ESCAPE');
        files.push({ path, type: 'symlink', mode: null, body: Buffer.from(target), target });
      } else if (s.isDirectory()) {
        if ((s.mode & 0o7777) !== 0o755) throw new Error('MODE_DRIFT');
        files.push({ path, type: 'dir', mode: 0o755, body: Buffer.alloc(0) });
        await walk(path);
      } else if (s.isFile()) {
        if (s.nlink !== 1 || ![0o644, 0o755].includes(s.mode & 0o7777)) throw new Error('MODE_DRIFT');
        total += s.size;
        if (total > MAX_TREE_BYTES) throw new Error('TREE_SIZE_LIMIT');
        const fd = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const now = await fd.stat();
          if (now.ino !== s.ino || now.dev !== s.dev || now.nlink !== 1) throw new Error('UNSAFE_TREE');
          files.push({
            path,
            type: 'file',
            mode: (s.mode & 0o7777) as 0o644 | 0o755,
            body: await fd.readFile(),
          });
        } finally {
          await fd.close();
        }
      } else throw new Error('UNSUPPORTED_ARCHIVE_ENTRY');
      if (files.length > MAX_ENTRIES) throw new Error('TREE_SIZE_LIMIT');
    }
  }
  await walk('');
  return manifest(validateFiles(files));
}
export const manifest = (files: TreeFile[]): ManifestEntry[] =>
  files.map((f) => ({
    path: f.path,
    type: f.type,
    mode: f.mode,
    bytes: f.body.length,
    sha256: hash(f.body),
    ...(f.type === 'symlink' ? { target: f.target } : {}),
  }));
export const manifestHash = (entries: ManifestEntry[]) => hash(canonicalJson(entries));
export async function readTree(root: string): Promise<TreeFile[]> {
  const entries = await scanTree(root);
  const result: TreeFile[] = [];
  for (const e of entries) {
    let body = Buffer.alloc(0);
    if (e.type === 'file') {
      const fd = await open(join(root, e.path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        body = await fd.readFile();
      } finally {
        await fd.close();
      }
    } else if (e.type === 'symlink') body = Buffer.from(e.target ?? '');
    if (hash(body) !== e.sha256) throw new Error('CHECKSUM_MISMATCH');
    result.push({ ...e, body });
  }
  return result;
}
