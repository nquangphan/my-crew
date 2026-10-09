import type { WorkflowPin } from './pin.js';

/**
 * Nguồn bản ghim BMAD: repo chính thức `bmad-plugins` qua https, đúng một revision. Bản ghim lắp hai cây skill
 * (`bmad-method`, `bmad-toolbox`) thành một plugin `bmad` (tên plugin = id workflow, run-init so tên này). Lấy bằng
 * `git archive` từ marketplace `bmad` local của owner nếu có commit này, không thì clone https. Không theo HEAD
 * marketplace: owner cập nhật marketplace không được đổi skill agent đang chạy.
 *
 * Số đo checksum và `executables` lấy từ lần đo ngày 10/10/2026 trên Mac mini (258 file: 257 file skill và
 * `.claude-plugin/plugin.json`). Nâng bản: sửa `BMAD_SOURCE.revision`, version trong `BMAD_PLUGIN_JSON` và `BMAD_PIN`
 * (đo lại checksum theo docs/flows/mac-workflows.md), chạy `crew-mac workflows install` trên mọi Mac, rồi
 * `apply-roles.sh agent <id> bmad <thư mục ghim mới>` cho từng agent BMAD. Repo dự án đã commit `_bmad/scripts` của
 * bản cũ sẽ bị `workflow-check` chặn (`khác bản ghim BMAD`) tới khi dựng lại: trong worktree agent BMAD xóa
 * `_bmad/scripts`, chạy `crew-mac bmad setup-project --root <worktree>` (bỏ qua nếu còn `resolve_config.py`), rồi
 * commit `_bmad`.
 */
export const BMAD_SOURCE = {
  repoUrl: 'https://github.com/bmad-code-org/bmad-plugins.git',
  /** Tương đối HOME. */
  marketplaceDir: '.claude/plugins/marketplaces/bmad',
  revision: 'd009608292d8a2ea4df846de7dca2f0d78a9e22d',
  trees: ['plugins/method/skills', 'plugins/toolbox/skills'],
} as const;

/** Nguồn cài; test thay `repoUrl` bằng repo tạm. Revision luôn lấy từ pin. */
export interface BmadSource {
  repoUrl: string;
  marketplaceDir: string;
  trees: readonly string[];
}

export const BMAD_PLUGIN_JSON =
  '{"name":"bmad","version":"6.13.0-next","description":"BMAD Method (bmad-method + bmad-toolbox), Crew pin d009608292d8"}\n';

export const BMAD_PIN: WorkflowPin = {
  workflow: 'bmad',
  version: '6.13.0-next',
  revision: BMAD_SOURCE.revision,
  checksum: '7f62e5cb6033d039505afdce2a1d411cbff064a83f13df1d467987f698cd82d2',
  executables: ['skills/bmad/scripts/resolve_customization.py'],
};
