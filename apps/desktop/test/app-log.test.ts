import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLog, formatEntry, localTimestamp, redactFields } from '../src/main/app-log.js';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-app-log-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Credential-shaped values assembled at run time, so no secret literal is ever committed. */
const machineToken = () => ['crew', 'mt', 'Q3xYz9AbCdEfGhIjKlMnOpQrStUv'].join('_');
const githubToken = () => ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');

describe('app log redaction', () => {
  it('drops secret-named fields and scrubs credential patterns anywhere in the line', () => {
    const line = formatEntry(
      {
        level: 'warn',
        source: 'host',
        event: 'api-error',
        fields: {
          method: 'POST',
          path: '/v1/machines/pair',
          code: 'ABCD-EFGH-IJKL',
          pairingCode: 'ABCD-EFGH-IJKL',
          headers: { authorization: `Bearer ${machineToken()}`, cookie: 'crew_session=abc' },
          password: 'hunter2',
          totp: '123456',
          message: `push failed for https://bot:${githubToken()}@github.com/2p/app.git with ${machineToken()}`,
        },
      },
      new Date(),
    );
    expect(line).not.toContain('ABCD-EFGH-IJKL');
    expect(line).not.toContain(machineToken());
    expect(line).not.toContain(githubToken());
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('crew_session=abc');
    expect(line).not.toContain('123456');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: 'warn',
      source: 'host',
      event: 'api-error',
      method: 'POST',
      path: '/v1/machines/pair',
      code: '[đã ẩn]',
      password: '[đã ẩn]',
      headers: { authorization: '[đã ẩn]', cookie: '[đã ẩn]' },
    });
    expect(parsed.message).toContain('[đã ẩn: crew-machine-token]');
  });

  it('keeps the entry keys first and ignores fields that try to overwrite them', () => {
    const line = formatEntry(
      { level: 'info', source: 'main', event: 'ipc', fields: { event: 'fake', level: 'error', ms: 3 } },
      new Date(2026, 8, 29, 10, 8, 14, 729),
    );
    expect(Object.keys(JSON.parse(line)).slice(0, 4)).toEqual(['at', 'level', 'source', 'event']);
    expect(JSON.parse(line)).toMatchObject({ level: 'info', event: 'ipc', ms: 3 });
    expect(line).toContain('"at":"2026-09-29T10:08:14.729');
  });

  it('caps long strings and deep objects', () => {
    const redacted = redactFields({ text: 'x'.repeat(5_000), a: { b: { c: { d: { e: 1 } } } } }) as {
      text: string;
      a: { b: { c: { d: unknown } } };
    };
    expect(redacted.text.length).toBeLessThan(4_100);
    expect(redacted.a.b.c.d).toBe('[…]');
  });

  it('formats local time with the offset', () => {
    expect(localTimestamp(new Date(2026, 0, 2, 3, 4, 5, 6))).toMatch(
      /^2026-01-02T03:04:05\.006[+-]\d{2}:\d{2}$/,
    );
  });
});

describe('app log file', () => {
  it('writes JSON lines with mode 0600, rotates at the size cap and keeps two backups', () => {
    const dir = join(temp(), 'logs');
    const file = join(dir, 'app.log');
    const log = new AppLog(file, { maxBytes: 400, backups: 2 });
    for (let i = 0; i < 20; i++) {
      log.write({
        level: 'info',
        source: 'main',
        event: 'ipc',
        fields: { method: `m${i}`, pad: 'y'.repeat(60) },
      });
    }
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const name of ['app.log', 'app.log.1', 'app.log.2']) {
      const path = join(dir, name);
      expect(existsSync(path), name).toBe(true);
      expect(statSync(path).size, name).toBeLessThanOrEqual(400);
    }
    expect(existsSync(join(dir, 'app.log.3'))).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const newest = readFileSync(file, 'utf8').trim().split('\n');
    expect(JSON.parse(newest.at(-1) ?? '{}')).toMatchObject({ method: 'm19' });
    // Nothing lost between the current file and the first backup.
    const previous = readFileSync(`${file}.1`, 'utf8').trim().split('\n');
    const index = (line: string) => Number((JSON.parse(line) as { method: string }).method.slice(1));
    expect(index(newest[0] ?? '')).toBe(index(previous.at(-1) ?? '') + 1);
  });

  it('tightens the mode of an existing file and never throws when the disk refuses', () => {
    const dir = temp();
    const file = join(dir, 'app.log');
    writeFileSync(file, '', { mode: 0o644 });
    new AppLog(file).write({ level: 'info', source: 'main', event: 'app-start', fields: {} });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const blocked = new AppLog(join(file, 'not-a-dir', 'app.log'));
    expect(() => blocked.write({ level: 'error', source: 'main', event: 'x', fields: {} })).not.toThrow();
  });
});
