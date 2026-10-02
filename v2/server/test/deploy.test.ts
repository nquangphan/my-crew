import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { deployTicketFingerprint, readDeployAuthorization } from '../src/tickets/deploy.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(4);

test('machine cannot create deploy request or unapproved deploy descendant', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'c'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    const machine = { kind: 'machine' as const, id: machineId };
    await assert.rejects(
      () =>
        f.mutation('machine-deploy-root', (tx) =>
          f.services.createTicket(
            tx,
            inputTicket(f.project.id, 'request', null, { kind: 'deploy' }),
            machine,
          ),
        ),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
    await assert.rejects(
      () =>
        f.mutation('machine-deploy-child', (tx) =>
          f.services.createTicket(
            tx,
            inputTicket(f.project.id, 'step', f.request.id, { kind: 'deploy' }),
            machine,
          ),
        ),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
  }));

test('owner-created deploy request authorizes only itself; machine child needs exact action approval', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'d'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    const root = await f.mutation('owner-deploy-root', (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request', null, { kind: 'deploy' }), owner),
    );
    const staging = inputTicket(f.project.id, 'step', root.id, {
      kind: 'deploy',
      title: 'Triển khai staging',
    });
    const machine = { kind: 'machine' as const, id: machineId };
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, root.id)), 'owner_deploy_request');
    await assert.rejects(
      () => f.mutation('unapproved-owner-root-child', (tx) => f.services.createTicket(tx, staging, machine)),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
    const approvalId = await f.mutation('approve-staging-under-owner-root', (tx) =>
      f.services.recordDecision(
        tx,
        root.id,
        {
          kind: 'approval',
          content: 'Duyệt staging',
          rationale: 'Đúng môi trường đã chọn',
          sources: [],
          scope: {
            action: 'deploy',
            rootTicketId: root.id,
            ticketDefinitionHash: deployTicketFingerprint(staging, root.id),
          },
        },
        owner,
      ),
    );
    await assert.rejects(
      () =>
        f.mutation('changed-target-under-owner-root', (tx) =>
          f.services.createTicket(
            tx,
            { ...staging, title: 'Triển khai production', deployApprovalDecisionId: approvalId },
            machine,
          ),
        ),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
    await assert.rejects(
      () =>
        f.mutation('changed-body-under-owner-root', (tx) =>
          f.services.createTicket(
            tx,
            { ...staging, inputs: { target: 'production' }, deployApprovalDecisionId: approvalId },
            machine,
          ),
        ),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
    const child = await f.mutation('approved-staging-under-owner-root', (tx) =>
      f.services.createTicket(tx, { ...staging, deployApprovalDecisionId: approvalId }, machine),
    );
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, child.id)), 'owner_approval');
    const ownerChild = await f.mutation('owner-child-under-owner-root', (tx) =>
      f.services.createTicket(
        tx,
        inputTicket(f.project.id, 'step', root.id, { kind: 'deploy', title: 'Triển khai khác' }),
        owner,
      ),
    );
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, ownerChild.id)), null);
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, f.request.id)), null);
  }));

test('machine deploy child under ordinary root needs exact persisted owner approval', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'Mac',${'e'.repeat(64)})`;
    await db`update projects set machine_id=${machineId},checkout_path='/tmp/crew' where id=${f.project.id}`;
    const candidate = inputTicket(f.project.id, 'step', f.request.id, {
      kind: 'deploy',
      title: 'Triển khai staging',
    });
    const fingerprint = deployTicketFingerprint(candidate, f.request.id);
    const decisionId = await f.mutation('exact-deploy-approval', (tx) =>
      f.services.recordDecision(
        tx,
        f.request.id,
        {
          kind: 'approval',
          content: 'Duyệt triển khai staging',
          rationale: 'Đã xem tác động',
          sources: [],
          scope: { action: 'deploy', rootTicketId: f.request.id, ticketDefinitionHash: fingerprint },
        },
        owner,
      ),
    );
    await assert.rejects(
      () =>
        f.mutation('changed-deploy-title', (tx) =>
          f.services.createTicket(
            tx,
            { ...candidate, title: 'Triển khai production', deployApprovalDecisionId: decisionId },
            { kind: 'machine', id: machineId },
          ),
        ),
      { code: 'DEPLOY_OWNER_INTENT_REQUIRED' },
    );
    const child = await f.mutation('approved-deploy-child', (tx) =>
      f.services.createTicket(
        tx,
        { ...candidate, deployApprovalDecisionId: decisionId },
        { kind: 'machine', id: machineId },
      ),
    );
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, child.id)), 'owner_approval');
  }));

test('deploy completion accepts owner-created request but requires approval for a child elsewhere', async () =>
  withDatabase(async (db) => {
    const f = await ticketFixture(db);
    const authority = createTicketServices({
      execution: {
        verifySignal: async () => {},
        verifyRepairResult: async () => {},
        requestTerminalIntent: async () => {},
      },
    });
    const rootInput = inputTicket(f.project.id, 'request', null, { kind: 'deploy' });
    const deployRoot = await f.mutation('explicit-deploy-root', (tx) =>
      authority.createTicket(tx, rootInput, owner),
    );
    await db`update tickets set status='running' where id=${deployRoot.id}`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${deployRoot.id},'deploy_result',${db.json({ verification: 'verified' })})`;
    const rootDone = await f.mutation('explicit-deploy-done', (tx) =>
      authority.applyExecutionSignal(tx, deployRoot.id, 'passed', 1, null, owner),
    );
    assert.equal(rootDone.status, 'done');

    const childInput = inputTicket(f.project.id, 'step', f.request.id, { kind: 'deploy' });
    const child = await f.mutation('owner-deploy-child', (tx) =>
      authority.createTicket(tx, childInput, owner),
    );
    await db`update tickets set status='running' where id=${child.id}`;
    await db`insert into evidence(id,ticket_id,kind,data) values
      (${randomUUID()},${child.id},'deploy_result',${db.json({ verification: 'verified' })})`;
    await assert.rejects(
      () =>
        f.mutation('unapproved-deploy-done', (tx) =>
          authority.applyExecutionSignal(tx, child.id, 'passed', 1, null, owner),
        ),
      { code: 'COMPLETION_GATE' },
    );
    await f.mutation('approve-existing-deploy', (tx) =>
      authority.recordDecision(
        tx,
        child.id,
        {
          kind: 'approval',
          content: 'Duyệt ticket deploy',
          rationale: 'Đã kiểm tra',
          sources: [],
          scope: {
            action: 'deploy',
            targetTicketId: child.id,
            ticketDefinitionHash: deployTicketFingerprint(childInput, f.request.id),
          },
        },
        owner,
      ),
    );
    const done = await f.mutation('approved-deploy-done', (tx) =>
      authority.applyExecutionSignal(tx, child.id, 'passed', 1, null, owner),
    );
    assert.equal(done.status, 'done');
  }));
