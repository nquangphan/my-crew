import { describe, expect, it } from 'vitest';
import { createRequestTicket, createSubtask } from '../../api/src/services/ticket-service.js';
import { VpsClient } from '../src/api/vps-client.js';
import { parseConfig } from '../src/config.js';
import { docsInitGate } from '../src/roles/docs-init-gate.js';
import { StateDb } from '../src/state-db.js';
import { JobWriter } from '../src/tools/ticket-mcp-server.js';
import { commentsOf, fixture, getTicket, reportAndFinish, useApi } from './helpers/api.js';
import { bundlePath, makeWorkflowRepo } from './helpers/workflow.js';

const api = useApi();

async function setup(docs: boolean) {
  const f = await fixture(api);
  const { repo } = makeWorkflowRepo({ docs });
  const request = await createRequestTicket(api.db, { title: 'Yêu cầu' });
  const pm = await createSubtask(api.db, {
    type: 'pm_task',
    parentId: request.id,
    projectId: f.projectId,
    title: 'PM',
  });
  const vps = new VpsClient({ apiUrl: f.server.url, token: () => f.machine.token });
  const state = new StateDb(':memory:');
  const job = state.insertJob({
    ticketId: pm.id,
    projectId: f.projectId,
    role: 'pm',
    trigger: 'ticket.assigned',
  });
  const project = parseConfig({
    apiUrl: f.server.url,
    machineName: 'm',
    projects: [{ key: f.projectKey, repoPath: repo }],
  }).projects[0] as NonNullable<ReturnType<typeof parseConfig>['projects'][number]>;
  const gate = async () =>
    docsInitGate({
      pm: await vps.getTicket(pm.id),
      project,
      crewDocs: { bundle: bundlePath(), runtime: process.execPath },
      vps,
      writer: new JobWriter(state, job.id),
    });
  return { f, pm, gate, vps };
}

describe('docs-init gate', () => {
  it('creates one docs-init child on sonnet when crew-docs says NOT_INITIALIZED, and the PM waits', async () => {
    const { pm, gate, vps } = await setup(false);
    const first = await gate();
    expect(first).toMatchObject({ action: 'wait', created: true });
    const again = await gate();
    expect(again).toMatchObject({ action: 'wait', created: false });
    const detail = await vps.getTicket(pm.id);
    const inits = detail.children.filter((child) => child.type === 'docs_init');
    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatchObject({ model: 'sonnet', effort: 'high', assigneeRole: 'dev' });
    expect(detail.ticket.status).toBe('triage');
    expect((await commentsOf(api.db, pm.id)).map((c) => c.body).join('\n')).toContain(
      inits[0]?.key as string,
    );
  });

  it('lets the PM analyze once the docs-init child is done', async () => {
    const { pm, gate, vps } = await setup(false);
    await gate();
    const init = (await vps.getTicket(pm.id)).children[0];
    await reportAndFinish(api.db, init?.id as string);
    expect(await gate()).toMatchObject({ action: 'proceed', docsInit: { id: init?.id } });
  });

  it('does nothing for a project that already has docs', async () => {
    const { pm, gate, vps } = await setup(true);
    expect(await gate()).toEqual({ action: 'proceed', docsInit: null });
    expect((await vps.getTicket(pm.id)).children).toEqual([]);
    expect((await getTicket(api.db, pm.id)).status).toBe('todo');
  });
});
