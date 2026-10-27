/**
 * Kiểu của Paperclip client. Hình dạng theo API thật của fork `v2026.1005.0`: project có `urlKey`
 * (không có `key`), environment chỉ archive (không bao giờ xóa, vì xóa kéo theo secret SSH dùng chung), agent tạo
 * ra không ở `paused` được nên tạo với heartbeat tắt rồi gọi `pauseAgent` nếu cần.
 */

/** Vai trò agent theo project trong bảng plugin `crew_project_roles`. */
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
  /** Bắt buộc, như agent R1 (vd. `claude-sonnet-5-5`); không đặt thì Claude chạy model mặc định của máy. */
  model: string;
  /** Mức effort của bảng cài đặt model; `null`/không đặt thì không ghi `adapterConfig.effort`. */
  effort?: string | null;
  defaultEnvironmentId: string;
}

/** Một ô của bảng cài đặt model: model và effort mặc định của một vai. */
export interface ModelSettingsCell {
  model: string;
  effort: string | null;
}

/** Phần `GET /api/crew/model-settings` mà app dùng: model mặc định theo vai (bảng đầy đủ còn catalog và order). */
export interface ModelSettingsRoles {
  assistant: ModelSettingsCell;
  executor: ModelSettingsCell;
  reviewer: ModelSettingsCell;
  integrator: ModelSettingsCell;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  /** `idle`, `running`, `paused`, `pending_approval`, `terminated`... */
  status: string;
  companyId: string;
  defaultEnvironmentId: string | null;
  /** `adapterConfig.engine`; agent chạy qua environment SSH phải là `cli` (thiếu thì Paperclip dùng ACP và hỏng). */
  engine: string | null;
}

/**
 * Quyền của agent như board đặt qua `PATCH /agents/:id/permissions`. Paperclip mặc định cho agent mới tạo được tạo
 * agent, tạo skill và tự cấp grant `tasks:assign`; agent Crew chỉ Trợ Lý được giao việc.
 */
export interface AgentPermissions {
  canCreateAgents: boolean;
  canCreateSkills: boolean;
  /** Có grant `tasks:assign` (đọc lại từ `access.grants`). */
  canAssignTasks: boolean;
}

export interface InstructionsFile {
  content: string;
  /** `contentHash` của server (64 hex), dùng làm `baseHash` khi PUT. */
  hash: string;
}

/** Thông tin máy gửi lên route ghép máy của plugin `crew.core` (đúng các key server nhận). */
export interface MachinePairInput {
  companyId: string;
  machineId: string;
  hostname: string;
  environmentId: string;
  /** IP Tailscale (100.64.0.0/10), trùng `host` của environment SSH của máy. */
  tailscaleIp: string;
  port: number;
  /** `SHA256:<43 ký tự base64>` của host key sshd agent. */
  hostKeyFingerprint: string;
}

export interface MachinePairing {
  /** Key máy dẫn xuất (base64url, 43 ký tự): chỉ đi thẳng vào Keychain, không log, không lưu trong app. */
  machineKey: string;
  pairedAt: string;
}

export interface PaperclipClient {
  origin: string;
  me(): Promise<{ userId: string }>;
  /** Mọi company key thấy được (trừ company đã archive); app để owner tự chọn. */
  companies(): Promise<PaperclipCompany[]>;
  projects(companyId: string): Promise<PaperclipProject[]>;
  createProject(companyId: string, input: { name: string; description?: string }): Promise<{ id: string }>;
  /**
   * Environment mà server trả cho company. Environment là của cả instance (không có cột company) nên danh sách có thể
   * chứa environment của company khác: muốn lấy secret SSH để chép thì phải lọc theo `secrets(companyId)`.
   */
  environments(companyId: string): Promise<PaperclipEnvironment[]>;
  /** `GET /api/companies/:id/secrets` (cần board key): chỉ `id` và `name`, không có giá trị secret. */
  secrets(companyId: string): Promise<Array<{ id: string; name: string }>>;
  createEnvironment(companyId: string, input: SshEnvironmentInput): Promise<{ id: string }>;
  /** `PATCH {status: 'archived'}`. Client cố ý không có hàm xóa environment. */
  /** Bật lại (`status: active`) và ghi đè cấu hình SSH của environment có sẵn; không đổi tên, không xóa. */
  updateEnvironment(environmentId: string, input: SshEnvironmentInput): Promise<void>;
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
  /** `PATCH /agents/:id/permissions`; `canAssignTasks` thêm/bỏ grant `tasks:assign`. */
  setAgentPermissions(agentId: string, permissions: AgentPermissions): Promise<void>;
  /**
   * Đọc lại quyền từ `GET /agents/:id` như `agent-permissions.sh` của fork: `canCreateAgents` chỉ khi đúng `true`,
   * `canCreateSkills` trừ khi đúng `false` (mặc định server là được), `canAssignTasks` khi có grant `tasks:assign`.
   * `null` khi agent không có (404).
   */
  getAgentPermissions(agentId: string): Promise<AgentPermissions | null>;
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
  /**
   * Model mặc định của các vai app tạo (`GET /api/crew/model-settings`, `settings.roles`). `null`: server chưa có route
   * (bản cũ, 404). Phản hồi sai dạng thì ném.
   */
  modelSettingsRoles(): Promise<ModelSettingsRoles | null>;
  /** 400 của plugin (luật vai trò) thành `PaperclipHttpError` có lời từ chối của server trong message. */
  setRoles(companyId: string, projectId: string, roles: ProjectRoles): Promise<void>;
  deleteRoles(companyId: string, projectId: string): Promise<void>;
  /** Public key SSH Paperclip dùng vào máy (`GET …/machines/pair-info`). 409 khi server chưa có key. */
  pairInfo(companyId: string): Promise<{ paperclipSshPublicKey: string }>;
  /**
   * Ghép máy (`POST …/machines/pair`), nhận key máy một lần. 409 `machine_revoked` khi máy đã bị gỡ trên web (chỉ
   * ghép lại khi `allowRepair`, do owner bấm "Ghép lại máy này"); 409 `machine_uses_company_secret` khi máy đang gửi
   * bản tin bằng secret company và chưa từng ghép.
   */
  pairMachine(input: MachinePairInput, options?: { allowRepair?: boolean }): Promise<MachinePairing>;
  /** `null`: server chưa có route (bản cũ). */
  machineBlockers(
    companyId: string,
    projectId: string,
    agentIds: string[] | null,
  ): Promise<MachineReleaseBlocker[] | null>;
  releaseProjectMachines(
    companyId: string,
    projectId: string,
    body: { agentIds: string[]; wholeProject: boolean; primaryMachineId: string | null },
  ): Promise<MachineReleaseResult | null>;
  provisionProjectMachines(
    companyId: string,
    projectId: string,
    body: {
      exceptMachineId: string | null;
      includeReady: boolean;
      repo: { originUrl: string; branch: string } | null;
    },
  ): Promise<MachineProvisionResult | null>;
}

/** Cây ghim máy của project còn run chờ hay đang chạy (route Crew `…/machines/blockers`). */
export interface MachineReleaseBlocker {
  issueId: string;
  identifier: string | null;
  hostname: string;
  runStatus: string;
}

export interface MachineReleaseResult {
  archivedEnvironmentIds: string[];
  jobs: { machineId: string; jobId: string }[];
}

export interface MachineProvisionResult {
  queued: { machineId: string; jobId: string }[];
  skipped: { machineId: string; reason: string }[];
}
