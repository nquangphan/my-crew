// Mẫu secret chép từ plugin crew.core (fork Paperclip, `packages/crew-plugin/src/jobs/sanitize.ts`), vốn chép từ
// `packages/docs-kit/src/secret-scan.ts` (SECRET_RULES) của repo này. App làm sạch trước khi gửi, plugin làm lại.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g,
  /aws.{0,20}?secret.{0,20}?['"=:\s]\s*['"]?[A-Za-z0-9/+=]{40}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g,
  /\bgithub_pat_[0-9A-Za-z_]{82}\b/g,
  /\bglpat-[0-9A-Za-z_-]{20}\b/g,
  /\bxox[abposr]-[0-9A-Za-z-]{10,}/g,
  /hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{20,}/g,
  /\b(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g,
  /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{80,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bcrew_mt_[A-Za-z0-9_-]{40,}/g,
];

/** `scheme://user:pass@` trong URL (git in nguyên remote có credential vào stderr). */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s'"]*@/gi;
// biome-ignore lint/suspicious/noControlCharactersInRegex: mã terminal là thứ bị bỏ
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// Ký tự điều khiển trừ tab và xuống dòng (giữ output git nhiều dòng đọc được).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ký tự điều khiển là thứ bị bỏ
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
export const REDACTED = '[ĐÃ CHE]';
export const JOB_ERROR_MAX = 300;

/** Lỗi gửi lên web: không mã terminal, không credential, tối đa 300 ký tự (không cắt đôi ký tự). */
export function sanitizeJobError(text: string): string {
  let clean = text.replace(ANSI, '').replace(CONTROL, '').replace(URL_USERINFO, `$1${REDACTED}@`);
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, REDACTED);
  const chars = Array.from(clean.trim());
  return chars.length > JOB_ERROR_MAX ? chars.slice(0, JOB_ERROR_MAX).join('') : chars.join('');
}

/** URL remote báo lên web không mang `user:pass@` (URL kiểu scp `git@host:x` giữ nguyên). */
export function stripUrlCredentials(remote: string): string {
  return remote.replace(URL_USERINFO, '$1');
}
