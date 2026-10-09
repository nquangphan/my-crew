import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BridgeClient } from '../../src/files/bridge.js';
import { attachmentPaths, blobPath, derivedDir } from '../../src/files/paths.js';
import { collectFiles, type ExtractRequest } from '../../src/files/run.js';
import { createWorkerExtract } from '../../src/files/worker-client.js';
import { makeOffice, makeZip, wordNs } from '../fixtures/attachments/make-fixtures.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { fakeHome, sha256Hex } from './helpers.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = join(pkgDir, 'dist', 'files-worker.cjs');

/** Lưu blob vào cache giả và dựng yêu cầu trích như `run.ts` dựng. */
function stage(home: string, bytes: Buffer, kind: ExtractRequest['kind'], filename: string): ExtractRequest {
  const p = attachmentPaths(home);
  const sha = sha256Hex(bytes);
  mkdirSync(p.blobs, { recursive: true, mode: 0o700 });
  writeFileSync(blobPath(p, sha), bytes, { mode: 0o600 });
  return { kind, blobPath: blobPath(p, sha), sha256: sha, filename, outDir: derivedDir(p, sha) };
}

/** Worker giả: script node viết sẵn, chạy thay cho bundle. */
function fakeWorker(body: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-fake-worker-')));
  const path = join(dir, 'worker.cjs');
  writeFileSync(path, body);
  return path;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('worker trích xuất (process con)', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(pkgDir, 'build-files.mjs')], { cwd: pkgDir, stdio: 'pipe' });
  }, 60_000);

  it('docx mẫu → complete, đầu ra .md 0600 nằm trong derived/<sha>/v1/extract', async () => {
    const home = fakeHome();
    const req = stage(home, makeOffice('docx'), 'docx', 'bao-gia.docx');
    const result = await createWorkerExtract(attachmentPaths(home), { workerPath: bundle })(req);
    expect(result).toEqual({
      status: 'complete',
      outputs: [{ path: 'extract/bao-gia.md', kind: 'text' }],
      notes: [],
      problemCodes: [],
    });
    const md = join(req.outDir, 'extract', 'bao-gia.md');
    expect(readFileSync(md, 'utf8')).toContain('[đoạn 1] Xin chào Việt Nam');
    expect(statSync(md).mode & 0o777).toBe(0o600);
    expect(statSync(join(req.outDir, 'extract')).mode & 0o777).toBe(0o700);
  });

  it('bản đã trích được dùng lại, không chạy worker lần nữa', async () => {
    const home = fakeHome();
    const req = stage(home, makeOffice('xlsx'), 'xlsx', 'data.xlsx');
    const first = await createWorkerExtract(attachmentPaths(home), { workerPath: bundle })(req);
    const again = await createWorkerExtract(attachmentPaths(home), { workerPath: '/khong/co/worker.cjs' })(
      req,
    );
    expect(first.status).toBe('partial');
    expect(again).toEqual(first);
  });

  it('zip bomb (tỉ lệ nén > 100) → failed/LIMIT_EXCEEDED, không treo, không công bố đầu ra', async () => {
    const home = fakeHome();
    const raw = Buffer.alloc(8 * 1024 * 1024, 65);
    const b = makeZip([
      { name: 'word/document.xml', body: deflateRawSync(raw), method: 8, declaredSize: raw.length },
    ]);
    b.writeUInt32LE(crc32(raw), 14);
    b.writeUInt32LE(crc32(raw), b.indexOf(Buffer.from('504b0102', 'hex')) + 16);
    const req = stage(home, b, 'docx', 'bomb.docx');
    const result = await createWorkerExtract(attachmentPaths(home), { workerPath: bundle })(req);
    expect(result).toMatchObject({ status: 'failed', problemCodes: ['LIMIT_EXCEEDED'], outputs: [] });
    expect(existsSync(join(req.outDir, 'extract'))).toBe(false);
  });

  it('DOCX có DTD/entity → blocked; zip quá 2000 mục → failed', async () => {
    const home = fakeHome();
    const extract = createWorkerExtract(attachmentPaths(home), { workerPath: bundle });
    const dtd = stage(
      home,
      makeOffice('docx', {
        'word/document.xml': '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>',
      }),
      'docx',
      'dtd.docx',
    );
    expect((await extract(dtd)).status).toBe('blocked');
    const many = stage(
      home,
      makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `a${i}`, body: '' }))),
      'docx',
      'many.docx',
    );
    expect(await extract(many)).toMatchObject({ status: 'failed', problemCodes: ['LIMIT_EXCEEDED'] });
  });

  it('worker treo → bị SIGKILL khi quá hạn, trả failed, process con đã chết', async () => {
    const home = fakeHome();
    const pidFile = join(home, 'worker.pid');
    const worker = fakeWorker(
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
    );
    const req = stage(home, Buffer.from('xin chào'), 'text', 'a.txt');
    const started = Date.now();
    const result = await createWorkerExtract(attachmentPaths(home), { workerPath: worker, timeoutMs: 500 })(
      req,
    );
    expect(result).toMatchObject({ status: 'failed', outputs: [] });
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(false);
  });

  it('worker in rác ra stdout → failed', async () => {
    const home = fakeHome();
    const worker = fakeWorker(`process.stdout.write('không phải JSON\\n');`);
    const req = stage(home, Buffer.from('x'), 'text', 'a.txt');
    expect((await createWorkerExtract(attachmentPaths(home), { workerPath: worker })(req)).status).toBe(
      'failed',
    );
  });

  it('worker cấp phát vượt --max-old-space-size → thoát khác 0 → failed', async () => {
    const home = fakeHome();
    const worker = fakeWorker(`const keep = []; for (;;) keep.push(new Array(1e6).fill(1.5));`);
    const req = stage(home, Buffer.from('x'), 'text', 'a.txt');
    const result = await createWorkerExtract(attachmentPaths(home), {
      workerPath: worker,
      maxOldSpaceMb: 64,
      timeoutMs: 30_000,
    })(req);
    expect(result).toMatchObject({ status: 'failed', outputs: [] });
  }, 40_000);

  it('workerPath không tồn tại (cài hỏng) → failed', async () => {
    const home = fakeHome();
    const req = stage(home, Buffer.from('x'), 'text', 'a.txt');
    const result = await createWorkerExtract(attachmentPaths(home), {
      workerPath: join(home, 'khong-co.cjs'),
    })(req);
    expect(result).toMatchObject({ status: 'failed', outputs: [] });
  });

  it('worker khai đầu ra ra ngoài thư mục hoặc là symlink → failed, không công bố', async () => {
    const home = fakeHome();
    const req = stage(home, Buffer.from('x'), 'text', 'a.txt');
    const outside = fakeWorker(
      `process.stdout.write(JSON.stringify({ status: 'complete', outputs: [{ path: '../x.md', kind: 'text' }], notes: [], problemCodes: [] }) + '\\n');`,
    );
    expect((await createWorkerExtract(attachmentPaths(home), { workerPath: outside })(req)).status).toBe(
      'failed',
    );
    const link = fakeWorker(
      `const { readFileSync, symlinkSync } = require('node:fs'); const req = JSON.parse(readFileSync(0, 'utf8'));
       symlinkSync('/etc/hosts', require('node:path').join(req.outDir, 'a.txt'));
       process.stdout.write(JSON.stringify({ status: 'complete', outputs: [{ path: 'a.txt', kind: 'text' }], notes: [], problemCodes: [] }) + '\\n');`,
    );
    expect((await createWorkerExtract(attachmentPaths(home), { workerPath: link })(req)).status).toBe(
      'failed',
    );
    expect(existsSync(join(req.outDir, 'extract'))).toBe(false);
  });

  it('env của process con chỉ có PATH, HOME, LANG=C.UTF-8; cwd là thư mục tạm riêng', async () => {
    const home = fakeHome();
    const out = join(home, 'env.json');
    const worker = fakeWorker(
      `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ keys: Object.keys(process.env).sort(), lang: process.env.LANG, cwd: process.cwd(), home: process.env.HOME }));
       process.stdout.write(JSON.stringify({ status: 'complete', outputs: [], notes: [], problemCodes: [] }) + '\\n');`,
    );
    const req = stage(home, Buffer.from('x'), 'text', 'a.txt');
    await createWorkerExtract(attachmentPaths(home), { workerPath: worker })(req);
    const seen = JSON.parse(readFileSync(out, 'utf8')) as {
      keys: string[];
      lang: string;
      cwd: string;
      home: string;
    };
    // macOS tự thêm `__CF_USER_TEXT_ENCODING` (mã uid và bảng mã) cho mọi process; không do crew-mac truyền.
    expect(seen.keys.filter((k) => k !== '__CF_USER_TEXT_ENCODING')).toEqual(['HOME', 'LANG', 'PATH']);
    expect(seen.lang).toBe('C.UTF-8');
    expect(seen.cwd).not.toBe(process.cwd());
    expect(seen.home).toBe(seen.cwd);
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it('bundle files-worker.cjs không chứa đường mạng', () => {
    const code = readFileSync(bundle, 'utf8');
    expect(code).not.toMatch(/fetch\(/);
    expect(code).not.toMatch(/require\("(node:)?https?"\)/);
    expect(code).not.toMatch(/require\("(node:)?net"\)/);
    expect(code).not.toMatch(/require\("(node:)?(tls|dgram|dns|child_process)"\)/);
  });

  it('chạy được bằng node: stdin một dòng JSON → stdout một dòng WorkerResponse', () => {
    const home = fakeHome();
    const req = stage(home, Buffer.from('a,b\n1,2\n'), 'csv', 'bang.csv');
    const outDir = mkdtempSync(join(home, 'out-'));
    const stdout = execFileSync(process.execPath, [bundle], {
      input: `${JSON.stringify({ kind: 'csv', input: req.blobPath, outDir, filename: 'bang.csv' })}\n`,
      encoding: 'utf8',
    });
    expect(JSON.parse(stdout.trim())).toEqual({
      status: 'complete',
      outputs: [{ path: 'bang.csv', kind: 'text' }],
      notes: [],
      problemCodes: [],
    });
    expect(readFileSync(join(outDir, 'bang.csv'), 'utf8')).toBe('a,b\n1,2\n');
  });

  it('qua collectFiles: docx thật qua worker + redact → sẵn sàng, đọc bản .md', async () => {
    const home = fakeHome();
    const bytes = makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Giá 771 304</w:t></w:r></w:p></w:body></w:document>`,
    });
    const id = '00000000-0000-4000-8000-000000000001';
    const issueId = '11111111-1111-4111-8111-111111111111';
    const bridge: BridgeClient = {
      issue: async () => ({
        id: issueId,
        identifier: 'TPS-80',
        description: null,
        parentId: null,
        createdAt: '2026-10-09T00:00:00.000Z',
      }),
      heartbeatContext: async () => ({ ancestors: [] }),
      comments: async () => [],
      attachments: async () => [
        {
          id,
          issueId,
          issueCommentId: null,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          byteSize: bytes.length,
          sha256: sha256Hex(bytes),
          originalFilename: 'bao-gia.docx',
          createdAt: '2026-10-09T00:00:00.000Z',
        },
      ],
      content: async () =>
        (async function* () {
          yield new Uint8Array(bytes);
        })(),
    };
    const m = await collectFiles(
      {
        ctx: { home, now: () => new Date('2026-10-09T05:00:00.000Z') } as never,
        bridge,
        runner: new FakeRunner(),
        sleep: async () => {},
        extract: createWorkerExtract(attachmentPaths(home), { workerPath: bundle }),
        redact: async () => [],
      },
      { issueId, runId: '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10' },
    );
    const f = m.files[0];
    expect(f).toMatchObject({ status: 'san_sang', detected: 'docx' });
    expect(f?.readPaths).toEqual([
      join(derivedDir(attachmentPaths(home), sha256Hex(bytes)), 'extract', 'bao-gia.md'),
    ]);
    expect(readFileSync(f?.readPaths[0] ?? '', 'utf8')).toContain('[đoạn 1] Giá 771 304');
  });
});
