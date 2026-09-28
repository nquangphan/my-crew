/**
 * Credential patterns scrubbed from every comment and report body before it leaves the machine. The list
 * mirrors the crew-docs R7 built-in ruleset (ported from gitleaks' defaults) plus 2P Crew machine tokens.
 */
const SECRET_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'aws-access-key-id', pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g },
  {
    id: 'aws-secret-access-key',
    pattern: /(aws.{0,20}?secret.{0,20}?['"=:\s]\s*['"]?)[A-Za-z0-9/+=]{40}\b/gi,
  },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[0-9A-Za-z_]{82}\b/g },
  { id: 'gitlab-token', pattern: /\bglpat-[0-9A-Za-z_-]{20}\b/g },
  { id: 'slack-token', pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}/g },
  { id: 'slack-webhook', pattern: /hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{20,}/g },
  { id: 'stripe-key', pattern: /\b(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: 'openai-api-key',
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g,
  },
  { id: 'anthropic-api-key', pattern: /\bsk-ant-(?:api03|admin01|oat01)-[A-Za-z0-9_-]{20,}/g },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    id: 'private-key',
    pattern:
      /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'crew-machine-token', pattern: /\bcrew_mt_[A-Za-z0-9_-]{20,}/g },
  { id: 'basic-auth-url', pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi },
];

export interface ScrubResult {
  text: string;
  /** Rule ids that matched, one per replacement. */
  found: string[];
}

/** Replaces every credential-shaped string with `[đã ẩn: <rule>]`. */
export function scrubSecrets(input: string): ScrubResult {
  const found: string[] = [];
  let text = input;
  for (const { id, pattern } of SECRET_PATTERNS) {
    text = text.replace(pattern, (...args: unknown[]) => {
      found.push(id);
      const groups = args.slice(1, -2).filter((g): g is string => typeof g === 'string');
      // Keep the non-secret prefix/suffix groups (e.g. `aws_secret=` or `user:` … `@`).
      if (groups.length === 2) return `${groups[0]}[đã ẩn: ${id}]${groups[1]}`;
      if (groups.length === 1) return `${groups[0]}[đã ẩn: ${id}]`;
      return `[đã ẩn: ${id}]`;
    });
  }
  return { text, found };
}
