import { SetupError } from './context.js';

export const PATH_BLOCK_BEGIN = '# >>> crew-mac path >>>';
export const PATH_BLOCK_END = '# <<< crew-mac path <<<';
export const PATH_BLOCK_BODY = 'export PATH="$HOME/.local/bin:$PATH"';
/** Dòng comment mà spike stock-first đã thêm, ngay trên dòng PATH_BLOCK_BODY. */
export const SPIKE_PATH_COMMENT = '# Crew v3 spike: claude cho phiên SSH không tương tác';

/** Gỡ các khối crew-mac; khối mở mà thiếu dòng đóng thì ném lỗi thay vì nuốt phần còn lại của file. */
export function removePathBlock(text: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line === PATH_BLOCK_BEGIN) {
      if (inside) break;
      inside = true;
      continue;
    }
    if (inside) {
      if (line === PATH_BLOCK_END) inside = false;
      continue;
    }
    out.push(line);
  }
  if (inside) {
    throw new SetupError(
      `~/.zshenv có dòng "${PATH_BLOCK_BEGIN}" mà thiếu dòng đóng "${PATH_BLOCK_END}". Sửa tay file này (thêm dòng đóng hoặc xóa dòng mở) rồi chạy lại.`,
    );
  }
  return out.join('\n');
}

export function upsertPathBlock(text: string): string {
  const without = removePathBlock(text);
  const base = without === '' || without.endsWith('\n') ? without : `${without}\n`;
  return `${base}${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\n${PATH_BLOCK_END}\n`;
}

export function hasPathBlock(text: string): boolean {
  const lines = text.split('\n');
  const begin = lines.indexOf(PATH_BLOCK_BEGIN);
  return begin >= 0 && lines[begin + 1] === PATH_BLOCK_BODY && lines[begin + 2] === PATH_BLOCK_END;
}

export function removeSpikePathLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === SPIKE_PATH_COMMENT && lines[i + 1] === PATH_BLOCK_BODY) {
      i++;
      continue;
    }
    out.push(lines[i] as string);
  }
  return out.join('\n');
}
