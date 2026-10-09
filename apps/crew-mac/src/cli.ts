#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BMAD_USAGE, bmadCommand } from './commands/bmad.js';
import { type CheckStatus, doctor } from './commands/doctor.js';
import { setup } from './commands/setup.js';
import {
  addStatusRepo,
  configureStatus,
  listStatusRepos,
  removeStatusRepo,
  StatusSendError,
  sendStatus,
  setStatusSecret,
} from './commands/status.js';
import { formatStopLine, RUN_ID_UUID, StopRunInputError, stopRun } from './commands/stop-run.js';
import { uninstall } from './commands/uninstall.js';
import { runInitCheck, workflowCheck } from './commands/workflow-check.js';
import { WORKFLOWS_USAGE, workflowsCommand } from './commands/workflows.js';
import type { MacContext } from './context.js';
import { createMacContext } from './context-factory.js';
import { filesCommand } from './files/command.js';
import { type Manifest, readManifest } from './manifest.js';
import { DEFAULT_PORT, macPaths, SSHD_LABEL } from './paths.js';
import { reapOnce } from './reaper/reap.js';
import { resolveSshdOwner, type SshdOwner } from './sshd-owner.js';
import { addTarget, listTargets } from './status/targets.js';
import { gcWorkflowPins } from './workflows/workflow-gc.js';

export const USAGE = `crew-mac: cài và kiểm Mac chạy agent cho Crew v3

Cách dùng:
  crew-mac setup --paperclip-key <file .pub | chuỗi key> [--port 2222] [--worktree-root <thư mục>]
                 [--sshd-owner app|launchd] [--force]
                 --sshd-owner: ai giữ sshd agent (không truyền thì giữ chủ hiện tại); chỉ đổi khi không còn run,
                 --force bỏ qua kiểm run và phiên sshd agent
  crew-mac doctor [--no-probe] [--tcc-window 24h] [--probe-timeout 90]
  crew-mac status config --url <Paperclip origin> --company <UUID>
  crew-mac status set-secret   (đọc một dòng từ stdin)
  crew-mac status send
  crew-mac status add-target --company <UUID> [--url <Paperclip origin>] --secret-stdin
                 (thêm company nhận bản tin máy; secret webhook của company đọc một dòng từ stdin)
  crew-mac status list-targets
  crew-mac status add-repo <projectId> <đường dẫn repo tuyệt đối> [--company <UUID>]
  crew-mac status remove-repo <projectId>
  crew-mac status list-repos
  crew-mac uninstall [--force]      --force: bỏ qua kiểm phiên sshd agent và run Paperclip đang chạy
  crew-mac reap [--grace-seconds 60] [--dry-run]
  crew-mac stop-run --run-id <uuid> --root <worktree tuyệt đối> [--term-wait-seconds 5]
  crew-mac workflow-check --root <worktree tuyệt đối> --plugin-dir <thư mục tuyệt đối>   (wrapper gọi trước mỗi run)
  crew-mac run-init-check --root <worktree tuyệt đối> --log <file stream-json | ->   (kiểm system/init của một run)
  crew-mac files --issue <uuid> --run <uuid> [--json]   (agent gọi trong run Paperclip: liệt kê file đính kèm của issue và issue cha)
  crew-mac files --gc-only   (chỉ dọn cache file đính kèm)
  ${WORKFLOWS_USAGE}   (xem, cài riêng bản ghim workflow; không đụng sshd)
  ${BMAD_USAGE}
                 (agent BMAD và Trợ Lý gọi: đọc file epic/story, dựng _bmad cho repo dự án)

Chạy setup và uninstall trong Terminal trên màn hình Mac (phiên desktop), không chạy qua sshd agent.`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** Test hook: ghi đè từng phần của context. */
  context?: Partial<MacContext>;
  /** Test hook: thay đọc stdin (mặc định đọc hết fd 0). */
  readStdin?: () => string;
}

class UsageError extends Error {}

/**
 * Thời gian chờ sau TERM của stop-run: mặc định và tối đa. Phía server truyền 3 giây và chờ cả lệnh khoảng 12 giây.
 */
const DEFAULT_TERM_WAIT_SECONDS = 5;
const MAX_TERM_WAIT_SECONDS = 20;

/** Mã thoát khi workflow bị chặn (EX_CONFIG); wrapper cũng thoát mã này. */
const WORKFLOW_BLOCKED_EXIT = 78;

/** Ngưỡng mồ côi thấp nhất: ngắn hơn thì dễ dọn nhầm run vừa mất mạng chốc lát. */
const MIN_GRACE_SECONDS = 60;

function parseFlags(
  args: readonly string[],
  valueFlags: readonly string[],
  boolFlags: readonly string[] = [],
) {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} cần một giá trị`);
      flags.set(arg, value);
    } else if (boolFlags.includes(arg)) {
      flags.set(arg, true);
    } else {
      throw new UsageError(`không có tuỳ chọn ${arg}`);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  const number = (flag: string) => {
    const v = value(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UsageError(`${flag} cần một số`);
    return n;
  };
  return { has: (flag: string) => flags.has(flag), value, number };
}

function manifestOrNull(path: string): Manifest | null {
  try {
    return readManifest(path);
  } catch {
    return null;
  }
}

export function sshServerPort(env: NodeJS.ProcessEnv): number | null {
  const parts = env.SSH_CONNECTION?.trim().split(/\s+/);
  if (parts?.length !== 4) return null;
  const port = Number(parts[3]);
  return Number.isInteger(port) ? port : null;
}

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'ĐẠT', warn: 'CẢNH BÁO', fail: 'LỖI' };

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  const readStdin = io.readStdin ?? (() => readFileSync(0, 'utf8'));
  try {
    const ctx: MacContext = {
      ...createMacContext({
        env: io.env,
        out: io.out,
        cliPath: realpathSync(fileURLToPath(import.meta.url)),
      }),
      ...io.context,
    };
    switch (command) {
      case 'status': {
        const [subcommand, ...rest] = args;
        if (subcommand === 'config') {
          const flags = parseFlags(rest, ['--url', '--company']);
          const url = flags.value('--url');
          const companyId = flags.value('--company');
          if (!url) throw new UsageError('--url là bắt buộc');
          if (!companyId) throw new UsageError('--company là bắt buộc');
          const config = configureStatus(ctx, url, companyId);
          io.out(`Đã cấu hình máy ${config.machineId}.`);
          return 0;
        }
        if (subcommand === 'set-secret') {
          if (rest.length > 0) throw new UsageError('set-secret không nhận đối số');
          await setStatusSecret(ctx, readStdin());
          io.out('Đã lưu secret vào Keychain.');
          return 0;
        }
        if (subcommand === 'send') {
          if (rest.length > 0) throw new UsageError('send không nhận đối số');
          await sendStatus(ctx);
          return 0;
        }
        if (subcommand === 'add-target') {
          const flags = parseFlags(rest, ['--company', '--url'], ['--secret-stdin']);
          const companyId = flags.value('--company');
          if (!companyId) throw new UsageError('--company là bắt buộc');
          if (!flags.has('--secret-stdin'))
            throw new UsageError(
              '--secret-stdin là bắt buộc: secret chỉ đọc từ stdin, không truyền trên dòng lệnh',
            );
          const target = await addTarget(ctx, { companyId, url: flags.value('--url'), secret: readStdin() });
          io.out(`Đã thêm đích ${target.companyId} (${target.url}).`);
          return 0;
        }
        if (subcommand === 'list-targets') {
          if (rest.length !== 0) throw new UsageError('list-targets không nhận đối số');
          for (const target of listTargets(ctx))
            io.out(`${target.companyId}\t${target.url}\t${target.keychainService}`);
          return 0;
        }
        if (subcommand === 'add-repo') {
          const [projectId, path, ...extra] = rest;
          if (!projectId || !path) throw new UsageError('add-repo cần projectId và đường dẫn repo');
          const company = parseFlags(extra, ['--company']).value('--company');
          addStatusRepo(ctx, projectId, path, company);
          io.out('Đã thêm repo.');
          return 0;
        }
        if (subcommand === 'remove-repo') {
          if (rest.length !== 1) throw new UsageError('remove-repo cần projectId');
          removeStatusRepo(ctx, rest[0] as string);
          io.out('Đã gỡ repo.');
          return 0;
        }
        if (subcommand === 'list-repos') {
          if (rest.length !== 0) throw new UsageError('list-repos không nhận đối số');
          for (const repo of listStatusRepos(ctx))
            io.out(`${repo.projectId}\t${repo.path}\t${repo.lastCommit ?? 'chưa gửi'}`);
          return 0;
        }
        throw new UsageError(
          'status cần config, set-secret, add-target, list-targets, send, add-repo, remove-repo hoặc list-repos',
        );
      }
      case 'setup': {
        const flags = parseFlags(
          args,
          ['--paperclip-key', '--port', '--worktree-root', '--sshd-owner'],
          ['--force'],
        );
        const key = flags.value('--paperclip-key');
        const ownerFlag = flags.value('--sshd-owner');
        if (ownerFlag !== undefined && ownerFlag !== 'app' && ownerFlag !== 'launchd')
          throw new UsageError('--sshd-owner chỉ nhận app hoặc launchd');
        const sshdOwner = ownerFlag as SshdOwner | undefined;
        const current = manifestOrNull(macPaths(ctx.home).manifest);
        const sshPort = sshServerPort(io.env);
        const agentPort = current?.port ?? DEFAULT_PORT;
        if (
          sshdOwner !== undefined &&
          resolveSshdOwner(current, sshdOwner) !== resolveSshdOwner(current, undefined) &&
          sshPort !== null &&
          (sshPort === agentPort || sshPort === DEFAULT_PORT) &&
          !flags.has('--force')
        ) {
          io.err(
            `crew-mac: phiên này chạy qua chính sshd agent (cổng ${sshPort}); đổi chủ sshd sẽ cắt phiên này giữa chừng. ` +
              'Chạy trong Terminal trên màn hình Mac, hoặc thêm --force nếu chắc chắn (--force bỏ qua CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip).',
          );
          return 2;
        }
        const report = await setup(ctx, {
          paperclipKey: key === undefined ? undefined : existsSync(key) ? readFileSync(key, 'utf8') : key,
          port: flags.number('--port'),
          worktreeRoot: flags.value('--worktree-root'),
          sshdOwner,
          force: flags.has('--force'),
        });
        const m = report.manifest;
        io.out(`sshd agent nghe ${m.listenAddress}:${m.port}; thư mục worktree ${m.worktreeRoot}.`);
        io.out(
          m.sshdOwner === 'app'
            ? 'Chủ sshd agent: app 2P Crew. App đang mở tự nạp lại cấu hình khi manifest đổi cổng/IP (dừng listener cũ, ' +
                'sinh lại; phiên SSH đang chạy giữ nguyên); app chưa mở thì listener lên khi mở app.'
            : `Chủ sshd agent: LaunchAgent ${SSHD_LABEL}.`,
        );
        if (m.sshdOwner === 'app' && report.changed.includes(macPaths(ctx.home).sshdConfig))
          io.out(
            `Cấu hình sshd đã đổi sang ${m.listenAddress}:${m.port}: app 2P Crew đang mở sẽ dừng listener cũ và sinh lại ` +
              'theo cấu hình mới. Kiểm bằng "crew-mac doctor".',
          );
        if (report.sshdHandoff !== 'unchanged')
          io.out(
            report.sshdHandoff === 'app'
              ? 'Đã chuyển sshd agent sang app 2P Crew.'
              : 'Đã trả sshd agent về LaunchAgent.',
          );
        io.out(
          report.changed.length === 0
            ? 'Không có file nào thay đổi.'
            : `Đã ghi: ${report.changed.join(', ')}`,
        );
        if (report.restarted.length > 0) io.out(`Đã nạp lại: ${report.restarted.join(', ')}`);
        io.out(`Agent claude_local: đặt adapterConfig.command = ${macPaths(ctx.home).wrapper}`);
        io.out(
          `Agent claude_local: đặt adapterConfig.extraArgs = ${JSON.stringify(report.superpowers.extraArgs)}`,
        );
        io.out(
          `Agent BMAD (vai bmad): đặt adapterConfig.extraArgs = ${JSON.stringify(report.bmad.extraArgs)}`,
        );
        io.out('Chạy "crew-mac doctor" để kiểm toàn bộ.');
        return 0;
      }
      case 'doctor': {
        const flags = parseFlags(args, ['--tcc-window', '--probe-timeout'], ['--no-probe']);
        const results = await doctor(ctx, {
          probe: !flags.has('--no-probe'),
          tccWindow: flags.value('--tcc-window') ?? '24h',
          probeTimeoutSec: flags.number('--probe-timeout') ?? 90,
        });
        for (const r of results) {
          io.out(`[${STATUS_LABEL[r.status]}] ${r.title}: ${r.detail}`);
          if (r.hint && r.status !== 'ok') io.out(`    → ${r.hint}`);
        }
        return results.some((r) => r.status === 'fail') ? 1 : 0;
      }
      case 'uninstall': {
        const flags = parseFlags(args, [], ['--force']);
        const sshPort = sshServerPort(io.env);
        const agentPort = (() => {
          try {
            return readManifest(macPaths(ctx.home).manifest)?.port ?? DEFAULT_PORT;
          } catch {
            return DEFAULT_PORT;
          }
        })();
        if (
          sshPort !== null &&
          (sshPort === agentPort || sshPort === DEFAULT_PORT) &&
          !flags.has('--force')
        ) {
          io.err(
            `crew-mac: phiên này đi qua sshd cổng ${sshPort}; uninstall sẽ cắt chính phiên này giữa chừng. ` +
              'Chạy trong Terminal trên màn hình Mac, hoặc thêm --force nếu chắc chắn (--force bỏ qua CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip).',
          );
          return 2;
        }
        const report = await uninstall(ctx, { force: flags.has('--force') });
        io.out(report.removed.length === 0 ? 'Không còn gì để gỡ.' : `Đã gỡ: ${report.removed.join(', ')}`);
        for (const note of report.notes ?? []) io.out(note);
        for (const kept of report.kept)
          io.out(`Giữ nguyên thư mục worktree ${kept} (có thể còn việc của agent).`);
        return 0;
      }
      case 'stop-run': {
        const flags = parseFlags(args, ['--run-id', '--root', '--term-wait-seconds']);
        const runId = flags.value('--run-id');
        const root = flags.value('--root');
        const waitSeconds = flags.number('--term-wait-seconds') ?? DEFAULT_TERM_WAIT_SECONDS;
        if (!runId || !RUN_ID_UUID.test(runId)) throw new UsageError('--run-id phải là UUID');
        if (!root || !isAbsolute(root)) throw new UsageError('--root phải là đường dẫn tuyệt đối');
        if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_TERM_WAIT_SECONDS) {
          throw new UsageError(`--term-wait-seconds phải là số nguyên 0–${MAX_TERM_WAIT_SECONDS}`);
        }
        const manifest = manifestOrNull(macPaths(ctx.home).manifest);
        if (manifest === null) {
          throw new UsageError('chưa chạy "crew-mac setup" trên máy này (không biết thư mục worktree)');
        }
        const result = await stopRun(
          {
            runner: ctx.runner,
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: ctx.now,
            selfPid: process.pid,
          },
          { runId, root, termWaitMs: waitSeconds * 1000, allowedRoot: manifest.worktreeRoot, home: ctx.home },
        );
        io.out(formatStopLine(result));
        return 0;
      }
      case 'reap': {
        const flags = parseFlags(args, ['--grace-seconds'], ['--dry-run']);
        const graceSeconds = flags.number('--grace-seconds') ?? MIN_GRACE_SECONDS;
        if (graceSeconds < MIN_GRACE_SECONDS) {
          throw new UsageError(`--grace-seconds tối thiểu ${MIN_GRACE_SECONDS} (giây mồ côi trước khi dọn)`);
        }
        const paths = macPaths(ctx.home);
        const targets = await reapOnce(
          {
            runner: ctx.runner,
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: ctx.now,
            selfPid: process.pid,
            gcWorkflowPins: () => gcWorkflowPins(ctx),
          },
          {
            graceMs: graceSeconds * 1000,
            termWaitMs: 10_000,
            dryRun: flags.has('--dry-run'),
            statePath: paths.reaperState,
            logPath: paths.reaperLog,
            worktreeRoot: manifestOrNull(paths.manifest)?.worktreeRoot ?? null,
            home: ctx.home,
            workflowsGcStampPath: paths.workflowsGcStamp,
          },
        );
        if (targets.length > 0)
          io.out(`Đã xử lý ${targets.length} run mồ côi; chi tiết ở ${paths.reaperLog}.`);
        return 0;
      }
      case 'workflow-check': {
        const flags = parseFlags(args, ['--root', '--plugin-dir']);
        const root = flags.value('--root');
        const pluginDir = flags.value('--plugin-dir');
        if (!root || !isAbsolute(root)) throw new UsageError('--root phải là đường dẫn tuyệt đối');
        if (!pluginDir || !isAbsolute(pluginDir))
          throw new UsageError('--plugin-dir phải là đường dẫn tuyệt đối');
        const report = await workflowCheck(ctx, { root, pluginDir });
        for (const line of report.lines) (report.ok ? io.out : io.err)(line);
        return report.ok ? 0 : WORKFLOW_BLOCKED_EXIT;
      }
      case 'run-init-check': {
        const flags = parseFlags(args, ['--root', '--log']);
        const root = flags.value('--root');
        const log = flags.value('--log');
        if (!root || !isAbsolute(root)) throw new UsageError('--root phải là đường dẫn tuyệt đối');
        if (!log) throw new UsageError('--log cần file stream-json của run (hoặc - để đọc stdin)');
        const report = await runInitCheck(ctx, { root, log: readFileSync(log === '-' ? 0 : log, 'utf8') });
        for (const line of report.lines) (report.ok ? io.out : io.err)(line);
        return report.ok ? 0 : WORKFLOW_BLOCKED_EXIT;
      }
      case 'workflows':
        return await workflowsCommand(ctx, args, io.err);
      case 'bmad':
        return await bmadCommand(ctx, args, io.err);
      case 'files':
        return await filesCommand(ctx, args, io.env, { out: io.out, err: io.err });
      default:
        throw new UsageError(command === undefined ? 'thiếu lệnh' : `không có lệnh ${command}`);
    }
  } catch (error) {
    if (error instanceof StatusSendError) return 1;
    if (error instanceof StopRunInputError) {
      io.err(`crew-mac: ${error.message}`);
      return 2;
    }
    if (error instanceof UsageError) {
      io.err(`crew-mac: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.err(`crew-mac: ${(error as Error).message}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      process.stderr.write(`crew-mac: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
