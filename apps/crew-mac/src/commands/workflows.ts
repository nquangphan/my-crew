import { type MacContext, SetupError } from '../context.js';
import { installBmadPin } from '../workflows/bmad-install.js';
import { checksumOrNull, installSuperpowersPin, pathExists } from '../workflows/install.js';
import { agentExtraArgs, pinDir } from '../workflows/pin.js';
import { type CertifiedWorkflow, certifiedWorkflows } from '../workflows/registry.js';
import { gcAfterInstall, gcReportLines, gcWorkflowPins } from '../workflows/workflow-gc.js';

export const WORKFLOWS_USAGE = 'crew-mac workflows list [--json] | install | gc';

type InstallState = 'installed' | 'missing' | 'mismatch';

function installState(dir: string, w: CertifiedWorkflow): InstallState {
  if (!pathExists(dir)) return 'missing';
  return checksumOrNull(dir) === w.pin.checksum ? 'installed' : 'mismatch';
}

const STATE_TEXT: Record<InstallState, string> = {
  installed: 'đã cài',
  missing: 'chưa cài',
  mismatch: 'lệch checksum',
};

function list(ctx: MacContext, json: boolean): void {
  const rows = certifiedWorkflows(ctx).map((w) => {
    const dir = pinDir(ctx.home, w.pin);
    return { w, dir, state: installState(dir, w) };
  });
  if (json) {
    ctx.out(
      JSON.stringify(
        rows.map(({ w, dir, state }) => ({
          id: w.id,
          version: w.pin.version,
          revision: w.pin.revision,
          checksum: w.pin.checksum,
          runtimes: w.runtimes,
          isDefault: w.isDefault,
          purpose: w.purpose,
          dir,
          installed: state === 'installed',
        })),
      ),
    );
    return;
  }
  for (const { w, state } of rows) {
    ctx.out(
      `${w.id} ${w.pin.version} rev=${w.pin.revision.slice(0, 12)} ${STATE_TEXT[state]} ${w.isDefault ? 'mặc định' : '-'}`,
    );
  }
}

/**
 * Cài riêng các bản ghim workflow (Superpowers rồi BMAD) mà không chạy lại cả `setup`: không đụng sshd, launchd hay
 * file nào khác, nên chạy được khi app 2P Crew đang giữ sshd agent.
 */
async function install(ctx: MacContext): Promise<void> {
  const sp = installSuperpowersPin(ctx);
  const bmad = await installBmadPin(ctx);
  ctx.out(`extraArgs (vai thường): ${JSON.stringify(agentExtraArgs(sp.dir))}`);
  ctx.out(`extraArgs (vai bmad): ${JSON.stringify(agentExtraArgs(bmad.dir))}`);
  gcAfterInstall(ctx);
}

/** `crew-mac workflows <lệnh con>`: 0 đạt, 1 lỗi cài, 2 sai cách dùng. */
export async function workflowsCommand(
  ctx: MacContext,
  argv: readonly string[],
  err: (line: string) => void = ctx.out,
): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'list' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--json'))) {
    list(ctx, rest[0] === '--json');
    return 0;
  }
  if (sub === 'install' && rest.length === 0) {
    try {
      await install(ctx);
      return 0;
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      err(`crew-mac: ${error.message}`);
      return 1;
    }
  }
  if (sub === 'gc' && rest.length === 0) {
    for (const line of gcReportLines(gcWorkflowPins(ctx))) ctx.out(line);
    return 0;
  }
  err(`crew-mac: cách dùng: ${WORKFLOWS_USAGE}`);
  return 2;
}
