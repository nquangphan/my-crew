import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ATTACHMENT_BYTES, type TicketDetailResponse } from '@crew/shared';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { createRequestTicket, createSubtask } from '../../api/src/services/ticket-service.js';
import { createTestProject } from '../../api/test/helpers/test-db.js';
import { VpsClient, VpsError } from '../src/api/vps-client.js';
import { homePaths } from '../src/config.js';
import type { RunAgentOptions } from '../src/runner/agent-runner.js';
import { jobTmpDir } from '../src/runner/job-cleanup.js';
import {
  collectTicketImages,
  extractAttachmentIds,
  IMAGES_DIR,
  type ImageText,
  MAX_DOWNLOADED_IMAGES,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGES,
  sniffImageType,
  ticketImageTexts,
} from '../src/runner/ticket-images.js';
import { type JobStatus, StateDb } from '../src/state-db.js';
import {
  commentsOf,
  devTicket,
  type Fixture,
  fixture,
  getTicket,
  ownerComment,
  ownerTransition,
  pmTask,
  useApi,
} from './helpers/api.js';
import { makeDaemon, type ScriptSource, waitFor } from './helpers/daemon.js';
import { makeRepo } from './helpers/git.js';
import { noisePng, ownerDescribes, tinyPng, uploadImage } from './helpers/images.js';

const api = useApi();
const scratch = mkdtempSync(join(tmpdir(), 'crew-images-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const link = (n: number) => `![ảnh](/v1/attachments/${id(n)})`;
const ORIGIN = 'https://crew.example.com';

describe('extractAttachmentIds', () => {
  it('reads markdown images and <img> tags, relative or under the server origin', () => {
    const text = [
      `Màn hình lỗi: ${link(1)}`,
      `<img src="/v1/attachments/${id(2)}" alt="ảnh">`,
      `![có origin](${ORIGIN}/v1/attachments/${id(3)} "tiêu đề")`,
      `<IMG width="200" SRC='${ORIGIN}/v1/attachments/${id(4)}' />`,
      `![trong ngoặc nhọn](</v1/attachments/${id(5)}>)`,
      `[![ảnh trong link](/v1/attachments/${id(6)})](https://example.com)`,
      `![chữ hoa](/v1/attachments/${id(7).replace('8000', 'ABCD')})`,
    ].join('\n\n');
    expect(extractAttachmentIds(text, [ORIGIN])).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
      id(6),
      id(7).replace('8000', 'abcd'),
    ]);
  });

  it('counts an image shown several times once, in the order of its first use', () => {
    const text = `${link(2)} rồi ${link(1)} rồi lại <img src="/v1/attachments/${id(2)}"> và ${link(1)}`;
    expect(extractAttachmentIds(text)).toEqual([id(2), id(1)]);
  });

  it('skips images of other sites, malformed ids and plain links', () => {
    const text = [
      `![ngoài](https://evil.example/v1/attachments/${id(1)})`,
      `![giao thức tương đối](//evil.example/v1/attachments/${id(2)})`,
      `![origin khác](${ORIGIN}.evil.example/v1/attachments/${id(3)})`,
      '![uuid ngắn](/v1/attachments/1234)',
      '![không phải uuid](/v1/attachments/zzzzzzzz-0000-4000-8000-000000000004)',
      `![thừa đuôi](/v1/attachments/${id(5)}/raw)`,
      `![route khác](/v1/tickets/${id(6)})`,
      `[link thường](/v1/attachments/${id(7)})`,
      `<img alt="không có src" data-src="/v1/attachments/${id(8)}">`,
      '![ảnh ngoài](https://example.com/a.png)',
    ].join('\n');
    expect(extractAttachmentIds(text, [ORIGIN])).toEqual([]);
    // Without a known origin, an absolute URL is never the server's.
    expect(extractAttachmentIds(`![a](${ORIGIN}/v1/attachments/${id(1)})`)).toEqual([]);
  });

  it('skips links inside fenced code blocks and inline code', () => {
    const text = [
      `Ví dụ cú pháp: \`${link(1)}\` và \`\`<img src="/v1/attachments/${id(2)}">\`\``,
      '```md',
      link(3),
      '```',
      '~~~',
      `<img src="/v1/attachments/${id(4)}">`,
      '~~~',
      `Ảnh thật: ${link(5)}`,
    ].join('\n');
    expect(extractAttachmentIds(text)).toEqual([id(5)]);
  });
});

describe('ticketImageTexts', () => {
  const detail = {
    ticket: { key: 'WEB-7', description: 'mô tả' },
    comments: [
      { authorKind: 'owner', authorRole: null, body: 'một' },
      { authorKind: 'agent', authorRole: 'pm', body: 'hai' },
      { authorKind: 'system', authorRole: null, body: 'ba' },
      { authorKind: 'owner', authorRole: null, body: 'bốn' },
    ],
  } as unknown as TicketDetailResponse;

  it('names the description and every comment by its place in the thread', () => {
    expect(ticketImageTexts(detail)).toEqual([
      { source: 'mô tả ticket WEB-7', text: 'mô tả' },
      { source: 'bình luận thứ 1 của ticket WEB-7 (chủ dự án viết)', text: 'một' },
      { source: 'bình luận thứ 2 của ticket WEB-7 (agent pm viết)', text: 'hai' },
      { source: 'bình luận thứ 3 của ticket WEB-7 (hệ thống viết)', text: 'ba' },
      { source: 'bình luận thứ 4 của ticket WEB-7 (chủ dự án viết)', text: 'bốn' },
    ]);
  });

  it('keeps only the owner comments of an owner request, numbered as in the thread', () => {
    expect(ticketImageTexts(detail, { ownerOnly: true }).map((entry) => entry.source)).toEqual([
      'mô tả ticket WEB-7',
      'bình luận thứ 1 của ticket WEB-7 (chủ dự án viết)',
      'bình luận thứ 4 của ticket WEB-7 (chủ dự án viết)',
    ]);
  });
});

describe('VpsClient.attachment', () => {
  const client = (answer: () => Response | Promise<Response>, failures: unknown[] = []) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const vps = new VpsClient({
      apiUrl: `${ORIGIN}/`,
      token: () => 'machine-token',
      fetch: (async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return answer();
      }) as unknown as typeof fetch,
      onError: (failure) => failures.push(failure),
    });
    return { vps, calls };
  };
  const png = tinyPng(1);

  it('downloads the bytes and mime type through the daemon route with the machine token', async () => {
    const { vps, calls } = client(
      () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png; charset=binary' } }),
    );
    const got = await vps.attachment(id(1), MAX_ATTACHMENT_BYTES);
    expect(got.mimeType).toBe('image/png');
    expect(got.data.equals(png)).toBe(true);
    expect(calls).toEqual([
      {
        url: `${ORIGIN}/v1/daemon/attachments/${id(1)}`,
        headers: { accept: 'image/*', authorization: 'Bearer machine-token' },
      },
    ]);
  });

  it('refuses an answer over the size cap, by content-length and by the bytes read', async () => {
    const declared = client(
      () => new Response(new Uint8Array(png), { headers: { 'content-length': String(png.length) } }),
    );
    await expect(declared.vps.attachment(id(1), png.length - 1)).rejects.toMatchObject({
      code: 'ATTACHMENT_TOO_LARGE',
    });
    // A streamed body carries no content-length: the cap still holds on what was read.
    const streamed = client(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(png));
              controller.close();
            },
          }),
        ),
    );
    await expect(streamed.vps.attachment(id(1), png.length - 1)).rejects.toMatchObject({
      code: 'ATTACHMENT_TOO_LARGE',
    });
  });

  it('reports 403, 404, an old server without the route and a network error once each, without retrying', async () => {
    const failures: unknown[] = [];
    const error = (status: number, code: string) =>
      new Response(JSON.stringify({ error: { code, message: 'x' } }), { status });
    const forbidden = client(() => error(403, 'FORBIDDEN'), failures);
    await expect(forbidden.vps.attachment(id(1), 10)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    const missing = client(() => error(404, 'NOT_FOUND'), failures);
    await expect(missing.vps.attachment(id(1), 10)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    const oldServer = client(() => new Response('Not Found', { status: 404 }), failures);
    await expect(oldServer.vps.attachment(id(1), 10)).rejects.toMatchObject({ status: 404, code: 'HTTP' });
    const offline = client(() => Promise.reject(new TypeError('fetch failed')), failures);
    await expect(offline.vps.attachment(id(1), 10)).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
    expect(offline.calls).toHaveLength(1);
    expect(failures).toHaveLength(4);
    expect(JSON.stringify(failures)).not.toContain('machine-token');
  });
});

describe('collectTicketImages', () => {
  type Served = { data: Buffer; mimeType: string } | VpsError;
  /** A VPS that serves the given images by id; an unknown id is a 404. */
  function serve(images: Record<string, Served>) {
    const asked: string[] = [];
    const vps = {
      apiUrl: ORIGIN,
      attachment: async (imageId: string, maxBytes: number) => {
        asked.push(imageId);
        const served = images[imageId] ?? new VpsError(404, 'NOT_FOUND', 'attachment not found');
        if (served instanceof VpsError) throw served;
        if (served.data.length > maxBytes) throw new VpsError(200, 'ATTACHMENT_TOO_LARGE', 'too large');
        return served;
      },
    };
    return { vps, asked };
  }
  const collect = (
    texts: ImageText[],
    images: Record<string, Served>,
    extra: { alreadySent?: string[]; signal?: AbortSignal } = {},
  ) => {
    const tmpDir = mkdtempSync(join(scratch, 'job-'));
    const logs: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
    const { vps, asked } = serve(images);
    return collectTicketImages({
      jobId: 'job-1',
      texts,
      vps,
      tmpDir,
      log: (level, message, fields) => logs.push({ level, message, fields }),
      ...extra,
    }).then((result) => ({ ...result, tmpDir, logs, asked }));
  };
  const png = (n: number) => ({ data: tinyPng(n), mimeType: 'image/png' });

  it('returns nothing, and creates nothing, when the texts show no image', async () => {
    const out = await collect(
      [{ source: 'mô tả ticket WEB-1', text: 'Không có ảnh. `![a](/v1/attachments/x)`' }],
      {},
    );
    expect(out).toMatchObject({ images: [], inline: [], note: '' });
    expect(existsSync(join(out.tmpDir, IMAGES_DIR))).toBe(false);
    expect(out.asked).toEqual([]);
    expect(out.logs).toEqual([]);
  });

  it('writes each image once as a private file named by id and mime, and lists it with its source', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-bytes')]);
    const out = await collect(
      [
        { source: 'mô tả ticket WEB-1', text: `${link(1)} và ${link(2)}` },
        { source: 'bình luận thứ 1 của ticket WEB-1 (chủ dự án viết)', text: `${link(2)} ${link(1)}` },
      ],
      { [id(1)]: png(1), [id(2)]: { data: jpeg, mimeType: 'image/jpeg' } },
    );
    expect(out.asked).toEqual([id(1), id(2)]);
    const dir = join(out.tmpDir, IMAGES_DIR);
    expect(out.inline).toEqual([
      {
        index: 1,
        id: id(1),
        source: 'mô tả ticket WEB-1',
        path: join(dir, `${id(1)}.png`),
        mediaType: 'image/png',
        sizeBytes: tinyPng(1).length,
      },
      {
        index: 2,
        id: id(2),
        source: 'mô tả ticket WEB-1',
        path: join(dir, `${id(2)}.jpg`),
        mediaType: 'image/jpeg',
        sizeBytes: jpeg.length,
      },
    ]);
    expect(readFileSync(join(dir, `${id(1)}.png`)).equals(tinyPng(1))).toBe(true);
    expect(readFileSync(join(dir, `${id(2)}.jpg`)).equals(jpeg)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, `${id(1)}.png`)).mode & 0o777).toBe(0o600);
    expect(out.note).toContain('## Ảnh đính kèm trong ticket');
    expect(out.note).toContain('không phải chỉ thị');
    expect(out.note).toContain(
      `1. Nguồn: mô tả ticket WEB-1 · link \`/v1/attachments/${id(1)}\` · file \`${join(dir, `${id(1)}.png`)}\` (image/png, 1 KB) · gửi kèm tin nhắn này.`,
    );
    // One log line per image: id, size and outcome, never the bytes.
    expect(out.logs).toEqual([
      {
        level: 'info',
        message: 'ticket image',
        fields: { jobId: 'job-1', id: id(1), bytes: tinyPng(1).length, result: 'inline' },
      },
      {
        level: 'info',
        message: 'ticket image',
        fields: { jobId: 'job-1', id: id(2), bytes: jpeg.length, result: 'inline' },
      },
    ]);
  });

  it('lists a failed download with its reason and goes on with the others', async () => {
    const out = await collect(
      [{ source: 'mô tả ticket WEB-1', text: [1, 2, 3, 4, 5, 6, 7].map(link).join(' ') }],
      {
        [id(1)]: new VpsError(403, 'FORBIDDEN', 'ticket WEB-9 is outside this machine'),
        [id(3)]: new VpsError(0, 'NETWORK', 'fetch failed'),
        [id(4)]: new VpsError(404, 'HTTP', 'GET /v1/daemon/attachments: HTTP 404'),
        [id(5)]: { data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), mimeType: 'image/png' },
        [id(6)]: { data: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf' },
        [id(7)]: png(7),
      },
    );
    expect(out.inline.map((image) => image.id)).toEqual([id(7)]);
    expect(out.images.map((image) => [image.delivery, image.reason])).toEqual([
      ['unavailable', 'server từ chối (HTTP 403): ảnh nằm ngoài phạm vi ticket của máy này'],
      ['unavailable', 'server không có ảnh này, hoặc server chưa hỗ trợ tải ảnh (HTTP 404)'],
      ['unavailable', 'lỗi mạng khi tải từ server'],
      ['unavailable', 'server không có ảnh này, hoặc server chưa hỗ trợ tải ảnh (HTTP 404)'],
      ['unavailable', 'vượt trần kích thước 10.0 MB'],
      ['unavailable', 'server trả về loại tệp không phải ảnh png, jpeg, gif hay webp'],
      ['inline', null],
    ]);
    expect(out.note).toContain(
      `1. Nguồn: mô tả ticket WEB-1 · link \`/v1/attachments/${id(1)}\` · không tải được: server từ chối (HTTP 403)`,
    );
    // The server's own error text never reaches the prompt.
    expect(out.note).not.toContain('WEB-9');
    expect(out.logs.filter((entry) => entry.level === 'warn')).toHaveLength(6);
    expect(out.logs[0]?.fields).toEqual({
      jobId: 'job-1',
      id: id(1),
      bytes: null,
      result: 'unavailable: server từ chối (HTTP 403): ảnh nằm ngoài phạm vi ticket của máy này',
    });
  });

  it('sends at most 20 images as blocks and lists the rest with their files', async () => {
    const count = MAX_INLINE_IMAGES + 2;
    const numbers = Array.from({ length: count }, (_, index) => index + 1);
    const out = await collect(
      [{ source: 'mô tả ticket WEB-1', text: numbers.map(link).join('\n') }],
      Object.fromEntries(numbers.map((n) => [id(n), png(n)])),
    );
    expect(out.inline).toHaveLength(MAX_INLINE_IMAGES);
    expect(out.inline.at(-1)?.id).toBe(id(MAX_INLINE_IMAGES));
    const rest = out.images.slice(MAX_INLINE_IMAGES);
    expect(rest.map((image) => [image.delivery, image.reason])).toEqual([
      ['file_only', 'vượt giới hạn 20 ảnh gửi kèm mỗi lượt chạy'],
      ['file_only', 'vượt giới hạn 20 ảnh gửi kèm mỗi lượt chạy'],
    ]);
    for (const image of rest) expect(existsSync(image.path as string)).toBe(true);
    expect(out.note).toContain('20 ảnh được gửi kèm ngay sau văn bản này');
    expect(out.note).toContain(
      `21. Nguồn: mô tả ticket WEB-1 · link \`/v1/attachments/${id(21)}\` · file \`${rest[0]?.path}\` (image/png, 1 KB) · không gửi kèm: vượt giới hạn 20 ảnh gửi kèm mỗi lượt chạy; tự \`Read\` file khi cần.`,
    );
  });

  it('does not send an image over 5 MB, nor bytes that are no image, as a block: the agent reads the file', async () => {
    const big = Buffer.concat([tinyPng(1), Buffer.alloc(MAX_INLINE_IMAGE_BYTES)]);
    const out = await collect([{ source: 'mô tả ticket WEB-1', text: `${link(1)} ${link(2)} ${link(3)}` }], {
      [id(1)]: { data: big, mimeType: 'image/png' },
      [id(2)]: { data: Buffer.from('not an image at all'), mimeType: 'image/png' },
      [id(3)]: png(3),
    });
    expect(out.inline.map((image) => image.id)).toEqual([id(3)]);
    expect(out.images.slice(0, 2).map((image) => [image.delivery, image.reason])).toEqual([
      ['file_only', 'lớn hơn 5.0 MB'],
      ['file_only', 'nội dung file không phải ảnh png, jpeg, gif hay webp hợp lệ'],
    ]);
    expect(statSync(out.images[0]?.path as string).size).toBe(big.length);
    expect(out.note).toContain(
      '(image/png, 5.0 MB) · không gửi kèm: lớn hơn 5.0 MB; tự `Read` file khi cần.',
    );
  });

  it('sends the format the bytes really are, whatever mime type the server stored', async () => {
    const out = await collect([{ source: 'mô tả ticket WEB-1', text: link(1) }], {
      [id(1)]: { data: tinyPng(1), mimeType: 'image/jpeg' },
    });
    expect(out.inline[0]).toMatchObject({ mediaType: 'image/png', path: expect.stringMatching(/\.jpg$/) });
    expect(sniffImageType(Buffer.from('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<svg/>'))).toBeNull();
  });

  it('downloads again but does not resend what the resumed session already got', async () => {
    const out = await collect(
      [
        { source: 'mô tả ticket WEB-1', text: link(1) },
        { source: 'bình luận thứ 2 của ticket WEB-1 (chủ dự án viết)', text: link(2) },
      ],
      { [id(1)]: png(1), [id(2)]: png(2) },
      { alreadySent: [id(1)] },
    );
    expect(out.inline.map((image) => [image.index, image.id])).toEqual([[2, id(2)]]);
    expect(out.images[0]).toMatchObject({ delivery: 'sent_before', reason: null });
    expect(readFileSync(out.images[0]?.path as string).equals(tinyPng(1))).toBe(true);
    expect(out.note).toContain('phiên này đã nhận ảnh ở lượt chạy trước, không gửi lại.');
    expect(out.note).toContain('1 ảnh được gửi kèm ngay sau văn bản này');
  });

  it('stops asking the server after 40 downloads and once the job is cancelled', async () => {
    const numbers = Array.from({ length: MAX_DOWNLOADED_IMAGES + 1 }, (_, index) => index + 1);
    const text = [{ source: 'mô tả ticket WEB-1', text: numbers.map(link).join('\n') }];
    const capped = await collect(text, {});
    expect(capped.asked).toHaveLength(MAX_DOWNLOADED_IMAGES);
    expect(capped.images.at(-1)).toMatchObject({
      delivery: 'unavailable',
      reason: 'vượt giới hạn 40 ảnh tải về mỗi lượt chạy',
    });
    const cancelled = new AbortController();
    cancelled.abort();
    const aborted = await collect(text, {}, { signal: cancelled.signal });
    expect(aborted.asked).toEqual([]);
    expect(aborted.inline).toEqual([]);
  });
});

describe('images sent to a session (state DB)', () => {
  it('adds the images_sent column to an older state DB and reads what a session already got', () => {
    const path = join(scratch, 'state.db');
    new StateDb(path).close();
    const raw = new Database(path);
    raw.exec('alter table jobs drop column images_sent');
    raw.close();

    const state = new StateDb(path);
    const first = state.insertJob({
      ticketId: 't-1',
      projectId: null,
      role: 'pm',
      trigger: 'ticket.assigned',
    });
    expect(first.imagesSent).toEqual([]);
    state.updateJob(first.id, { sessionId: 'sess-1', imagesSent: [id(1), id(2)] });
    state.updateJob(first.id, { status: 'done' });
    const second = state.insertJob({ ticketId: 't-1', projectId: null, role: 'pm', trigger: 'wakeup' });
    state.updateJob(second.id, { sessionId: 'sess-1', imagesSent: [id(2), id(3)] });
    state.updateJob(second.id, { status: 'done' });
    const other = state.insertJob({ ticketId: 't-1', projectId: null, role: 'pm', trigger: 'wakeup' });
    state.updateJob(other.id, { sessionId: 'sess-2', imagesSent: [id(9)] });
    expect(state.imagesSentInSession('sess-1')).toEqual([id(1), id(2), id(3)]);
    expect(state.imagesSentInSession('sess-2')).toEqual([id(9)]);
    expect(state.imagesSentInSession('sess-3')).toEqual([]);
    state.close();
  });
});

// ---------------------------------------------------------------------------
// Whole jobs on the real API
// ---------------------------------------------------------------------------

const tool = (name: string, input: Record<string, unknown> = {}) => ({
  tool: `mcp__tickets__${name}`,
  input,
});

/** What a scripted run saw of its images, read while the run was still going. */
interface Seen {
  run: RunAgentOptions;
  files: { id: string; bytes: Buffer; mode: number }[];
}

function watching(seen: Seen[], script: ScriptSource): ScriptSource {
  return (run) => {
    seen.push({
      run,
      files: (run.images ?? []).map((image) => ({
        id: image.id,
        bytes: readFileSync(image.path),
        mode: statSync(image.path).mode & 0o777,
      })),
    });
    return typeof script === 'function' ? script(run) : script;
  };
}

const NOISE = noisePng(7);

/** A dev ticket whose description shows a tiny image and whose first owner comment shows a 50 KB one. */
async function ticketWithImages(f: Fixture, title: string) {
  const pm = await pmTask(api, f);
  const dev = await devTicket(api, pm.id, title);
  const a = await uploadImage(f, dev.id, tinyPng(1));
  const b = await uploadImage(f, dev.id, NOISE);
  await ownerDescribes(f, dev.id, `Sửa theo ảnh chụp màn hình:\n\n${a.markdown}`);
  await ownerComment(f, dev.id, `Thêm ảnh thứ hai: <img src="${f.server.url}/v1/attachments/${b.id}">`);
  return { dev, a, b };
}

describe('ticket images in a job', () => {
  it('a ticket without images runs with the same prompt and no image data', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo() });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Không có ảnh');
    await ownerDescribes(
      f,
      dev.id,
      'Link thường /v1/attachments/x và `![ví dụ](/v1/attachments/y)` trong code.',
    );
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'job done',
    );
    const run = t.book.runs.find((entry) => entry.ticketId === dev.id);
    expect(run).not.toHaveProperty('images');
    expect(run?.prompt).not.toContain('Ảnh đính kèm');
    expect(run?.prompt.endsWith('Bình luận, câu hỏi và report viết bằng tiếng Việt.')).toBe(true);
    expect(job.imagesSent).toEqual([]);
    await t.daemon.stop();
  });

  const endings: [string, ScriptSource, JobStatus][] = [
    ['done', { steps: [] }, 'done'],
    ['a runner error', { steps: [{ fail: 'hỏng giữa chừng' }] }, 'failed'],
    ['an API backoff', { steps: [{ apiError: 'rate_limit' }] }, 'backoff'],
    [
      'a cancelled ticket',
      { steps: [tool('update_status', { to: 'in_progress' }), { sleep: 30_000 }] },
      'cancelled',
    ],
  ];
  it.each(endings)(
    'downloads the images of the description and the comments into the job temp dir and deletes it after %s',
    async (_name, script, status) => {
      const f = await fixture(api);
      const t = makeDaemon(f, { repoPath: makeRepo() });
      const { dev, a, b } = await ticketWithImages(f, 'Có ảnh');
      const seen: Seen[] = [];
      t.book.byTicket.set(dev.id, watching(seen, script));
      await t.daemon.start();
      if (status === 'cancelled') {
        await waitFor(() => seen.length > 0, 15_000, 'run started');
        await waitFor(
          async () => (await getTicket(api.db, dev.id)).status === 'in_progress',
          15_000,
          'in progress',
        );
        await ownerTransition(f, dev.id, 'cancelled');
      }
      const job = await waitFor(
        () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === status),
        20_000,
        `job ${status}`,
      );
      // The runner got both images, in the job's own temp dir, byte for byte, as private files.
      const dir = join(jobTmpDir(homePaths(t.home).tmp, job.id), IMAGES_DIR);
      const first = seen[0] as Seen;
      expect(first.run.images).toEqual([
        {
          index: 1,
          id: a.id,
          source: `mô tả ticket ${dev.key}`,
          path: join(dir, `${a.id}.png`),
          mediaType: 'image/png',
          sizeBytes: tinyPng(1).length,
        },
        {
          index: 2,
          id: b.id,
          source: `bình luận thứ 1 của ticket ${dev.key} (chủ dự án viết)`,
          path: join(dir, `${b.id}.png`),
          mediaType: 'image/png',
          sizeBytes: NOISE.length,
        },
      ]);
      expect(first.files.map((file) => file.bytes.equals(file.id === a.id ? tinyPng(1) : NOISE))).toEqual([
        true,
        true,
      ]);
      expect(first.files.map((file) => file.mode)).toEqual([0o600, 0o600]);
      expect(first.run.env.TMPDIR).toBe(jobTmpDir(homePaths(t.home).tmp, job.id));
      expect(first.run.prompt).toContain(
        `file \`${join(dir, `${a.id}.png`)}\` (image/png, 1 KB) · gửi kèm tin nhắn này.`,
      );
      // The temp dir, images included, is gone once the job ended.
      await waitFor(() => t.daemon.state.cleanups({ jobId: job.id }).length > 0, 15_000, 'cleanup');
      expect(existsSync(jobTmpDir(homePaths(t.home).tmp, job.id))).toBe(false);
      // The daemon's own downloads are not booked as temp files the agent left behind.
      expect(NOISE.length).toBeGreaterThan(40_000);
      expect(t.daemon.state.cleanups({ jobId: job.id })[0]?.bytesFreed).toBeLessThan(1024);
      await t.daemon.stop();
    },
  );

  it('an image the machine cannot get (403, 404) does not fail the job: the prompt and the log say why', async () => {
    const f = await fixture(api);
    const logs: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
    const t = makeDaemon(f, {
      repoPath: makeRepo(),
      extra: { logger: (level, message, fields) => logs.push({ level, message, fields }) },
    });
    // An image of a ticket in a project this machine does not own, and one that does not exist.
    const foreign = await createTestProject(api.db, { key: 'OTH' });
    const request = await createRequestTicket(api.db, { title: 'Yêu cầu dự án khác' });
    const otherPm = await createSubtask(api.db, {
      type: 'pm_task',
      parentId: request.id,
      projectId: foreign.id,
      title: 'Việc dự án khác',
    });
    const secret = await uploadImage(f, otherPm.id, tinyPng(9));
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Ảnh lỗi');
    const ok = await uploadImage(f, dev.id, tinyPng(1));
    await ownerDescribes(f, dev.id, `${secret.markdown}\n${link(404)}\n${ok.markdown}`);
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Đã chạy' })] });
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'job done',
    );
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toContain('Đã chạy');
    const run = t.book.runs.find((entry) => entry.ticketId === dev.id);
    expect(run?.images?.map((image) => [image.index, image.id])).toEqual([[3, ok.id]]);
    expect(run?.prompt).toContain(
      `1. Nguồn: mô tả ticket ${dev.key} · link \`/v1/attachments/${secret.id}\` · không tải được: server từ chối (HTTP 403): ảnh nằm ngoài phạm vi ticket của máy này.`,
    );
    expect(run?.prompt).toContain(
      `2. Nguồn: mô tả ticket ${dev.key} · link \`/v1/attachments/${id(404)}\` · không tải được: server không có ảnh này, hoặc server chưa hỗ trợ tải ảnh (HTTP 404).`,
    );
    const lines = logs.filter((entry) => entry.message === 'ticket image');
    expect(lines.map((entry) => [entry.level, entry.fields?.id, entry.fields?.bytes])).toEqual([
      ['warn', secret.id, null],
      ['warn', id(404), null],
      ['info', ok.id, tinyPng(1).length],
    ]);
    expect(lines.every((entry) => entry.fields?.jobId === job.id)).toBe(true);
    expect(job.imagesSent).toEqual([ok.id]);
    await t.daemon.stop();
  });

  it('a run that resumes a session gets only the images that session has not seen', async () => {
    const f = await fixture(api);
    const t = makeDaemon(f, { repoPath: makeRepo() });
    const { dev, a, b } = await ticketWithImages(f, 'Hỏi rồi làm tiếp');
    const seen: Seen[] = [];
    t.book.byTicket.set(
      dev.id,
      watching(seen, (run) => ({
        steps: [tool('comment', { body: `Lượt ${run.resumeSessionId ? 'tiếp' : 'đầu'}` })],
      })),
    );
    await t.daemon.start();
    const first = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'first run',
    );
    expect(first.imagesSent).toEqual([a.id, b.id]);
    await waitFor(() => !t.daemon.state.activeJob(dev.id), 15_000, 'first runs ended');
    const before = seen.length;

    // The owner answers with a new image: the resumed session gets that one only.
    const c = await uploadImage(f, dev.id, tinyPng(3));
    await ownerComment(f, dev.id, `Trả lời: xem ảnh mới ${c.markdown}`);
    await waitFor(() => seen.length > before, 15_000, 'resumed run');
    const resumed = seen[before] as Seen;
    const second = await waitFor(
      () =>
        t.daemon.state.jobsForTicket(dev.id).find((j) => j.id === resumed.run.jobId && j.status === 'done'),
      15_000,
      'resumed run done',
    );
    expect(resumed.run.resumeSessionId).toBe(first.sessionId);
    expect(resumed.run.images?.map((image) => [image.index, image.id, image.source])).toEqual([
      [3, c.id, expect.stringMatching(/^bình luận thứ \d+ của ticket \S+ \(chủ dự án viết\)$/)],
    ]);
    expect(resumed.files.map((file) => file.bytes.equals(tinyPng(3)))).toEqual([true]);
    // The earlier images are in the new job's temp dir again, listed but not sent twice.
    const dir = join(jobTmpDir(homePaths(t.home).tmp, second.id), IMAGES_DIR);
    expect(resumed.run.prompt).toContain(
      `1. Nguồn: mô tả ticket ${dev.key} · link \`/v1/attachments/${a.id}\` · file \`${join(dir, `${a.id}.png`)}\` (image/png, 1 KB) · phiên này đã nhận ảnh ở lượt chạy trước, không gửi lại.`,
    );
    expect(second.imagesSent).toEqual([c.id]);
    expect(t.daemon.state.imagesSentInSession(first.sessionId as string)).toEqual([a.id, b.id, c.id]);
    await t.daemon.stop();
  });
});
