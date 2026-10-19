import { SetupError } from './context.js';

const KEY_RE = /^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa)\s+([A-Za-z0-9+/]+={0,3})(?:\s.*)?$/;

export function parsePublicKey(text: string): { type: string; body: string } {
  const match = KEY_RE.exec(text.trim());
  if (!match) throw new SetupError('Public key SSH không hợp lệ (cần dạng "ssh-ed25519 AAAA... [comment]").');
  return { type: match[1] as string, body: match[2] as string };
}

function lastToken(line: string): string | undefined {
  return line.trim().split(/\s+/).at(-1);
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

function join(rows: string[]): string {
  return rows.length === 0 ? '' : `${rows.join('\n')}\n`;
}

export function upsertKey(text: string, publicKey: string, comment: string, options?: string): string {
  const { type, body } = parsePublicKey(publicKey);
  const kept = lines(text).filter((line) => lastToken(line) !== comment && !line.split(/\s+/).includes(body));
  kept.push(`${options ? `${options} ` : ''}${type} ${body} ${comment}`);
  return join(kept);
}

export function removeKeysByComment(text: string, comment: string): string {
  return join(lines(text).filter((line) => lastToken(line) !== comment));
}

export function hasKeyComment(text: string, comment: string): boolean {
  return lines(text).some((line) => lastToken(line) === comment);
}
