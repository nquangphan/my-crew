// Port luật từ my-crew packages/shared/src/bmad-schemas.ts (v2).

/**
 * Câu trả lời module mà `crew-mac bmad setup-project` truyền cho `setup.py` chỉ được là câu trả lời cấp nhóm: không
 * khóa cá nhân, không khóa giống credential, không đường dẫn tuyệt đối hay ra ngoài repo, không ký tự điều khiển.
 */

/** Câu trả lời cấp người dùng: không bao giờ ghi vào `_bmad/config.toml` của dự án. */
export const BMAD_PERSONAL_KEYS: readonly string[] = [
  'user_name',
  'user_skill_level',
  'communication_language',
];

/** Khóa ngôn ngữ: chỉ nhận khi gọi với `allowLanguage` (Crew luôn đặt `Vietnamese`). */
const LANGUAGE_KEYS: readonly string[] = ['communication_language', 'document_output_language'];

export interface BmadAnswer {
  module: string;
  key: string;
  value: string;
}

const MODULE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SECRET_KEY = /(token|secret|password|passwd|credential|api_?key|private)/i;
const LANGUAGE_RE = /^[\p{L}][\p{L} ()'-]*$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ký tự điều khiển chính là thứ bị từ chối
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_VALUE = 500;

function problemOf(answer: BmadAnswer, allowLanguage: boolean): string | null {
  const { module, key, value } = answer;
  if (!MODULE_RE.test(module)) return 'tên module không hợp lệ';
  if (!KEY_RE.test(key)) return 'khóa không phải snake_case';
  if (LANGUAGE_KEYS.includes(key) && allowLanguage) {
    const name = value.trim();
    return name.length > 0 && name.length <= 60 && LANGUAGE_RE.test(name) ? null : 'không phải tên ngôn ngữ';
  }
  if (BMAD_PERSONAL_KEYS.includes(key)) return 'câu trả lời cá nhân không dùng cho dự án';
  if (SECRET_KEY.test(key)) return 'khóa giống credential';
  if (value.length > MAX_VALUE) return `dài hơn ${MAX_VALUE} ký tự`;
  if (CONTROL_RE.test(value)) return 'có ký tự điều khiển';
  if (value.startsWith('/') || value.startsWith('~')) return 'đường dẫn tuyệt đối';
  if (value.split(/[\\/]/).includes('..')) return 'đường dẫn ra ngoài repo (..)';
  return null;
}

/** Danh sách vấn đề dạng `<module>.<key>: <lý do>`, rỗng là đạt. */
export function checkBmadAnswers(
  answers: readonly BmadAnswer[],
  opts: { allowLanguage: boolean } = { allowLanguage: false },
): string[] {
  const problems: string[] = [];
  for (const answer of answers) {
    const problem = problemOf(answer, opts.allowLanguage);
    if (problem) problems.push(`${answer.module}.${answer.key}: ${problem}`);
  }
  return problems;
}
