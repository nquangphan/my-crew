import { z } from 'zod';

/** Who an owner comment calls by tag. `pm` (`@pm`) wakes the PM of the ticket's pm_task tree. */
export const CommentMention = z.enum(['pm']);
export type CommentMention = z.infer<typeof CommentMention>;

/** Fenced code blocks (``` or ~~~, closed or running to the end of the text). */
const FENCED = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
/** Inline code spans: a run of backticks up to the next run of the same length. */
const INLINE = /(`+)[\s\S]*?(?<!`)\1(?!`)/g;
/**
 * `@pm` as a word, in any case: not preceded by a word character or by `@`, `/`, `.` (an email address or a
 * URL), and not followed by a word character, `-`, or a dot that continues a name (`@pm.example`).
 */
const PM_TAG = /(?<![\w@/.])@pm(?![\w-]|\.\w)/i;

/** Comment text without its code: tags written inside code are examples, not calls. */
function withoutCode(body: string): string {
  return body.replace(FENCED, ' ').replace(INLINE, ' ');
}

/**
 * The tags an owner comment carries. Agent and system comments never call anyone, so callers pass only
 * owner-written text.
 */
export function parseMentions(body: string): CommentMention[] {
  return PM_TAG.test(withoutCode(body)) ? ['pm'] : [];
}
