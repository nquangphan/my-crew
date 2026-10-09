import { setTimeout as delay } from 'node:timers/promises';
import type { MacContext } from '../context.js';
import { createBridgeClient } from './bridge.js';
import { runGc } from './gc.js';
import { logError } from './log.js';
import { attachmentPaths, isUuid } from './paths.js';
import { renderMarkdown } from './render.js';
import { collectFiles } from './run.js';

const MISSING_ENV = 'files: thiếu PAPERCLIP_API_URL hoặc PAPERCLIP_API_KEY (chỉ chạy trong run Paperclip)';
const INTERNAL_ERROR = 'files: lỗi nội bộ, xem ~/.crew/logs/attachments.log';
const USAGE = 'Cách dùng: crew-mac files --issue <uuid> --run <uuid> [--json]   |   crew-mac files --gc-only';

class FilesUsageError extends Error {}

function parse(argv: readonly string[]) {
  let issue: string | undefined;
  let run: string | undefined;
  let json = false;
  let gcOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--issue' || arg === '--run') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new FilesUsageError(`${arg} cần một giá trị`);
      if (arg === '--issue') issue = value;
      else run = value;
    } else if (arg === '--json') json = true;
    else if (arg === '--gc-only') gcOnly = true;
    else throw new FilesUsageError(`không có tuỳ chọn ${arg}`);
  }
  return { issue, run, json, gcOnly };
}

/** `crew-mac files`: 0 kể cả khi có file bị chặn; 2 khi đối số/môi trường sai; 1 khi lỗi nội bộ. */
export async function filesCommand(
  ctx: MacContext,
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: { out(s: string): void; err(s: string): void },
): Promise<number> {
  const paths = attachmentPaths(ctx.home);
  let runId = '-';
  try {
    const flags = parse(argv);
    if (flags.gcOnly) {
      const report = await runGc(paths, { now: ctx.now(), currentRunId: null });
      io.out(`Đã dọn: ${report.removedRuns} run, ${report.removedBlobs} blob`);
      return 0;
    }
    if (!flags.issue || !isUuid(flags.issue)) throw new FilesUsageError('--issue cần UUID của issue');
    if (!flags.run || !isUuid(flags.run)) throw new FilesUsageError('--run cần UUID của run');
    runId = flags.run;
    const url = env.PAPERCLIP_API_URL;
    const key = env.PAPERCLIP_API_KEY;
    if (!url || !key) {
      io.err(MISSING_ENV);
      return 2;
    }
    const manifest = await collectFiles(
      {
        ctx,
        bridge: createBridgeClient({ PAPERCLIP_API_URL: url, PAPERCLIP_API_KEY: key }),
        runner: ctx.runner,
        sleep: (ms) => delay(ms),
      },
      { issueId: flags.issue, runId: flags.run },
    );
    io.out(flags.json ? JSON.stringify(manifest, null, 2) : renderMarkdown(manifest));
    return 0;
  } catch (error) {
    if (error instanceof FilesUsageError) {
      io.err(`files: ${error.message}\n${USAGE}`);
      return 2;
    }
    logError(paths, ctx.now(), runId, error);
    io.err(INTERNAL_ERROR);
    return 1;
  }
}
