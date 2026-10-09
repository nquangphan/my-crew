import type { CheckResult } from '@crew/mac';
import type { StepResult } from '../../shared/ipc-contract.js';
import type { AppState, AppStateStore, SetupStep } from '../app-state.js';
import type { LoginItem } from '../login-item.js';
import type { OpsBridge } from '../ops-bridge.js';
import { isRecord, type StepOutcome, type StepRun } from './types.js';

/** Thứ tự bước của wizard. `v2` (gỡ app cũ) phải xong trước `move` vì hai app cùng tên `2P Crew.app`. */
export const STEP_ORDER: readonly SetupStep[] = [
  'check',
  'v2',
  'move',
  'paperclip',
  'machine',
  'disk-access',
  'sshd',
  'doctor',
  'done',
];

export interface WizardDeps {
  store: Pick<AppStateStore, 'get' | 'update'>;
  loginItem: Pick<LoginItem, 'set'>;
  steps: {
    check: StepRun;
    v2?: StepRun;
    move?: StepRun;
    paperclip: StepRun;
    machine: StepRun;
    diskAccess: StepRun;
    sshd: StepRun;
    doctor: StepRun;
  };
}

export interface Wizard {
  state(): AppState['setup'];
  step(step: SetupStep, input: unknown): Promise<StepResult>;
}

const passThrough: StepRun = async () => ({ ok: true, message: 'Không có việc cần làm.' });
const indexOf = (step: SetupStep) => STEP_ORDER.indexOf(step);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Máy trạng thái của wizard. Bước xong thì `setup.step` trong `app.json` là bước kế tiếp (mở lại app tiếp từ bước
 * dở). Chỉ được chạy bước đã tới lượt hoặc bước cũ (chạy lại không lùi tiến độ); bước `done` bật login item và chỉ
 * chạy khi tiến độ đã tới `done`, tức mọi bước trước đã `ok`.
 */
export function createWizard(deps: WizardDeps): Wizard {
  const runners: Record<Exclude<SetupStep, 'done'>, StepRun> = {
    check: deps.steps.check,
    v2: deps.steps.v2 ?? passThrough,
    move: deps.steps.move ?? passThrough,
    paperclip: deps.steps.paperclip,
    machine: deps.steps.machine,
    'disk-access': deps.steps.diskAccess,
    sshd: deps.steps.sshd,
    doctor: deps.steps.doctor,
  };

  const runDone = async (): Promise<StepOutcome> => {
    const enabled = deps.loginItem.set(true);
    return {
      ok: true,
      message: enabled
        ? 'Cài đặt xong. 2P Crew sẽ tự mở cùng máy.'
        : 'Cài đặt xong. Mở Cài đặt hệ thống → Cài đặt chung → Mục đăng nhập và cho phép 2P Crew để app tự mở cùng máy.',
    };
  };

  return {
    state: () => deps.store.get().setup,
    async step(step, input) {
      const progress = deps.store.get().setup.step;
      if (indexOf(step) > indexOf(progress)) {
        return { ok: false, message: `Hãy hoàn thành bước "${progress}" trước.`, next: progress };
      }
      let outcome: StepOutcome;
      try {
        outcome = step === 'done' ? await runDone() : await runners[step](isRecord(input) ? input : {});
      } catch (error) {
        outcome = { ok: false, message: errorText(error) };
      }
      if (!outcome.ok || outcome.stay) return { ok: outcome.ok, message: outcome.message, next: step };
      const next = step === 'done' ? 'done' : (STEP_ORDER[indexOf(step) + 1] as SetupStep);
      if (indexOf(next) > indexOf(progress)) {
        await deps.store.update((state) => ({ ...state, setup: { ...state.setup, step: next } }));
      }
      return { ok: true, message: outcome.message, next };
    },
  };
}

export interface PaperclipStepDeps {
  store: Pick<AppStateStore, 'get' | 'update'>;
  companies(): Promise<Array<{ id: string; name: string }>>;
}

/** Bước `paperclip`: đăng nhập đã xong ở kênh `paperclip:*` (ghi origin); bước này ghi company được chọn. */
export function createPaperclipStep(deps: PaperclipStepDeps): StepRun {
  return async (input) => {
    const origin = deps.store.get().setup.paperclipOrigin;
    if (!origin) return { ok: false, message: 'Chưa đăng nhập Paperclip.' };
    const companyId = isRecord(input) && typeof input.companyId === 'string' ? input.companyId : '';
    if (!companyId) return { ok: false, message: 'Chọn company.' };
    const company = (await deps.companies()).find((item) => item.id === companyId);
    if (!company) return { ok: false, message: 'Company này không có trong tài khoản đã đăng nhập.' };
    await deps.store.update((state) => ({ ...state, setup: { ...state.setup, companyId } }));
    return { ok: true, message: `Đã chọn company ${company.name}.` };
  };
}

export interface DoctorStepDeps {
  ops: Pick<OpsBridge, 'call'>;
  /** Cập nhật chấm màu tray và màn Sức khỏe sau khi kiểm xong. */
  refreshHealth?(): void;
}

/** Bước `doctor`: kiểm cuối có thử `claude`; `ok` khi không có check `fail`. */
export function createDoctorStep(deps: DoctorStepDeps): StepRun {
  return async () => {
    const results: CheckResult[] = await deps.ops.call('doctor', {
      probe: true,
      tccWindow: '24h',
      probeTimeoutSec: 90,
    });
    deps.refreshHealth?.();
    const failed = results.filter((result) => result.status === 'fail');
    if (failed.length === 0) {
      const warned = results.filter((result) => result.status === 'warn').length;
      return { ok: true, message: warned > 0 ? `Máy ổn (${warned} cảnh báo, xem màn Sức khỏe).` : 'Máy ổn.' };
    }
    const lines = failed.map(
      (result) => `${result.title}: ${result.detail}${result.hint ? ` (${result.hint})` : ''}`,
    );
    return { ok: false, message: `Còn ${failed.length} lỗi:\n${lines.join('\n')}` };
  };
}
