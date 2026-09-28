import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/** One line a diff adds, with where it lands. */
export interface AddedLine {
  path: string;
  line: number;
  text: string;
}

export interface SecretFinding {
  rule: string;
  path: string;
  line: number;
}

/** Extracts added lines from a `git diff -U0` patch. Binary files and deletions carry none. */
export function addedLines(patch: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let path: string | null = null;
  let next = 0;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4);
      path = target === '/dev/null' ? null : target.replace(/^b\//, '').replace(/^"b\/(.*)"$/, '$1');
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (path !== null && raw.startsWith('+')) {
      lines.push({ path, line: next, text: raw.slice(1) });
      next += 1;
    }
  }
  return lines;
}

interface SecretRule {
  id: string;
  pattern: RegExp;
  /** Known documentation placeholders that are not credentials. */
  allow?: RegExp;
}

/**
 * Built-in ruleset, ported from the gitleaks default configuration for the credential types an agent is
 * most likely to handle, plus 2P Crew's own machine tokens. There is deliberately no inline allow marker:
 * a token-shaped string must not be committed, even in tests.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: 'aws-access-key-id',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/,
    allow: /EXAMPLE\b/,
  },
  {
    id: 'aws-secret-access-key',
    pattern: /aws.{0,20}?secret.{0,20}?['"=:\s]\s*['"]?[A-Za-z0-9/+=]{40}\b/i,
    allow: /EXAMPLEKEY/,
  },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/ },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[0-9A-Za-z_]{82}\b/ },
  { id: 'gitlab-token', pattern: /\bglpat-[0-9A-Za-z_-]{20}\b/ },
  { id: 'slack-token', pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
  { id: 'slack-webhook', pattern: /hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{20,}/ },
  { id: 'stripe-key', pattern: /\b(?:sk|rk)_(?:test|live|prod)_[0-9A-Za-z]{10,99}\b/ },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    id: 'openai-api-key',
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/,
  },
  { id: 'anthropic-api-key', pattern: /\bsk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{80,}/ },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'private-key', pattern: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'crew-machine-token', pattern: /\bcrew_mt_[A-Za-z0-9_-]{40,}/ },
];

export function scanBuiltIn(lines: readonly AddedLine[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const added of lines) {
    for (const rule of SECRET_RULES) {
      const match = rule.pattern.exec(added.text);
      if (match && !(rule.allow?.test(match[0]) ?? false)) {
        findings.push({ rule: rule.id, path: added.path, line: added.line });
      }
    }
  }
  return findings;
}

/** The `gitleaks` executable on PATH, or null. */
export function findGitleaks(pathEnv = process.env.PATH ?? ''): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'gitleaks');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this directory
    }
  }
  return null;
}

/**
 * Runs gitleaks (its full default ruleset) over the added lines when it is installed. The lines are fed
 * through stdin, one per input line, so a finding's line number maps back to the added line.
 * Returns null when gitleaks is unavailable or fails; the built-in ruleset always runs regardless.
 */
export function scanWithGitleaks(lines: readonly AddedLine[], binary: string): SecretFinding[] | null {
  if (lines.length === 0) return [];
  const dir = mkdtempSync(join(tmpdir(), 'crew-docs-gitleaks-'));
  const report = join(dir, 'report.json');
  try {
    execFileSync(
      binary,
      [
        'stdin',
        '--no-banner',
        '--redact',
        '--exit-code',
        '0',
        '--report-format',
        'json',
        '--report-path',
        report,
      ],
      {
        input: lines.map((added) => added.text).join('\n'),
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 60_000,
      },
    );
    const parsed: unknown = JSON.parse(readFileSync(report, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    const findings: SecretFinding[] = [];
    for (const item of parsed as { RuleID?: unknown; StartLine?: unknown }[]) {
      const origin = typeof item.StartLine === 'number' ? lines[item.StartLine - 1] : undefined;
      if (origin && typeof item.RuleID === 'string') {
        findings.push({ rule: `gitleaks:${item.RuleID}`, path: origin.path, line: origin.line });
      }
    }
    return findings;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ScanResult {
  findings: SecretFinding[];
  /** Which engines ran: always `built-in`, plus `gitleaks` when it was available and succeeded. */
  engines: string[];
}

/** Scans the lines a patch adds for credentials. */
export function scanPatch(patch: string, gitleaksBinary: string | null = findGitleaks()): ScanResult {
  const lines = addedLines(patch);
  const findings = scanBuiltIn(lines);
  const engines = ['built-in'];
  const external = gitleaksBinary ? scanWithGitleaks(lines, gitleaksBinary) : null;
  if (external) {
    engines.push('gitleaks');
    for (const finding of external) {
      if (!findings.some((f) => f.path === finding.path && f.line === finding.line)) findings.push(finding);
    }
  }
  return { findings, engines };
}
