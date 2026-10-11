import { join } from 'node:path';
import type { MachineFacts, StatusTestResult } from '@crew/mac';
import { DEFAULT_PORT, forbiddenRootReason } from '@crew/mac';
import type { AppStateStore } from '../app-state.js';
import type { OpsBridge } from '../ops-bridge.js';
import { PaperclipHttpError } from '../paperclip/client.js';
import type { PaperclipClient } from '../paperclip/types.js';
import { inPlaceSshTemplates } from '../projects/add-project.js';
import type { ExistingMachine } from './import-existing.js';
import { isRecord, type StepOutcome } from './types.js';

export type MachineStepClient = Pick<
  PaperclipClient,
  'pairInfo' | 'pairMachine' | 'environments' | 'createEnvironment' | 'archiveEnvironment'
>;

export interface MachineStepDeps {
  ops: Pick<OpsBridge, 'call'>;
  home: string;
  /** `process.resourcesPath`: bản `crew-mac` mang theo nằm ở `<resourcesPath>/crew-mac`. */
  resourcesPath: string;
  detect(): Promise<ExistingMachine>;
  store: Pick<AppStateStore, 'get' | 'update'>;
  /** Client Paperclip bằng board key của owner; chỉ gọi khi cần (máy có sẵn gửi bản tin được thì không gọi). */
  client(): MachineStepClient;
}

/** `state` của kết quả bước Máy cho renderer: mở phần nhập tay, hoặc hiện nút "Ghép lại máy này". */
export const MACHINE_STEP_STATE = { manual: 'manual', revoked: 'revoked' } as const;

export const REVOKED_MESSAGE = 'Máy này đã bị gỡ trên web. Bấm Ghép lại nếu muốn dùng lại.';
/**
 * Server từ chối ghép vì máy đã gửi bản tin bằng secret company và chưa từng ghép. App chỉ ghép sau khi bản tin thử đã
 * hỏng, nên secret trên máy không còn đúng: bước không đạt, không ghi key nào.
 */
export const USES_COMPANY_SECRET_MESSAGE =
  'Máy này đang gửi bản tin bằng secret chung của company nhưng secret trên máy không còn đúng. Gỡ máy này trên trang Máy (web) rồi chạy lại bước Máy.';
const NO_PAPERCLIP_KEY_MESSAGE =
  'Server chưa có key Paperclip, báo người quản trị. Tạm thời có thể dán key và secret ở phần "Nhập tay (dự phòng)".';

const KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/=]+(?: \S.*)?$/;

const fail = (message: string, state?: string): StepOutcome => ({
  ok: false,
  message,
  ...(state === undefined ? {} : { state }),
});

function parsePort(value: unknown): number | string {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : 'Cổng sshd phải là số nguyên từ 1024 đến 65535';
}

/** Cổng và thư mục worktree của máy mới (mặc định 2222, `~/crew-agents`); sai thì trả câu lỗi. */
function freshLocation(
  home: string,
  input: Record<string, unknown>,
): { port: number; worktreeRoot: string } | string {
  const port = parsePort(input.port);
  if (typeof port === 'string') return port;
  const root =
    typeof input.worktreeRoot === 'string' && input.worktreeRoot.trim() !== ''
      ? input.worktreeRoot.trim()
      : join(home, 'crew-agents');
  const reason = forbiddenRootReason(home, root);
  if (reason) return `Thư mục worktree không dùng được: ${reason}.`;
  return { port, worktreeRoot: root };
}

/** Câu báo khi bản tin thử không 2xx. */
export function testFailureMessage(result: StatusTestResult): string {
  switch (result.failure) {
    case 'http':
      return `Server từ chối bản tin máy (HTTP ${result.httpStatus}). Kiểm company đã chọn.`;
    case 'network':
      return 'Không gửi được bản tin thử tới Paperclip (lỗi mạng). Kiểm kết nối Tailscale/Internet rồi bấm lại.';
    case 'keychain':
      return 'Không đọc được secret bản tin trong Keychain. Mở khóa Keychain (đăng nhập màn hình Mac) rồi bấm lại.';
    case 'report':
      return 'Không dựng được bản tin máy để gửi thử (xem log crew-mac).';
    default:
      return 'Chưa có đích bản tin cho company đã chọn.';
  }
}

/** Tên environment của máy: `may-<tên máy>` chữ thường, chỉ chữ số và gạch ngang. */
export function machineEnvironmentName(hostname: string): string {
  const slug = hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `may-${slug || 'mac'}`;
}

function isConflict(error: unknown, code?: string): error is PaperclipHttpError {
  return (
    error instanceof PaperclipHttpError && error.status === 409 && (code === undefined || error.code === code)
  );
}

/**
 * Environment SSH `in_place` của máy: dùng lại environment active đã tạo trước (cùng tên, host, cổng, known_hosts,
 * thư mục), không có thì tạo mới theo khuôn environment `in_place` active của company (secret SSH dùng chung, cổng
 * tải). Chỉ tạo, không bao giờ xóa.
 */
async function ensureMachineEnvironment(
  client: MachineStepClient,
  companyId: string,
  facts: MachineFacts,
): Promise<{ id: string; name: string; created: boolean } | string> {
  const name = machineEnvironmentName(facts.hostname);
  const envs = await client.environments(companyId);
  const same = envs.find(
    (env) =>
      env.name === name &&
      env.status === 'active' &&
      env.driver === 'ssh' &&
      env.config.host === facts.listenAddress &&
      env.config.port === facts.port &&
      env.config.knownHosts === facts.knownHostsLine &&
      env.config.remoteWorkspacePath === facts.worktreeRoot,
  );
  if (same) return { id: same.id, name, created: false };
  const template = inPlaceSshTemplates(envs)[0];
  if (!template) {
    return 'Company chưa có environment SSH in_place nào để dùng chung secret SSH của Paperclip; báo người quản trị.';
  }
  const ref = template.config.privateKeySecretRef as { secretId: string };
  const gate = template.metadata?.crewLoadGate as
    | { maxLoad1?: unknown; maxWaitMinutes?: unknown }
    | undefined;
  const created = await client.createEnvironment(companyId, {
    name,
    description: `Máy ${facts.hostname} (ghép từ app 2P Crew)`,
    host: facts.listenAddress,
    port: facts.port,
    username: facts.username,
    remoteWorkspacePath: facts.worktreeRoot,
    privateKeySecretId: ref.secretId,
    knownHosts: facts.knownHostsLine,
    ...(typeof gate?.maxLoad1 === 'number' && typeof gate.maxWaitMinutes === 'number'
      ? { crewLoadGate: { maxLoad1: gate.maxLoad1, maxWaitMinutes: gate.maxWaitMinutes } }
      : {}),
  });
  return { id: created.id, name, created: true };
}

/**
 * Bước `machine`: ghép máy với Paperclip, owner không phải dán gì.
 *
 * - Máy mới: lấy key Paperclip từ server, cài crew-mac, cấu hình bản tin, `setup`, tạo environment SSH của máy, ghép
 *   máy để nhận key máy (vào thẳng Keychain của đích thuộc company), rồi gửi một bản tin thử phải 2xx.
 * - Máy có sẵn (Mac mini): gửi thử bằng secret đang có; 2xx thì giữ nguyên như trước, không ghép, không đổi key. Chỉ
 *   ghép khi server trả lỗi HTTP hoặc Keychain không đọc được; lỗi mạng thì dừng.
 * - Server báo máy đã bị gỡ trên web: chỉ ghép lại khi owner bấm "Ghép lại máy này" (`input.repair`). Server báo máy
 *   đang dùng secret company: bước không đạt, không ghi key.
 * - `input.manual`: đường dán tay cũ (key và secret), vẫn phải qua bản tin thử 2xx.
 *
 * Key máy và secret dán tay không vào log, app state hay argv; biến giữ chúng bị xóa trong `finally`.
 */
export function createMachineStep(deps: MachineStepDeps): (input: unknown) => Promise<StepOutcome> {
  const { ops } = deps;

  return async (rawInput) => {
    const input = isRecord(rawInput) ? rawInput : {};
    const { paperclipOrigin, companyId } = deps.store.get().setup;
    if (!paperclipOrigin || !companyId) return fail('Hãy đăng nhập Paperclip và chọn company trước.');

    const machine = await deps.detect();
    if (machine.kind === 'broken') return fail(machine.message);
    if (input.manual === true) return manualStep(deps, input, machine, paperclipOrigin, companyId);

    const repair = input.repair === true;
    let location: { port: number; worktreeRoot: string };
    if (machine.kind === 'fresh') {
      const parsed = freshLocation(deps.home, input);
      if (typeof parsed === 'string') return fail(parsed);
      location = parsed;
    } else {
      location = { port: machine.port, worktreeRoot: machine.worktreeRoot };
    }

    const readPaperclipKey = async (): Promise<string | StepOutcome> => {
      try {
        return (await deps.client().pairInfo(companyId)).paperclipSshPublicKey;
      } catch (error) {
        if (isConflict(error)) return fail(NO_PAPERCLIP_KEY_MESSAGE, MACHINE_STEP_STATE.manual);
        throw error;
      }
    };

    // Máy mới hỏi key trước khi đụng vào máy: server chưa có key thì dừng khi máy còn nguyên.
    let paperclipKey: string | null = null;
    if (machine.kind === 'fresh') {
      const key = await readPaperclipKey();
      if (typeof key !== 'string') return key;
      paperclipKey = key;
    }

    const install = await ops.call('installCrewMacFrom', join(deps.resourcesPath, 'crew-mac'));
    if (!install.installed && install.reason) return fail(install.reason);
    // Máy có sẵn giữ url bản tin đang chạy (có thể là đường Tailscale); máy mới lấy origin Paperclip đã đăng nhập.
    const statusUrl = machine.kind === 'existing' ? (machine.statusUrl ?? paperclipOrigin) : paperclipOrigin;
    const status = await ops.call('configureStatus', statusUrl, companyId);

    let firstTest: StatusTestResult | null = null;
    if (machine.kind === 'existing' && !repair) {
      firstTest = await ops.call('testStatus', companyId);
      if (firstTest.ok) {
        const report = await ops.call('setup', {});
        return {
          ok: true,
          message: `Nhận cài đặt có sẵn (cổng ${machine.port}, thư mục ${machine.worktreeRoot}), bản tin thử HTTP ${firstTest.httpStatus}, không cần ghép. Thay đổi: ${report.changed.length}.`,
        };
      }
      if (firstTest.failure !== 'http' && firstTest.failure !== 'keychain') {
        return fail(`${testFailureMessage(firstTest)} Máy chưa được ghép.`);
      }
    }
    if (paperclipKey === null) {
      const key = await readPaperclipKey();
      if (typeof key !== 'string') return key;
      paperclipKey = key;
    }

    const report = await ops.call('setup', { paperclipKey, ...location });
    const facts = await ops.call('machineFacts');
    const client = deps.client();
    const env = await ensureMachineEnvironment(client, companyId, facts);
    if (typeof env === 'string') return fail(env);

    let machineKey = '';
    try {
      try {
        machineKey = (
          await client.pairMachine(
            {
              companyId,
              machineId: status.machineId,
              hostname: facts.hostname,
              environmentId: env.id,
              tailscaleIp: facts.listenAddress,
              port: facts.port,
              hostKeyFingerprint: facts.hostKeyFingerprint,
            },
            repair ? { allowRepair: true } : {},
          )
        ).machineKey;
      } catch (error) {
        // Environment vừa tạo cho lần ghép hỏng thì archive (không bao giờ xóa), để không còn environment nhận run.
        const archiveNote = env.created
          ? await client.archiveEnvironment(env.id).then(
              () => '',
              () => ` Chưa archive được environment ${env.name} vừa tạo; archive nó trên web.`,
            )
          : '';
        if (isConflict(error, 'machine_revoked')) {
          return fail(`${REVOKED_MESSAGE}${archiveNote}`, MACHINE_STEP_STATE.revoked);
        }
        if (isConflict(error, 'machine_uses_company_secret')) {
          return fail(`${USES_COMPANY_SECRET_MESSAGE}${archiveNote}`);
        }
        if (archiveNote)
          throw new Error(`${error instanceof Error ? error.message : String(error)}.${archiveNote}`);
        throw error;
      }
      await ops.call('setTargetSecret', companyId, machineKey);
    } finally {
      machineKey = '';
    }

    const finalTest = await ops.call('testStatus', companyId);
    if (!finalTest.ok) return fail(testFailureMessage(finalTest));
    await deps.store.update((state) => ({
      ...state,
      setup: { ...state.setup, pairedEnvironmentId: env.id },
    }));
    return {
      ok: true,
      message: `Đã ghép máy (environment ${env.name}), bản tin thử HTTP ${finalTest.httpStatus}. Thay đổi: ${report.changed.length}.`,
    };
  };
}

/**
 * Đường dán tay (dự phòng): máy mới cần key Paperclip và secret webhook; máy có sẵn cần secret, key thì tùy. Secret đi
 * một lần tới Keychain của đích thuộc company rồi bị xóa khỏi input. Không tạo environment, không ghép.
 */
async function manualStep(
  deps: MachineStepDeps,
  input: Record<string, unknown>,
  machine: Exclude<ExistingMachine, { kind: 'broken' }>,
  paperclipOrigin: string,
  companyId: string,
): Promise<StepOutcome> {
  const { ops } = deps;
  let secret = typeof input.webhookSecret === 'string' ? input.webhookSecret.replace(/\r?\n$/, '') : '';
  try {
    const key = typeof input.paperclipKey === 'string' ? input.paperclipKey.trim() : '';
    if ((machine.kind === 'fresh' || key !== '') && !KEY_RE.test(key)) {
      return fail('Cần key Paperclip dạng "ssh-ed25519 AAAA… ghi-chú".');
    }
    if (!secret || /[\r\n]/.test(secret)) return fail('Cần secret webhook (đúng một dòng).');
    let options: { paperclipKey?: string; port?: number; worktreeRoot?: string } = {};
    if (machine.kind === 'fresh') {
      const location = freshLocation(deps.home, input);
      if (typeof location === 'string') return fail(location);
      options = { paperclipKey: key, ...location };
    } else if (key !== '') {
      options = { paperclipKey: key };
    }

    const install = await ops.call('installCrewMacFrom', join(deps.resourcesPath, 'crew-mac'));
    if (!install.installed && install.reason) return fail(install.reason);
    const statusUrl = machine.kind === 'existing' ? (machine.statusUrl ?? paperclipOrigin) : paperclipOrigin;
    await ops.call('configureStatus', statusUrl, companyId);
    await ops.call('setTargetSecret', companyId, secret);
    secret = '';
    const report = await ops.call('setup', options);
    const tested = await ops.call('testStatus', companyId);
    if (!tested.ok) return fail(testFailureMessage(tested), MACHINE_STEP_STATE.manual);
    return {
      ok: true,
      message: `Đã cài bằng key và secret dán tay, bản tin thử HTTP ${tested.httpStatus}. Thay đổi: ${report.changed.length}.`,
    };
  } finally {
    secret = '';
    if ('webhookSecret' in input) input.webhookSecret = '';
  }
}
