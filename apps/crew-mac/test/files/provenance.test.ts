import { describe, expect, it } from 'vitest';
import type { AttachmentMeta } from '../../src/files/bridge.js';
import {
  extractAttachmentIds,
  type SourceText,
  sanitizeName,
  sourceFor,
} from '../../src/files/provenance.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('extractAttachmentIds', () => {
  it('lấy link ảnh và link thường theo thứ tự xuất hiện', () => {
    const text = `![a](/api/attachments/${A}/content) rồi [b.pdf](/api/attachments/${B}/content)`;
    expect(extractAttachmentIds(text)).toEqual([A, B]);
  });
  it('bỏ link trong khối ``` và `inline`', () => {
    const text = [
      `\`\`\`\n![x](/api/attachments/${A}/content)\n\`\`\``,
      `và \`[y](/api/attachments/${B}/content)\``,
      `![z](/api/attachments/${C}/content)`,
    ].join('\n');
    expect(extractAttachmentIds(text)).toEqual([C]);
  });
  it('nhận <img src> và <a href> với URL tuyệt đối đúng mẫu', () => {
    const text = `<img src="https://crew.2p-solutions.com/api/attachments/${C}/content"> <a href='/api/attachments/${D}/content'>d</a>`;
    expect(extractAttachmentIds(text)).toEqual([C, D]);
  });
  it('bỏ id không phải UUID và đường dẫn sai mẫu', () => {
    const text = `![x](/api/attachments/not-a-uuid/content) ![y](/api/attachments/${A}/other) [z](/files/${B})`;
    expect(extractAttachmentIds(text)).toEqual([]);
  });
  it('lặp id chỉ một lần, id viết hoa chuẩn hóa về chữ thường', () => {
    const text = `![a](/api/attachments/${A}/content) [b](/api/attachments/${A.toUpperCase()}/content)`;
    expect(extractAttachmentIds(text)).toEqual([A]);
  });
  it('nhận link có tiêu đề và alt chứa dấu ngoặc đã escape', () => {
    const text = `![sơ đồ \\[v2\\]](/api/attachments/${A}/content "tiêu đề")`;
    expect(extractAttachmentIds(text)).toEqual([A]);
  });
});

describe('sanitizeName', () => {
  it('bỏ ký tự điều khiển, `/` và cắt 120 ký tự', () => {
    expect(sanitizeName('a/b\nc\u0007d.png')).toBe('abcd.png');
    expect(sanitizeName('x'.repeat(300))).toHaveLength(120);
  });
  it('bỏ ký tự đảo chiều chữ', () => {
    expect(sanitizeName('gnp.‮txt')).toBe('gnp.txt');
  });
});

const meta = (id: string, issueCommentId: string | null = null): AttachmentMeta => ({
  id,
  issueId: 'i',
  issueCommentId,
  contentType: 'image/png',
  byteSize: 1,
  sha256: 'x',
  originalFilename: 'f.png',
  createdAt: '2026-10-09T01:00:00.000Z',
});

const texts: SourceText[] = [
  {
    kind: 'description',
    issueKey: 'TPS-80',
    ordinal: null,
    author: null,
    commentId: null,
    text: `![a](/api/attachments/${A}/content) và [e](/api/attachments/${E}/content)`,
  },
  { kind: 'comment', issueKey: 'TPS-80', ordinal: 1, author: 'agent', commentId: 'c1', text: 'ok' },
  {
    kind: 'comment',
    issueKey: 'TPS-80',
    ordinal: 2,
    author: 'chủ dự án',
    commentId: 'c2',
    text: `thêm ![e](/api/attachments/${E}/content)`,
  },
  {
    kind: 'comment',
    issueKey: 'TPS-80',
    ordinal: 3,
    author: 'chủ dự án',
    commentId: 'c3',
    text: `hình ![b](/api/attachments/${B}/content)`,
  },
];

describe('sourceFor', () => {
  it('link trong mô tả', () => expect(sourceFor(meta(A), 'TPS-80', 'self', texts)).toBe('mô tả TPS-80'));
  it('không link nhưng có issueCommentId → bình luận đó', () =>
    expect(sourceFor(meta(D, 'c3'), 'TPS-80', 'self', texts)).toBe('bình luận thứ 3 của TPS-80 (chủ dự án)'));
  it('link ở cả mô tả và comment → nguồn đầu tiên', () =>
    expect(sourceFor(meta(E, 'c2'), 'TPS-80', 'self', texts)).toBe('mô tả TPS-80'));
  it('link trong comment', () =>
    expect(sourceFor(meta(B), 'TPS-80', 'self', texts)).toBe('bình luận thứ 3 của TPS-80 (chủ dự án)'));
  it('comment của agent', () =>
    expect(sourceFor(meta(D, 'c1'), 'TPS-80', 'self', texts)).toBe('bình luận thứ 1 của TPS-80 (agent)'));
  it('file của tổ tiên', () => expect(sourceFor(meta(A), 'TPS-79', 'ancestor', [])).toBe('issue cha TPS-79'));
  it('không link, không comment → đính kèm của issue', () =>
    expect(sourceFor(meta(D), 'TPS-80', 'self', texts)).toBe('đính kèm của issue TPS-80'));
  it('issueCommentId trỏ comment không còn trong danh sách → đính kèm của issue', () =>
    expect(sourceFor(meta(D, 'đã-xóa'), 'TPS-80', 'self', texts)).toBe('đính kèm của issue TPS-80'));
});
