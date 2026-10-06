import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Ghi atomic khi nội dung khác; luôn đặt lại mode. Trả true nếu đã ghi. */
export function writeIfChanged(path: string, content: string, mode: number): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && readFileSync(path, 'utf8') === content) {
    chmodSync(path, mode);
    return false;
  }
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode });
  renameSync(temp, path);
  chmodSync(path, mode);
  return true;
}
