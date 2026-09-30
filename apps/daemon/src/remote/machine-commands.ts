import {
  type JobView,
  MACHINE_COMMAND_LABEL,
  MACHINE_COMMAND_TIMEOUT_MS,
  type MachineCommandAction,
  type MachineCommandParsed,
  MachineCommandRequest,
} from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import { scrubSecrets } from '../runner/secret-scrubber.js';
import type { JobRow } from '../state-db.js';

/** One handler per action the machine can perform; each resolves to the action's result. */
export type MachineCommandHandlers = {
  [A in MachineCommandAction]?: (request: Extract<MachineCommandParsed, { action: A }>) => Promise<unknown>;
};

export interface MachineCommandRunnerDeps {
  vps: VpsClient;
  handlers: () => MachineCommandHandlers;
  log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} chạy quá ${Math.round(ms / 1000)} giây`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs one command the owner sent from the web: takes it on the server (an expired or already-ended command
 * is skipped), validates it again with the shared whitelist, runs its handler with the action's time limit,
 * and reports the result or the error (scrubbed of secrets). Never throws.
 */
export async function runMachineCommand(deps: MachineCommandRunnerDeps, commandId: string): Promise<void> {
  const { vps, log } = deps;
  let action: string;
  let params: Record<string, unknown>;
  try {
    const command = await vps.startCommand(commandId, `command-start:${commandId}`);
    action = command.action;
    params = command.params;
  } catch (error) {
    log('info', 'machine command skipped', { commandId, error: (error as Error).message });
    return;
  }
  const report = async (body: { ok: true; result: unknown } | { ok: false; error: string }) => {
    try {
      await vps.finishCommand(commandId, body, `command-result:${commandId}`);
    } catch (error) {
      log('warn', 'machine command result not delivered', { commandId, error: (error as Error).message });
    }
  };
  const parsed = MachineCommandRequest.safeParse({ ...params, action });
  if (!parsed.success) {
    await report({ ok: false, error: 'Thao tác không nằm trong danh sách được phép của máy này.' });
    return;
  }
  const request = parsed.data;
  const handler = deps.handlers()[request.action] as
    | ((input: MachineCommandParsed) => Promise<unknown>)
    | undefined;
  if (!handler) {
    await report({
      ok: false,
      error: `Máy này không làm được "${MACHINE_COMMAND_LABEL[request.action]}" (chỉ app 2P Crew trên máy làm được).`,
    });
    return;
  }
  log('info', 'machine command', { commandId, action: request.action });
  try {
    const result = await withTimeout(
      handler(request),
      MACHINE_COMMAND_TIMEOUT_MS[request.action],
      MACHINE_COMMAND_LABEL[request.action],
    );
    await report({ ok: true, result });
  } catch (error) {
    const text = scrubSecrets((error as Error).message || String(error)).text.slice(0, 2_000);
    log('warn', 'machine command failed', { commandId, action: request.action, error: text });
    await report({ ok: false, error: text || 'Thao tác lỗi.' });
  }
}

/** A job row as the web's job list shows it (ticket key and title when known). */
export function jobView(job: JobRow, ticket: { key: string; title: string } | null): JobView {
  return {
    id: job.id,
    ticketId: job.ticketId,
    ticketKey: ticket?.key ?? null,
    ticketTitle: ticket?.title ?? null,
    status: job.status,
    role: job.role,
    kind: job.kind,
    model: job.model,
    effort: job.effort,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    retryAt: job.retryAt,
    costUsd: job.costUsd,
    error: job.error ? scrubSecrets(job.error).text.slice(0, 2_000) : null,
    webUrl: null,
  };
}
