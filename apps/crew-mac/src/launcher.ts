function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Script `~/.crew/bin/crew-mac`: đường dẫn ổn định cho phía server gọi qua SSH, trỏ vào node và cli.js đã cài. */
export function renderLauncher(nodePath: string, cliPath: string): string {
  return [
    '#!/bin/sh',
    '# Quản lý bởi crew-mac setup: đường dẫn ổn định để gọi crew-mac qua SSH.',
    `exec ${shQuote(nodePath)} ${shQuote(cliPath)} "$@"`,
    '',
  ].join('\n');
}

/** Đọc lại node và cli.js mà launcher đang trỏ tới; null khi không đúng định dạng của `renderLauncher`. */
export function parseLauncher(text: string): { nodePath: string; cliPath: string } | null {
  const match = /^exec '([^']*)' '([^']*)' "\$@"$/m.exec(text);
  return match ? { nodePath: match[1] as string, cliPath: match[2] as string } : null;
}
