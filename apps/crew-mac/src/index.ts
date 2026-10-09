export { type CheckResult, type CheckStatus, type DoctorOptions, doctor } from './commands/doctor.js';
export { type SetupOptions, type SetupReport, setup } from './commands/setup.js';
export {
  addStatusRepo,
  configureStatus,
  listStatusRepos,
  readStatusConfig,
  removeStatusRepo,
  type StatusConfig,
  type StatusRepo,
  sendStatus,
  setStatusSecret,
} from './commands/status.js';
export { stopRun } from './commands/stop-run.js';
export { scanUninstallBlockers, uninstall } from './commands/uninstall.js';
export { type WorkflowReport, workflowCheck } from './commands/workflow-check.js';
export { type MacContext, SetupError } from './context.js';
export { createMacContext } from './context-factory.js';
export { filesCommand } from './files/command.js';
export type { ManifestFile, RunManifest } from './files/types.js';
export { type InstallCrewMacResult, installCrewMacFrom } from './install-cli.js';
export { type Manifest, readManifest } from './manifest.js';
export { DEFAULT_PORT, forbiddenRootReason, type MacPaths, macPaths, SSHD_LABEL } from './paths.js';
export { listProcesses, type ProcInfo, readCwds } from './reaper/process-table.js';
export { isClaudePrint } from './reaper/select.js';
export { isCrewListener, readSshdPid, type SshdOwner } from './sshd-owner.js';
export { type AppReport, readAppState } from './status/app-state.js';
export { type CommandRunner, createRunner } from './system.js';
