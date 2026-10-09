import type { AttachmentMeta } from './bridge.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ATTACHMENT_URL = new RegExp(
  `^(?:https?://[^/\\s]+)?/api/attachments/(${UUID})/content(?:[?#]\\S*)?$`,
  'i',
);
/** `![alt](url)` hoặc `[text](url)`, url trần hoặc trong `<>`, có thể kèm tiêu đề. */
const MARKDOWN_LINK =
  /!?\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^<>\n]*)>|([^\s()<>]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
/** `<img src="…">` và `<a href="…">`, url trong nháy kép, nháy đơn hoặc trần. */
const HTML_LINK = /<(?:img|a)\b[^>]*?\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** Bỏ khối rào (``` hoặc ~~~) và code inline: link trong code không phải đính kèm. */
function withoutCode(text: string): string {
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (match && match[1]?.[0] === fence.char && (match[1]?.length ?? 0) >= fence.length) fence = null;
      out.push('');
    } else if (match) {
      fence = { char: match[1]?.[0] as string, length: match[1]?.length ?? 3 };
      out.push('');
    } else {
      out.push(line);
    }
  }
  return out.join('\n').replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
}

/** Id attachment mà văn bản markdown/HTML link tới, theo thứ tự xuất hiện, mỗi id một lần. */
export function extractAttachmentIds(text: string): string[] {
  const prose = withoutCode(text);
  const found: { at: number; id: string }[] = [];
  for (const pattern of [MARKDOWN_LINK, HTML_LINK]) {
    for (const match of prose.matchAll(pattern)) {
      const id = ATTACHMENT_URL.exec((match[1] ?? match[2] ?? match[3] ?? '').trim())?.[1]?.toLowerCase();
      if (id) found.push({ at: match.index, id });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((entry) => entry.id))];
}

/** Chữ ngắn cho agent (kiểu nội dung, tên sheet): bỏ ký tự điều khiển và ký tự định dạng, tối đa 120 ký tự. */
export function sanitizeText(text: string): string {
  return [...text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')].slice(0, 120).join('');
}

/** Tên cho agent: bỏ ký tự điều khiển, ký tự định dạng (đảo chiều chữ), `/`, tối đa 120 ký tự. */
export function sanitizeName(name: string): string {
  return sanitizeText(name.replaceAll('/', ''));
}

export interface SourceText {
  kind: 'description' | 'comment';
  issueKey: string;
  /** Thứ tự bình luận từ 1, theo createdAt tăng dần; null với mô tả. */
  ordinal: number | null;
  author: 'chủ dự án' | 'agent' | null;
  commentId: string | null;
  text: string;
}

function describe(t: SourceText): string {
  return t.kind === 'description'
    ? `mô tả ${t.issueKey}`
    : `bình luận thứ ${t.ordinal} của ${t.issueKey} (${t.author ?? 'agent'})`;
}

/**
 * Câu nguồn của file: tổ tiên → `issue cha`; không thì link đầu tiên (mô tả trước, rồi bình luận theo thứ tự);
 * không link mà có `issueCommentId` thì bình luận đó; còn lại `đính kèm của issue`.
 */
export function sourceFor(
  a: AttachmentMeta,
  issueKey: string,
  relation: 'self' | 'ancestor',
  texts: SourceText[],
): string {
  if (relation === 'ancestor') return `issue cha ${issueKey}`;
  const id = a.id.toLowerCase();
  const linked = texts.find((t) => extractAttachmentIds(t.text).includes(id));
  if (linked) return describe(linked);
  const comment = a.issueCommentId
    ? texts.find((t) => t.kind === 'comment' && t.commentId === a.issueCommentId)
    : undefined;
  return comment ? describe(comment) : `đính kèm của issue ${issueKey}`;
}
