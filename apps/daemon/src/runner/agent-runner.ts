import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  type HookCallback,
  type McpServerConfig,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole, Effort, RoleStage } from '@crew/shared';
import type { JobKind } from '../state-db.js';
import type { AnyToolDefinition, EndReason } from '../tools/ticket-mcp-server.js';
import { BackgroundSession, type BackgroundTask } from './background-session.js';
import { emptyCapture, type RunCapture, recordTool } from './run-trace.js';
import { slashCommandsIn } from './skill-usage.js';

/** Lets a ticket tool (ask_owner, handoff_docs) end the run after its result. */
export class RunControl {
  endReason: EndReason | null = null;
  private listener: (() => void) | null = null;

  requestEnd(reason: EndReason): void {
    if (this.endReason) return;
    this.endReason = reason;
    this.listener?.();
  }

  onEnd(listener: () => void): void {
    this.listener = listener;
  }
}

export interface InitInfo {
  sessionId: string;
  /** Skill names from the SDK `system/init` message (plugin skills are namespaced, e.g. `ak:scout`). */
  skills: string[];
  mcpServers: { name: string; status: string; source?: string }[];
  model: string;
  apiKeySource: string | null;
  claudeCodeVersion: string | null;
}

export interface RunAgentOptions {
  jobId: string;
  ticketId: string;
  ticketKey: string;
  role: AgentRole;
  kind: JobKind;
  /** The role step the run performs (informational; the prompt already says it). */
  stage?: RoleStage;
  cwd: string;
  model: string;
  effort: Effort;
  prompt: string;
  resumeSessionId?: string | null;
  allowedTools: string[];
  /** Tools removed from the model's context (the disabled MCP servers' `mcp__<server>__*`). */
  disallowedTools?: string[];
  /**
   * MCP servers (by inventory name) the owner disabled for the project: passed as the session's
   * `deniedMcpServers`, so Claude Code does not start them at all where the name matches.
   */
  deniedMcpServers?: string[];
  maxBudgetUsd?: number | null;
  abortSignal: AbortSignal;
  /** Full child env: the job tag, the per-job temp dir, never `ANTHROPIC_API_KEY`. */
  env: Record<string, string | undefined>;
  /** In-process servers (the ticket server); every other MCP server comes from the loaded settings. */
  mcpServers: Record<string, McpServerConfig>;
  /** The ticket tools behind `mcpServers.tickets` (the scripted runner calls them directly). */
  ticketTools: AnyToolDefinition[];
  preToolUse: HookCallback;
  /** Project `.mcp.json` servers from the inventory, approved for this headless run. */
  enabledMcpjsonServers?: string[];
  /** Project `.mcp.json` servers the owner switched off. */
  disabledMcpjsonServers?: string[];
  appendSystemPrompt?: string;
  control: RunControl;
  /**
   * Ceiling of one wait for the agent's background tasks, in ms (default 30 minutes). When it passes, the
   * daemon reminds the agent once in the open session.
   */
  backgroundWaitMs?: number;
  /**
   * True once the run's own work is finished (the ticket left in-progress): a turn that ends then never waits
   * for background tasks. Without it a turn that ends with background tasks always waits.
   */
  workDone?: () => boolean | Promise<boolean>;
  /** The agent process started (its pid is also its process group id). */
  onSpawn?: (pid: number) => void;
  onInit?: (info: InitInfo) => void;
}

export interface AgentRunResult {
  sessionId: string | null;
  /** `success`, an `error_*` subtype, or null when the run produced no result message. */
  resultSubtype: string | null;
  isError: boolean;
  /**
   * The last result's `total_cost_usd`: cumulative over every turn of the run (a resumed session already
   * includes its earlier spend).
   */
  totalCostUsd: number;
  modelUsage: Record<string, { costUSD: number; inputTokens: number; outputTokens: number }>;
  skillsListed: string[];
  /** `/skill` commands seen in the run's user messages and prompt. */
  slashCommands: string[];
  mcpServers: { name: string; status: string }[];
  /** Last API error class the CLI reported (`system/api_retry` or an assistant error). */
  apiError: string | null;
  aborted: boolean;
  endedBy: EndReason | null;
  errors: string[];
  apiKeySource: string | null;
  claudeCodeVersion: string | null;
  /** Turns, duration, compactions, the last message and tool calls, for diagnosing a run that ends badly. */
  capture: RunCapture;
  /** Background tasks still alive when the session closed (the daemon stopped them); empty after a clean end. */
  backgroundTasksLeft: BackgroundTask[];
  /** True when a wait for background tasks hit its ceiling and the daemon reminded the agent. */
  reminded: boolean;
}

/** Same interface for the real SDK runner and the scripted test double. */
export type AgentRunner = (options: RunAgentOptions) => Promise<AgentRunResult>;

export function emptyResult(): AgentRunResult {
  return {
    sessionId: null,
    resultSubtype: null,
    isError: false,
    totalCostUsd: 0,
    modelUsage: {},
    skillsListed: [],
    slashCommands: [],
    mcpServers: [],
    apiError: null,
    aborted: false,
    endedBy: null,
    errors: [],
    apiKeySource: null,
    claudeCodeVersion: null,
    capture: emptyCapture(),
    backgroundTasksLeft: [],
    reminded: false,
  };
}

/** The agent env: the daemon's env without `ANTHROPIC_API_KEY`, plus the given additions. */
export function agentEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base, ...extra };
  // Billing must stay on the owner's subscription login; an API key in the env would silently switch it.
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function textOf(message: SDKMessage): string {
  if (message.type !== 'user') return '';
  const content = (message.message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && typeof block === 'object' && 'text' in block ? String(block.text) : ''))
    .join('\n');
}

/**
 * Records the main agent's text and tool calls from one assistant message (subagent messages are skipped).
 * While streaming, the CLI sends one message per content block, so text blocks sharing a message id are
 * joined and a new message's text replaces the previous one.
 */
function captureAssistant(
  capture: RunCapture,
  message: Extract<SDKMessage, { type: 'assistant' }>,
  cwd: string,
  lastTextId: { id: string | null },
): void {
  if (message.parent_tool_use_id !== null) return;
  const content = (message.message as { id?: string; content?: unknown }).content;
  if (!Array.isArray(content)) return;
  const id = (message.message as { id?: string }).id ?? null;
  for (const block of content as { type?: string; text?: unknown; name?: unknown; input?: unknown }[]) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      capture.lastMessage =
        id !== null && id === lastTextId.id && capture.lastMessage
          ? `${capture.lastMessage}\n\n${block.text}`
          : block.text;
      lastTextId.id = id;
    } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
      recordTool(capture, block.name, block.input, cwd);
    }
  }
}

/** Version of the Claude Code runtime bundled with the pinned Agent SDK (`claudeCodeVersion`). */
export function sdkRuntimeVersion(): string | null {
  try {
    const entry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    const manifest = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
      claudeCodeVersion?: string;
    };
    return manifest.claudeCodeVersion ?? null;
  } catch {
    return null;
  }
}

/** The session input the daemon drives: the run's prompt, later messages, then the end of input. */
export interface PromptStream extends AsyncIterable<SDKUserMessage> {
  /** Queues one user message (ignored once closed). */
  send(text: string): void;
  /** Ends the input after what is already queued. */
  close(): void;
}

export function createPromptStream(): PromptStream {
  const queue: SDKUserMessage[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    send(text) {
      if (closed) return;
      queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift();
        if (next) yield next;
        else if (closed) return;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
    },
  };
}

export interface SdkRunnerOptions {
  query?: typeof sdkQuery;
  /** Path of the Claude Code executable (the desktop app points the SDK at its bundled runtime). */
  pathToClaudeCodeExecutable?: string;
  /** How long a session stays open for a turn the runtime still owes (default `DEFAULT_SETTLE_MS`). */
  backgroundSettleMs?: number;
}

/**
 * The production runner: one Agent SDK `query()` per run, with `settingSources` (so skills load), the
 * `dontAsk` permission mode plus the role's `allowedTools`, the inline `PreToolUse` guard and the
 * in-process ticket server. The agent process runs in its own process group so cleanup can stop it and
 * everything it started.
 *
 * The prompt is a stream the daemon keeps open: with a plain string the runtime closes its input after the
 * first result and kills the agent's background tasks 5 seconds later. A turn that ends with background
 * tasks leaves the session open (`BackgroundSession`), so the runtime can deliver their notifications and
 * the agent runs further turns, until no task is alive and no turn is owed (an empty result, which the
 * runtime sends when two tasks end at the same moment, pays for none); the live tasks are stopped before the
 * session closes.
 */
export function createSdkRunner(options: SdkRunnerOptions = {}): AgentRunner {
  const query = options.query ?? sdkQuery;
  return async (run) => {
    const result = emptyResult();
    result.slashCommands.push(...slashCommandsIn(run.prompt));
    const abortController = new AbortController();
    if (run.abortSignal.aborted) abortController.abort();
    const stderr: string[] = [];

    const sdkOptions: Options = {
      cwd: run.cwd,
      model: run.model,
      effort: run.effort,
      ...(run.resumeSessionId ? { resume: run.resumeSessionId } : {}),
      settingSources: ['user', 'project', 'local'],
      permissionMode: 'dontAsk',
      allowedTools: run.allowedTools,
      ...(run.disallowedTools?.length ? { disallowedTools: run.disallowedTools } : {}),
      mcpServers: run.mcpServers,
      hooks: { PreToolUse: [{ hooks: [run.preToolUse] }] },
      env: { ...run.env, CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' },
      ...(run.maxBudgetUsd ? { maxBudgetUsd: run.maxBudgetUsd } : {}),
      abortController,
      settings: {
        ...(run.enabledMcpjsonServers ? { enabledMcpjsonServers: run.enabledMcpjsonServers } : {}),
        ...(run.disabledMcpjsonServers?.length ? { disabledMcpjsonServers: run.disabledMcpjsonServers } : {}),
        ...(run.deniedMcpServers?.length
          ? { deniedMcpServers: run.deniedMcpServers.map((serverName) => ({ serverName })) }
          : {}),
      },
      ...(run.appendSystemPrompt
        ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: run.appendSystemPrompt } }
        : {}),
      ...(options.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
        : {}),
      stderr: (data) => {
        stderr.push(data);
        if (stderr.length > 50) stderr.shift();
      },
      spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawn(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env as NodeJS.ProcessEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group: cleanup signals the whole tree the agent started.
          detached: true,
        });
        if (child.pid) run.onSpawn?.(child.pid);
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr.push(chunk.toString('utf8'));
          if (stderr.length > 50) stderr.shift();
        });
        spawnOptions.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
        return child as unknown as ReturnType<NonNullable<Options['spawnClaudeCodeProcess']>>;
      },
    };

    const input = createPromptStream();
    input.send(run.prompt);
    const q = query({ prompt: input, options: sdkOptions });
    const session = new BackgroundSession({
      port: {
        send: (text) => input.send(text),
        stopTask: (taskId) => q.stopTask(taskId),
        close: () => input.close(),
      },
      ...(run.backgroundWaitMs !== undefined ? { waitMs: run.backgroundWaitMs } : {}),
      ...(options.backgroundSettleMs !== undefined ? { settleMs: options.backgroundSettleMs } : {}),
      endRequested: () => run.control.endReason !== null,
      ...(run.workDone ? { workDone: run.workDone } : {}),
    });
    /** The abort arrived while the session was still open (mid-turn or waiting for background tasks). */
    let cutShort = false;
    /** The message stream ended while the session was still open: the process went away on its own. */
    let lost = false;
    const onAbort = () => {
      if (!session.closed) cutShort = true;
      // The agent's background tasks are stopped first; then the process goes, as before.
      void session.shutdown().finally(() => abortController.abort());
    };
    if (!run.abortSignal.aborted) run.abortSignal.addEventListener('abort', onAbort, { once: true });
    let interrupted = false;
    const interrupt = () => {
      if (interrupted) return;
      interrupted = true;
      q.interrupt().catch(() => undefined);
    };
    run.control.onEnd(() => {
      result.endedBy = run.control.endReason;
    });
    const lastTextId = { id: null as string | null };
    let initSeen = false;
    try {
      for await (const message of q) {
        if (
          (message.type === 'system' && message.subtype === 'init') ||
          (message.type === 'assistant' && message.parent_tool_use_id === null)
        ) {
          // No turn runs once the daemon closed the session (a reminder that crossed a turn): end here.
          if (session.closed) break;
          session.turnStarted();
        }
        if (run.control.endReason && message.type === 'assistant') interrupt();
        if (message.type === 'assistant') captureAssistant(result.capture, message, run.cwd, lastTextId);
        if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
          session.tasksChanged(message.tasks);
        } else if (message.type === 'system' && message.subtype === 'init') {
          // The runtime sends `init` at the start of every turn; the run's init is the first one.
          if (initSeen) continue;
          initSeen = true;
          result.sessionId = message.session_id;
          result.skillsListed = [...message.skills];
          result.mcpServers = message.mcp_servers.map((server) => ({
            name: server.name,
            status: server.status,
          }));
          result.apiKeySource = message.apiKeySource;
          result.claudeCodeVersion = message.claude_code_version;
          run.onInit?.({
            sessionId: message.session_id,
            skills: [...message.skills],
            mcpServers: message.mcp_servers,
            model: message.model,
            apiKeySource: message.apiKeySource,
            claudeCodeVersion: message.claude_code_version,
          });
        } else if (message.type === 'system' && message.subtype === 'compact_boundary') {
          result.capture.compactions++;
        } else if (message.type === 'system' && message.subtype === 'api_retry') {
          result.apiError = message.error;
        } else if (message.type === 'assistant' && message.error) {
          result.apiError = message.error;
        } else if (message.type === 'user') {
          for (const command of slashCommandsIn(textOf(message))) result.slashCommands.push(command);
        } else if (message.type === 'result') {
          result.sessionId = message.session_id;
          result.resultSubtype = message.subtype;
          result.isError = message.is_error;
          // `total_cost_usd` and `modelUsage` are cumulative over the session's process, so the last result
          // carries the whole run; `num_turns` and `duration_ms` count one turn each and are added up.
          result.totalCostUsd = message.total_cost_usd;
          if (typeof message.num_turns === 'number')
            result.capture.numTurns = (result.capture.numTurns ?? 0) + message.num_turns;
          if (typeof message.duration_ms === 'number')
            result.capture.durationMs = (result.capture.durationMs ?? 0) + message.duration_ms;
          result.modelUsage = Object.fromEntries(
            Object.entries(message.modelUsage).map(([model, usage]) => [
              model,
              { costUSD: usage.costUSD, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
            ]),
          );
          if (message.subtype !== 'success') result.errors.push(...message.errors);
          // Closes the input (after stopping what is still running), or leaves the session open so the
          // runtime can deliver the background tasks' notifications and the agent runs another turn. A result
          // that counts no turn ran nothing: the runtime still owes what it owed before it.
          await session.turnEnded({
            isError: message.is_error || message.subtype !== 'success',
            empty: message.num_turns === 0,
          });
          if (run.control.endReason) break;
        }
      }
    } catch (error) {
      if (run.abortSignal.aborted) result.aborted = true;
      else result.errors.push((error as Error).message);
    } finally {
      run.abortSignal.removeEventListener('abort', onAbort);
      lost = !session.closed;
      // Whatever ended the run, what is still running is stopped before the session goes away.
      await session.shutdown();
      session.dispose();
      q.close();
    }
    if (cutShort) result.aborted = true;
    result.backgroundTasksLeft = session.tasksLeft;
    result.reminded = session.reminded;
    result.endedBy = run.control.endReason;
    // A process that dies during a later turn, or while the session waits for background tasks, leaves the
    // earlier turn's result behind: the run did not end with it.
    const died = lost && result.resultSubtype !== null && !result.endedBy && !result.aborted;
    if (died) result.resultSubtype = null;
    // A run ended by ask_owner / handoff_docs is a normal end even though the turn was interrupted.
    if (result.endedBy) result.isError = false;
    else if (result.resultSubtype === null && !result.aborted) {
      result.isError = true;
      if (result.errors.length === 0)
        result.errors.push(
          stderr.join('').slice(-2_000) ||
            (died ? 'agent process ended while its session was still open' : 'no result message'),
        );
    }
    result.slashCommands = [...new Set(result.slashCommands)];
    return result;
  };
}
