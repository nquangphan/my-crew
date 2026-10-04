import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DocDestination, externalLinkRel, isRemoteImage, resolveDocLink } from '../src/docs/links.ts';
import { docsFailureText, docsSearchPath, ticketDocsLinksPath } from '../src/docs/queries.ts';
import { ApiFailure } from '../src/lib/api.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const snapshotId = '22222222-2222-4222-8222-222222222222';
const otherSnapshot = '33333333-3333-4333-8333-333333333333';
const pages = new Set([
  'docs/index.md',
  'docs/flows/đăng-nhập.md',
  'docs/flows/tạo yêu cầu.md',
  'docs/Kiến-trúc.md',
  'README.md',
  'docs/guide/index.md',
  'docs/a.md',
  'docs/đ ê.md',
]);

function resolve(href: string, currentPath = 'docs/index.md', snapshot = snapshotId): DocDestination {
  return resolveDocLink({ href, currentPath, projectId, snapshotId: snapshot, pages });
}

const page = (path: string, fragment: string | null = null, snapshot = snapshotId): DocDestination => ({
  kind: 'page',
  projectId,
  snapshotId: snapshot,
  path,
  fragment,
});

test('liên kết tương đối được giải theo thư mục của trang hiện hành', () => {
  assert.deepEqual(resolve('flows/đăng-nhập.md'), page('docs/flows/đăng-nhập.md'));
  assert.deepEqual(resolve('./Kiến-trúc.md'), page('docs/Kiến-trúc.md'));
  assert.deepEqual(resolve('../Kiến-trúc.md', 'docs/flows/đăng-nhập.md'), page('docs/Kiến-trúc.md'));
  assert.deepEqual(resolve('../README.md', 'docs/index.md'), page('README.md'));
});

test('percent-encoding tiếng Việt và khoảng trắng được giải mã đúng một lần', () => {
  assert.deepEqual(resolve('flows/%C4%91%C4%83ng-nh%E1%BA%ADp.md'), page('docs/flows/đăng-nhập.md'));
  assert.deepEqual(
    resolve('flows/t%E1%BA%A1o%20y%C3%AAu%20c%E1%BA%A7u.md'),
    page('docs/flows/tạo yêu cầu.md'),
  );
  assert.equal(resolve('flows/%E0%A4%A.md').kind, 'blocked');
  // %252e%252e giải mã một lần thành "%2e%2e", không phải "..": là tên thư mục, không thoát root.
  assert.equal(resolve('%252e%252e/README.md').kind, 'blocked');
});

test('fragment giữ nguyên chữ hoa/thường và giải mã percent; #only ở lại trang hiện hành', () => {
  assert.deepEqual(resolve('Kiến-trúc.md#Tổng-Quan'), page('docs/Kiến-trúc.md', 'Tổng-Quan'));
  assert.deepEqual(resolve('Kiến-trúc.md#T%E1%BB%95ng-Quan'), page('docs/Kiến-trúc.md', 'Tổng-Quan'));
  assert.deepEqual(
    resolve('#Mục-Một', 'docs/flows/đăng-nhập.md'),
    page('docs/flows/đăng-nhập.md', 'Mục-Một'),
  );
  assert.deepEqual(resolve('Kiến-trúc.md#'), page('docs/Kiến-trúc.md', null));
});

test('trang không có trong snapshot bị chặn kèm lý do, không đoán đích', () => {
  const result = resolve('khong-co.md');
  assert.equal(result.kind, 'blocked');
  assert.match((result as { reason: string }).reason, /không có trong/);
});

test('thoát khỏi root bị chặn, kể cả qua percent-encoding', () => {
  for (const href of ['../../README.md', '../../../etc/passwd', '%2e%2e/%2e%2e/README.md', '/../README.md'])
    assert.equal(resolve(href, 'docs/index.md').kind, 'blocked', href);
});

test('javascript:, data:, file:, vbscript: và biến thể che dấu bị chặn', () => {
  for (const href of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    '\u0000javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'blob:https://x/1',
    '\\\\server\\share',
    '//evil.example/x',
    '',
  ])
    assert.equal(resolve(href).kind, 'blocked', JSON.stringify(href));
});

test('http(s) là liên kết ngoài, giữ nguyên href; mailto bị chặn', () => {
  assert.deepEqual(resolve('https://example.com/a?b=1#c'), {
    kind: 'external',
    href: 'https://example.com/a?b=1#c',
  });
  assert.equal(resolve('HTTP://example.com').kind, 'external');
  assert.equal(resolve('mailto:a@b.c').kind, 'blocked');
});

test('cùng path nhưng khác snapshot là hai đích khác nhau, luôn ghim snapshot đầu vào', () => {
  const a = resolve('Kiến-trúc.md');
  const b = resolve('Kiến-trúc.md', 'docs/index.md', otherSnapshot);
  assert.deepEqual(a, page('docs/Kiến-trúc.md'));
  assert.deepEqual(b, page('docs/Kiến-trúc.md', null, otherSnapshot));
  assert.notDeepEqual(a, b);
});

test('rel của liên kết ngoài có noopener và noreferrer; ảnh từ xa được nhận diện để không tải', () => {
  assert.match(externalLinkRel, /noopener/);
  assert.match(externalLinkRel, /noreferrer/);
  assert.equal(isRemoteImage('https://x/y.png'), true);
  assert.equal(isRemoteImage('//x/y.png'), true);
  assert.equal(isRemoteImage('data:image/png;base64,AAAA'), true);
  assert.equal(isRemoteImage('./y.png'), false);
});

test('đường dẫn tìm kiếm mã hóa Unicode/ký tự dành riêng và cursor mờ, ghim project + snapshot', () => {
  const path = docsSearchPath({ q: 'đăng nhập & "tạo"', projectId, snapshotId }, 'a_b-c=', 50);
  const url = new URL(path, 'http://x');
  assert.equal(url.pathname, '/v2/docs/search');
  assert.equal(url.searchParams.get('q'), 'đăng nhập & "tạo"');
  assert.equal(url.searchParams.get('projectId'), projectId);
  assert.equal(url.searchParams.get('snapshotId'), snapshotId);
  assert.equal(url.searchParams.get('after'), 'a_b-c=');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.ok(!docsSearchPath({ q: 'x', projectId, snapshotId }, null, 50).includes('after='));
});

test('đường dẫn docs-links của ticket đi theo cursor mờ, limit 20 và từ chối ID sai trước khi gọi mạng', () => {
  const ticket = '44444444-4444-4444-8444-444444444444';
  assert.equal(ticketDocsLinksPath(ticket, null), `/v2/tickets/${ticket}/docs-links?limit=20`);
  assert.equal(
    ticketDocsLinksPath(ticket, 'W10_-'),
    `/v2/tickets/${ticket}/docs-links?cursor=W10_-&limit=20`,
  );
  assert.throws(() => ticketDocsLinksPath('../x', null), { code: 'TICKET_ID_INVALID' });
});

test('lỗi 422 mã hóa được nói rõ; lỗi khác không đổ cho ticket', () => {
  assert.match(
    docsFailureText(new ApiFailure(422, 'DOCS_ENCODING_INVALID', 'http', 'x')),
    /không phải UTF-8 hợp lệ/,
  );
  assert.match(docsFailureText(new ApiFailure(404, 'NOT_FOUND', 'http')), /Không tìm thấy tài liệu/);
});

/**
 * Mirrors `auditLinks` (`v2/server/src/docs/links.ts:150-170`). Each row was produced by running the server on
 * `[x](href)` from `docs/index.md`; `ok` links are clickable pages, everything else (LINK_PATH_ESCAPE, missing,
 * unsupported) must not be clickable here.
 */
const serverParity: [href: string, serverStatus: string, expected: string | null][] = [
  ['a.md', 'ok', 'docs/a.md'],
  ['./a.md', 'ok', 'docs/a.md'],
  ['../README.md', 'ok', 'README.md'],
  ['guide/index.md', 'ok', 'docs/guide/index.md'],
  ['đ%20ê.md', 'ok', 'docs/đ ê.md'],
  ['%C4%91%20%C3%AA.md', 'ok', 'docs/đ ê.md'],
  ['a/../a.md', 'ok', 'docs/a.md'],
  ['a.md#', 'ok', 'docs/a.md'],
  ['../../README.md', 'LINK_PATH_ESCAPE', null],
  ['a%2eb.md', 'LINK_PATH_ESCAPE', null],
  ['%2e%2e/README.md', 'LINK_PATH_ESCAPE', null],
  ['%2fa.md', 'LINK_PATH_ESCAPE', null],
  ['%2Fa.md', 'LINK_PATH_ESCAPE', null],
  ['a%5cb.md', 'LINK_PATH_ESCAPE', null],
  ['/README.md', 'LINK_PATH_ESCAPE', null],
  ['a.md?x=1', 'LINK_PATH_ESCAPE', null],
  ['a.md#?q', 'LINK_PATH_ESCAPE', null],
  ['guide/', 'LINK_PATH_ESCAPE', null],
  ['%252e%252e/README.md', 'LINK_PATH_ESCAPE', null],
  ['guide', 'LINK_MISSING', null],
  ['.', 'LINK_MISSING', null],
  ['x.md', 'LINK_MISSING', null],
  ['', 'UNVERIFIED_LINK_SYNTAX', null],
];

test('resolver khớp từng trường hợp với hành vi audit của máy chủ: chỉ link ok mới bấm được', () => {
  for (const [href, serverStatus, expected] of serverParity) {
    const result = resolve(href);
    if (expected === null) assert.equal(result.kind, 'blocked', `${href} (server ${serverStatus})`);
    else assert.deepEqual(result, page(expected), `${href} (server ${serverStatus})`);
  }
});

test('"#top" ở lại trang hiện hành; fragment giữ nguyên', () => {
  assert.deepEqual(resolve('#top'), page('docs/index.md', 'top'));
});
