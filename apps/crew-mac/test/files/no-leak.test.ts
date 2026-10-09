// Credential và chữ lỗi bên ngoài không được lọt ra bất cứ đầu ra nào của `crew-mac files` ngoài blob gốc trong cache:
// stdout (markdown và --json), stderr, manifest, log, bản trích trong `derived/`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { filesCommand } from '../../src/files/command.js';
import { attachmentPaths } from '../../src/files/paths.js';
import type { RunManifest } from '../../src/files/types.js';
import { makeOffice, makePng, officeRelNs, sheetNs } from '../fixtures/attachments/make-fixtures.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { fakeHome, sha256Hex } from './helpers.js';

// `filesCommand` dựng trình trích bằng bundle cạnh bản build; trong test trỏ sang worker bọc (xem `beforeAll`).
const worker = vi.hoisted(() => ({ path: '' }));
vi.mock('../../src/files/worker-client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/files/worker-client.js')>();
  return {
    ...mod,
    createWorkerExtract: (p: Parameters<typeof mod.createWorkerExtract>[0]) =>
      mod.createWorkerExtract(p, { workerPath: worker.path }),
  };
});

// Mọi chuỗi giống credential được ghép lúc chạy: hook R7 lúc commit chặn chuỗi nguyên khối.
const AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
const GH_TOKEN = ['ghp', '_', 'Z9y8'.repeat(9)].join('');
const MARK_TEXT = 'MỐC-RÒ-RỈ-1';
const MARK_BRIDGE = 'MỐC-RÒ-RỈ-2';
const MARK_STDERR = 'MỐC-RÒ-RỈ-3';

const ISSUE = '11111111-1111-4111-8111-111111111111';
const RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';
const RUN2 = '1c8f4d3f-8e2b-4d66-8b62-6e1f8b7cad21';
const KEY = 'tok-bridge-test';
const att = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const txt = Buffer.from(`${MARK_TEXT}\naws_access_key_id = ${AWS_KEY}\nhết\n`);
const xlsx = makeOffice('xlsx', {
  'xl/workbook.xml': `<workbook xmlns="${sheetNs}" xmlns:r="${officeRelNs}"><sheets><sheet name="Hiện" sheetId="1" r:id="s1"/><sheet name="Ẩn" sheetId="2" state="hidden" r:id="s2"/></sheets></workbook>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>token ${GH_TOKEN}</t></is></c></row></sheetData></worksheet>`,
});
const broken = Buffer.from('nội dung không bao giờ tải được\n');
const png = makePng(10, 10);
const FILES = [
  { id: att(1), name: 'ghi-chu.txt', bytes: txt, type: 'text/plain' },
  { id: att(2), name: 'data.xlsx', bytes: xlsx, type: 'application/vnd.ms-excel' },
  { id: att(3), name: 'hong.txt', bytes: broken, type: 'text/plain' },
  { id: att(4), name: 'anh.png', bytes: png, type: 'image/png' },
];

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let server: Server;
let env: Record<string, string>;

beforeAll(async () => {
  execFileSync(process.execPath, [join(pkgDir, 'build-files.mjs')], { cwd: pkgDir, stdio: 'pipe' });
  // Worker thật, thêm một dòng stderr mang mốc: stderr của trình đọc không được đi đâu.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-noleak-worker-')));
  worker.path = join(dir, 'worker.cjs');
  writeFileSync(
    worker.path,
    `process.stderr.write(${JSON.stringify(`${MARK_STDERR} ${AWS_KEY}\n`)});\nrequire(${JSON.stringify(join(pkgDir, 'dist', 'files-worker.cjs'))});\n`,
  );

  server = createServer((req, res) => {
    const url = req.url ?? '';
    const send = (status: number, body: string | Buffer) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, MARK_BRIDGE);
    if (url === `/api/issues/${ISSUE}`)
      return send(
        200,
        JSON.stringify({
          id: ISSUE,
          identifier: 'TPS-80',
          description: `Khóa ${AWS_KEY} ![a](/api/attachments/${att(1)}/content)`,
          parentId: null,
          createdAt: '2020-01-01T00:00:00.000Z',
        }),
      );
    if (url === `/api/issues/${ISSUE}/heartbeat-context`) return send(200, '{"ancestors":[]}');
    if (url.startsWith(`/api/issues/${ISSUE}/comments`))
      return send(
        200,
        JSON.stringify([
          {
            id: 'c-1',
            body: `token ${GH_TOKEN} ${MARK_TEXT}`,
            authorAgentId: null,
            authorUserId: 'u',
            createdAt: '2020-01-01T00:00:00.000Z',
          },
        ]),
      );
    if (url === `/api/issues/${ISSUE}/attachments`)
      return send(
        200,
        JSON.stringify(
          FILES.map((f) => ({
            id: f.id,
            issueId: ISSUE,
            issueCommentId: null,
            contentType: f.type,
            byteSize: f.bytes.length,
            sha256: sha256Hex(f.bytes),
            originalFilename: f.name,
            createdAt: '2020-01-01T00:00:00.000Z',
          })),
        ),
      );
    if (url === `/api/attachments/${att(3)}/content`) return send(500, `${MARK_BRIDGE} ${AWS_KEY}`);
    const hit = FILES.find((f) => url === `/api/attachments/${f.id}/content`);
    if (hit) return send(200, hit.bytes);
    return send(404, MARK_BRIDGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  env = {
    PAPERCLIP_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    PAPERCLIP_API_KEY: KEY,
  };
}, 60_000);

afterAll(() => {
  server?.close();
});

/** Mọi file dưới `dir` (đệ quy), trừ các thư mục con bị loại. */
function walk(dir: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip.includes(path)) continue;
    if (entry.isDirectory()) out.push(...walk(path, skip));
    else out.push(path);
  }
  return out;
}

describe('không rò rỉ credential và chữ lỗi bên ngoài', () => {
  it('stdout, stderr, manifest, log, bản trích: chỉ có giá trị đã che', async () => {
    const home = fakeHome();
    const p = attachmentPaths(home);
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    const runner = new FakeRunner().on('sips', (args) =>
      args.includes('-g') ? { stdout: 'pixelWidth: 10\npixelHeight: 10\n' } : { code: 1 },
    );
    const ctx = { home, now: () => new Date(), runner } as unknown as Parameters<typeof filesCommand>[0];

    expect(await filesCommand(ctx, ['--issue', ISSUE, '--run', RUN], env, io)).toBe(0);
    const markdown = out.join('\n');
    // Lượt thứ hai dùng lại bản trích theo sha: danh sách che phải đọc lại được từ info.json.
    out.length = 0;
    expect(await filesCommand(ctx, ['--issue', ISSUE, '--run', RUN2, '--json'], env, io)).toBe(0);
    const json = out.join('\n');
    const manifest = JSON.parse(json) as RunManifest;

    const byName = (name: string) => manifest.files.find((f) => f.filename === name);
    expect(byName('ghi-chu.txt')).toMatchObject({
      status: 'san_sang',
      credentialFindings: [{ rule: 'aws-access-key-id', line: 2 }],
      credentialScan: { code: 'da_quet' },
    });
    const sheet = byName('data.xlsx');
    expect(sheet?.status).toBe('mot_phan');
    expect(sheet?.credentialFindings.map((f) => f.rule)).toEqual(['github-token']);
    expect(byName('hong.txt')).toMatchObject({ status: 'khong_doc_duoc', reason: 'tai_loi', readPaths: [] });
    expect(byName('anh.png')?.credentialScan).toEqual({
      code: 'khong_quet_duoc',
      text: 'không quét được credential trong ảnh/PDF',
    });
    for (const f of manifest.files)
      for (const finding of f.credentialFindings) {
        expect(Object.keys(finding).sort()).toEqual(['line', 'rule']);
        expect(Number.isSafeInteger(finding.line) && finding.line > 0).toBe(true);
      }
    expect(readFileSync(byName('ghi-chu.txt')?.readPaths[0] as string, 'utf8')).toBe(
      `${MARK_TEXT}\naws_access_key_id = [ĐÃ CHE: aws-access-key-id]\nhết\n`,
    );

    // Mọi đầu ra: stdout/stderr hai lượt và mọi file dưới ~/.crew trừ blob gốc.
    const extracted = walk(p.derived).filter((f) => /\.(md|txt|csv)$/.test(f));
    expect(extracted.length).toBeGreaterThanOrEqual(2);
    const files = walk(join(home, '.crew'), [p.blobs]).filter((f) => !f.endsWith('.png'));
    expect(files.some((f) => f === p.log)).toBe(true);
    expect(files.filter((f) => f.startsWith(p.runs))).toHaveLength(2);
    const outputs: [string, string][] = [
      ['stdout markdown', markdown],
      ['stdout json', json],
      ['stderr', err.join('\n')],
      ...files.map((f): [string, string] => [relative(home, f), readFileSync(f, 'utf8')]),
    ];
    for (const [where, content] of outputs) {
      for (const secret of [AWS_KEY, GH_TOKEN, MARK_BRIDGE, MARK_STDERR])
        expect(content.includes(secret), `${where} chứa ${secret}`).toBe(false);
      // Chữ thường (không phải credential) chỉ được có trong bản trích đã che.
      if (!extracted.includes(join(home, where)))
        expect(content.includes(MARK_TEXT), `${where} chứa ${MARK_TEXT}`).toBe(false);
    }
    expect(extracted.some((f) => readFileSync(f, 'utf8').includes(MARK_TEXT))).toBe(true);
    expect(markdown).toContain('`Read` ');
  }, 60_000);
});
