import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { filesCommand } from '../../src/files/command.js';
import { attachmentPaths } from '../../src/files/paths.js';
import { createRunner } from '../../src/system.js';
import { makePng, makeZip } from '../fixtures/attachments/make-fixtures.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { fakeHome, sha256Hex } from './helpers.js';

const ISSUE = '11111111-1111-4111-8111-111111111111';
const RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';
const KEY = 'tok-bridge-test';
const LEAK = 'MÃ-KIỂM-RÒ-RỈ';
const png = makePng(10, 10);
const zip = makeZip({ 'a.txt': 'x' });
const ATT_PNG = '00000000-0000-4000-8000-000000000001';
const ATT_ZIP = '00000000-0000-4000-8000-000000000002';

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function listen(): Promise<number> {
  const current = server as Server;
  await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', resolve));
  return (current.address() as AddressInfo).port;
}

async function startBridge(opts: { failListing?: boolean } = {}) {
  const hits: { url: string; auth: string | undefined }[] = [];
  server = createServer((req, res) => {
    hits.push({ url: req.url ?? '', auth: req.headers.authorization });
    const send = (status: number, body: string | Buffer, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    const url = req.url ?? '';
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, LEAK);
    if (opts.failListing && url.endsWith('/attachments')) return send(500, LEAK);
    if (url === `/api/issues/${ISSUE}`)
      return send(
        200,
        JSON.stringify({
          id: ISSUE,
          identifier: 'TPS-80',
          description: `![a](/api/attachments/${ATT_PNG}/content)`,
          parentId: null,
          createdAt: '2020-01-01T00:00:00.000Z',
        }),
      );
    if (url === `/api/issues/${ISSUE}/heartbeat-context`) return send(200, JSON.stringify({ ancestors: [] }));
    if (url.startsWith(`/api/issues/${ISSUE}/comments`)) return send(200, '[]');
    if (url === `/api/issues/${ISSUE}/attachments`)
      return send(
        200,
        JSON.stringify([
          meta(ATT_PNG, 'screenshot.png', png, 'image/png'),
          meta(ATT_ZIP, 'tool.zip', zip, 'application/zip'),
        ]),
      );
    if (url === `/api/attachments/${ATT_PNG}/content`) return send(200, png, 'image/png');
    if (url === `/api/attachments/${ATT_ZIP}/content`) return send(200, zip, 'application/zip');
    return send(404, LEAK);
  });
  const port = await listen();
  return { env: { PAPERCLIP_API_URL: `http://127.0.0.1:${port}`, PAPERCLIP_API_KEY: KEY }, hits };
}

function meta(id: string, name: string, bytes: Buffer, contentType: string) {
  return {
    id,
    issueId: ISSUE,
    issueCommentId: null,
    contentType,
    byteSize: bytes.length,
    sha256: sha256Hex(bytes),
    originalFilename: name,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
}

function setup() {
  const home = fakeHome();
  const out: string[] = [];
  const err: string[] = [];
  const runner = new FakeRunner().on('sips', (args) =>
    args.includes('-g') ? { stdout: 'pixelWidth: 10\npixelHeight: 10\n' } : { code: 1 },
  );
  const ctx = { home, now: () => new Date(), runner } as unknown as Parameters<typeof filesCommand>[0];
  return { home, out, err, ctx, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

describe('filesCommand với bridge HTTP giả', () => {
  it('in markdown cho agent, thoát 0 kể cả khi có file bị chặn', async () => {
    const bridge = await startBridge();
    const t = setup();
    const code = await filesCommand(t.ctx, ['--issue', ISSUE, '--run', RUN], bridge.env, t.io);
    expect(code).toBe(0);
    const text = t.out.join('\n');
    expect(text).toContain('## File đính kèm');
    expect(text).toContain('1. Nguồn: mô tả TPS-80 · screenshot.png (image/png, 70 B) · `Read` ');
    expect(text).toContain(
      '2. Nguồn: đính kèm của issue TPS-80 · tool.zip · bị chặn: kiểu file không được phép (zip)',
    );
    expect(bridge.hits.every((h) => h.auth === `Bearer ${KEY}`)).toBe(true);
  });

  it('--json in RunManifest', async () => {
    const bridge = await startBridge();
    const t = setup();
    expect(await filesCommand(t.ctx, ['--issue', ISSUE, '--run', RUN, '--json'], bridge.env, t.io)).toBe(0);
    const m = JSON.parse(t.out.join('\n'));
    expect(m).toMatchObject({ version: 1, runId: RUN, issueId: ISSUE, transport: 'bridge' });
    expect(m.files).toHaveLength(2);
  });

  it('lỗi bridge ở listing → exit 1, một dòng cố định, không rò thân lỗi, log chỉ có tên lỗi', async () => {
    const bridge = await startBridge({ failListing: true });
    const t = setup();
    const code = await filesCommand(t.ctx, ['--issue', ISSUE, '--run', RUN], bridge.env, t.io);
    expect(code).toBe(1);
    expect(t.err).toEqual(['files: lỗi nội bộ, xem ~/.crew/logs/attachments.log']);
    expect(t.out.join('')).not.toContain(LEAK);
    const log = readFileSync(attachmentPaths(t.home).log, 'utf8');
    expect(log).toContain('BridgeError');
    expect(log).not.toContain(LEAK);
  });

  it('--gc-only không gọi bridge', async () => {
    const bridge = await startBridge();
    const t = setup();
    expect(await filesCommand(t.ctx, ['--gc-only'], bridge.env, t.io)).toBe(0);
    expect(bridge.hits).toEqual([]);
    expect(t.out).toEqual(['Đã dọn: 0 run, 0 blob']);
  });
});

describe.runIf(process.platform === 'darwin')('filesCommand với sips và osascript thật', () => {
  it('ảnh và PDF thật ra sẵn sàng, đường đọc có đuôi, PDF ghi số trang', async () => {
    const fixture = (name: string) =>
      readFileSync(fileURLToPath(new URL(`../fixtures/attachments/${name}`, import.meta.url)));
    const jpg = fixture('orientation-6.jpg');
    const pdf = fixture('text.pdf');
    const items = [
      { id: ATT_PNG, name: 'a.jpg', bytes: jpg, type: 'image/jpeg' },
      { id: ATT_ZIP, name: 'b.pdf', bytes: pdf, type: 'application/pdf' },
    ];
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const send = (body: string | Buffer) => {
        res.writeHead(200);
        res.end(body);
      };
      if (url === `/api/issues/${ISSUE}`)
        return send(
          JSON.stringify({
            id: ISSUE,
            identifier: 'TPS-80',
            description: null,
            parentId: null,
            createdAt: '2020-01-01T00:00:00Z',
          }),
        );
      if (url.endsWith('/heartbeat-context')) return send('{"ancestors":[]}');
      if (url.includes('/comments')) return send('[]');
      if (url.endsWith('/attachments'))
        return send(JSON.stringify(items.map((i) => meta(i.id, i.name, i.bytes, i.type))));
      const hit = items.find((i) => url === `/api/attachments/${i.id}/content`);
      if (hit) return send(hit.bytes);
      res.writeHead(404);
      res.end();
    });
    const port = await listen();
    const env = { PAPERCLIP_API_URL: `http://127.0.0.1:${port}`, PAPERCLIP_API_KEY: KEY };
    const t = setup();
    (t.ctx as { runner: unknown }).runner = createRunner();
    expect(await filesCommand(t.ctx, ['--issue', ISSUE, '--run', RUN, '--json'], env, t.io)).toBe(0);
    const m = JSON.parse(t.out.join('\n'));
    expect(m.files.map((f: { status: string }) => f.status)).toEqual(['san_sang', 'san_sang']);
    expect(m.files[0].readPaths[0]).toMatch(/\.jpg$/);
    expect(m.files[1]).toMatchObject({ detected: 'pdf', pages: 1 });
    expect(m.files[1].readPaths[0]).toMatch(/\.pdf$/);
    expect(readFileSync(m.files[1].readPaths[0])).toEqual(pdf);
  });
});
