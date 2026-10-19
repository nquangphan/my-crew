import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AttachmentMeta, type BridgeClient, BridgeError } from '../../src/files/bridge.js';
import { readRunManifest } from '../../src/files/cache.js';
import { GC_LOCK_WAIT_MS } from '../../src/files/config.js';
import { runGc } from '../../src/files/gc.js';
import { attachmentPaths, blobPath, derivedDir } from '../../src/files/paths.js';
import { collectFiles, type ExtractFn, type FilesDeps } from '../../src/files/run.js';
import { makeOffice, makePng, makeZip } from '../fixtures/attachments/make-fixtures.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { DAY_MS, fakeHome, seed, sha256Hex } from './helpers.js';

const NOW = new Date('2026-10-09T05:00:00.000Z');
const RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10';
const ISSUE = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const LEAK = 'MÃ-KIỂM-RÒ-RỈ';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

interface FakeFile {
  meta: AttachmentMeta;
  bytes: Buffer;
}

function file(
  n: number,
  name: string,
  bytes: Buffer,
  extra: Partial<AttachmentMeta> & { issueId?: string } = {},
): FakeFile {
  return {
    bytes,
    meta: {
      id: uuid(n),
      issueId: ISSUE,
      issueCommentId: null,
      contentType: 'application/octet-stream',
      byteSize: bytes.length,
      sha256: sha256Hex(bytes),
      originalFilename: name,
      createdAt: iso(-n * 1000),
      ...extra,
    },
  };
}

interface World {
  issue?: { description: string | null; createdAt: string };
  comments?: {
    id: string;
    body: string;
    authorAgentId: string | null;
    authorUserId: string | null;
    createdAt: string;
  }[];
  /** Danh sách trả về theo lần gọi (lần cuối lặp lại). */
  listings?: FakeFile[][];
  ancestors?: { id: string; identifier: string }[];
  ancestorFiles?: Record<string, FakeFile[] | 'forbidden'>;
  contentFail?: Record<string, BridgeError>;
  contentOverride?: Record<string, Buffer>;
}

function fakeBridge(world: World) {
  const calls = { content: [] as string[], attachments: [] as string[], issue: 0 };
  const known = new Map<string, FakeFile>();
  for (const list of world.listings ?? []) for (const f of list) known.set(f.meta.id, f);
  for (const list of Object.values(world.ancestorFiles ?? {}))
    if (list !== 'forbidden') for (const f of list) known.set(f.meta.id, f);
  let listing = 0;
  const bridge: BridgeClient = {
    async issue(id) {
      calls.issue++;
      if (id === PARENT)
        return { id, identifier: 'TPS-79', description: null, parentId: null, createdAt: iso(-86_400_000) };
      return {
        id,
        identifier: 'TPS-80',
        description: world.issue?.description ?? null,
        parentId: world.ancestors?.length ? PARENT : null,
        createdAt: world.issue?.createdAt ?? iso(-3_600_000),
      };
    },
    async heartbeatContext() {
      return { ancestors: world.ancestors ?? [] };
    },
    async comments() {
      return world.comments ?? [];
    },
    async attachments(id) {
      calls.attachments.push(id);
      if (id !== ISSUE) {
        const list = world.ancestorFiles?.[id];
        if (list === 'forbidden') throw new BridgeError('http', 403);
        return (list ?? []).map((f) => f.meta);
      }
      const lists = world.listings ?? [[]];
      const current = lists[Math.min(listing, lists.length - 1)] ?? [];
      listing++;
      return current.map((f) => f.meta);
    },
    async content(attachmentId) {
      calls.content.push(attachmentId);
      const fail = world.contentFail?.[attachmentId];
      if (fail) throw fail;
      const data = world.contentOverride?.[attachmentId] ?? known.get(attachmentId)?.bytes;
      if (!data) throw new BridgeError('http', 404);
      return (async function* () {
        yield new Uint8Array(data);
      })();
    },
  };
  return { bridge, calls };
}

function fakeRunner(opts: { pages?: number; encrypted?: boolean } = {}) {
  return new FakeRunner()
    .on('sips', (args) =>
      args.includes('-g') ? { stdout: 'pixelWidth: 100\npixelHeight: 100\n' } : { code: 1 },
    )
    .on('osascript', () => ({
      stdout: `${JSON.stringify({ pages: opts.pages ?? 25, encrypted: opts.encrypted ?? false })}\n`,
    }));
}

function setup(
  world: World,
  extra: Partial<FilesDeps> = {},
  runnerOpts: Parameters<typeof fakeRunner>[0] = {},
) {
  const home = fakeHome();
  const { bridge, calls } = fakeBridge(world);
  const sleeps: number[] = [];
  const deps: FilesDeps = {
    ctx: { home, now: () => NOW } as FilesDeps['ctx'],
    bridge,
    runner: fakeRunner(runnerOpts),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  };
  return { home, deps, calls, sleeps, paths: attachmentPaths(home) };
}

const png = makePng(10, 10);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const zip = makeZip({ 'a.txt': 'x' });

describe('collectFiles', () => {
  it('3 file (png, pdf 25 trang, zip) → manifest đúng; lần hai cùng sha không tải lại', async () => {
    const f1 = file(1, 'screenshot.png', png);
    const f2 = file(2, 'bao-gia.pdf', pdf);
    const f3 = file(3, 'tool.zip', zip);
    const t = setup({
      issue: { description: `![s](/api/attachments/${f1.meta.id}/content)`, createdAt: iso(-3_600_000) },
      listings: [[f1, f2, f3]],
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.version).toBe(1);
    expect(m.transport).toBe('bridge');
    expect(m.generatedAt).toBe(NOW.toISOString());
    expect(m.files.map((f) => f.status)).toEqual(['san_sang', 'san_sang', 'bi_chan']);
    const [a, b, c] = m.files;
    expect(a?.source).toBe('mô tả TPS-80');
    expect(a?.detected).toBe('png');
    expect(a?.issueKey).toBe('TPS-80');
    expect(a?.relation).toBe('self');
    expect(a?.readPaths).toHaveLength(1);
    expect(a?.readPaths[0]).toMatch(/\.png$/);
    expect(readFileSync(a?.readPaths[0] as string)).toEqual(png);
    expect(b?.pages).toBe(25);
    expect(b?.notes).toEqual(['pdf_doc_theo_trang']);
    expect(b?.readPaths[0]).toMatch(/\.pdf$/);
    expect(b?.source).toBe('đính kèm của issue TPS-80');
    // Ảnh/PDF đọc thẳng, không trích chữ: manifest nói rõ là không quét được credential.
    for (const f of [a, b])
      expect(f?.credentialScan).toEqual({
        code: 'khong_quet_duoc',
        text: 'không quét được credential trong ảnh/PDF',
      });
    expect(c?.credentialScan).toBeUndefined();
    expect(c?.reason).toBe('kieu_cam');
    expect(c?.blockLabel).toBe('zip');
    expect(c?.readPaths).toEqual([]);
    expect(existsSync(blobPath(t.paths, f1.meta.sha256))).toBe(true);
    expect(readRunManifest(t.paths, RUN)?.files).toHaveLength(3);
    expect(t.calls.content).toHaveLength(3);

    const again = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(t.calls.content).toHaveLength(3);
    expect(again.files.map((f) => f.status)).toEqual(['san_sang', 'san_sang', 'bi_chan']);
    expect(readFileSync(t.paths.log, 'utf8')).toContain('cache_hit');
  });

  it('file đọc được nằm trong cache 0600, thư mục 0700', async () => {
    const f1 = file(1, 'a.png', png);
    const t = setup({ listings: [[f1]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    const read = m.files[0]?.readPaths[0] as string;
    expect(read.startsWith(t.paths.root)).toBe(true);
    expect(statSync(read).mode & 0o777).toBe(0o600);
    expect(statSync(t.paths.root).mode & 0o777).toBe(0o700);
  });

  it('issue mới tạo: chờ 15 giây rồi liệt kê lại, thấy cả file đến sau', async () => {
    const f1 = file(1, 'a.png', png);
    const f2 = file(2, 'b.png', makePng(11, 11));
    const t = setup({ issue: { description: null, createdAt: iso(-30_000) }, listings: [[f1], [f1, f2]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(t.sleeps).toEqual([15_000]);
    expect(m.files).toHaveLength(2);
  });

  it('issue tạo 5 phút trước thì không chờ', async () => {
    const t = setup({
      issue: { description: null, createdAt: iso(-300_000) },
      listings: [[file(1, 'a.png', png)]],
    });
    await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(t.sleeps).toEqual([]);
    expect(t.calls.attachments.filter((id) => id === ISSUE)).toHaveLength(1);
  });

  it('45 attachment → 40 xử lý (mới trước), 5 mục vuot_40_file không tải', async () => {
    const files = Array.from({ length: 45 }, (_, i) => file(i + 1, `f${i + 1}.png`, makePng(i + 2, 3)));
    const t = setup({ listings: [files] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files).toHaveLength(45);
    expect(m.files.filter((f) => f.status === 'san_sang')).toHaveLength(40);
    const over = m.files.filter((f) => f.reason === 'vuot_40_file');
    expect(over).toHaveLength(5);
    expect(over.every((f) => f.status === 'qua_lon' && f.readPaths.length === 0)).toBe(true);
    expect(t.calls.content).toHaveLength(40);
    expect(t.calls.content).not.toContain(over[0]?.attachmentId);
    // thứ tự: file mới nhất (createdAt lớn nhất = id nhỏ nhất) được xử lý trước
    expect(m.files[0]?.attachmentId).toBe(uuid(1));
    expect(m.files.at(-1)?.attachmentId).toBe(uuid(45));
  });

  it('link trong mô tả tới file chưa có trong listing (upload trễ sau lần liệt kê lại) → chua_dong_bo, không tải', async () => {
    const f1 = file(1, 'a.png', png);
    const late = uuid(9);
    const t = setup({
      issue: {
        description: `![a](/api/attachments/${f1.meta.id}/content) ![b](/api/attachments/${late}/content)`,
        createdAt: iso(-30_000),
      },
      listings: [[f1], [f1]],
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files).toHaveLength(2);
    expect(m.files[1]).toMatchObject({
      attachmentId: late,
      issueId: ISSUE,
      relation: 'self',
      source: 'mô tả TPS-80',
      filename: 'attachment-00000000',
      status: 'chua_dong_bo',
      reason: 'chua_len_kip',
      readPaths: [],
    });
    expect(t.calls.content).toEqual([f1.meta.id]);
    expect(m.uploadsMayBePending).toBe(true);
  });

  it('issue cũ: link thiếu trong listing vẫn báo chua_dong_bo; không có cờ đang tải lên', async () => {
    const late = uuid(9);
    const t = setup({
      issue: { description: null, createdAt: iso(-3_600_000) },
      comments: [
        {
          id: 'c1',
          body: `xem [file](/api/attachments/${late}/content)`,
          authorAgentId: null,
          authorUserId: 'u',
          createdAt: iso(-1000),
        },
      ],
      listings: [[]],
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files).toHaveLength(1);
    expect(m.files[0]).toMatchObject({
      source: 'bình luận thứ 1 của TPS-80 (chủ dự án)',
      status: 'chua_dong_bo',
      reason: 'chua_len_kip',
    });
    expect(m.uploadsMayBePending).toBeUndefined();
  });

  it('link tới file của issue cha hoặc trong khối code → không thêm dòng chua_dong_bo', async () => {
    const par = file(2, 'par.png', makePng(12, 12), { issueId: PARENT });
    const t = setup({
      issue: {
        description: `![p](/api/attachments/${par.meta.id}/content)\n\`![x](/api/attachments/${uuid(8)}/content)\``,
        createdAt: iso(-3_600_000),
      },
      listings: [[]],
      ancestors: [{ id: PARENT, identifier: 'TPS-79' }],
      ancestorFiles: { [PARENT]: [par] },
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files.map((f) => [f.attachmentId, f.status])).toEqual([[par.meta.id, 'san_sang']]);
  });

  it('GC của run khác chạy giữa lúc run này dùng blob trúng cache sát hạn 7 ngày → blob và bản dẫn xuất còn nguyên', async () => {
    const bytes = Buffer.from('ghi chú cũ');
    const f1 = file(1, 'ghi-chu.txt', bytes);
    const sha = f1.meta.sha256;
    const OLD_RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c01';
    const OTHER_RUN = '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c02';
    let paths: ReturnType<typeof attachmentPaths> | undefined;
    const extract: ExtractFn = async (req) => {
      // Agent khác trên cùng Mac dọn cache đúng lúc run cũ duy nhất tham chiếu blob vừa quá 7 ngày.
      await runGc(paths as ReturnType<typeof attachmentPaths>, {
        now: new Date(NOW.getTime() + 60 * 60 * 1000),
        currentRunId: OTHER_RUN,
      });
      expect(existsSync(req.blobPath)).toBe(true);
      return { status: 'complete', outputs: [], notes: [], problemCodes: [], credentialFindings: [] };
    };
    const t = setup({ listings: [[f1]] }, { extract });
    paths = t.paths;
    seed(t.paths, NOW, { runs: [{ id: OLD_RUN, ageDays: 7 - 1 / 48, shas: [sha] }] });
    writeFileSync(blobPath(t.paths, sha), bytes, { mode: 0o600 });
    const eightDaysAgo = new Date(NOW.getTime() - 8 * DAY_MS);
    utimesSync(blobPath(t.paths, sha), eightDaysAgo, eightDaysAgo);
    mkdirSync(join(derivedDir(t.paths, sha), 'extract'), { recursive: true });
    writeFileSync(join(derivedDir(t.paths, sha), 'extract', 'ghi-chu.txt'), 'bản trích');

    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]?.status).toBe('san_sang');
    expect(t.calls.content).toEqual([]);
    expect(existsSync(blobPath(t.paths, sha))).toBe(true);
    expect(existsSync(join(derivedDir(t.paths, sha), 'extract', 'ghi-chu.txt'))).toBe(true);
    expect(existsSync(join(t.paths.runs, OLD_RUN))).toBe(false);
  });

  it('gc.lock đang bị run khác giữ → chờ khóa rồi mới ghi manifest giữ chỗ', async () => {
    const f1 = file(1, 'a.png', png);
    const t = setup({ listings: [[f1]] });
    const sleep = t.deps.sleep;
    t.deps.sleep = async (ms) => {
      await sleep(ms);
      rmSync(t.paths.gcLock, { force: true });
    };
    mkdirSync(t.paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(t.paths.gcLock, JSON.stringify({ pid: process.pid, at: NOW.getTime() }));
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(t.sleeps).toEqual([GC_LOCK_WAIT_MS]);
    expect(m.files[0]?.status).toBe('san_sang');
    expect(existsSync(t.paths.gcLock)).toBe(false);
  });

  it('issue hiện tại trước, tổ tiên gần trước; file tổ tiên ghi nguồn issue cha', async () => {
    const own = file(1, 'own.png', png);
    const par = file(2, 'par.png', makePng(12, 12), { issueId: PARENT });
    const t = setup({
      listings: [[own]],
      ancestors: [{ id: PARENT, identifier: 'TPS-79' }],
      ancestorFiles: { [PARENT]: [par] },
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files.map((f) => [f.relation, f.issueKey, f.source])).toEqual([
      ['self', 'TPS-80', 'đính kèm của issue TPS-80'],
      ['ancestor', 'TPS-79', 'issue cha TPS-79'],
    ]);
    expect(m.ancestorsUnreadable).toBeUndefined();
  });

  it('byteSize khai báo > 10 MB → vuot_10mb, không tải', async () => {
    const f1 = file(1, 'big.png', png, { byteSize: 11 * 1024 * 1024 });
    const t = setup({ listings: [[f1]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'qua_lon', reason: 'vuot_10mb' });
    expect(t.calls.content).toEqual([]);
  });

  it('bridge 500 cho một file → tai_loi, file khác vẫn sẵn sàng, không rò thân lỗi', async () => {
    const f1 = file(1, 'a.png', png);
    const f2 = file(2, 'b.png', makePng(11, 11));
    const t = setup({
      listings: [[f1, f2]],
      contentFail: { [f1.meta.id]: new BridgeError('http', 500) },
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files.map((f) => [f.status, f.reason])).toEqual([
      ['khong_doc_duoc', 'tai_loi'],
      ['san_sang', null],
    ]);
    expect(JSON.stringify(m)).not.toContain(LEAK);
  });

  it('timeout tải → tai_loi', async () => {
    const f1 = file(1, 'a.png', png);
    const t = setup({ listings: [[f1]], contentFail: { [f1.meta.id]: new BridgeError('timeout', null) } });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'khong_doc_duoc', reason: 'tai_loi' });
  });

  it('tải 404 khi file vừa upload (dưới 2 phút) → chua_len_kip', async () => {
    const f1 = file(1, 'a.png', png, { createdAt: iso(-20_000) });
    const t = setup({ listings: [[f1]], contentFail: { [f1.meta.id]: new BridgeError('http', 404) } });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'chua_dong_bo', reason: 'chua_len_kip' });
  });

  it('tải 404 khi file cũ → tai_loi', async () => {
    const f1 = file(1, 'a.png', png, { createdAt: iso(-3_600_000) });
    const t = setup({ listings: [[f1]], contentFail: { [f1.meta.id]: new BridgeError('http', 404) } });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'khong_doc_duoc', reason: 'tai_loi' });
  });

  it('vượt trần khi stream → vuot_10mb', async () => {
    const f1 = file(1, 'a.png', png);
    const t = setup({ listings: [[f1]], contentFail: { [f1.meta.id]: new BridgeError('too_large', null) } });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'qua_lon', reason: 'vuot_10mb' });
  });

  it('sha tải về lệch listing → hong/sai_ma_bam, không có blob', async () => {
    const f1 = file(1, 'a.png', png);
    const t = setup({ listings: [[f1]], contentOverride: { [f1.meta.id]: Buffer.from('khác hẳn') } });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({ status: 'hong', reason: 'sai_ma_bam', readPaths: [] });
    expect(existsSync(blobPath(t.paths, f1.meta.sha256))).toBe(false);
  });

  it('listing tổ tiên bị 403 → không có file tổ tiên, đánh dấu ancestorsUnreadable, lệnh không hỏng', async () => {
    const own = file(1, 'own.png', png);
    const t = setup({
      listings: [[own]],
      ancestors: [{ id: PARENT, identifier: 'TPS-79' }],
      ancestorFiles: { [PARENT]: 'forbidden' },
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files).toHaveLength(1);
    expect(m.ancestorsUnreadable).toBe(true);
  });

  it('không có attachment → files rỗng', async () => {
    const t = setup({ listings: [[]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files).toEqual([]);
    expect(existsSync(join(t.paths.runs, RUN, 'manifest.json'))).toBe(true);
  });

  it('comment sắp theo createdAt tăng dần dù bridge trả theo thứ tự khác; file gắn comment lấy nguồn comment', async () => {
    const f1 = file(1, 'a.png', png, { issueCommentId: 'c-2' });
    const t = setup({
      listings: [[f1]],
      comments: [
        { id: 'c-2', body: 'hai', authorAgentId: null, authorUserId: 'u1', createdAt: iso(-1000) },
        { id: 'c-1', body: 'một', authorAgentId: 'ag', authorUserId: null, createdAt: iso(-2000) },
      ],
    });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]?.source).toBe('bình luận thứ 2 của TPS-80 (chủ dự án)');
    expect(m.files[0]?.issueCommentId).toBe('c-2');
  });

  it('tên file được làm sạch trong manifest', async () => {
    const f1 = file(1, 'a/b\nc.png', png);
    const t = setup({ listings: [[f1]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]?.filename).toBe('abc.png');
  });

  it('thiếu extract → docx/xlsx/text/csv ra khong_doc_duoc/trinh_doc_loi', async () => {
    const f1 = file(1, 'ghi-chu.txt', Buffer.from('xin chào'));
    const f2 = file(2, 'data.csv', Buffer.from('a,b\n1,2\n'), { contentType: 'text/csv' });
    const t = setup({ listings: [[f1, f2]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files.map((f) => [f.status, f.reason])).toEqual([
      ['khong_doc_duoc', 'trinh_doc_loi'],
      ['khong_doc_duoc', 'trinh_doc_loi'],
    ]);
  });

  describe('extract (chữ đã che trong worker)', () => {
    const extractOk: ExtractFn = async (req) => {
      mkdirSync(req.outDir, { recursive: true });
      writeFileSync(join(req.outDir, 'out.md'), 'nội dung\n');
      return {
        status: 'partial',
        outputs: [{ path: 'out.md', kind: 'text' }],
        notes: [
          { code: 'sheet_an', name: 'Ẩn' },
          { code: 'thieu_formula_cache', count: 2 },
        ],
        problemCodes: [],
        credentialFindings: [{ rule: 'aws-access-key-id', line: 3 }],
      };
    };

    it('extract partial → mot_phan, readPaths là đường tuyệt đối, ghi chú, findings và trạng thái quét vào manifest', async () => {
      const f1 = file(1, 'data.txt', Buffer.from('abc'));
      const t = setup({ listings: [[f1]] }, { extract: extractOk });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      const f = m.files[0];
      expect(f?.status).toBe('mot_phan');
      expect(f?.notes).toEqual(['sheet_an', 'thieu_formula_cache']);
      expect(f?.noteDetails).toEqual([
        { code: 'sheet_an', name: 'Ẩn' },
        { code: 'thieu_formula_cache', count: 2 },
      ]);
      expect(f?.readPaths).toHaveLength(1);
      expect(f?.readPaths[0]?.startsWith(t.paths.derived)).toBe(true);
      expect(f?.readPaths[0]).toMatch(/out\.md$/);
      expect(f?.credentialFindings).toEqual([{ rule: 'aws-access-key-id', line: 3 }]);
      expect(f?.credentialScan).toEqual({ code: 'da_quet', text: 'đã quét và che credential trong chữ' });
    });

    it('bản trích có ảnh nhúng → ghi rõ ảnh nhúng không quét được credential', async () => {
      const f1 = file(1, 'a.docx', makeOffice('docx'));
      const extract: ExtractFn = async (req) => ({
        ...(await extractOk(req)),
        status: 'complete',
        outputs: [
          { path: 'out.md', kind: 'text' },
          { path: 'media/1.png', kind: 'image' },
        ],
      });
      const t = setup({ listings: [[f1]] }, { extract });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]?.credentialScan?.code).toBe('anh_nhung_khong_quet');
      expect(m.files[0]?.credentialScan?.text).toContain('không quét được credential trong ảnh nhúng');
    });

    it('extract không báo kết quả che (thiếu credentialFindings) → không đưa đường dẫn trích ra (đóng kín)', async () => {
      const f1 = file(1, 'data.txt', Buffer.from('abc'));
      const extract = (async (req: Parameters<ExtractFn>[0]) => {
        const { credentialFindings: _, ...rest } = await extractOk(req);
        return rest;
      }) as unknown as ExtractFn;
      const t = setup({ listings: [[f1]] }, { extract });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'khong_doc_duoc', reason: 'trinh_doc_loi', readPaths: [] });
      expect(m.files[0]?.credentialScan).toBeUndefined();
    });

    it.each([
      ['complete', [], 'san_sang', null],
      ['encrypted', [], 'ma_hoa', 'office_ma_hoa'],
      ['blocked', [], 'bi_chan', 'office_macro'],
      ['unsupported', [], 'bi_chan', 'kieu_cam'],
      ['unsupported', ['UNSUPPORTED_ENCODING'], 'khong_doc_duoc', 'khong_utf8'],
      ['corrupt', [], 'hong', 'hong_cau_truc'],
      ['failed', [], 'khong_doc_duoc', 'trinh_doc_loi'],
      ['failed', ['LIMIT_EXCEEDED'], 'hong', 'hong_cau_truc'],
    ] as const)('status %s %j → %s/%s', async (status, problemCodes, expectStatus, expectReason) => {
      const f1 = file(1, 'data.txt', Buffer.from('abc'));
      const extract: ExtractFn = async () => ({
        status,
        outputs: [],
        notes: [],
        problemCodes: [...problemCodes],
        credentialFindings: [],
      });
      const t = setup({ listings: [[f1]] }, { extract });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: expectStatus, reason: expectReason });
    });

    it('extract ném lỗi → khong_doc_duoc/trinh_doc_loi, lệnh vẫn chạy tiếp', async () => {
      const f1 = file(1, 'data.txt', Buffer.from('abc'));
      const f2 = file(2, 'a.png', png);
      const extract: ExtractFn = async () => {
        throw new Error(LEAK);
      };
      const t = setup({ listings: [[f1, f2]] }, { extract });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files.map((f) => f.status)).toEqual(['khong_doc_duoc', 'san_sang']);
      expect(JSON.stringify(m)).not.toContain(LEAK);
    });
  });

  describe('ảnh và PDF', () => {
    it('ảnh lớn bị thu nhỏ → note anh_da_thu_nho, đọc bản jpg', async () => {
      const big = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
      const f1 = file(1, 'big.png', big);
      const t = setup({ listings: [[f1]] });
      (t.deps.runner as FakeRunner).on('sips', (args) => {
        if (args.includes('-g')) return { stdout: 'pixelWidth: 9000\npixelHeight: 3000\n' };
        const out = args[args.indexOf('--out') + 1] as string;
        writeFileSync(out, 'jpegdata');
        return {};
      });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]?.notes).toEqual(['anh_da_thu_nho']);
      expect(m.files[0]?.readPaths[0]).toMatch(/\.jpg$/);
    });

    it('sips lỗi → khong_doc_duoc/doi_anh_loi', async () => {
      const f1 = file(1, 'a.png', png);
      const t = setup({ listings: [[f1]] });
      (t.deps.runner as FakeRunner).on('sips', () => ({ code: 1 }));
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'khong_doc_duoc', reason: 'doi_anh_loi', readPaths: [] });
    });

    it('PDF mã hóa → ma_hoa/pdf_ma_hoa', async () => {
      const t = setup({ listings: [[file(1, 'a.pdf', pdf)]] }, {}, { pages: 3, encrypted: true });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'ma_hoa', reason: 'pdf_ma_hoa', readPaths: [] });
    });

    it('PDF 201 trang → qua_lon/vuot_200_trang', async () => {
      const t = setup({ listings: [[file(1, 'a.pdf', pdf)]] }, {}, { pages: 201 });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'qua_lon', reason: 'vuot_200_trang', readPaths: [] });
    });

    it('PDF 8 trang → sẵn sàng, không note, vẫn ghi số trang', async () => {
      const t = setup({ listings: [[file(1, 'a.pdf', pdf)]] }, {}, { pages: 8 });
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'san_sang', pages: 8, notes: [] });
    });

    it('PDF hỏng → hong/hong_cau_truc', async () => {
      const t = setup({ listings: [[file(1, 'a.pdf', pdf)]] });
      (t.deps.runner as FakeRunner).on('osascript', () => ({ code: 1 }));
      const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
      expect(m.files[0]).toMatchObject({ status: 'hong', reason: 'hong_cau_truc' });
    });
  });

  it('exe đổi đuôi .png → bị chặn theo byte, không có đường đọc', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const t = setup({ listings: [[file(1, 'anh.png', exe, { contentType: 'image/png' })]] });
    const m = await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    expect(m.files[0]).toMatchObject({
      status: 'bi_chan',
      reason: 'kieu_cam',
      blockLabel: 'exe',
      readPaths: [],
    });
  });

  it('log không chứa nội dung hay tên file', async () => {
    const t = setup({ listings: [[file(1, 'bí-mật-lắm.png', png)]] });
    await collectFiles(t.deps, { issueId: ISSUE, runId: RUN });
    const log = readFileSync(t.paths.log, 'utf8');
    expect(log).not.toContain('bí-mật');
    expect(log.trim().split('\n').at(-1)).toMatch(
      /^\S+ 0b7f3c2e 00000000 [0-9a-f]{12} \d+ san_sang - tai_bridge$/,
    );
  });
});
