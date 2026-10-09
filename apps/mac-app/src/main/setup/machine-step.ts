import { join } from 'node:path';
import { DEFAULT_PORT, forbiddenRootReason } from '@crew/mac';
import type { AppStateStore } from '../app-state.js';
import type { OpsBridge } from '../ops-bridge.js';
import type { ExistingMachine } from './import-existing.js';
import { isRecord, type StepOutcome } from './types.js';

export interface MachineStepDeps {
  ops: Pick<OpsBridge, 'call'>;
  home: string;
  /** `process.resourcesPath`: bản `crew-mac` mang theo nằm ở `<resourcesPath>/crew-mac`. */
  resourcesPath: string;
  detect(): Promise<ExistingMachine>;
  store: Pick<AppStateStore, 'get'>;
}

const KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/=]+(?: \S.*)?$/;

const fail = (message: string): StepOutcome => ({ ok: false, message });

function parsePort(value: unknown): number | string {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : 'Cổng sshd phải là số nguyên từ 1024 đến 65535';
}

/**
 * Bước `machine`. Máy có sẵn cài đặt crew-mac thì nhận nguyên (không sinh key, không hỏi lại secret): cài bản
 * `crew-mac` mang theo, cập nhật cấu hình status theo company đã chọn, `setup({})` giữ chủ sshd hiện có. Máy mới cần
 * key Paperclip và secret webhook; secret chỉ đi một lần từ renderer tới `setStatusSecret` rồi bị xóa khỏi input.
 */
export function createMachineStep(deps: MachineStepDeps): (input: unknown) => Promise<StepOutcome> {
  const { ops } = deps;

  return async (rawInput) => {
    const input = isRecord(rawInput) ? rawInput : {};
    const { paperclipOrigin, companyId } = deps.store.get().setup;
    if (!paperclipOrigin || !companyId) return fail('Hãy đăng nhập Paperclip và chọn company trước.');

    const machine = await deps.detect();
    if (machine.kind === 'broken') return fail(machine.message);

    let setupOptions: { paperclipKey: string; port: number; worktreeRoot: string } | null = null;
    let secret = '';
    if (machine.kind === 'fresh') {
      const key = typeof input.paperclipKey === 'string' ? input.paperclipKey.trim() : '';
      if (!KEY_RE.test(key)) return fail('Cần key Paperclip dạng "ssh-ed25519 AAAA… ghi-chú".');
      secret = typeof input.webhookSecret === 'string' ? input.webhookSecret.replace(/\r?\n$/, '') : '';
      if (!secret || /[\r\n]/.test(secret)) return fail('Cần secret webhook (đúng một dòng).');
      const port = parsePort(input.port);
      if (typeof port === 'string') return fail(port);
      const root =
        typeof input.worktreeRoot === 'string' && input.worktreeRoot.trim() !== ''
          ? input.worktreeRoot.trim()
          : join(deps.home, 'crew-agents');
      const reason = forbiddenRootReason(deps.home, root);
      if (reason) return fail(`Thư mục worktree không dùng được: ${reason}.`);
      setupOptions = { paperclipKey: key, port, worktreeRoot: root };
    }

    try {
      const install = await ops.call('installCrewMacFrom', join(deps.resourcesPath, 'crew-mac'));
      if (!install.installed && install.reason) return fail(install.reason);
      if (machine.kind === 'fresh') {
        await ops.call('setStatusSecret', secret);
      }
    } finally {
      secret = '';
      if ('webhookSecret' in input) input.webhookSecret = '';
    }
    await ops.call('configureStatus', paperclipOrigin, companyId);
    const report = await ops.call('setup', setupOptions ?? {});

    if (machine.kind === 'existing') {
      const notes = [`cổng ${machine.port}`, `thư mục ${machine.worktreeRoot}`];
      if (!machine.hasWebhookSecret) notes.push('chưa thấy secret webhook trong Keychain');
      return {
        ok: true,
        message: `Nhận cài đặt có sẵn (${notes.join(', ')}). Thay đổi: ${report.changed.length}.`,
      };
    }
    return { ok: true, message: `Đã cài đặt máy mới (thay đổi: ${report.changed.length}).` };
  };
}
