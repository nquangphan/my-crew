/** Library entry of the 2P Crew daemon: the CLI and the desktop app both build on these exports. */
export { VpsClient, VpsError } from './api/vps-client.js';
export { doctor, renderHealth } from './commands/doctor.js';
export * from './config.js';
export {
  type CreateDaemonOptions,
  createDaemon,
  type Daemon,
  type DaemonStatus,
  type Logger,
} from './daemon.js';
export {
  CREW_DOCS_BUNDLE,
  hookStatus,
  installCrewDocs,
  installHooks,
  packagedCrewDocs,
  runCrewDocs,
} from './git/docs-kit-bridge.js';
export { detectSharedPaths, removeWorktree } from './git/worktree-manager.js';
export { loginProbe, MIN_CLAUDE_VERSION } from './health/checks/claude.js';
export { OFFICIAL_UI_TEST_SERVERS } from './health/checks/mcp.js';
export { missingHookFiles } from './health/checks/repos.js';
export {
  applyHealthFix,
  execCommand,
  HEALTH_CHECKS,
  runHealthChecks,
  summarize,
} from './health/health-runner.js';
export { serverProjects, storedInventory } from './health/project-views.js';
export {
  inspectFolder,
  normalizeRepoUrl,
  repoFolderChecks,
  sameRepo,
  suggestProjectKey,
} from './health/repo-probe.js';
export type {
  HealthAppFacts,
  HealthCheck,
  HealthCheckResult,
  HealthContext,
  HealthGroup,
} from './health/types.js';
export { resolveModel } from './roles/model-policy.js';
export { renderPrompt, setPromptsDir } from './roles/prompt-templates.js';
export { rolePlanner } from './roles/role-planner.js';
export { resolveStage, STAGES, type StageContract } from './roles/role-registry.js';
export {
  type AgentRunner,
  type AgentRunResult,
  agentEnv,
  createSdkRunner,
  type RunAgentOptions,
  RunControl,
  sdkRuntimeVersion,
} from './runner/agent-runner.js';
export { evaluateToolCall, type GuardContext } from './runner/guard-hook.js';
export { cleanupJob, findOrphans, sweepOrphans } from './runner/job-cleanup.js';
export {
  type AfterRunDecision,
  type AfterRunInput,
  chooseModel,
  defaultPlanner,
  type PlanInput,
  type PlannedRun,
  type PlannerContext,
  type RolePlanner,
} from './runner/job-runner.js';
export { buildResourceReport, ResourceOps, type ResourceReport } from './runner/resource-report.js';
export { ResourceTracker } from './runner/resource-tracker.js';
export { createScriptedRunner, Script, ScriptedCrash } from './runner/scripted-runner.js';
export { scrubSecrets } from './runner/secret-scrubber.js';
export { takeSnapshot, totalSlots } from './scheduler/resource-monitor.js';
export { defaultTokenStore, FileTokenStore, KeychainTokenStore, type TokenStore } from './secrets.js';
export { probeInventory } from './skills/skill-inventory.js';
export { type JobKind, type JobRow, type JobStatus, StateDb } from './state-db.js';
export { createDocsInitTicket, DocsHandoff } from './tools/ticket-mcp-server.js';
export { allowedToolsFor, TICKET_SERVER, ticketToolsFor } from './tools/tool-scopes.js';
