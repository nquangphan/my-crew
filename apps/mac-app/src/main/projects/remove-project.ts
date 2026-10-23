import type { ProjectRoles } from '../paperclip/types.js';
import { findByProjectId, manualRemoveCommand, type ProjectDeps, recordName } from './progress.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Agent của bốn vai trò app quản lý (cũng là mọi agent app ghi trong tiến độ), chữ thường. */
const roleAgentIds = (roles: ProjectRoles): string[] =>
  [roles.assistantAgentId, ...roles.executorAgentIds, roles.reviewerAgentId, roles.integratorAgentId]
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.toLowerCase());

/**
 * Gỡ project khỏi Mac: pause agent của project (chỉ agent app đã tạo, theo tiến độ trong `app.json`), archive
 * environment riêng của chúng (không bao giờ DELETE: xóa kéo theo secret SSH dùng chung), `crew-mac status
 * remove-repo`, xóa dòng vai trò. Không xóa project trên Paperclip, không xóa worktree agent, không đụng folder gốc của
 * owner: trả lệnh `git -C <folder> worktree remove …` để owner tự chạy.
 * Từ chối khi cây ghim máy của project còn run; nhờ server dọn máy khác (flow `multi-machine` của fork).
 * Mỗi bước kiểm trạng thái trước khi ghi nên chạy lại an toàn; tiến độ chỉ bị xóa khi mọi bước xong.
 */
export async function removeProject(
  deps: ProjectDeps,
  projectId: string,
): Promise<{ removed: string[]; manualCommand: string }> {
  if (!UUID_RE.test(projectId)) throw new Error('projectId phải là UUID hợp lệ');
  const companyId = deps.store.get().setup.companyId;
  if (!companyId) throw new Error('Chưa chọn company Paperclip (mục Cài đặt)');
  const { client } = deps;
  const progress = findByProjectId(deps.store.get(), projectId);
  const removed: string[] = [];
  const entries = progress ? Object.entries(progress.agents) : [];
  const agentIds = entries.map(([, e]) => e.agentId).filter((id): id is string => !!id);
  if (agentIds.length > 0) {
    // Cây đã ghim máy còn run chờ/chạy thì không gỡ: archive environment hay checkout lúc này làm gãy cây đó.
    const blockers = await client.machineBlockers(companyId, projectId, null);
    if (blockers && blockers.length > 0) {
      const list = blockers.map((b) => `${b.identifier ?? b.issueId} (${b.hostname})`).join(', ');
      throw new Error(
        `Chưa gỡ được: ${list} đang có run chờ hoặc đang chạy trên máy đã ghim. Chờ run xong (hoặc hủy run) rồi gỡ lại.`,
      );
    }
  }

  for (const [role, entry] of entries) {
    if (!entry.agentId) continue;
    const agent = await client.getAgent(entry.agentId);
    if (!agent || ['paused', 'terminated', 'pending_approval'].includes(agent.status)) continue;
    await client.pauseAgent(entry.agentId);
    removed.push(`agent ${recordName(progress?.key ?? '', role)} đã pause`);
  }

  const envIds = new Set(entries.map(([, e]) => e.environmentId).filter((id): id is string => !!id));
  if (envIds.size > 0) {
    const status = new Map((await client.environments(companyId)).map((env) => [env.id, env.status]));
    for (const [role, entry] of entries) {
      const id = entry.environmentId;
      if (!id || status.get(id) !== 'active') continue;
      await client.archiveEnvironment(id);
      removed.push(`environment ${recordName(progress?.key ?? '', role)} đã archive`);
    }
  }

  const roles = await client.getRoles(companyId, projectId);
  // Server chỉ nhận agent đang trong dòng vai trò: tiến độ có thể còn agent owner đã thay ở ô (wizard web), hay dòng vai
  // trò đã bị xóa ở lần chạy trước.
  const inRoles = new Set(roles ? roleAgentIds(roles) : []);
  const releaseIds = agentIds.filter((id) => inRoles.has(id.toLowerCase()));
  if (releaseIds.length > 0) {
    // Máy khác đã dựng project: server archive environment `@máy` và xếp việc gỡ checkout; máy này giữ cách cũ (lệnh tay).
    const { machineId } = await deps.ops.call('jobTargets');
    const released = await client.releaseProjectMachines(companyId, projectId, {
      agentIds: releaseIds,
      wholeProject: true,
      primaryMachineId: machineId,
    });
    if (released && (released.archivedEnvironmentIds.length > 0 || released.jobs.length > 0)) {
      removed.push(
        `${released.archivedEnvironmentIds.length} environment trên máy khác đã archive, gỡ checkout trên ${released.jobs.length} máy khác`,
      );
    }
  }

  await deps.ops.call('removeStatusRepo', projectId);
  removed.push('repo docs khỏi bản tin máy');

  if (roles) {
    await client.deleteRoles(companyId, projectId);
    removed.push('vai trò của project');
  }

  if (progress) {
    await deps.store.update((s) => {
      const { [progress.key]: _gone, ...rest } = s.projects;
      return { ...s, projects: rest };
    });
  }
  deps.log?.('project-removed', { projectId, key: progress?.key ?? null, steps: removed.length });
  return { removed, manualCommand: progress ? manualRemoveCommand(progress) : '' };
}
