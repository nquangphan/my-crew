import { readFileSync } from 'node:fs';
import type { MacContext } from '../context.js';
import { writeIfChanged } from '../fs-util.js';
import { macPaths } from '../paths.js';
import { parsePendingTccPrompts, TCC_PREDICATE } from '../commands/doctor.js';

const RESULT_RE = /AUTHREQ_RESULT: msgID=([\d.]+),/;
const TIMEOUT_MS = 20_000;

export interface StatusTccPrompt {
  service: string;
  client: string;
  since: string;
  /** ID cần để ghép AUTHREQ_RESULT xuất hiện trong lượt quét tiếp theo. */
  msgId: string;
}

interface StatusTccState {
  scannedUntil: string;
  pending: StatusTccPrompt[];
}

function readState(path: string): StatusTccState | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as StatusTccState;
    if (
      typeof value.scannedUntil === 'string' &&
      Number.isFinite(Date.parse(value.scannedUntil)) &&
      Array.isArray(value.pending) &&
      value.pending.every(
        (prompt) =>
          typeof prompt?.service === 'string' &&
          typeof prompt?.client === 'string' &&
          typeof prompt?.since === 'string' &&
          typeof prompt?.msgId === 'string',
      )
    ) {
      return value;
    }
  } catch {
    // Thiếu state lần đầu hoặc file cũ hỏng: dựng lại từ cửa sổ 24 giờ.
  }
  return null;
}

function asLocalLogTime(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}${zone}`;
}

/** Pure state transition; shares doctor parsing semantics and retains IDs for results arriving later. */
export function updateTccPending(
  current: readonly StatusTccPrompt[],
  logText: string | readonly string[],
): StatusTccPrompt[] {
  const text = typeof logText === 'string' ? logText : logText.join('\n');
  const resultIds = new Set<string>();
  for (const line of text.split('\n')) {
    const result = RESULT_RE.exec(line);
    if (result) resultIds.add(result[1] as string);
  }
  const retained = current.filter((prompt) => !resultIds.has(prompt.msgId));
  const parsed = parsePendingTccPrompts(text).pending;
  const byId = new Map(retained.map((prompt) => [prompt.msgId, prompt]));
  for (const prompt of parsed) {
    byId.set(prompt.msgId, {
      service: prompt.service,
      client: prompt.subject,
      since: new Date(prompt.at.replace(' ', 'T')).toISOString(),
      msgId: prompt.msgId,
    });
  }
  return [...byId.values()];
}

export async function probeStatusTcc(ctx: MacContext): Promise<{
  pending: StatusTccPrompt[];
  check?: { id: string; status: 'warn'; title: string };
}> {
  const paths = macPaths(ctx.home);
  const previous = readState(paths.statusTcc);
  const startedAt = ctx.now();
  const args = [
    'show',
    ...(previous ? ['--start', asLocalLogTime(new Date(Date.parse(previous.scannedUntil) - 5_000))] : ['--last', '24h']),
    '--style',
    'compact',
    '--predicate',
    TCC_PREDICATE,
  ];
  const result = await ctx.runner.run('/usr/bin/log', args, { timeoutMs: TIMEOUT_MS });
  if (result.timedOut || result.code !== 0) {
    return {
      pending: previous?.pending ?? [],
      check: { id: 'tcc-probe', status: 'warn', title: 'Không đọc kịp log TCC' },
    };
  }

  const state: StatusTccState = {
    scannedUntil: startedAt.toISOString(),
    pending: updateTccPending(previous?.pending ?? [], result.stdout),
  };
  writeIfChanged(paths.statusTcc, JSON.stringify(state), 0o600);
  return { pending: state.pending };
}
