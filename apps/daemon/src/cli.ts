#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectPlatform } from '@crew/shared';
import { VpsClient, VpsError } from './api/vps-client.js';
import { doctor } from './commands/doctor.js';
import {
  ConfigError,
  crewHome,
  type DaemonConfig,
  type DaemonConfigInput,
  homePaths,
  loadConfig,
  saveConfig,
} from './config.js';
import { createDaemon } from './daemon.js';
import { execCommand } from './health/health-runner.js';
import { defaultTokenStore, type TokenStore } from './secrets.js';
import { installService } from './service/systemd.js';
import { StateDb } from './state-db.js';

export const DEFAULT_API_URL = 'https://crew.2p-solutions.com';

export const USAGE = `crewd: daemon 2P Crew

Cách dùng:
  crewd pair --code <MÃ> [--api <url>] [--name <tên máy>]   ghép máy với VPS
  crewd start                                               chạy daemon (tiền cảnh)
  crewd status                                              trạng thái daemon và job
  crewd rotate-token                                        đổi token máy
  crewd doctor [--no-fix] [--no-login-probe]                kiểm tra sức khỏe (và tự sửa hook)
  crewd install-service                                     cài systemd user unit (Linux)
  crewd project add --key <KEY> --path <thư mục> [--branch <nhánh>] [--test-command <lệnh>]
  crewd project create --key <KEY> --name <tên> --description <mô tả> --platform <web|mobile|web_mobile|backend>
                       --path <thư mục> [--repo-url <url>] [--branch <nhánh>]
  crewd project release --key <KEY>
  crewd assistant on|off                                    nhận hoặc trả vai trò trợ lý

Biến môi trường: CREW_HOME (mặc định ~/.crew), CREW_TOKEN_STORE=file (không dùng Keychain).`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  /** Test hook: token store override. */
  tokenStore?: TokenStore;
  /** Test hook: resolves when `start` should stop (defaults to SIGINT/SIGTERM). */
  untilStopped?: () => Promise<void>;
}

class UsageError extends Error {}

function parseFlags(
  args: readonly string[],
  valueFlags: readonly string[],
  boolFlags: readonly string[] = [],
) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} cần một giá trị`);
      flags.set(arg, value);
    } else if (boolFlags.includes(arg)) {
      flags.set(arg, true);
    } else if (arg.startsWith('--')) {
      throw new UsageError(`không có tuỳ chọn ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  const required = (flag: string) => {
    const v = value(flag);
    if (!v) throw new UsageError(`thiếu ${flag}`);
    return v;
  };
  return { flags, positional, value, required };
}

function git(cwd: string, args: string[]): string | null {
  const run = execCommand('git', ['-C', cwd, ...args]);
  return run.code === 0 ? run.stdout.trim() : null;
}

function repoFolder(path: string): string {
  const abs = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(abs)) throw new UsageError(`${abs} không tồn tại`);
  const top = git(abs, ['rev-parse', '--show-toplevel']);
  if (!top) throw new UsageError(`${abs} không phải repo git`);
  return realpathSync(top);
}

interface Context {
  home: string;
  paths: ReturnType<typeof homePaths>;
  tokenStore: TokenStore;
}

function loadOrFail(ctx: Context): DaemonConfig {
  return loadConfig(ctx.paths.config);
}

function client(ctx: Context, config: DaemonConfig): VpsClient {
  return new VpsClient({ apiUrl: config.apiUrl, token: () => ctx.tokenStore.get() });
}

async function pair(ctx: Context, args: string[], io: CliIo): Promise<number> {
  const { value, required } = parseFlags(args, ['--code', '--api', '--name']);
  const existing = existsSync(ctx.paths.config) ? loadConfig(ctx.paths.config) : null;
  const apiUrl = value('--api') ?? existing?.apiUrl ?? DEFAULT_API_URL;
  const machineName = value('--name') ?? existing?.machineName ?? hostname().replace(/\.local$/, '');
  const vps = new VpsClient({ apiUrl, token: () => null });
  const paired = await vps.pair({
    code: required('--code'),
    name: machineName,
    hostname: hostname(),
    os: `${platform()} ${release()}`,
    hardware: { cpus: Math.max(1, cpus().length), memGb: Math.round(totalmem() / 1024 ** 3), arch: arch() },
  });
  ctx.tokenStore.set(paired.token);
  const next: DaemonConfigInput = { ...(existing ?? {}), apiUrl, machineName, machineId: paired.machineId };
  saveConfig(ctx.paths.config, next);
  io.out(
    `Đã ghép máy "${machineName}" (${paired.machineId}). Token lưu trong ${ctx.tokenStore.kind === 'keychain' ? 'Keychain' : ctx.paths.tokenFile}, hết hạn ${paired.expiresAt}.`,
  );
  return 0;
}

async function rotateToken(ctx: Context, io: CliIo): Promise<number> {
  const config = loadOrFail(ctx);
  const rotated = await client(ctx, config).rotateToken();
  ctx.tokenStore.set(rotated.token);
  io.out(`Đã đổi token, hết hạn ${rotated.expiresAt}. Token cũ còn dùng được tối đa 10 phút.`);
  return 0;
}

function pidAlive(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function status(ctx: Context, io: CliIo): number {
  const config = loadOrFail(ctx);
  const pid = pidAlive(ctx.paths.pidFile);
  io.out(`Máy: ${config.machineName}${config.machineId ? ` (${config.machineId})` : ' (chưa ghép)'}`);
  io.out(`VPS: ${config.apiUrl}`);
  io.out(`Daemon: ${pid ? `đang chạy (pid ${pid})` : 'không chạy'}`);
  io.out(`Project: ${config.projects.map((p) => `${p.key} → ${p.repoPath}`).join(', ') || '(chưa có)'}`);
  if (!existsSync(ctx.paths.stateDb)) return 0;
  const state = new StateDb(ctx.paths.stateDb);
  try {
    io.out(`Cursor: ${state.getCursor() ?? '(chưa nhận sự kiện)'}`);
    const active = state.listJobs(['running', 'queued', 'backoff']);
    io.out(`Job: ${active.length === 0 ? '(không có)' : ''}`);
    for (const job of active) {
      const extra = job.status === 'backoff' && job.retryAt ? ` thử lại ${job.retryAt}` : '';
      io.out(
        `  ${job.status.padEnd(8)} ${job.role.padEnd(9)} ${job.kind.padEnd(11)} ticket ${job.ticketId} ${job.model ?? ''}${extra}`,
      );
    }
  } finally {
    state.close();
  }
  return 0;
}

async function start(ctx: Context, io: CliIo): Promise<number> {
  const config = loadOrFail(ctx);
  const daemon = createDaemon({ config, home: ctx.home, tokenStore: ctx.tokenStore });
  await daemon.start();
  io.out(`crewd đang chạy (home ${ctx.home}). Ctrl+C để dừng.`);
  await (io.untilStopped?.() ??
    new Promise<void>((resolveStop) => {
      process.once('SIGINT', () => resolveStop());
      process.once('SIGTERM', () => resolveStop());
    }));
  io.out('Đang dừng: các job đang chạy sẽ được tiếp tục ở lần chạy sau…');
  await daemon.stop();
  return 0;
}

async function runDoctor(ctx: Context, args: string[], io: CliIo): Promise<number> {
  const { flags } = parseFlags(args, [], ['--no-fix', '--no-login-probe']);
  let config: DaemonConfig | null = null;
  try {
    config = loadConfig(ctx.paths.config);
  } catch {
    config = null;
  }
  const state = existsSync(ctx.paths.stateDb) ? new StateDb(ctx.paths.stateDb) : null;
  try {
    const report = await doctor(
      {
        config,
        paths: ctx.paths,
        tokenStore: ctx.tokenStore,
        vps: config ? client(ctx, config) : null,
        state,
        env: io.env,
        platform: process.platform,
        skipLoginProbe: flags.has('--no-login-probe'),
        exec: execCommand,
      },
      { fix: !flags.has('--no-fix') },
    );
    io.out(report.text);
    return report.exitCode;
  } finally {
    state?.close();
  }
}

function runInstallService(ctx: Context, io: CliIo): number {
  if (process.platform !== 'linux') {
    io.err('install-service chỉ dành cho Linux (systemd user). Trên macOS daemon chạy trong app 2P Crew.');
    return 2;
  }
  const cliPath = fileURLToPath(import.meta.url);
  const unit = installService({
    nodePath: process.execPath,
    cliPath,
    crewHome: ctx.home,
    systemctl: (args) => {
      const run = execCommand('systemctl', ['--user', ...args]);
      return { code: run.code, stderr: run.stderr };
    },
  });
  io.out(`Đã cài ${unit} và bật dịch vụ. Để chạy khi chưa đăng nhập: loginctl enable-linger $USER`);
  return 0;
}

function withProjects(config: DaemonConfig, projects: DaemonConfig['projects']): DaemonConfigInput {
  return { ...config, projects };
}

async function project(ctx: Context, args: string[], io: CliIo): Promise<number> {
  const [action, ...rest] = args;
  const config = loadOrFail(ctx);
  const vps = client(ctx, config);
  const { value, required } = parseFlags(rest, [
    '--key',
    '--path',
    '--branch',
    '--test-command',
    '--name',
    '--description',
    '--platform',
    '--repo-url',
  ]);
  const key = required('--key');
  if (action === 'add' || action === 'create') {
    const repoPath = repoFolder(required('--path'));
    const branch =
      value('--branch') ??
      git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') ??
      'main';
    if (action === 'create') {
      const platformValue = ProjectPlatform.safeParse(required('--platform'));
      if (!platformValue.success)
        throw new UsageError('--platform phải là web, mobile, web_mobile hoặc backend');
      const repoUrl = value('--repo-url') ?? git(repoPath, ['remote', 'get-url', 'origin']);
      if (!repoUrl) throw new UsageError('repo chưa có remote origin: truyền --repo-url');
      const created = await vps.createProject(
        {
          key,
          name: required('--name'),
          description: required('--description'),
          repoUrl,
          defaultBranch: branch,
          platform: platformValue.data,
        },
        `project-create:${key}:${randomUUID()}`,
      );
      io.out(`Đã tạo project ${created.key}, máy này sở hữu.`);
    } else {
      const claimed = await vps.claim({ projectKey: key }, `claim:${key}:${randomUUID()}`);
      io.out(
        claimed.status === 'pending'
          ? `Project ${key} đang thuộc máy khác: yêu cầu nhận đang chờ chủ dự án duyệt trên web.`
          : `Máy này sở hữu project ${key}.`,
      );
    }
    const entry = {
      key,
      repoPath,
      defaultBranch: branch,
      ...(value('--test-command') ? { testCommand: value('--test-command') } : {}),
      sharedPaths: [],
      disabledMcpServers: [],
    };
    saveConfig(
      ctx.paths.config,
      withProjects(config, [...config.projects.filter((p) => p.key !== key), entry]),
    );
    io.out(`Đã lưu thư mục ${repoPath} cho ${key} vào ${ctx.paths.config}.`);
    return 0;
  }
  if (action === 'release') {
    await vps.release({ projectKey: key }, `release:${key}:${randomUUID()}`);
    saveConfig(
      ctx.paths.config,
      withProjects(
        config,
        config.projects.filter((p) => p.key !== key),
      ),
    );
    io.out(`Đã trả project ${key}; các ticket đang mở sẽ chờ máy khác nhận.`);
    return 0;
  }
  throw new UsageError('project cần add, create hoặc release');
}

async function assistant(ctx: Context, args: string[], io: CliIo): Promise<number> {
  const config = loadOrFail(ctx);
  const vps = client(ctx, config);
  if (args[0] === 'on') {
    const claimed = await vps.claim({ hostsAssistant: true }, `claim:assistant:${randomUUID()}`);
    io.out(
      claimed.status === 'pending'
        ? 'Vai trò trợ lý đang thuộc máy khác: chờ duyệt trên web.'
        : 'Máy này là trợ lý.',
    );
    return 0;
  }
  if (args[0] === 'off') {
    await vps.release({ hostsAssistant: true }, `release:assistant:${randomUUID()}`);
    io.out('Đã trả vai trò trợ lý.');
    return 0;
  }
  throw new UsageError('assistant cần on hoặc off');
}

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    const home = crewHome(io.env);
    const paths = homePaths(home);
    const ctx: Context = {
      home,
      paths,
      tokenStore: io.tokenStore ?? defaultTokenStore(paths.tokenFile, io.env),
    };
    switch (command) {
      case 'pair':
        return await pair(ctx, args, io);
      case 'start':
        return await start(ctx, io);
      case 'status':
        return status(ctx, io);
      case 'rotate-token':
        return await rotateToken(ctx, io);
      case 'doctor':
        return await runDoctor(ctx, args, io);
      case 'install-service':
        return runInstallService(ctx, io);
      case 'project':
        return await project(ctx, args, io);
      case 'assistant':
        return await assistant(ctx, args, io);
      case undefined:
      case '--help':
      case 'help':
        io.out(USAGE);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`không có lệnh ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`crewd: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof ConfigError || error instanceof VpsError) {
      io.err(`crewd: ${error.message}`);
      return 1;
    }
    io.err(`crewd: ${(error as Error).message}`);
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
      process.stderr.write(`crewd: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
