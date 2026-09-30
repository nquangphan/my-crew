import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { RUNTIME_LIMITS, type RuntimeManifest, runtimePathProblem } from '@crew/shared';
import { RuntimeRefused, sha256 } from './runtime-verify.js';

const BLOCK = 512;

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

function octalField(header: Buffer, start: number, length: number): number {
  const text = field(header, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new RuntimeRefused('Tarball của bản runtime hỏng (số trong header sai).');
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] as number);
  return sum === octalField(header, 148, 8);
}

/**
 * Reads a gzipped ustar tarball of a runtime bundle into memory, strictly: only regular files (and directory
 * entries, which are skipped), each path safe (`runtimePathProblem`), listed in the signed manifest with the
 * same size and SHA-256, none twice, and every manifest file present. Links, devices, extended headers and
 * anything else refuse the whole bundle. Nothing is written here.
 */
export function readRuntimeTarball(tarball: Buffer, manifest: RuntimeManifest): Map<string, Buffer> {
  let tar: Buffer;
  try {
    tar = gunzipSync(tarball, {
      maxOutputLength: RUNTIME_LIMITS.unpackedBytes + RUNTIME_LIMITS.files * 2 * BLOCK,
    });
  } catch {
    throw new RuntimeRefused('Tarball của bản runtime hỏng hoặc quá lớn.');
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumOk(header)) throw new RuntimeRefused('Tarball của bản runtime hỏng (checksum header sai).');
    if (field(header, 257, 6) !== 'ustar')
      throw new RuntimeRefused('Tarball của bản runtime không đúng định dạng ustar.');
    const type = String.fromCharCode(header[156] as number);
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = octalField(header, 124, 12);
    offset += BLOCK;
    if (type === '5') {
      if (size !== 0) throw new RuntimeRefused('Tarball của bản runtime hỏng (thư mục có dữ liệu).');
      continue;
    }
    if (type !== '0' && type !== '\0') {
      throw new RuntimeRefused(
        `Tarball của bản runtime có mục không phải file thường (${path.slice(0, 80)}) nên bị từ chối.`,
      );
    }
    const problem = runtimePathProblem(path);
    if (problem)
      throw new RuntimeRefused(`Tarball của bản runtime có đường dẫn không an toàn (${path.slice(0, 80)}).`);
    if (files.has(path)) throw new RuntimeRefused(`Tarball của bản runtime có file trùng: ${path}.`);
    const expected = Object.hasOwn(manifest.files, path) ? manifest.files[path] : undefined;
    if (!expected) throw new RuntimeRefused(`Tarball của bản runtime có file ngoài manifest: ${path}.`);
    if (offset + size > tar.length) throw new RuntimeRefused('Tarball của bản runtime bị cắt cụt.');
    const data = tar.subarray(offset, offset + size);
    if (data.length !== expected.size || sha256(data) !== expected.sha256) {
      throw new RuntimeRefused(`File ${path} của bản runtime bị sửa (hash không khớp manifest).`);
    }
    files.set(path, Buffer.from(data));
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  for (const path of Object.keys(manifest.files)) {
    if (!files.has(path)) throw new RuntimeRefused(`Tarball của bản runtime thiếu file ${path}.`);
  }
  return files;
}

/**
 * Writes checked files under `dest` (a fresh folder the caller created): folders 0700, files 0600, never
 * following or replacing anything that exists (`wx`), and never outside `dest`.
 */
export function writeRuntimeFiles(files: Map<string, Buffer>, dest: string): void {
  const root = resolve(dest);
  for (const [path, data] of files) {
    const target = resolve(root, ...path.split('/'));
    if (!target.startsWith(root + sep))
      throw new RuntimeRefused(`Đường dẫn ${path} nằm ngoài thư mục runtime.`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, data, { mode: 0o600, flag: 'wx' });
  }
}

/** Joins a manifest path onto a runtime folder (paths were checked when the manifest was parsed). */
export function runtimeFile(dir: string, path: string): string {
  return join(dir, ...path.split('/'));
}
