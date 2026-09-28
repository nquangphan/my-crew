import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { parse } from 'yaml';
import { z } from 'zod';
import { mcpToolPrefix } from '../runner/skill-usage.js';
import { TICKET_SERVER } from '../tools/tool-scopes.js';
import { type AgentRunner, type AgentRunResult, emptyResult, type RunAgentOptions } from './agent-runner.js';

const Step = z.union([
  z.object({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) }).strict(),
  z.object({ bash: z.string().min(1), timeoutMs: z.number().int().positive().optional() }).strict(),
  z.object({ write: z.object({ path: z.string().min(1), content: z.string() }) }).strict(),
  z.object({ skill: z.string().min(1) }).strict(),
  z.object({ sleep: z.number().int().min(0).max(600_000) }).strict(),
  /** Ends the run like the CLI after its own retries failed with this API error class. */
  z.object({ apiError: z.string().min(1) }).strict(),
  z.object({ fail: z.string().min(1) }).strict(),
  /** Simulates the daemon dying mid-run: the runner throws `ScriptedCrash` and records nothing more. */
  z.object({ crash: z.literal(true) }).strict(),
]);
export type ScriptStep = z.infer<typeof Step>;

export const Script = z.object({
  /** Skill names the fake `system/init` lists. */
  skills: z.array(z.string()).default([]),
  mcpServers: z.array(z.object({ name: z.string(), status: z.string() })).default([]),
  steps: z.array(Step).default([]),
  result: z
    .object({ subtype: z.string().default('success'), costUsd: z.number().min(0).default(0) })
    .prefault({}),
});
export type Script = z.infer<typeof Script>;
export type ScriptInput = z.input<typeof Script>;

/** Thrown by a `crash` step: stands in for the daemon process dying in the middle of a run. */
export class ScriptedCrash extends Error {
  constructor() {
    super('scripted crash');
    this.name = 'ScriptedCrash';
  }
}

export interface ScriptedRunnerOptions {
  /** The script for a run (YAML text or a parsed script), e.g. chosen by ticket, role and trigger. */
  script: (run: RunAgentOptions) => string | ScriptInput | Promise<string | ScriptInput>;
  /** Where fake sessions keep their progress, so `resume` continues after the last completed step. */
  sessionsDir: string;
  /**
   * Fills in a step's input right before it runs (e.g. the id of a ticket an earlier step created). Tool
   * inputs and Bash commands pass through it.
   */
  resolve?: (
    input: Record<string, unknown>,
    run: RunAgentOptions,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

function loadScript(source: string | ScriptInput): Script {
  return Script.parse(typeof source === 'string' ? (parse(source) ?? {}) : source);
}

/**
 * A fake session: its cumulative cost, and per job how many steps completed. Resuming the same job (after
 * a restart) continues after its last completed step; a new job on the session (a new prompt) starts over.
 */
interface SessionState {
  costUsd: number;
  completed: Record<string, number>;
}

function readSession(dir: string, id: string): SessionState {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return { costUsd: 0, completed: {} };
  return JSON.parse(readFileSync(file, 'utf8')) as SessionState;
}

function writeSession(dir: string, id: string, state: SessionState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(state));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolveSleep();
      },
      { once: true },
    );
  });

/** A tool call as the scripted step expresses it. */
function toolCall(step: ScriptStep): { tool: string; input: Record<string, unknown> } | null {
  if ('tool' in step) return { tool: step.tool, input: step.input };
  if ('bash' in step) return { tool: 'Bash', input: { command: step.bash } };
  if ('write' in step)
    return { tool: 'Write', input: { file_path: step.write.path, content: step.write.content } };
  if ('skill' in step) return { tool: 'Skill', input: { skill: step.skill } };
  return null;
}

/**
 * Test double with the `runAgent` interface: replays tool calls from a YAML script through the same guard
 * hook, tool log and ticket tools a real run uses, and really runs Bash and file writes in the job's cwd
 * with the job env. For CI lifecycle tests only; production uses the SDK runner.
 */
export function createScriptedRunner(options: ScriptedRunnerOptions): AgentRunner {
  return async (run) => {
    const script = loadScript(await options.script(run));
    const result: AgentRunResult = emptyResult();
    const sessionId = run.resumeSessionId ?? `scripted-${randomUUID()}`;
    const session = run.resumeSessionId
      ? readSession(options.sessionsDir, sessionId)
      : { costUsd: 0, completed: {} };
    result.sessionId = sessionId;
    result.skillsListed = script.skills;
    result.mcpServers = script.mcpServers;
    run.onInit?.({
      sessionId,
      skills: script.skills,
      mcpServers: script.mcpServers,
      model: run.model,
      apiKeySource: 'none',
      claudeCodeVersion: 'scripted',
    });
    const ticketPrefix = mcpToolPrefix(TICKET_SERVER);
    let spawnedGroup = false;

    for (let index = session.completed[run.jobId] ?? 0; index < script.steps.length; index++) {
      if (run.abortSignal.aborted) {
        result.aborted = true;
        break;
      }
      const step = script.steps[index] as ScriptStep;
      if ('crash' in step) throw new ScriptedCrash();
      if ('sleep' in step) {
        await sleep(step.sleep, run.abortSignal);
      } else if ('apiError' in step) {
        result.apiError = step.apiError;
        result.isError = true;
        result.resultSubtype = 'error_during_execution';
        result.errors.push(`API error: ${step.apiError}`);
        break;
      } else if ('fail' in step) {
        result.isError = true;
        result.resultSubtype = 'error_during_execution';
        result.errors.push(step.fail);
        break;
      } else {
        const planned = toolCall(step);
        if (!planned) continue;
        const call = options.resolve
          ? { tool: planned.tool, input: await options.resolve(planned.input, run) }
          : planned;
        const hookInput: PreToolUseHookInput = {
          hook_event_name: 'PreToolUse',
          session_id: sessionId,
          transcript_path: '',
          cwd: run.cwd,
          tool_name: call.tool,
          tool_input: call.input,
          tool_use_id: `${sessionId}-${index}`,
        };
        const verdict = await run.preToolUse(hookInput, hookInput.tool_use_id, { signal: run.abortSignal });
        const denied =
          'hookSpecificOutput' in verdict &&
          verdict.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
          verdict.hookSpecificOutput.permissionDecision === 'deny';
        const allowed = run.allowedTools.some(
          (pattern) =>
            pattern === call.tool || (pattern.endsWith('*') && call.tool.startsWith(pattern.slice(0, -1))),
        );
        if (!denied && allowed) {
          if (call.tool === 'Bash') {
            const pid = await runBash(
              run,
              String(call.input.command),
              'bash' in step ? step.timeoutMs : undefined,
            );
            if (pid && !spawnedGroup) {
              spawnedGroup = true;
              run.onSpawn?.(pid);
            }
          } else if (call.tool === 'Write') {
            const target = resolve(run.cwd, String(call.input.file_path));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, String(call.input.content));
          } else if (call.tool === 'Edit') {
            applyEdit(run.cwd, call.input);
          } else if (call.tool.startsWith(ticketPrefix)) {
            const name = call.tool.slice(ticketPrefix.length);
            const definition = run.ticketTools.find((tool) => tool.name === name);
            if (definition) await definition.handler(z.object(definition.inputSchema).parse(call.input), {});
          }
        }
      }
      session.completed[run.jobId] = index + 1;
      writeSession(options.sessionsDir, sessionId, session);
      if (run.control.endReason) break;
    }

    result.endedBy = run.control.endReason;
    if (!result.isError && !result.aborted) result.resultSubtype = script.result.subtype;
    if (result.resultSubtype && result.resultSubtype !== 'success' && !result.endedBy) result.isError = true;
    // Like the SDK, a resumed session's final cost already includes its earlier spend.
    session.costUsd += result.aborted ? 0 : script.result.costUsd;
    writeSession(options.sessionsDir, sessionId, session);
    result.totalCostUsd = session.costUsd;
    return result;
  };
}

/** Replays an Edit like Claude Code: `old_string` must be found (once, unless `replace_all`). */
function applyEdit(cwd: string, input: Record<string, unknown>): void {
  const target = resolve(cwd, String(input.file_path));
  const oldString = String(input.old_string);
  const newString = String(input.new_string);
  const text = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (!text.includes(oldString)) throw new Error(`scripted Edit: old_string not found in ${input.file_path}`);
  writeFileSync(
    target,
    input.replace_all === true
      ? text.split(oldString).join(newString)
      : text.replace(oldString, () => newString),
  );
}

/** Runs one Bash step in its own process group with the job env; resolves with the shell's pid. */
function runBash(run: RunAgentOptions, command: string, timeoutMs = 60_000): Promise<number | undefined> {
  return new Promise((resolveRun) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: run.cwd,
      env: run.env as NodeJS.ProcessEnv,
      stdio: 'ignore',
      detached: true,
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolveRun(child.pid);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolveRun(child.pid);
    });
  });
}
