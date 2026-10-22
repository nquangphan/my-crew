import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { type GateResult, Jev, type JevBackend, OpenRouterBackend } from 'jev-use';
import type { MacContext } from '../context.js';
import { macPaths } from '../paths.js';
import { type Category, dangerCategory, type GitFacts, needsGitFacts, readGitFacts } from './classify.js';
import { COMPANY_ID, type JevCompanyConfig, readJevConfig, readJevKey, selectCompany } from './config.js';
import { appendGateLog, type GateErrorCode, type GateLogInput, type GateVerdict } from './log.js';

export interface GateOptions {
  env: NodeJS.ProcessEnv;
  /** true trong `jev gate-bg`: luôn gọi Jev, không bao giờ chặn. */
  background: boolean;
  /** Tách `crew-mac jev gate-bg` (stdin là sự kiện) ra khỏi nhóm process của run; test thay bằng hàm giả. */
  spawnBackground?: (eventJson: string) => Promise<void>;
  /** Test thay backend; mặc định OpenRouter với `maxRetries: 0`. */
  createBackend?: (options: { apiKey: string; timeoutMs: number; model: string }) => JevBackend;
}

export interface GateOutcome {
  /** In ra stdout cho Claude: rỗng (cho chạy) hoặc JSON `permissionDecision: deny`. */
  stdout: string;
  /** Dòng đã ghi vào `gate.log`, hoặc null khi không ghi. */
  logLine: string | null;
}

const EMPTY: GateOutcome = { stdout: '', logLine: null };
/** Tổng thời gian tối đa của một lượt chặn (Keychain + git + Jev); Claude giết hook ở 5 giây. */
const HARD_DEADLINE_MS = 3000;
const KEYCHAIN_TIMEOUT_MS = 1000;
/** Dưới mức này không kịp gọi Jev: coi như quá hạn. */
const MIN_JEV_MS = 100;
const SPAWN_WRITE_TIMEOUT_MS = 1000;

type ParsedEvent =
  | { kind: 'bash'; command: string; cwd: string | null }
  | { kind: 'other' }
  | { kind: 'bad' };

function parseEvent(eventJson: string): ParsedEvent {
  let value: unknown;
  try {
    value = JSON.parse(eventJson);
  } catch {
    return { kind: 'bad' };
  }
  if (typeof value !== 'object' || value === null) return { kind: 'bad' };
  const { tool_name: tool, tool_input: input, cwd } = value as Record<string, unknown>;
  if (typeof tool !== 'string') return { kind: 'bad' };
  if (tool !== 'Bash') return { kind: 'other' };
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== 'string' || command.trim() === '') return { kind: 'bad' };
  return { kind: 'bash', command, cwd: typeof cwd === 'string' && isAbsolute(cwd) ? cwd : null };
}

function uuidOrNull(value: string | undefined): string | null {
  return value !== undefined && COMPANY_ID.test(value) ? value.toLowerCase() : null;
}

/**
 * State gửi Jev: tiếng Anh, cố định, không có dữ liệu của run (không prompt, không mô tả issue, không env). Câu luật
 * lấy từ mục "Không bao giờ" của vai trò; việc dọn thư mục `mktemp -d` của chính lệnh được nói rõ là hợp lệ.
 */
export function jevState(cwd: string | null, git: GitFacts | null): string {
  return [
    'A Crew coding agent runs shell commands inside its own git worktree on the owner Mac.',
    `Worktree: ${cwd ?? 'unknown'}`,
    `Default branch: ${git?.defaultBranch ?? 'not checked'}`,
    `Origin is GitHub: ${git ? (git.originIsGithub ? 'yes' : 'no') : 'not checked'}`,
    'The agent must never:',
    '1. Delete directories recursively (rm -r, find -delete) outside its own temporary files. Removing a directory the same command created with mktemp -d is required cleanup and is allowed.',
    '2. Skip git hooks (--no-verify, git commit -n, git -c core.hooksPath=...).',
    '3. Force-push or rewrite remote history (git push --force, --force-with-lease, --mirror, +refspec).',
    '4. Push directly to the default branch of a GitHub origin; work goes to crew/... branches and pull requests.',
    '5. Merge pull requests (gh pr merge, the pulls/<n>/merge API); merging is the owner decision.',
    '6. Read, print or copy credentials: Keychain secrets, SSH private keys, .pem/.p12 files, real .env files, gh or Claude credential files, ~/.crew/jev, or environment variables holding keys, tokens, secrets or passwords.',
    'Ordinary development (building, testing, committing, pushing crew/... branches, calling the Paperclip API with its own key) is expected.',
  ].join('\n');
}

export function denyOutput(category: Category, confidence: number): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Crew Jev chặn: ${category} (độ tin ${confidence.toFixed(2)}). Lệnh này nằm trong mục "Không bao giờ" của vai trò.`,
    },
  });
}

interface JevAnswer {
  verdict: GateVerdict;
  confidence: number | null;
  reason: string | null;
  errorCode: GateErrorCode | null;
}

const errorAnswer = (errorCode: GateErrorCode): JevAnswer => ({
  verdict: 'error',
  confidence: null,
  reason: null,
  errorCode,
});

/** GateResult của jev-use → verdict log. Backend lỗi được jev-use trả thành `escalate/unreachable`; tách theo hint. */
export function interpretGateResult(result: GateResult): JevAnswer {
  if (typeof result !== 'object' || result === null) return errorAnswer('bad_response');
  const confidence = Number.isFinite(result.confidence) ? result.confidence : null;
  if (result.decision === 'escalate') {
    if (result.reason === 'unreachable') {
      const hint = result.hint ?? '';
      if (/timed out/i.test(hint)) return errorAnswer('timeout');
      if (/no answer|has no (answers|numeric|choice)|missing answer/i.test(hint))
        return errorAnswer('bad_response');
      return errorAnswer('unreachable');
    }
    return { verdict: 'escalate', confidence, reason: result.reason ?? 'unsure', errorCode: null };
  }
  if (result.decision === 'allow' || result.decision === 'deny')
    return { verdict: result.decision, confidence, reason: null, errorCode: null };
  return errorAnswer('bad_response');
}

async function askJev(
  entry: JevCompanyConfig,
  apiKey: string,
  command: string,
  state: string,
  budgetMs: number,
  createBackend: NonNullable<GateOptions['createBackend']>,
): Promise<JevAnswer> {
  const timeoutMs = Math.min(entry.timeoutMs, Math.floor(budgetMs));
  if (timeoutMs < MIN_JEV_MS) return errorAnswer('timeout');
  const jev = new Jev({
    backend: createBackend({ apiKey, timeoutMs, model: entry.model }),
    model: entry.model,
  });
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([
      jev.gate(state, { tool: 'Bash', input: { command } }, { confidenceThreshold: entry.threshold }),
      expired,
    ]);
    return result === 'timeout' ? errorAnswer('timeout') : interpretGateResult(result);
  } finally {
    clearTimeout(timer);
  }
}

const defaultCreateBackend: NonNullable<GateOptions['createBackend']> = ({ apiKey, timeoutMs, model }) =>
  new OpenRouterBackend({ apiKey, timeoutMs, maxRetries: 0, defaultModel: model });

/**
 * Tách `node <cli.js> jev gate-bg` thành process riêng (`detached`: nhóm process mới, ngoài nhóm của run, nên
 * `--require-no-orphans` và reaper không tính nó), chờ ghi xong sự kiện vào stdin của nó rồi `unref`.
 */
export function spawnGateBackground(
  ctx: MacContext,
  env: NodeJS.ProcessEnv,
): (eventJson: string) => Promise<void> {
  return (eventJson) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [ctx.cliPath, 'jev', 'gate-bg'], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env,
      });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin?.destroy();
        child.unref();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('ghi stdin của gate-bg quá hạn')),
        SPAWN_WRITE_TIMEOUT_MS,
      );
      child.on('error', (error) => finish(error));
      child.stdin?.on('error', (error) => finish(error));
      child.stdin?.end(eventJson, () => finish());
    });
}

/**
 * Hook PreToolUse cho lệnh Bash. Chỉ chặn khi `enforce`, lệnh thuộc nhóm nguy hiểm VÀ Jev trả `deny`. Mọi lỗi (thiếu
 * key, quá hạn, mạng, sự kiện hỏng, exception) đều cho chạy và ghi một dòng log có `errorCode`; không bao giờ ném.
 */
export async function runGate(
  ctx: MacContext,
  eventJson: string,
  options: GateOptions,
): Promise<GateOutcome> {
  const started = Date.now();
  const paths = macPaths(ctx.home);
  let selected: ReturnType<typeof selectCompany>;
  try {
    selected = selectCompany(readJevConfig(paths.jevConfig), options.env);
  } catch {
    return EMPTY;
  }
  if (!selected?.entry.enabled) return EMPTY;
  const { companyId, entry } = selected;
  const blank: Omit<GateLogInput, 'verdict' | 'errorCode'> = {
    at: ctx.now(),
    companyId,
    runId: uuidOrNull(options.env.PAPERCLIP_RUN_ID),
    agentId: uuidOrNull(options.env.PAPERCLIP_AGENT_ID),
    cwd: null,
    mode: entry.gateMode,
    category: null,
    blocking: false,
    applied: 'allow',
    confidence: null,
    reason: null,
    latencyMs: null,
    model: entry.model,
    command: '',
  };
  const log = (input: GateLogInput): GateOutcome => {
    try {
      return { stdout: '', logLine: appendGateLog(paths.jevLog, input) };
    } catch {
      return EMPTY;
    }
  };
  const fail = (errorCode: GateErrorCode, extra: Partial<GateLogInput> = {}) =>
    log({ ...blank, ...extra, verdict: 'error', errorCode, latencyMs: Date.now() - started });

  const event = parseEvent(eventJson);
  if (event.kind === 'other') return EMPTY;
  if (event.kind === 'bad') return fail('bad_event');
  const context = { cwd: event.cwd, command: event.command };
  try {
    const spawnBackground = options.spawnBackground ?? spawnGateBackground(ctx, options.env);
    const detach = async (): Promise<GateOutcome> => {
      try {
        await spawnBackground(eventJson);
        return EMPTY;
      } catch {
        return fail('internal', context);
      }
    };
    // Shadow: tiến trình chính không cần phân nhóm (không chạy git), tách nền ngay.
    if (!options.background && entry.gateMode === 'shadow') return await detach();
    const git = needsGitFacts(event.command) && event.cwd ? await readGitFacts(ctx, event.cwd) : null;
    const category = dangerCategory(event.command, git);
    const blocking = !options.background && entry.gateMode === 'enforce' && category !== null;
    if (!options.background && !blocking) return await detach();

    const base = { ...blank, ...context, category, blocking };
    const apiKey = await readJevKey(ctx, companyId, KEYCHAIN_TIMEOUT_MS);
    if (apiKey === null) return fail('no_key', base);
    const budget = blocking ? HARD_DEADLINE_MS - (Date.now() - started) : entry.timeoutMs;
    const answer = await askJev(
      entry,
      apiKey,
      event.command,
      jevState(event.cwd, git),
      budget,
      options.createBackend ?? defaultCreateBackend,
    );
    const applied = blocking && answer.verdict === 'deny' ? 'deny' : 'allow';
    const outcome = log({ ...base, ...answer, applied, latencyMs: Date.now() - started });
    if (applied === 'deny' && category)
      return { stdout: denyOutput(category, answer.confidence ?? 0), logLine: outcome.logLine };
    return outcome;
  } catch {
    return fail('internal', context);
  }
}
