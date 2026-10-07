import { join } from 'node:path';
import { macPaths } from '../paths.js';

export interface WorkflowPin {
  workflow: 'superpowers';
  version: string;
  revision: string;
  checksum: string;
  /**
   * File phải có bit thực thi (hook và script mà skill gọi). Checksum cây chỉ băm nội dung, nên quyền được kiểm riêng;
   * không nằm trong `samePin`.
   */
  executables: readonly string[];
}

/**
 * Bản owner cài trên Mac mini ngày 07/10/2026 (claude-plugins-official), 231 file. Nâng bản: sửa hằng số này,
 * chạy lại "crew-mac setup" trên mọi Mac rồi cập nhật adapterConfig.extraArgs của agent.
 */
export const SUPERPOWERS_PIN: WorkflowPin = {
  workflow: 'superpowers',
  version: '6.4.1',
  revision: '5bf4e78011075bcfc0dc295f0724994cd123ee71',
  checksum: '3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a',
  executables: [
    'hooks/run-hook.cmd',
    'hooks/session-start',
    'skills/brainstorming/scripts/start-server.sh',
    'skills/brainstorming/scripts/stop-server.sh',
    'skills/executing-plans/scripts/task-done',
    'skills/executing-plans/scripts/task-start',
    'skills/subagent-driven-development/scripts/review-package',
    'skills/subagent-driven-development/scripts/sdd-workspace',
    'skills/subagent-driven-development/scripts/task-brief',
    'skills/systematic-debugging/find-polluter.sh',
    'skills/writing-skills/render-graphs.js',
  ],
};

export const SUPERPOWERS_PLUGIN_KEY = 'superpowers@claude-plugins-official';

export function superpowersPinDir(home: string, pin: WorkflowPin = SUPERPOWERS_PIN): string {
  return join(macPaths(home).workflowsRoot, pin.workflow, `${pin.version}-${pin.revision.slice(0, 12)}`);
}

/** Đặt vào `adapterConfig.extraArgs` của agent claude_local: không nạp nguồn user, chỉ plugin ở thư mục ghim. */
export function agentExtraArgs(pinDir: string): string[] {
  return ['--setting-sources', 'project,local', '--plugin-dir', pinDir];
}
