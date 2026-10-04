import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { CapacityReceipt, CapacityRequest, TurnFence } from '../../src/assistant/contracts.ts';
import type { MessageSubmission } from '../../src/attachments/contracts.ts';
import { createMessageServices } from '../../src/attachments/messages.ts';
import { connectDb } from '../../src/db/client.ts';
import { createCommand } from '../../src/execution/commands.ts';
import { canonicalJson } from '../../src/journal/canonical.ts';
import type { Db, Id, Tx } from '../../src/platform/contracts.ts';
import { attachmentFixture } from './attachments.ts';
import { pin } from './execution.ts';
import { inputTicket, owner } from './tickets.ts';

export function assistantSchemaCompiler() {
  // Execute the public compiler used by the accepted Fastify dependency. No server,
  // request route, socket, or production authority is assembled by this helper.
  const require = createRequire(import.meta.resolve('fastify'));
  type Validate = ((input: unknown) => boolean) & { errors?: unknown };
  const factory = require('@fastify/ajv-compiler') as () => (
    schemas: Record<string, unknown>,
    options: { customOptions: Record<string, unknown> },
  ) => (input: { schema: unknown; method: string; url: string; httpPart: string }) => Validate;
  const compiler = factory()(
    {},
    { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  );
  return (schema: unknown) => compiler({ schema, method: 'POST', url: '/validation-only', httpPart: 'body' });
}

// Transport samples only: no database, HTTP authority, certificate or model call.
export function assistantContractSamples(): Record<string, unknown[]> {
  const id = randomUUID(),
    hash = 'a'.repeat(64),
    time = '2026-10-03T10:00:00.000Z';
  const key = { machineId: id, runtime: 'api', providerId: 'fixture', modelId: 'fixture' };
  const fence = {
    turnId: id,
    designationId: id,
    designationRevision: 1,
    generation: '1',
    processInstanceId: id,
  };
  const input = { snapshotId: id, snapshotSha256: hash, inputRevision: '1', selectionSha256: hash };
  const context = {
    deploymentId: id,
    machineId: id,
    key,
    binarySha256: hash,
    policySha256: hash,
    observerSha256: hash,
    osVersion: 'fixture',
  };
  const source = {
    name: 'superpowers',
    version: '1',
    sourceRevision: 'a'.repeat(40),
    sourceUrl: 'https://example.test/source',
    payloadSha256: hash,
    packageIntegrity: null,
    sourceManifestSha256: hash,
    sourceTreeSha256: hash,
  };
  const projection = {
    runtime: 'api',
    sourceTreeSha256: hash,
    manifestSha256: hash,
    treeSha256: hash,
    derivation: { tool: 'fixture', version: '1', options: [], layoutSchema: '1', policySha256: hash },
  };
  const step = {
    id,
    ticketId: id,
    skill: 'fixture',
    sourcePath: 'SKILL.md',
    sourceSha256: hash,
    predecessorIds: [],
    acceptance: ['Kiểm chứng'],
    outputKinds: ['report'],
    gateIds: [],
    ownershipKeys: ['file.ts'],
    role: 'implement',
  };
  const run = {
    id,
    rootTicketId: id,
    source,
    projection,
    definitionSha256: hash,
    customizationSha256: hash,
    renderedArtifactId: null,
    path: 'bounded',
    revision: 1,
    steps: [step],
    parallelApprovalId: null,
  };
  const refs = ['docs', 'ticket', 'artifact', 'owner_decision'].map((kind) => ({
    kind,
    id,
    path: 'README.md',
    locator: 'L1',
  }));
  const assessmentFields = {
    ticketId: id,
    candidateReadOperationId: id,
    input,
    complexity: 'bounded',
    risk: [],
    uncertainty: [],
    required: ['text'],
    strengthRationale: 'Fixture',
    sources: refs,
    candidateReasons: [{ key, reason: 'Fixture' }],
  };
  const assessment = { id, ...assessmentFields };
  const proposal = { ...assessmentFields, chosen: key, choiceRationale: 'Fixture' };
  const questionFields = {
    conversationId: id,
    ticketId: null,
    runId: null,
    stepId: null,
    gateId: null,
    cycleId: null,
    artifactSha256: null,
    question: 'Chọn?',
    options: ['Tiếp tục'],
    scopeSha256: hash,
  };
  const question = { id, ...questionFields, revision: 1, state: 'open' };
  const scope = {
    ticketId: id,
    projectId: id,
    machineId: id,
    bindingRevision: 1,
    runId: id,
    runRevision: 1,
    definitionSha256: hash,
    input,
    source: {
      name: 'superpowers',
      version: '1',
      sourceRevision: 'a'.repeat(40),
      sourceManifestSha256: hash,
      sourceTreeSha256: hash,
    },
  };
  const candidate = {
    key,
    declared: ['text'],
    capabilities: ['text'],
    available: true,
    reason: null,
    sourceDesired: true,
    sourceApplied: true,
    probe: { receiptId: id, contextSha256: hash, status: 'pass', receivedAt: time, expiresAt: time },
    projection: {
      runtime: 'api',
      sourceTreeSha256: hash,
      manifestSha256: hash,
      treeSha256: hash,
      derivationSha256: hash,
    },
    installReportId: id,
    certificationReceiptId: id,
  };
  const snapshot = {
    scope,
    observedAt: time,
    sha256: hash,
    modelConfigRevision: 1,
    modelAppliedRevision: 1,
    gatewayConfigRevision: 1,
    gatewayAppliedRevision: 1,
    inventoryReportId: id,
    bootGeneration: '1',
    entries: [candidate],
  };
  const telemetry = {
    sampleId: id,
    bootGeneration: '1',
    sampleAgeMs: 0,
    cpuLoad1: 0,
    cpuCount: 1,
    memoryAvailableBytes: '4294967296',
    memoryPressure: 'normal',
    diskAvailableBytes: '8589934592',
    activeJobs: 0,
    configuredMaxJobs: 1,
  };
  const request = {
    id,
    machineId: id,
    ticketId: id,
    kind: 'implement',
    ownershipKeys: ['file.ts'],
    bootGeneration: '1',
    requestedAt: time,
    expiresAt: time,
  };
  const receipt = {
    id,
    requestId: id,
    machineId: id,
    bootGeneration: '1',
    ticketId: id,
    kind: 'implement',
    ownershipKeys: ['file.ts'],
    telemetry,
    receivedAt: time,
    expiresAt: time,
    allowed: true,
    reason: 'Fixture',
  };
  const doc = {
    projectId: id,
    snapshotId: id,
    path: 'README.md',
    sha256: hash,
    sourceCommit: null,
    receivedAt: time,
    auditState: 'verified',
    contentClass: 'implemented',
    text: 'Fixture',
    state: 'current',
  };
  const route = {
    id,
    messageId: id,
    revision: 1,
    projectId: id,
    ticketId: id,
    decisionId: id,
    supersedesRouteId: null,
    revokedAt: null,
  };
  const dispatch = {
    command: {
      id,
      machineId: id,
      ticketId: id,
      type: 'start',
      payload: { nested: { enabled: true } },
      state: 'queued',
      result: null,
      createdAt: time,
    },
    permit: {
      commandId: id,
      ticketId: id,
      machineId: id,
      bindingRevision: 1,
      ticketRevision: 1,
      workflow: pin,
      checkedAt: time,
      expiresAt: time,
      telemetryId: id,
      decisionId: id,
    },
    selection: {
      runtime: 'api',
      sourceTreeSha256: hash,
      projectionManifestSha256: hash,
      projectionTreeSha256: hash,
      installReportId: id,
      configRevision: 1,
      decisionId: id,
    },
    modelChoice: {
      model: key,
      modelConfigRevision: 1,
      probeReceiptId: id,
      probeContextSha256: hash,
      certificationReceiptId: null,
      required: ['text'],
    },
    inputSnapshot: input,
  };
  const ticket = { ...inputTicket(id, 'request'), workflowPin: pin };
  const calls = [
    { name: 'read_catalog', input: {} },
    { name: 'read_docs', input: { projectId: id, snapshotId: id, path: 'README.md' } },
    {
      name: 'route_message',
      input: {
        messageId: id,
        expectedInputRevision: '1',
        expectedRouteRevision: 0,
        ticket,
        confidence: 0.9,
        rationale: 'Fixture',
        docReadIds: [id],
      },
    },
    { name: 'read_execution_candidates', input: { ticketId: id, runId: id } },
    { name: 'assess_ticket', input: proposal },
    { name: 'ask_owner', input: questionFields },
    { name: 'create_run', input: { rootTicketId: id, path: 'bounded', definitionSha256: hash } },
    { name: 'request_dispatch', input: { stepId: id, assessmentId: id, chosen: key, priorAttemptId: null } },
    { name: 'request_review', input: { runId: id, implementationStepId: id, implementationAttemptId: id } },
    {
      name: 'publish_reply',
      input: {
        messageId: id,
        inputRevision: '1',
        snapshotId: id,
        receiptIds: [id],
        text: 'Fixture',
        sources: refs,
      },
    },
  ];
  const values = [
    {
      kind: 'catalog',
      items: [{ projectId: id, key: 'P1', name: 'Fixture', latestSnapshotId: null, sourceCommit: null }],
    },
    { kind: 'execution_candidates', snapshot },
    { kind: 'docs', page: doc, readReceiptId: id },
    { kind: 'route', route },
    { kind: 'assessment', assessment },
    { kind: 'question', question },
    { kind: 'run', run },
    { kind: 'review', step },
    { kind: 'capacity', request },
    { kind: 'dispatch', dispatch },
    { kind: 'reply', decisionId: id },
  ];
  const selection = {
    id,
    turnId: id,
    key,
    modelConfigRevision: 1,
    probeReceiptId: id,
    policyReceiptId: id,
    required: ['text'],
    rationale: 'Fixture',
    createdAt: time,
  };
  const policyReceipt = {
    id,
    deploymentId: id,
    challengeId: id,
    verifierBuildSha256: hash,
    machineId: id,
    key,
    osVersion: 'fixture',
    binarySha256: hash,
    policySha256: hash,
    probeContextSha256: hash,
    status: 'UNVERIFIED',
    evidenceIds: [],
    expiresAt: time,
    revokedAt: null,
  };
  const launch = { challengeId: id, turnId: id, generation: '1', processInstanceId: id, context };
  const policy = {
    maxJobs: 1,
    telemetryMaxAgeMs: 15000,
    maxLoadPerCpu: 1,
    minMemoryBytes: '4294967296',
    minDiskBytes: '8589934592',
    maxTurnsPerRun: 1,
    maxToolsPerTurn: 1,
    maxCostUsdPerRun: 0,
    maxTurnMs: 1000,
    maxRecoveryAttempts: 0,
    parallelApprovalId: null,
  };
  return {
    assistantPolicySchema: [policy],
    assistantConfigSchema: [
      { designation: null, revision: 1, preferred: null, policy },
      {
        designation: { id, ownerId: 'owner', machineId: id, revision: 1 },
        revision: 1,
        preferred: key,
        policy,
      },
    ],
    dispatchInputPinSchema: [input],
    turnFenceSchema: [fence],
    assistantModelSelectionSchema: [selection],
    routingPolicyReceiptSchema: [policyReceipt],
    assistantTurnSchema: [
      {
        fence,
        conversationId: id,
        messageId: id,
        selection,
        admission: { id, admittedAt: time, modelConfigRevision: 1, sourceEnabledAtAdmission: true },
        readSessionId: null,
        state: 'running',
        checkpointArtifactId: null,
      },
    ],
    orchestrationProofSchema: [{ fence, scopeId: id, operationId: id }],
    orchestrationActionSchema: ['create_ticket', 'decision', 'dependency', 'command', 'signal'],
    docReadSchema: [doc],
    assessmentSchema: [assessment],
    assessmentProposalSchema: [proposal],
    skillStepSchema: [step],
    workflowRunSchema: [run],
    ownerQuestionSchema: [question],
    questionProposalSchema: [questionFields],
    routingCandidateSchema: [
      {
        key,
        requiredSupported: ['text'],
        sourceDesired: true,
        sourceApplied: true,
        modelConfigRevision: 1,
        probeReceiptId: id,
        probeContextSha256: hash,
        binarySha256: hash,
        probeExpiresAt: time,
        available: true,
        reason: null,
      },
    ],
    capacityRequestSchema: [request],
    assistantTelemetrySchema: [telemetry],
    capacityReceiptSchema: [receipt],
    preparedDispatchSchema: [dispatch],
    routingCertificationContextSchema: [context],
    routingCertificationChallengeSchema: [
      {
        id,
        context,
        nonce: 'opaque-nonce',
        expiresAt: time,
        maxTurns: 1,
        maxTools: 1,
        maxCostUsd: 0,
        maxMs: 1000,
        fixtureSha256: hash,
      },
    ],
    routingCertificationLaunchSchema: [launch],
    routingCertificationEvidenceSchema: [
      {
        launch,
        traceArtifactIds: [id],
        stopEvidenceId: id,
        surfaces: [{ name: 'network', allowedTrace: hash, deniedTrace: hash }],
        usage: { turns: 1, tools: 1, costUsd: 0, elapsedMs: 100 },
      },
    ],
    executionCandidateScopeSchema: [scope],
    executionCandidateSchema: [candidate, { ...candidate, projection: null }],
    executionCandidateSnapshotSchema: [snapshot],
    routingToolSchema: calls,
    routingEventSchema: [
      ...calls.map((call) => ({ kind: 'tool', providerCallId: 'provider-call', sequence: '1', call })),
      ...['completed', 'failed', 'interrupted'].map((outcome) => ({ kind: 'finished', outcome })),
    ],
    routingToolValueSchema: values,
    routingToolRequestSchema: calls.map((call) => ({
      fence,
      operationId: id,
      clientSequence: '1',
      inputSnapshot: input,
      call,
    })),
    routingToolResultSchema: [
      ...values.map((result) => ({ operationId: id, state: 'completed', result, errorCode: null })),
      { operationId: id, state: 'pending', result: null, errorCode: null },
      { operationId: id, state: 'rejected', result: null, errorCode: 'STALE' },
    ],
    launchAuthorizationSchema: [
      { id, commandId: id, processInstanceId: id, bootGeneration: '1', generation: '1', expiresAt: time },
    ],
    unclaimedStopProofSchema: [
      { kind: 'never-authorized', commandId: id, retirementId: id },
      ...['journal-no-launch', 'process-stopped'].map((kind) => ({
        kind,
        commandId: id,
        launchAuthorizationId: id,
        processInstanceId: id,
        bootGeneration: '1',
        generation: '1',
        journalSha256: hash,
        stopEvidenceId: id,
      })),
    ],
  };
}

// These helpers exercise accepted 009 producers. They do not implement
// admission, HTTP clients, routing certification, or production authority.
/** Pinned verifier build of fixture receipts; production pins its own build hash. */
export const fixtureVerifierBuildSha256 = createHash('sha256')
  .update('crew-v2:test-only-routing-verifier')
  .digest('hex');

type TurnRowsInput = {
  conversationId: Id;
  messageId: Id | null;
  machineId?: Id;
  selectionModelId?: string;
  receiptMachineId?: Id;
  receiptStatus?: 'PASS' | 'FAIL' | 'UNVERIFIED';
  verifierBuildSha256?: string;
  receiptExpiresInSeconds?: number;
  admission?: { target: { kind: 'ticket' | 'message'; id: Id }; sessionExpiresInSeconds: number };
};

// Explicit test-only SQL rows. Defaults reproduce the unadmitted UNVERIFIED turn.
async function insertTurnRows(tx: Tx, input: TurnRowsInput) {
  const { allocateAssistantGeneration } = await import('../../src/assistant/store.ts');
  const machineId = input.machineId ?? randomUUID(),
    designationId = randomUUID(),
    turnId = randomUUID();
  const selectionId = randomUUID(),
    challengeId = randomUUID(),
    receiptId = randomUUID(),
    probeId = randomUUID();
  const processInstanceId = randomUUID();
  const status = input.receiptStatus ?? 'UNVERIFIED';
  const receiptSeconds = input.receiptExpiresInSeconds ?? 300;
  const [config] = await tx`select deployment_id from assistant_config where singleton=true`;
  const key = {
    machineId: input.receiptMachineId ?? machineId,
    runtime: 'api',
    providerId: 'fixture',
    modelId: 'no-inference',
  };
  const context = {
    deploymentId: String(config?.deployment_id),
    machineId: key.machineId,
    key,
    binarySha256: 'a'.repeat(64),
    policySha256: 'b'.repeat(64),
    observerSha256: 'c'.repeat(64),
    osVersion: 'fixture-only',
  };
  const contextHash = createHash('sha256').update(canonicalJson(context)).digest('hex');
  if (!input.machineId)
    await tx`insert into machines(id,name,token_hash) values(${machineId},'fixture-assistant',${createHash('sha256').update(machineId).digest('hex')})`;
  await tx`insert into assistant_designations(id,owner_id,machine_id,revision) values(${designationId},'owner',${machineId},1)`;
  await tx`update assistant_config set designation_id=${designationId} where singleton=true`;
  await tx`insert into routing_certification_challenges(id,deployment_id,context,nonce_hash,expires_at,budgets,fixture_sha256,state,receipt_id)
    values(${challengeId},${config?.deployment_id},${tx.json(context)},${'d'.repeat(64)},now()+interval '5 minutes',
    ${tx.json({ maxTurns: 1, maxTools: 1, maxCostUsd: 0, maxMs: 1000 })},${'e'.repeat(64)},
    ${status === 'PASS' ? 'verified' : 'failed'},${status === 'PASS' ? receiptId : null})`;
  await tx`insert into assistant_policy_receipts(id,deployment_id,challenge_id,verifier_build_sha256,machine_id,model_key,os_version,
    binary_sha256,policy_sha256,probe_context_sha256,status,evidence_ids,expires_at)
    values(${receiptId},${config?.deployment_id},${challengeId},${input.verifierBuildSha256 ?? 'f'.repeat(64)},${key.machineId},${tx.json(key)},'fixture-only',
    ${context.binarySha256},${context.policySha256},${contextHash},${status},'[]',now()+${receiptSeconds}*interval '1 second')`;
  await tx`insert into routing_capability_receipts(id,certification_receipt_id,model_key,context_sha256,capabilities,received_at,expires_at)
    values(${probeId},${receiptId},${tx.json(key)},${contextHash},'[]',
    now()-${input.admission ? 600 : 0}*interval '1 second',now()+${input.admission ? receiptSeconds : 240}*interval '1 second')`;
  let admission: { snapshotId: Id; sessionId: Id; admissionId: Id } | null = null;
  if (input.admission) {
    const { target, sessionExpiresInSeconds } = input.admission;
    const snapshotId = randomUUID(),
      authorizationId = randomUUID(),
      grantId = randomUUID(),
      sessionId = randomUUID(),
      admissionId = randomUUID();
    const snapshotSha256 = createHash('sha256').update(snapshotId).digest('hex');
    await tx`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
      values(${snapshotId},${target.kind},${target.id},1,0,'{}',${snapshotSha256})`;
    await tx`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,expires_at)
      values(${authorizationId},${target.kind},${target.id},'[]',${'a'.repeat(64)},now()+interval '10 minutes')`;
    await tx`insert into attachment_assistant_grants(id,authorization_id,target_kind,target_id,originals,input_revision,route_revision,
      designation_id,designation_revision,machine_id,snapshot_id,snapshot_sha256,expires_at)
      values(${grantId},${authorizationId},${target.kind},${target.id},'[]',1,0,${designationId},1,${machineId},
      ${snapshotId},${snapshotSha256},now()+interval '10 minutes')`;
    await tx`insert into attachment_assistant_sessions(id,grant_id,snapshot_id,snapshot_sha256,designation_revision,machine_id,runtime,
      model_key,model_selection_id,policy_receipt_id,process_instance_id,admission_id,admitted_at,model_config_revision,
      source_enabled_at_admission,state,expires_at)
      values(${sessionId},${grantId},${snapshotId},${snapshotSha256},1,${machineId},'api',${canonicalJson(key)},${selectionId},
      ${receiptId},${processInstanceId},${admissionId},now(),1,true,'running',
      clock_timestamp()+${sessionExpiresInSeconds}*interval '1 second')`;
    admission = { snapshotId, sessionId, admissionId };
  }
  const generation = await allocateAssistantGeneration(tx);
  await tx`insert into assistant_turns(id,conversation_id,message_id,designation_id,designation_revision,generation,process_instance_id,
    model_selection_id,admission_id,read_session_id,state)
    values(${turnId},${input.conversationId},${input.messageId},${designationId},1,${generation},${processInstanceId},${selectionId},
    ${admission?.admissionId ?? null},${admission?.sessionId ?? null},'running')`;
  await tx`insert into assistant_model_selections(id,turn_id,model_key,model_config_revision,probe_receipt_id,policy_receipt_id,required,rationale)
    values(${selectionId},${turnId},${tx.json({ ...key, modelId: input.selectionModelId ?? key.modelId })},1,${probeId},${receiptId},'[]','Fixture SQL không cấp authority production')`;
  const fence: TurnFence = { turnId, designationId, designationRevision: 1, generation, processInstanceId };
  return {
    fence,
    machineId,
    policyReceiptId: receiptId,
    snapshotId: admission?.snapshotId ?? null,
    sessionId: admission?.sessionId ?? null,
  };
}

export async function assistantFixture(db: Db) {
  const attachments = await attachmentFixture(db);
  const messages = createMessageServices({ store: attachments.store, now: attachments.clock.now });
  async function seedWorkflowRows() {
    const runId = randomUUID(),
      stepId = randomUUID();
    await db`insert into workflow_runs(id,root_ticket_id,source,projection,definition_sha256,customization_sha256,path,revision)
      values(${runId},${attachments.request.id},'{}','{}',${'a'.repeat(64)},${'b'.repeat(64)},'bounded',1)`;
    await db`insert into workflow_steps(id,run_id,ticket_id,skill,source_path,source_sha256,predecessor_ids,acceptance,output_kinds,gate_ids,ownership_keys,role)
      values(${stepId},${runId},${attachments.a.id},'fixture-only','SKILL.md',${'a'.repeat(64)},'[]','[]','[]','[]','["fixture.txt"]','implement')`;
    return { runId, stepId };
  }
  return {
    ...attachments,
    messages,
    seedWorkflowRows,
    async seedDispatchRows(options: { reservation?: boolean } = {}) {
      // This seeds relational hook preconditions, not a permitted production run.
      const { runId, stepId } = await seedWorkflowRows();
      const machineId = randomUUID(),
        snapshotId = randomUUID(),
        assessmentId = randomUUID();
      const requestId = randomUUID(),
        receiptId = randomUUID(),
        reservationId = randomUUID();
      await db`insert into machines(id,name,token_hash) values(${machineId},'fixture-project',${createHash('sha256').update(machineId).digest('hex')})`;
      await db`update projects set machine_id=${machineId},checkout_path='/tmp/fixture',binding_revision=2 where id=${attachments.project.id}`;
      await attachments.mutation(randomUUID(), (tx) =>
        attachments.services.signalTicket(
          tx,
          attachments.a.id,
          'dependencies_ready',
          attachments.a.revision,
          null,
          owner,
        ),
      );
      const command = await attachments.mutation(randomUUID(), (tx) =>
        createCommand(
          tx,
          {
            machineId,
            ticketId: attachments.a.id,
            type: 'start',
            payload: {},
          },
          owner,
        ),
      );
      const decisionId = await attachments.mutation(randomUUID(), (tx) =>
        attachments.services.recordDecision(
          tx,
          attachments.a.id,
          {
            kind: 'dispatch',
            content: 'Fixture constraint',
            rationale: 'Không có authority production',
            sources: [],
            scope: {},
          },
          owner,
        ),
      );
      await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
        values(${snapshotId},'ticket',${attachments.a.id},1,0,'{}',${'c'.repeat(64)})`;
      await db`insert into assistant_assessments(id,ticket_id,input_snapshot_id,body,hash)
        values(${assessmentId},${attachments.a.id},${snapshotId},'{}',${'d'.repeat(64)})`;
      await db`insert into assistant_dispatches(command_id,decision_id,run_id,step_id,assessment_id,permit)
        values(${command.id},${decisionId},${runId},${stepId},${assessmentId},'{}')`;
      const now = Date.now();
      const request: CapacityRequest = {
        id: requestId,
        machineId,
        ticketId: attachments.a.id,
        kind: 'implement',
        ownershipKeys: ['fixture.txt'],
        bootGeneration: '1',
        requestedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 15000).toISOString(),
      };
      const receipt: CapacityReceipt = {
        id: receiptId,
        requestId,
        machineId,
        ticketId: attachments.a.id,
        kind: 'implement',
        ownershipKeys: request.ownershipKeys,
        bootGeneration: '1',
        telemetry: {
          sampleId: randomUUID(),
          bootGeneration: '1',
          sampleAgeMs: 0,
          cpuLoad1: 0,
          cpuCount: 1,
          memoryAvailableBytes: '4294967296',
          memoryPressure: 'normal',
          diskAvailableBytes: '8589934592',
          activeJobs: 0,
          configuredMaxJobs: 1,
        },
        receivedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 10000).toISOString(),
        allowed: true,
        reason: 'Fixture SQL only',
      };
      const requestHash = createHash('sha256').update(canonicalJson(request)).digest('hex');
      const receiptHash = createHash('sha256').update(canonicalJson(receipt)).digest('hex');
      await db`insert into assistant_capacity_requests(id,machine_id,ticket_id,kind,ownership_keys,boot_generation,requested_at,expires_at,request_sha256)
        values(${request.id},${machineId},${request.ticketId},${request.kind},${db.json(request.ownershipKeys)},${request.bootGeneration},${request.requestedAt},${request.expiresAt},${requestHash})`;
      await db`insert into assistant_capacity_receipts(id,request_id,machine_id,boot_generation,ticket_id,kind,ownership_keys,telemetry,received_at,expires_at,allowed,reason,receipt_sha256)
        values(${receipt.id},${requestId},${machineId},${receipt.bootGeneration},${receipt.ticketId},${receipt.kind},${db.json(receipt.ownershipKeys)},${db.json(receipt.telemetry)},${receipt.receivedAt},${receipt.expiresAt},${receipt.allowed},${receipt.reason},${receiptHash})`;
      await db`update assistant_capacity_requests set receipt_id=${receiptId} where id=${requestId}`;
      if (options.reservation !== false)
        await db`insert into assistant_reservations(id,command_id,receipt_id,machine_id,ownership_keys,state)
        values(${reservationId},${command.id},${receiptId},${machineId},'["fixture.txt"]','reserved')`;
      return {
        runId,
        stepId,
        command,
        machineId,
        reservationId,
        snapshotId,
        assessmentId,
        decisionId,
        request,
        receipt,
        async launch() {
          const id = randomUUID(),
            processInstanceId = randomUUID();
          await db`insert into assistant_launch_authorizations(command_id,id,machine_id,process_instance_id,boot_generation,generation,expires_at,state)
            values(${command.id},${id},${machineId},${processInstanceId},'1',1,now()+interval '15 seconds','issued')`;
          return { id, processInstanceId };
        },
        async insertAttempt(processInstanceId: Id) {
          const id = randomUUID();
          await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin)
            values(${id},${attachments.a.id},${machineId},${command.id},1,2,${processInstanceId},'active',now()+interval '10 seconds',${db.json(pin)})`;
          return id;
        },
      };
    },
    async seedTurn(
      conversationId: Id,
      messageId: Id | null,
      options: { selectionModelId?: string; receiptMachineId?: Id } = {},
    ): Promise<TurnFence> {
      // Explicit test-only persisted rows. UNVERIFIED routing receipts never
      // demonstrate admission or a production certification implementation.
      return db.begin(
        async (tx) => (await insertTurnRows(tx, { conversationId, messageId, ...options })).fence,
      );
    },
    /**
     * Test-only admitted turn: input grant, read session and a PASS policy receipt
     * signed by the fixture verifier constant in this deployment. Production
     * assembly has no such rows until live certification issues them.
     */
    async seedAdmittedTurn(input: {
      conversationId: Id;
      messageId: Id | null;
      target: { kind: 'ticket' | 'message'; id: Id };
      machineId?: Id;
      receiptStatus?: 'PASS' | 'FAIL' | 'UNVERIFIED';
      verifierBuildSha256?: string;
      receiptExpiresInSeconds?: number;
      sessionExpiresInSeconds?: number;
    }) {
      return db.begin((tx) =>
        insertTurnRows(tx, {
          conversationId: input.conversationId,
          messageId: input.messageId,
          machineId: input.machineId,
          receiptStatus: input.receiptStatus ?? 'PASS',
          verifierBuildSha256: input.verifierBuildSha256 ?? fixtureVerifierBuildSha256,
          receiptExpiresInSeconds: input.receiptExpiresInSeconds,
          admission: {
            target: input.target,
            sessionExpiresInSeconds: input.sessionExpiresInSeconds ?? 300,
          },
        }),
      );
    },
    /** Test-only stand-in for the tools route row written before the port call. */
    async seedToolOperation(
      sql: Db | Tx,
      input: { turnId: Id; snapshotId: Id; state?: 'pending' | 'completed' | 'rejected' },
    ): Promise<Id> {
      const operationId = randomUUID();
      const state = input.state ?? 'pending';
      await sql`insert into assistant_tool_operations(operation_id,turn_id,client_sequence,provider_call_id,request_hash,input_snapshot_id,state,response)
        values(${operationId},${input.turnId},
          (select coalesce(max(client_sequence),0)+1 from assistant_tool_operations where turn_id=${input.turnId}),
          ${`fixture-${operationId}`},${createHash('sha256').update(operationId).digest('hex')},${input.snapshotId},${state},
          ${state === 'pending' ? null : sql.json({ fixture: true })})`;
      return operationId;
    },
    async submitMessage(text = 'Yêu cầu cần xử lý sau khi máy kết nối lại') {
      const conversation = await attachments.mutation(randomUUID(), (tx) =>
        messages.createConversation(tx, owner),
      );
      const selection = await attachments.readyCompose(
        {
          purpose: 'assistant_message',
          projectId: null,
          ticketId: null,
          conversationId: conversation.id,
        },
        [],
      );
      const input: MessageSubmission = {
        conversationId: conversation.id,
        clientMessageId: randomUUID(),
        text,
        selection,
        assistantRead: 'none',
      };
      const message = await attachments.mutation(randomUUID(), (tx) =>
        messages.submitAssistantMessage(tx, input, owner),
      );
      const [event] = await db`
        select cursor from events
        where type='assistant.message.created' and data->>'messageId'=${message.id}
      `;
      if (!event) throw new Error('ASSISTANT_FIXTURE_MESSAGE_EVENT_MISSING');
      return { conversation, input, message, cursor: String(event.cursor) };
    },
    async comment(ticketId: Id) {
      const comment = await attachments.mutation(randomUUID(), (tx) =>
        attachments.services.appendComment(tx, ticketId, 'Đầu vào cần được đọc lại', owner),
      );
      const [event] = await db`
        select cursor from events where type='comment.created' and data->>'commentId'=${comment.id}
      `;
      if (!event) throw new Error('ASSISTANT_FIXTURE_COMMENT_EVENT_MISSING');
      return { comment, cursor: String(event.cursor) };
    },
  };
}

export async function pendingCount(tx: Tx, eventId: string): Promise<number> {
  const [row] = await tx`
    select count(*)::integer as count from assistant_work_inbox
    where logical_key like ${`event:${eventId}:%`} and state='pending'
  `;
  return Number(row?.count ?? 0);
}

export async function databaseContentsSha256(db: Db): Promise<string> {
  const tables = await db`select tablename from pg_tables where schemaname='public' order by tablename`;
  const contents: Record<string, unknown> = {};
  for (const row of tables) {
    const name = String(row.tablename);
    if (!/^[a-z_]+$/.test(name)) throw new Error('UNSAFE_TABLE_NAME');
    const [data] = await db.unsafe(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${name}" t`,
    );
    contents[name] = data?.rows;
  }
  return createHash('sha256').update(canonicalJson(contents)).digest('hex');
}

async function pgCommand(container: string, args: string[], input: Buffer | null = null): Promise<Buffer> {
  if (!/^[0-9a-f]{64}$/.test(container)) throw new Error('UNSAFE_TEST_DB_CONTAINER');
  const command = ['exec', ...(input ? ['-i'] : []), container, ...args];
  console.info('assistant backup child intended', JSON.stringify(command));
  const child = spawn('docker', command, { stdio: ['pipe', 'pipe', 'pipe'] });
  console.info('assistant backup child created', child.pid);
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let failure: Error | null = null;
  child.stdout.on('data', (b: Buffer) => stdout.push(b));
  child.stderr.on('data', (b: Buffer) => stderr.push(b));
  child.on('error', (error) => {
    failure = error;
  });
  child.stdin.on('error', (error) => {
    failure = error;
  });
  child.stdin.end(input ?? undefined);
  return new Promise((resolve, reject) =>
    child.once('close', (code, signal) => {
      console.info('assistant backup child closed', child.pid, code, signal);
      if (failure || code !== 0 || signal)
        reject(
          failure ??
            new Error(`PG_FIXTURE_COMMAND_FAILED ${Buffer.concat(stderr).toString().slice(0, 1024)}`),
        );
      else resolve(Buffer.concat(stdout));
    }),
  );
}

export async function verifyBackupRestore(db: Db, prefix: number): Promise<void> {
  const container = process.env.CREW_V2_TEST_CONTAINER_ID;
  const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL;
  if (!container || !baseUrl) throw new Error('PRIVATE_POSTGRES_REQUIRED');
  const [source] = await db`select current_database() as name`;
  if (!/^crew_v2_test_[0-9a-f]{32}$/.test(String(source?.name))) throw new Error('UNSAFE_BACKUP_DATABASE');
  const original = await databaseContentsSha256(db);
  const dump = await pgCommand(container, ['pg_dump', '-U', 'postgres', '-Fc', '-d', String(source.name)]);
  if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('BACKUP_FORMAT_INVALID');
  const restoredName = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
  let restored: Db | null = null;
  await db`create database ${db(restoredName)}`;
  console.info('assistant restore database created', restoredName);
  try {
    await pgCommand(container, ['pg_restore', '-U', 'postgres', '--exit-on-error', '-d', restoredName], dump);
    const url = new URL(baseUrl);
    url.pathname = `/${restoredName}`;
    restored = connectDb(url.toString());
    const actual = await databaseContentsSha256(restored);
    if (actual !== original) throw new Error('BACKUP_RESTORE_CONTENT_MISMATCH');
    const migrations = await restored`select version,checksum from schema_migrations order by version`;
    if (migrations.length !== prefix) throw new Error('BACKUP_RESTORE_PREFIX_MISMATCH');
    console.info(
      'assistant backup restore verified',
      JSON.stringify({
        prefix,
        dumpSha256: createHash('sha256').update(dump).digest('hex'),
        dumpBytes: dump.length,
        sourceDataSha256: original,
        restoredDataSha256: actual,
        migrations,
      }),
    );
  } finally {
    if (restored) await restored.end();
    await db`drop database ${db(restoredName)}`;
    console.info('assistant restore database closed and removed', restoredName);
  }
}
