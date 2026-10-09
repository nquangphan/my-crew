import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  addStatusRepo,
  configureStatus,
  createMacContext,
  doctor,
  installCrewMacFrom,
  listStatusRepos,
  removeStatusRepo,
  sendStatus,
  setStatusSecret,
  setup,
  workflowCheck,
} from '@crew/mac';
import type { OpsApi, OpsRequest, OpsResponse } from '../main/ops-bridge.js';

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
}

/**
 * Mỗi lời gọi dựng một `MacContext` mới. `cliPath` luôn là bản đã cài `~/.crew/app/crew-mac/dist/cli.js`
 * (không phải đường dẫn trong bundle) để plist reaper/status không trỏ vào bundle sẽ bị thay khi cập nhật.
 */
export function createOpsHandlers(deps: OpsDeps): OpsHandlers {
  const home = deps.env.HOME ?? homedir();
  const context = () =>
    (deps.makeContext ?? createMacContext)({
      env: deps.env,
      out: deps.log,
      cliPath: join(home, '.crew', 'app', 'crew-mac', 'dist', 'cli.js'),
    });
  return {
    doctor: async (opts) => doctor(context(), opts),
    setup: async (opts) => setup(context(), opts),
    configureStatus: async (url, companyId) => configureStatus(context(), url, companyId),
    setStatusSecret: async (secret) => setStatusSecret(context(), secret),
    addStatusRepo: async (projectId, path) => addStatusRepo(context(), projectId, path),
    removeStatusRepo: async (projectId) => removeStatusRepo(context(), projectId),
    listStatusRepos: async () => listStatusRepos(context()),
    installCrewMacFrom: async (srcDir) => installCrewMacFrom(context(), srcDir),
    sendStatus: async () => sendStatus(context()),
    workflowCheck: async (input) => workflowCheck(context(), input),
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
