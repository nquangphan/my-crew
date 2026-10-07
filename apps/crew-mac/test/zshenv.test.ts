import { describe, expect, it } from 'vitest';
import { SetupError } from '../src/context.js';
import {
  hasPathBlock,
  PATH_BLOCK_BEGIN,
  PATH_BLOCK_BODY,
  PATH_BLOCK_END,
  pathBlockBody,
  removePathBlock,
  removeSpikePathLines,
  SPIKE_PATH_COMMENT,
  upsertPathBlock,
} from '../src/zshenv.js';

const BLOCK = `${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\n${PATH_BLOCK_END}\n`;

describe('khối PATH trong ~/.zshenv', () => {
  it('thêm khối vào file rỗng', () => {
    expect(upsertPathBlock('')).toBe(BLOCK);
  });

  it('giữ nội dung sẵn có và chạy lại không đổi gì', () => {
    const once = upsertPathBlock('export EDITOR=vim');
    expect(once).toBe(`export EDITOR=vim\n${BLOCK}`);
    expect(upsertPathBlock(once)).toBe(once);
    expect(hasPathBlock(once)).toBe(true);
  });

  it('gỡ khối, giữ phần còn lại', () => {
    expect(removePathBlock(`export EDITOR=vim\n${BLOCK}`)).toBe('export EDITOR=vim\n');
    expect(hasPathBlock('export EDITOR=vim\n')).toBe(false);
  });

  it('gỡ đúng hai dòng PATH của spike, không đụng dòng PATH khác', () => {
    const text = `export A=1\n${SPIKE_PATH_COMMENT}\n${PATH_BLOCK_BODY}\nexport PATH="$HOME/bin:$PATH"\n`;
    expect(removeSpikePathLines(text)).toBe('export A=1\nexport PATH="$HOME/bin:$PATH"\n');
  });

  it('khối thiếu dòng đóng thì báo lỗi, không bỏ phần còn lại của file', () => {
    const text = `export A=1\n${PATH_BLOCK_BEGIN}\n${PATH_BLOCK_BODY}\nexport OWNER=giu\n`;
    expect(() => removePathBlock(text)).toThrow(SetupError);
    expect(() => upsertPathBlock(text)).toThrow('dòng đóng');
  });

  it('thêm thư mục của node vào PATH (sshd agent cần node cho crew-docs); thư mục mặc định thì không', () => {
    expect(pathBlockBody('/opt/homebrew/bin')).toBe('export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"');
    expect(pathBlockBody('/usr/bin')).toBe(PATH_BLOCK_BODY);
    expect(pathBlockBody('/Users/a/my "node"/$x')).toBe(
      'export PATH="$HOME/.local/bin:/Users/a/my \\"node\\"/\\$x:$PATH"',
    );
    const once = upsertPathBlock(`export EDITOR=vim\n${BLOCK}`, '/opt/homebrew/bin');
    expect(once).toBe(
      `export EDITOR=vim\n${PATH_BLOCK_BEGIN}\nexport PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"\n${PATH_BLOCK_END}\n`,
    );
    expect(upsertPathBlock(once, '/opt/homebrew/bin')).toBe(once);
    expect(hasPathBlock(once, '/opt/homebrew/bin')).toBe(true);
    expect(hasPathBlock(BLOCK, '/opt/homebrew/bin')).toBe(false);
    expect(hasPathBlock(once, '/usr/local/bin')).toBe(false);
  });

  it('không gỡ dòng PATH giống hệt nếu không đi sau comment spike', () => {
    const text = `${PATH_BLOCK_BODY}\n`;
    expect(removeSpikePathLines(text)).toBe(text);
  });
});
