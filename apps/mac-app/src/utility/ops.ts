import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  addStatusRepo,
  configureStatus,
  createMacContext,
  createRunner,
  doctor,
  ensureNode,
  installCrewMacFrom,
  listStatusRepos,
  listTargets,
  machineFacts,
  NO_NODE_MESSAGE,
  type NodeInfo,
  readStatusConfig,
  removeStatusRepo,
  resolveNode,
  runtimesStatus,
  sendStatus,
  setStatusSecret,
  setTargetSecret,
  setup,
  stableNodePath,
  superpowersPinDir,
  testStatus,
  workflowCheck,
} from '@crew/mac';
import { runJob } from '../main/jobs/executors.js';
import type { OpsApi, OpsRequest, OpsResponse } from '../main/ops-bridge.js';
import { killActiveGit } from '../main/projects/folder.js';

export type { OpsRequest, OpsResponse };

type ContextInput = Parameters<typeof createMacContext>[0];
type OpsHandlers = {
  [K in keyof OpsApi]: (...args: Parameters<OpsApi[K]>) => Promise<Awaited<ReturnType<OpsApi[K]>>>;
};

export interface OpsDeps {
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  /** Test thay để xem tham số; mặc định `createMacContext`. */
  makeContext?: (input: ContextInput) => ReturnType<typeof createMacContext>;
  /** Test thay cách dò/tải node; mặc định các hàm của `@crew/mac` với HOME của `env`. */
  node?: NodeFinder;
}

const NO_NODE_FOR_APP = `${NO_NODE_MESSAGE}. Mở 2P Crew → bước Kiểm tra máy để dò hoặc tải Node vào ~/.crew/node.`;

export interface NodeFinder {
  /** Dò đồng bộ (Homebrew, `~/.crew/node`, node trong launcher); không có thì ném. */
  stable(): string;
  /** Dò cả shell đăng nhập (nvm), không tải. */
  resolve(): Promise<NodeInfo | null>;
  /** Dò, không có thì tải Node LTS vào `~/.crew/node`. */
  ensure(): Promise<NodeInfo>;
}

/**
 * Mỗi lời gọi dựng một `MacContext` mới. `cliPath` luôn là bản đã cài `~/.crew/app/crew-mac/dist/cli.js`
 * (không phải đường dẫn trong bundle) để plist reaper/status không trỏ vào bundle sẽ bị thay khi cập nhật.
 * `nodePath` là node thật (không bao giờ là binary của app): kết quả `ensureNode` gần nhất, không có thì dò đồng bộ
 * rồi dò cả shell đăng nhập; nhớ trong process. Launcher do `setup` ghi là nơi lưu bền giữa các lần mở app.
 */
export function createOpsHandlers(deps: OpsDeps): OpsHandlers {
  const home = deps.env.HOME ?? homedir();
  const node: NodeFinder = deps.node ?? {
    stable: () => stableNodePath({ home }),
    resolve: () => resolveNode({ home, runner: createRunner() }),
    ensure: () => ensureNode({ home, runner: createRunner() }),
  };
  let nodePath: string | undefined;
  // Shell đăng nhập có thể mất tới 15 giây: chỉ dò một lần cho tới khi `ensureNode` chạy lại.
  let shellTried = false;
  const currentNodePath = async (): Promise<string> => {
    if (nodePath !== undefined) return nodePath;
    try {
      nodePath = node.stable();
      return nodePath;
    } catch {
      // Dò tiếp bằng shell đăng nhập.
    }
    const found = shellTried ? null : await node.resolve();
    shellTried = true;
    if (found === null) throw new Error(NO_NODE_FOR_APP);
    nodePath = found.path;
    return nodePath;
  };
  const context = async () =>
    (deps.makeContext ?? createMacContext)({
      env: deps.env,
      out: deps.log,
      cliPath: join(home, '.crew', 'app', 'crew-mac', 'dist', 'cli.js'),
      nodePath: await currentNodePath(),
    });
  return {
    ensureNode: async () => {
      shellTried = false;
      const info = await node.ensure();
      nodePath = info.path;
      return info;
    },
    doctor: async (opts) => doctor(await context(), opts),
    setup: async (opts) => setup(await context(), opts),
    configureStatus: async (url, companyId) => configureStatus(await context(), url, companyId),
    setStatusSecret: async (secret) => setStatusSecret(await context(), secret),
    setTargetSecret: async (companyId, secret) => setTargetSecret(await context(), companyId, secret),
    testStatus: async (companyId) => testStatus(await context(), companyId),
    machineFacts: async () => machineFacts(await context()),
    addStatusRepo: async (projectId, path, companyId) =>
      addStatusRepo(await context(), projectId, path, companyId),
    removeStatusRepo: async (projectId) => removeStatusRepo(await context(), projectId),
    listStatusRepos: async () => listStatusRepos(await context()),
    installCrewMacFrom: async (srcDir) => installCrewMacFrom(await context(), srcDir),
    sendStatus: async () => sendStatus(await context()),
    workflowCheck: async (input) => workflowCheck(await context(), input),
    jobTargets: async () => {
      const ctx = await context();
      return {
        machineId: readStatusConfig(ctx)?.machineId ?? null,
        targets: listTargets(ctx).map(({ url, companyId }) => ({ url, companyId })),
      };
    },
    cancelMachineJob: async () => killActiveGit(),
    runMachineJob: async (job, extras) => {
      const ctx = await context();
      return runJob(job, extras, {
        home,
        env: deps.env,
        addStatusRepo: async (projectId, path, companyId) => addStatusRepo(ctx, projectId, path, companyId),
        statusRepoPaths: async () => listStatusRepos(ctx).map((repo) => repo.path),
        removeStatusRepo: async (projectId) => removeStatusRepo(ctx, projectId),
        doctor: () => doctor(ctx, { probe: false, tccWindow: '1h', probeTimeoutSec: 90, skipTcc: true }),
        workflowCheck: (root) => workflowCheck(ctx, { root, pluginDir: superpowersPinDir(home) }),
        runtimesSetup: async () => {
          await setup(ctx, {});
          return runtimesStatus(ctx);
        },
      });
    },
  } as OpsHandlers;
}

interface ParentPort {
  on(event: 'message', listener: (event: { data: OpsRequest }) => void): void;
  postMessage(message: OpsResponse): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort) {
  const handlers = createOpsHandlers({
    env: process.env,
    log: (line) => process.stdout.write(`${line}\n`),
  }) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  parentPort.on('message', async ({ data }) => {
    const handler = Object.hasOwn(handlers, data.op) ? handlers[data.op] : undefined;
    try {
      if (!handler) throw new Error(`Thao tác không có: ${data.op}`);
      parentPort.postMessage({ id: data.id, ok: true, result: await handler(...data.args) });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      parentPort.postMessage({ id: data.id, ok: false, error: { name: err.name, message: err.message } });
    }
  });
}
