import { findByProjectId, manualRemoveCommand, type ProjectDeps, recordName } from './progress.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gỡ project khỏi Mac: pause agent của project (chỉ agent app đã tạo, theo tiến độ trong `app.json`), archive
 * environment riêng của chúng (không bao giờ DELETE: xóa kéo theo secret SSH dùng chung), `crew-mac status
 * remove-repo`, xóa dòng vai trò. Không xóa project trên Paperclip, không xóa checkout: trả lệnh để owner tự chạy.
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

  await deps.ops.call('removeStatusRepo', projectId);
  removed.push('repo docs khỏi bản tin máy');

  if (await client.getRoles(companyId, projectId)) {
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
  return { removed, manualCommand: progress ? manualRemoveCommand(progress.key) : '' };
}
