import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SetupError } from '../context.js';

/**
 * Checksum cây thư mục workflow (thuật toán ở docs/flows/mac-workflows.md): mọi file thường, bỏ `.in_use` ở cấp gốc,
 * symlink hay loại file khác là lỗi; đường dẫn tương đối sắp theo byte; sha256 của chuỗi `<path>\0<sha256 file>\n`.
 */
export function treeChecksum(root: string): { checksum: string; files: number } {
  if (lstatSync(root).isSymbolicLink()) throw new SetupError(`thư mục workflow là symlink: ${root}`);
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && entry.name === '.in_use') continue;
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new SetupError(`symlink trong cây workflow: ${path}`);
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) files.push(path);
      else throw new SetupError(`entry không phải file thường trong cây workflow: ${path}`);
    }
  };
  walk(root, '');
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash('sha256');
  for (const path of files) {
    const digest = createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex');
    hash.update(`${path}\0${digest}\n`);
  }
  return { checksum: hash.digest('hex'), files: files.length };
}
