import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { pinDir, type WorkflowId, type WorkflowPin } from './pin.js';

/** Runtime (adapterType Paperclip) chạy agent trên Mac. */
export type CrewRuntime = 'claude_local' | 'codex_local' | 'opencode_local';

/** Một workflow đã chứng nhận: bản ghim, runtime chạy được, có là mặc định không, dùng cho việc gì. */
export interface CertifiedWorkflow {
  id: WorkflowId;
  pin: WorkflowPin;
  runtimes: readonly CrewRuntime[];
  isDefault: boolean;
  purpose: string;
  /** Key `enabledPlugins` thuộc workflow này (bật trong repo là nạp chéo với run của workflow khác). */
  pluginKeys: readonly RegExp[];
}

type PinContext = Pick<MacContext, 'superpowersPin' | 'bmadPin'>;

/** Sổ workflow theo thứ tự cố định: Superpowers (mặc định) rồi BMAD. */
export function certifiedWorkflows(ctx: PinContext): readonly CertifiedWorkflow[] {
  return [
    {
      id: 'superpowers',
      pin: ctx.superpowersPin,
      // Codex/OpenCode đọc skill ở bản ghim này qua CREW_SUPERPOWERS_DIR (workflow-check --runtime kiểm checksum).
      runtimes: ['claude_local', 'codex_local', 'opencode_local'],
      isDefault: true,
      purpose: 'design/plan/task, code, review, merge',
      pluginKeys: [/^superpowers@/],
    },
    {
      id: 'bmad',
      pin: ctx.bmadPin,
      runtimes: ['claude_local'],
      isDefault: false,
      purpose: 'epic/story',
      pluginKeys: [/^bmad@/, /^bmad-method@/, /^bmad-toolbox@/],
    },
  ];
}

/** Workflow có thư mục ghim trùng `dir` (so bằng `comparablePath`), hoặc null nếu `dir` không phải bản ghim nào. */
export function workflowForPluginDir(
  ctx: Pick<MacContext, 'home'> & PinContext,
  dir: string,
): CertifiedWorkflow | null {
  const target = comparablePath(dir);
  return certifiedWorkflows(ctx).find((w) => comparablePath(pinDir(ctx.home, w.pin)) === target) ?? null;
}
