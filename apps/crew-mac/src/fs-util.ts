import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export interface WriteOptions {
  /** File của owner (`~/.zshenv`, `authorized_keys`): đã có thì giữ mode cũ, chỉ file mới nhận `mode`. */
  keepExistingMode?: boolean;
}

/**
 * Ghi atomic khi nội dung khác; trả true nếu đã ghi. Đường dẫn là symlink thì ghi vào file đích thật
 * (file tạm nằm cạnh file đích), nên symlink từ dotfiles của owner giữ nguyên.
 */
export function writeIfChanged(
  path: string,
  content: string,
  mode: number,
  options: WriteOptions = {},
): boolean {
  const exists = existsSync(path);
  const target = exists ? realpathSync(path) : path;
  if (!exists) mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const finalMode = exists && options.keepExistingMode ? statSync(target).mode & 0o7777 : mode;
  if (exists && readFileSync(target, 'utf8') === content) {
    if (!options.keepExistingMode) chmodSync(target, finalMode);
    return false;
  }
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  writeFileSync(temp, content, { mode: finalMode });
  chmodSync(temp, finalMode);
  renameSync(temp, target);
  return true;
}
