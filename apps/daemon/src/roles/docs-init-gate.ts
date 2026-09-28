import type { Ticket, TicketDetailResponse } from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import type { ProjectConfig } from '../config.js';
import { runCrewDocs } from '../git/docs-kit-bridge.js';
import { createDocsInitTicket, type JobWriter } from '../tools/ticket-mcp-server.js';

/** Exit code of `crew-docs check` when the repo has no `docs/flows.yaml`. */
export const NOT_INITIALIZED_EXIT = 3;

export type DocsInitGateResult =
  /** Docs exist (or were just initialized by a finished docs-init child): the PM analyzes now. */
  | { action: 'proceed'; docsInit: Ticket | null }
  /** A docs-init child runs first; the PM wakes on `children.all_done` when it is done. */
  | { action: 'wait'; docsInit: Ticket; created: boolean };

export function isOpen(ticket: Pick<Ticket, 'status'>): boolean {
  return ticket.status !== 'done' && ticket.status !== 'cancelled';
}

/**
 * The docs-init gate of PM analyze. A project whose `crew-docs check` exits 3 (NOT_INITIALIZED) gets a
 * `docs_init` child of the pm_task, created by the daemon (never by the agent) with the fixed sonnet model.
 * The PM then waits: it analyzes once docs-init is done, so it reads real docs, and every subtask it creates
 * depends on the docs-init ticket (the `create_subtask` tool adds that dependency).
 */
export async function docsInitGate(input: {
  pm: TicketDetailResponse;
  project: ProjectConfig;
  crewDocs: { bundle: string; runtime: string } | null;
  vps: VpsClient;
  writer: JobWriter;
}): Promise<DocsInitGateResult> {
  const { pm, project, crewDocs, vps, writer } = input;
  const existing = pm.children.find((child) => child.type === 'docs_init' && child.status !== 'cancelled');
  if (existing) {
    return isOpen(existing)
      ? { action: 'wait', docsInit: existing, created: false }
      : { action: 'proceed', docsInit: existing };
  }
  // Without crew-docs the gate cannot tell; the doctor check reports the missing install.
  if (!crewDocs) return { action: 'proceed', docsInit: null };
  const check = runCrewDocs(crewDocs.bundle, ['check', '--all'], project.repoPath, crewDocs.runtime);
  if (check.code !== NOT_INITIALIZED_EXIT) return { action: 'proceed', docsInit: null };

  const ticket = pm.ticket;
  const docsInit = await writer.write((key) =>
    createDocsInitTicket(
      vps,
      {
        pmTaskId: ticket.id,
        title: `Khởi tạo docs cho dự án ${project.key}`,
        description: [
          `Dự án ${project.key} chưa có docs theo chuẩn 2P Crew (\`crew-docs check\` trả về NOT_INITIALIZED).`,
          `Ticket này chạy trước mọi subtask khác của ${ticket.key}: viết toàn bộ docs theo STANDARD.md,`,
          'đạt `crew-docs check --all`, rồi commit một lần với trailer `Crew-Docs-Init: true`.',
        ].join(' '),
      },
      key,
    ),
  );
  await writer.write((key) =>
    vps.comment(
      ticket.id,
      {
        role: 'pm',
        body:
          `Dự án chưa có docs (\`crew-docs check\` báo NOT_INITIALIZED). Daemon đã tạo ${docsInit.key} để khởi tạo docs ` +
          'bằng model sonnet. PM sẽ phân tích yêu cầu sau khi docs xong; mọi subtask sau đó phụ thuộc vào ticket này.',
      },
      key,
    ),
  );
  if (ticket.status === 'todo') await writer.write((key) => vps.transition(ticket.id, 'triage', key));
  return { action: 'wait', docsInit, created: true };
}
