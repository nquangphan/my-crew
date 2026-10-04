/**
 * Pure link resolution for rendered docs pages. A markdown `href` becomes exactly one of: a page inside the
 * pinned project snapshot, an external http(s) URL, or a blocked link with a visible reason. Nothing is
 * guessed: a relative link that does not name a page of this snapshot is blocked, never redirected.
 */

export type DocDestination =
  | { kind: 'page'; projectId: string; snapshotId: string; path: string; fragment: string | null }
  | { kind: 'external'; href: string }
  | { kind: 'blocked'; reason: string };

export type ResolveDocLinkInput = {
  href: string;
  currentPath: string;
  projectId: string;
  snapshotId: string;
  pages: ReadonlySet<string>;
};

/** `rel` of every external link: no opener handle and no Referer. */
export const externalLinkRel = 'noopener noreferrer nofollow';

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is rejected.
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const scheme = /^[a-z][a-z0-9+.-]*:/i;

const blocked = (reason: string): DocDestination => ({ kind: 'blocked', reason });

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** True for any image source that would make the browser fetch a remote or inline resource on its own. */
export function isRemoteImage(src: string): boolean {
  const value = src.trim();
  return value.startsWith('//') || scheme.test(value);
}

export function resolveDocLink(input: ResolveDocLinkInput): DocDestination {
  const href = input.href.trim();
  if (href === '') return blocked('Liên kết rỗng');
  if (controlCharacters.test(href) || href.includes('\\'))
    return blocked('Liên kết chứa ký tự không an toàn');
  if (scheme.test(href)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return blocked('Liên kết ngoài không hợp lệ');
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? { kind: 'external', href }
      : blocked(`Giao thức ${url.protocol} không được phép mở từ tài liệu`);
  }
  if (href.startsWith('//')) return blocked('Liên kết theo giao thức tương đối không được phép');

  const hashAt = href.indexOf('#');
  const rawFragment = hashAt === -1 ? '' : href.slice(hashAt + 1);
  const beforeFragment = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = beforeFragment.indexOf('?');
  const rawPath = queryAt === -1 ? beforeFragment : beforeFragment.slice(0, queryAt);

  const fragmentDecoded = rawFragment === '' ? '' : (decode(rawFragment) ?? rawFragment);
  const fragment = fragmentDecoded === '' ? null : fragmentDecoded;
  const target = (path: string): DocDestination => ({
    kind: 'page',
    projectId: input.projectId,
    snapshotId: input.snapshotId,
    path,
    fragment,
  });

  if (rawPath === '') return target(input.currentPath);

  const decoded = decode(rawPath);
  if (decoded === null) return blocked('Liên kết có mã hóa phần trăm không hợp lệ');
  if (controlCharacters.test(decoded) || decoded.includes('\\'))
    return blocked('Liên kết chứa ký tự không an toàn');

  const absolute = decoded.startsWith('/');
  const segments: string[] = absolute ? [] : input.currentPath.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.pop() === undefined) return blocked('Liên kết trỏ ra ngoài thư mục gốc của dự án');
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join('/');
  const index = normalized === '' ? 'index.md' : `${normalized}/index.md`;
  if (normalized !== '' && input.pages.has(normalized)) return target(normalized);
  if (input.pages.has(index)) return target(index);
  return blocked('Trang này không có trong phiên bản tài liệu đang xem');
}
