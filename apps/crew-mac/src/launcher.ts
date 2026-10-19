function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Script `~/.crew/bin/crew-mac`: đường dẫn ổn định cho phía server gọi qua SSH, trỏ vào node và cli.js đã cài.
 * Thiếu node hoặc cli.js thì thoát 127 (như "không có lệnh"), để phía server phân biệt với lỗi của chính crew-mac.
 */
export function renderLauncher(nodePath: string, cliPath: string): string {
  return [
    '#!/bin/sh',
    '# Quản lý bởi crew-mac setup: đường dẫn ổn định để gọi crew-mac qua SSH.',
    `[ -x ${shQuote(nodePath)} ] && [ -f ${shQuote(cliPath)} ] || exit 127`,
    `exec ${shQuote(nodePath)} ${shQuote(cliPath)} "$@"`,
    '',
  ].join('\n');
}

/** Đọc lại node và cli.js mà launcher đang trỏ tới; null khi không đúng định dạng của `renderLauncher`. */
export function parseLauncher(text: string): { nodePath: string; cliPath: string } | null {
  const match = /^exec '([^']*)' '([^']*)' "\$@"$/m.exec(text);
  return match ? { nodePath: match[1] as string, cliPath: match[2] as string } : null;
}
