/**
 * Kiểu của Paperclip client (Interface I6). Hình dạng theo API thật của fork `v2026.1005.0`: project có `urlKey`
 * (không có `key`), environment chỉ archive (không bao giờ xóa, vì xóa kéo theo secret SSH dùng chung), agent tạo
 * ra không ở `paused` được nên tạo với heartbeat tắt rồi gọi `pauseAgent` nếu cần.
 */

/** Vai trò agent theo project trong bảng plugin `crew_project_roles` (Interface I7). */
export interface ProjectRoles {
  assistantAgentId: string;
  executorAgentIds: string[];
  reviewerAgentId: string;
  integratorAgentId: string;
}

export interface PaperclipCompany {
  id: string;
  name: string;
  /** Tiền tố issue, cũng là đoạn đầu link web (`/<issuePrefix>/agents/...`). */
  issuePrefix: string;
  requireBoardApprovalForNewAgents: boolean;
}

export interface PaperclipProject {
  id: string;
  name: string;
  urlKey: string;
}

/** Environment SSH `in_place`: run chạy ngay trong `remoteWorkspacePath` trên Mac, không chép workspace. */
export interface SshEnvironmentInput {
  name: string;
  description?: string;
  host: string;
  port: number;
  username: string;
  /** Đường dẫn tuyệt đối của checkout riêng của agent trên Mac. */
  remoteWorkspacePath: string;
  /** Secret SSH dùng chung, lấy từ `privateKeySecretRef.secretId` của một environment có sẵn. */
  privateKeySecretId: string;
  knownHosts: string | null;
  crewLoadGate?: { maxLoad1: number; maxWaitMinutes: number };
}

export interface PaperclipEnvironment {
  id: string;
  name: string;
  driver: string;
  status: 'active' | 'archived';
  /** Cấu hình như server trả (khóa riêng chỉ ở dạng `privateKeySecretRef`, không có giá trị). */
  config: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export interface ClaudeLocalAgentInput {
  name: string;
  title?: string;
  /** Đường dẫn tuyệt đối `<home>/.crew/bin/crew-claude-run`. */
  command: string;
  extraArgs: string[];
  model?: string;
  defaultEnvironmentId: string;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  /** `idle`, `running`, `paused`, `pending_approval`, `terminated`... */
  status: string;
  companyId: string;
  defaultEnvironmentId: string | null;
}

export interface InstructionsFile {
  content: string;
  /** `contentHash` của server (64 hex), dùng làm `baseHash` khi PUT. */
  hash: string;
}

export interface PaperclipClient {
  origin: string;
  me(): Promise<{ userId: string }>;
  /** Mọi company key thấy được (trừ company đã archive); app để owner tự chọn. */
  companies(): Promise<PaperclipCompany[]>;
  projects(companyId: string): Promise<PaperclipProject[]>;
  createProject(companyId: string, input: { name: string; description?: string }): Promise<{ id: string }>;
  environments(companyId: string): Promise<PaperclipEnvironment[]>;
  createEnvironment(companyId: string, input: SshEnvironmentInput): Promise<{ id: string }>;
  /** `PATCH {status: 'archived'}`. Client cố ý không có hàm xóa environment. */
  archiveEnvironment(environmentId: string): Promise<void>;
  /** Tạo agent `claude_local`, heartbeat tắt, `maxConcurrentRuns = 1`. */
  createAgent(companyId: string, input: ClaudeLocalAgentInput): Promise<{ id: string; status: string }>;
  getAgent(agentId: string): Promise<PaperclipAgent | null>;
  /** Mọi agent của company (kể cả `terminated`), để tìm lại agent đã tạo khi response bị mất. */
  agents(companyId: string): Promise<PaperclipAgent[]>;
  pauseAgent(agentId: string): Promise<void>;
  /** `POST /agents/:id/resume` → `idle`; server từ chối agent `pending_approval`/`terminated` (409). */
  resumeAgent(agentId: string): Promise<void>;
  patchAgent(agentId: string, patch: Record<string, unknown>): Promise<void>;
  /** `null` khi file chưa có (404). */
  getInstructionsFile(agentId: string, path: 'AGENTS.md'): Promise<InstructionsFile | null>;
  /** `baseHash` = `hash` của lần GET trước, `null` chỉ khi file chưa có (server trả 409 nếu đã có). */
  putInstructionsFile(
    agentId: string,
    path: 'AGENTS.md',
    content: string,
    baseHash: string | null,
  ): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  /** Link mở run trên web: `<origin>/<issuePrefix>/agents/<agentId>/runs/<runId>`. */
  runWebUrl(runId: string): Promise<string>;
  getRoles(companyId: string, projectId: string): Promise<ProjectRoles | null>;
  /** 400 của plugin (luật vai trò) thành `PaperclipHttpError` có lời từ chối của server trong message. */
  setRoles(companyId: string, projectId: string, roles: ProjectRoles): Promise<void>;
  deleteRoles(companyId: string, projectId: string): Promise<void>;
}
