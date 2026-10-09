import type { PaperclipClient } from '../paperclip/types.js';
import assistant from './templates/assistant.md?raw';
import executor from './templates/executor.md?raw';
import integrator from './templates/integrator.md?raw';
import reviewer from './templates/reviewer.md?raw';

/**
 * Instructions theo vai trò cho agent của project. Template chép nguyên văn từ `crew/agents/*.md` của fork; các hàm
 * dưới là bản port của `render-instructions.mjs`, `add-base.mjs` và phần ghim Superpowers của
 * `merge-agent-config.mjs`, chạy trong app thay vì shell trên VPS.
 */
export type RoleTemplate = 'assistant' | 'executor' | 'reviewer' | 'integrator';

export const ROLE_TEMPLATES: Record<RoleTemplate, string> = { assistant, executor, reviewer, integrator };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\/.+\/\.crew\/workflows\/superpowers\/(?!\.\.?$)[^/]+$/;

function checkIds(ids: string[], label: string, agentId: string, taken: Set<string>): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`${label} phải là uuid: ${id}`);
    const key = id.toLowerCase();
    if (seen.has(key) || taken.has(key)) throw new Error(`${label} trùng: ${id}`);
    if (key === agentId.toLowerCase())
      throw new Error(`Trợ Lý không được nằm trong danh sách ${label} của chính nó`);
    seen.add(key);
  }
  return seen;
}

/**
 * Như `renderInstructions` của fork: chỉ Trợ Lý nhận danh sách executor và agent BMAD (của project), thêm vào cuối
 * file. Project app tạo không có agent BMAD nên mục này ghi "Không có. Luôn dùng Superpowers.".
 */
export function renderInstructions(
  role: RoleTemplate,
  text: string,
  agentId: string,
  executorIds: string[],
  bmadIds: string[] = [],
): string {
  if (!(role in ROLE_TEMPLATES)) throw new Error(`unknown role: ${role}`);
  if (role !== 'assistant') {
    if (executorIds.length > 0) throw new Error('danh sách executor chỉ assistant nhận');
    if (bmadIds.length > 0) throw new Error('danh sách agent BMAD chỉ assistant nhận');
    return text;
  }
  if (!UUID_RE.test(agentId)) throw new Error(`assistant phải là uuid: ${agentId}`);
  if (executorIds.length === 0) throw new Error('assistant cần ít nhất một executor');
  const executors = checkIds(executorIds, 'executor', agentId, new Set());
  checkIds(bmadIds, 'agent BMAD', agentId, executors);
  const list = executorIds.map((id) => `- \`${id}\``).join('\n');
  const bmad =
    bmadIds.length > 0 ? bmadIds.map((id) => `- \`${id}\``).join('\n') : 'Không có. Luôn dùng Superpowers.';
  return `${text.replace(/\n*$/, '\n')}\n## Executor của company\n\n${list}\n\n## Agent BMAD của company\n\n${bmad}\n`;
}

/** `extraArgs` ghim Superpowers như `merge-agent-config.mjs`; thư mục phải là bản ghim `~/.crew/workflows/superpowers/<bản>`. */
export function pinnedExtraArgs(pinDir: string): string[] {
  if (!pinDir.startsWith('/')) throw new Error(`thư mục Superpowers phải là đường dẫn tuyệt đối: ${pinDir}`);
  if (!PIN_RE.test(pinDir))
    throw new Error(
      `thư mục Superpowers phải là bản ghim <home>/.crew/workflows/superpowers/<bản>: ${pinDir}`,
    );
  return ['--setting-sources', 'project,local', '--plugin-dir', pinDir];
}

/**
 * Tải `AGENTS.md` theo luật của `add-base.mjs`: `baseHash` = hash của file hiện có (agent mới đã có sẵn file),
 * `null` chỉ khi server trả 404; lỗi khác ném, không đoán. Nội dung đã đúng thì không ghi.
 */
export async function uploadInstructions(
  client: Pick<PaperclipClient, 'getInstructionsFile' | 'putInstructionsFile'>,
  agentId: string,
  content: string,
): Promise<'uploaded' | 'unchanged'> {
  const current = await client.getInstructionsFile(agentId, 'AGENTS.md');
  if (current && current.content === content) return 'unchanged';
  await client.putInstructionsFile(agentId, 'AGENTS.md', content, current?.hash ?? null);
  return 'uploaded';
}
