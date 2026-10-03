import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  type Attempt,
  type Command,
  type Permit,
  type ReadTransport,
  type ResultInput,
  type Selection,
  toDomainPin,
} from '../commands/contracts.ts';
import { mutate } from '../commands/http-client.ts';
import { AtomicRecords, canonicalJson } from '../journal/atomic-records.ts';
import type { HttpOperationJournal } from '../journal/http-operations.ts';
import {
  type AttemptProjectionPin,
  Launcher,
  type LauncherOptions,
  type LaunchInput,
  type LaunchRecord,
  type ProcessJournal,
} from '../journal/process-journal.ts';
import type { WorkflowRegistry } from '../workflows/registry.ts';

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type BridgeRecord = {
  formatVersion: 1;
  command: Command;
  selection: Selection;
  permit: Permit;
  input: LaunchInput;
  attemptId: string | null;
  released: boolean;
  finalizeOp?: string | null;
  runningOp?: string | null;
  stopReason?: 'exit' | 'pause' | 'cancel';
};
export type BeforeReleaseContext = Readonly<{
  record: Readonly<LaunchRecord>;
  attempt: Readonly<Attempt>;
  companion: Readonly<AttemptProjectionPin>;
  command: Readonly<Command>;
}>;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export type BridgeOptions = {
  machineId: string;
  journal: ProcessJournal;
  registry: WorkflowRegistry;
  http: HttpOperationJournal;
  read: ReadTransport;
  permit?: (command: Command) => Promise<Permit>;
  command?: string[];
  recheckCapacity?: () => Promise<boolean>;
  onDurableStage?: LauncherOptions['onDurableStage'];
  beforeRelease?: (context: BeforeReleaseContext) => Promise<void>;
};
export class TicketCommandBridge {
  private readonly store: AtomicRecords;
  private readonly options: BridgeOptions;
  private readonly launcher: Launcher;
  private readonly beforeRelease: BridgeOptions['beforeRelease'];
  private constructor(store: AtomicRecords, options: BridgeOptions) {
    this.store = store;
    this.options = options;
    this.beforeRelease = options.beforeRelease;
    this.launcher = new Launcher(options.journal, {
      command: options.command,
      recheckCapacity: options.recheckCapacity,
      onDurableStage: options.onDurableStage,
      verifyProjection: async (record, fence, attemptId) => {
        const local = await this.store.get<BridgeRecord>(this.key(record.commandId));
        if (!local || local.attemptId !== attemptId) throw new Error('ATTEMPT_MISMATCH');
        const attempt = await this.current(local);
        if (attempt.fence !== fence || attempt.state !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
        return this.companion(local, attempt);
      },
    });
  }
  static async open(root: string, options: BridgeOptions) {
    const bridge = new TicketCommandBridge(await AtomicRecords.open(join(root, 'ticket-bridge')), options);
    await options.journal.bindPinRetirementAuthority(async (record) => {
      const local = await bridge.local(record.commandId),
        attempt = await bridge.current(local),
        pin = record.authorization;
      if (
        !pin ||
        attempt.state !== 'stopped' ||
        !attempt.finalizedAt ||
        !attempt.stoppedAt ||
        attempt.fence !== pin.fence ||
        !same(pin, bridge.expectedCompanion(local, attempt))
      )
        throw new Error('FINALIZATION_MISMATCH');
      return {
        attemptId: attempt.id,
        commandId: attempt.commandId,
        ticketId: attempt.ticketId,
        fence: attempt.fence,
        processInstanceId: attempt.processInstanceId,
        workflowPin: attempt.workflowPin,
        state: 'stopped',
        finalizedAt: attempt.finalizedAt,
        projection: pin,
      };
    });
    return bridge;
  }
  private key(id: string) {
    return `${this.options.machineId}:${id}`;
  }
  private async storedCommand(id: string) {
    const command = (await this.options.read(`/v2/machine/commands/${id}`)) as Command;
    if (command.machineId !== this.options.machineId || command.id !== id)
      throw new Error('COMMAND_SCOPE_MISMATCH');
    return command;
  }
  async reserve(command: Command): Promise<LaunchRecord> {
    return this.store.transaction(async () => {
      const current = await this.storedCommand(command.id);
      if (
        !same(current.payload, command.payload) ||
        current.ticketId !== command.ticketId ||
        current.type !== command.type
      )
        throw new Error('COMMAND_CHANGED');
      let local = await this.store.get<BridgeRecord>(this.key(command.id));
      if (!local) {
        if (!this.options.permit) throw new Error('DISPATCH_NOT_CONFIGURED');
        const permit = await this.options.permit(current),
          selection = current.payload.selection as Selection;
        if (
          !selection ||
          !['claude', 'codex', 'api'].includes(selection.runtime) ||
          selection.decisionId !== permit.decisionId ||
          permit.commandId !== current.id ||
          permit.ticketId !== current.ticketId ||
          permit.machineId !== this.options.machineId
        )
          throw new Error('SELECTION_MISMATCH');
        const source = await this.options.registry.current(permit.workflow.workflow);
        if (
          !source ||
          !same(toDomainPin(source), permit.workflow) ||
          source.sourceTreeSha256 !== selection.sourceTreeSha256
        )
          throw new Error('SOURCE_MISMATCH');
        const projection = (await this.options.read('/v2/gateway/config')) as {
          desired?: Record<string, { source: typeof source; projections: Record<string, unknown> }>;
        };
        const desired = projection.desired?.[source.name];
        const selected = desired?.projections[selection.runtime] as LaunchInput['projection'] | null;
        if (
          !desired ||
          !same(desired.source, source) ||
          !selected ||
          selected.manifestSha256 !== selection.projectionManifestSha256 ||
          selected.treeSha256 !== selection.projectionTreeSha256
        )
          throw new Error('PROJECTION_UNAVAILABLE');
        await this.options.registry.resolve(source, selected);
        local = {
          formatVersion: 1,
          command: current,
          selection: structuredClone(selection),
          permit: structuredClone(permit),
          input: {
            commandId: current.id,
            ticketId: current.ticketId,
            processInstanceId: randomUUID(),
            source,
            projection: selected,
          },
          attemptId: null,
          released: false,
        };
        await this.store.put(this.key(current.id), local);
      }
      if (!same(current.payload.selection, local.selection)) throw new Error('SELECTION_MISMATCH');
      return this.options.journal.reserve(local.input);
    });
  }
  private validateAttempt(local: BridgeRecord, attempt: Attempt) {
    if (
      !attempt ||
      attempt.commandId !== local.command.id ||
      attempt.ticketId !== local.command.ticketId ||
      attempt.machineId !== this.options.machineId ||
      attempt.processInstanceId !== local.input.processInstanceId ||
      !same(attempt.workflowPin, toDomainPin(local.input.source)) ||
      !/^\d+$/.test(attempt.fence)
    )
      throw new Error('ATTEMPT_MISMATCH');
    if (local.attemptId && attempt.id !== local.attemptId) throw new Error('ATTEMPT_MISMATCH');
  }
  private async current(local: BridgeRecord): Promise<Attempt> {
    const command = await this.storedCommand(local.command.id);
    if (!same(command.payload.selection, local.selection)) throw new Error('SELECTION_MISMATCH');
    if (!local.attemptId) throw new Error('CLAIM_UNCONFIRMED');
    const attempt = (await this.options.read(`/v2/machine/attempts/${local.attemptId}`)) as Attempt;
    this.validateAttempt(local, attempt);
    return attempt;
  }
  private expectedCompanion(local: BridgeRecord, attempt: Attempt): AttemptProjectionPin {
    return {
      attemptId: attempt.id,
      fence: attempt.fence,
      processInstanceId: local.input.processInstanceId,
      sourceTreeSha256: local.selection.sourceTreeSha256,
      runtime: local.selection.runtime,
      projectionManifestSha256: local.selection.projectionManifestSha256,
      projectionTreeSha256: local.selection.projectionTreeSha256,
      installReportId: local.selection.installReportId,
    };
  }
  private async companion(local: BridgeRecord, attempt: Attempt): Promise<AttemptProjectionPin> {
    const expected = this.expectedCompanion(local, attempt);
    const { attemptId: _id, ...body } = expected;
    const pin = await mutate<AttemptProjectionPin>(
      this.options.http,
      `${this.key(local.command.id)}:projection`,
      `/v2/gateway/attempts/${attempt.id}/projection`,
      'projection',
      body,
    );
    if (!same(pin, expected)) throw new Error('PROJECTION_CONFLICT');
    // Cached POST is followed by fresh scoped attempt+command reads before RELEASE.
    const current = await this.current(local);
    if (current.fence !== attempt.fence || current.state !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
    return pin;
  }
  async handle(command: Command): Promise<void> {
    if (command.type === 'pause' || command.type === 'cancel') return this.stopCommand(command);
    if (command.type === 'reconcile') {
      const current = await this.storedCommand(command.id);
      if (
        !same(current.payload, command.payload) ||
        current.type !== command.type ||
        current.ticketId !== command.ticketId
      )
        throw new Error('COMMAND_CHANGED');
      await this.ackTicket(command.id, 'received');
      await this.reconcileOwned(command.ticketId);
      await this.ackTicket(command.id, 'completed');
      return;
    }
    if (!['start', 'resume'].includes(command.type)) throw new Error('UNSUPPORTED_COMMAND');
    const record = await this.reserve(command);
    await this.store.transaction(async () => {
      const local = (await this.store.get<BridgeRecord>(this.key(command.id)))!;
      if (local.released) {
        await this.current(local);
        await this.options.journal.observe(record);
        await this.ackTicket(command.id, 'completed');
        return;
      }
      await this.ackTicket(command.id, 'received');
      const ready = await this.options.journal.ready(record);
      if (!ready) await this.launcher.spawnGated(record);
      if ((await this.options.journal.observe(record)) !== 'running') throw new Error('PROCESS_UNKNOWN');
      const response = await mutate<Attempt>(
        this.options.http,
        `${this.key(command.id)}:claim`,
        `/v2/machine/commands/${command.id}/claim`,
        'claim',
        { processInstanceId: record.processInstanceId, permit: local.permit },
      );
      this.validateAttempt(local, response);
      local.attemptId = response.id;
      await this.store.put(this.key(command.id), local);
      const attempt = await this.current(local);
      if (attempt.state !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
      const companion = await this.companion(local, attempt);
      if (this.beforeRelease) {
        const command = await this.storedCommand(local.command.id);
        if (!same(command.payload.selection, local.selection)) throw new Error('SELECTION_MISMATCH');
        const result = await this.beforeRelease(
          immutable(structuredClone({ record, attempt, companion, command })),
        );
        if (result !== undefined) throw new Error('RUNTIME_RELEASE_DENIED');
      }
      await this.launcher.release(record, attempt.fence, attempt.id);
      local.released = true;
      await this.store.put(this.key(command.id), local);
      await this.ackTicket(command.id, 'completed');
    });
  }
  private async recordFailure(id: string, error: unknown) {
    await this.store.put(`failure:${this.key(id)}`, {
      formatVersion: 1,
      commandId: id,
      message: error instanceof Error ? error.message : 'COMMAND_FAILED',
      observedAt: new Date().toISOString(),
    });
  }
  private failAfterPass(errors: unknown[]) {
    if (errors.length)
      throw new AggregateError(
        errors,
        errors.map((error) => (error instanceof Error ? error.message : 'COMMAND_FAILED')).join('; '),
      );
  }
  async reconnect(): Promise<void> {
    const errors: unknown[] = [];
    // Owned recovery runs independently of new dispatch, including commands on later pages.
    try {
      await this.reconcileOwned();
    } catch (error) {
      errors.push(error);
    }
    let after: string | null = null;
    try {
      for (;;) {
        const page = (await this.options.read(
          `/v2/machine/commands?limit=50${after ? `&after=${after}` : ''}`,
        )) as { items: Command[]; nextCursor: string | null };
        for (const command of page.items) {
          try {
            await this.handle(command);
          } catch (error) {
            await this.recordFailure(command.id, error);
            errors.push(error);
          }
        }
        if (!page.nextCursor) break;
        if (page.nextCursor === after) throw new Error('COMMAND_CURSOR_STUCK');
        after = page.nextCursor;
      }
    } catch (error) {
      errors.push(error);
    }
    this.failAfterPass(errors);
  }
  private async reconcileOwned(ticketId?: string) {
    const errors: unknown[] = [];
    for (const local of await this.store.all<BridgeRecord>()) {
      if (!local.attemptId || (ticketId && local.command.ticketId !== ticketId)) continue;
      try {
        const record = await this.options.journal.byInstance(local.input.processInstanceId);
        if (!record) throw new Error('PROCESS_UNKNOWN');
        // A validated immutable receipt already settled this history under its original binding.
        if (await this.options.journal.pinRetirement(record)) continue;
        const attempt = await this.current(local);
        const observation = await this.options.journal.observe(record);
        if (observation === 'unknown') throw new Error('PROCESS_UNKNOWN');
        if (observation === 'running' && attempt.state === 'uncertain')
          await this.reconcileObservation(local, attempt, 'running', null);
        if (observation === 'stopped' && attempt.state !== 'stopped')
          await this.reconcileObservation(local, attempt, 'stopped', local.stopReason ?? 'exit');
        if (observation === 'stopped' && attempt.state === 'stopped' && attempt.finalizedAt)
          await this.retire(local.command.id);
      } catch (error) {
        await this.recordFailure(local.command.id, error);
        errors.push(error);
      }
    }
    this.failAfterPass(errors);
  }
  /** Trusted composition: no caller-supplied proof. Lock order connection -> bridge -> journal.
   * Observe/reconcile can write the journal, so both finish before its admission barrier. */
  async withBootReconciliation<T>(
    transition: { hostRoot: string; priorBootId: string; priorGeneration: string; nextBootId: string },
    commit: (receipt: unknown) => Promise<T>,
  ): Promise<T> {
    if (transition.hostRoot !== dirname(this.store.root)) throw new Error('BOOT_ROOT_MISMATCH');
    return this.store.transaction(async () => {
      // Per-record failures are persisted. The complete accounting below decides admissibility.
      try {
        await this.reconcileOwned();
      } catch {
        /* UNKNOWN may be accounted without a STOP. */
      }
      const records = await this.options.journal.processes();
      const observations = new Map<string, 'running' | 'stopped' | 'unknown'>();
      for (const record of records) {
        if (!(await this.options.journal.pinRetirement(record)))
          observations.set(record.launchId, await this.options.journal.observe(record));
      }
      const snapshot = await this.options.journal.processes();
      if (
        !same(
          records.map((record) => record.launchId).sort(),
          snapshot.map((record) => record.launchId).sort(),
        )
      )
        throw new Error('BOOT_RECONCILIATION_CHANGED');
      return this.options.journal.withPinAdmissionBarrier(this.options.registry.root, async () => {
        if (
          !same(snapshot, await this.options.journal.processes()) ||
          (await this.options.journal.pendingPinAdmissions()).length
        )
          throw new Error('BOOT_RECONCILIATION_CHANGED');
        const entries: unknown[] = [];
        for (const record of snapshot) {
          const retired = await this.options.journal.pinRetirement(record);
          if (retired) {
            entries.push({ category: 'retired', receipt: retired });
            continue;
          }
          const local = await this.local(record.commandId);
          if (
            !local.attemptId ||
            local.input.processInstanceId !== record.processInstanceId ||
            !same(local.input.source, record.source) ||
            !same(local.input.projection, record.projection)
          )
            throw new Error('BOOT_UNACCOUNTED_LAUNCH');
          const attempt = await this.current(local);
          if (!record.authorization || !same(record.authorization, this.expectedCompanion(local, attempt)))
            throw new Error('BOOT_AUTHORIZATION_MISMATCH');
          const observation = observations.get(record.launchId);
          const category =
            observation === 'unknown' && ['active', 'uncertain'].includes(attempt.state)
              ? 'retained-unknown'
              : observation === 'running' && attempt.state === 'active'
                ? 'running'
                : observation === 'stopped' &&
                    attempt.stoppedAt &&
                    ['stopped', 'finalizing'].includes(attempt.state)
                  ? 'stopped'
                  : null;
          if (!category) throw new Error('BOOT_RECONCILIATION_REQUIRED');
          entries.push({ category, record, attempt });
        }
        return commit({
          formatVersion: 1,
          machineId: this.options.machineId,
          ...transition,
          entries,
          observedAt: new Date().toISOString(),
        });
      });
    });
  }
  private async ackTicket(id: string, phase: 'received' | 'completed') {
    await mutate(
      this.options.http,
      `${this.key(id)}:${phase}`,
      `/v2/machine/commands/${id}/ack`,
      `ticket-${phase}`,
      phase === 'received' ? { phase } : { phase, result: { ok: true } },
    );
    await this.storedCommand(id);
  }
  private async reconcileObservation(
    local: BridgeRecord,
    attempt: Attempt,
    observation: 'running' | 'stopped',
    stopReason: 'exit' | 'pause' | 'cancel' | null,
  ) {
    if (observation === 'running' && !local.runningOp) {
      local.runningOp = randomUUID();
      await this.store.put(this.key(local.command.id), local);
    }
    const operationId =
      observation === 'running' ? local.runningOp! : `${this.key(local.command.id)}:reconcile:stopped`;
    await mutate(
      this.options.http,
      operationId,
      `/v2/machine/attempts/${attempt.id}/reconcile`,
      'reconcile',
      {
        fence: attempt.fence,
        processInstanceId: attempt.processInstanceId,
        observation,
        artifacts: [],
        stopReason,
      },
    );
    const current = await this.current(local);
    if (observation === 'running') {
      local.runningOp = null;
      await this.store.put(this.key(local.command.id), local);
    }
    return current;
  }
  async reportStopped(commandId: string, reason: 'exit' | 'pause' | 'cancel' = 'exit') {
    const local = await this.local(commandId),
      attempt = await this.current(local),
      record = (await this.options.journal.byInstance(local.input.processInstanceId))!;
    if (!record || (await this.options.journal.observe(record)) !== 'stopped')
      throw new Error('EXACT_EXIT_PROOF_REQUIRED');
    if (local.stopReason && local.stopReason !== reason) throw new Error('STOP_REASON_CONFLICT');
    local.stopReason = reason;
    await this.store.put(this.key(commandId), local);
    return this.reconcileObservation(local, attempt, 'stopped', reason);
  }
  private async local(commandId: string) {
    const local = await this.store.get<BridgeRecord>(this.key(commandId));
    if (!local) throw new Error('UNKNOWN_COMMAND');
    return local;
  }
  async result(commandId: string, input: ResultInput) {
    const local = await this.local(commandId),
      attempt = await this.current(local);
    if (input.fence !== attempt.fence || input.processInstanceId !== attempt.processInstanceId)
      throw new Error('STALE_FENCE');
    await mutate(
      this.options.http,
      `${this.key(commandId)}:result`,
      `/v2/machine/attempts/${attempt.id}/result`,
      'result',
      input,
    );
    return this.current(local);
  }
  async finalize(commandId: string) {
    return this.store.transaction(async () => {
      const local = await this.local(commandId),
        attempt = await this.current(local);
      if (!attempt.terminalResult || !attempt.stoppedAt) throw new Error('FINAL_RESULT_PENDING');
      if (!local.finalizeOp) {
        local.finalizeOp = randomUUID();
        await this.store.put(this.key(commandId), local);
      }
      await mutate(
        this.options.http,
        local.finalizeOp,
        `/v2/machine/attempts/${attempt.id}/finalize`,
        'finalize',
        { fence: attempt.fence, processInstanceId: attempt.processInstanceId },
      );
      const current = await this.current(local);
      local.finalizeOp = null;
      await this.store.put(this.key(commandId), local);
      return current;
    });
  }
  async checkpoint(
    commandId: string,
    input: {
      fence: string;
      processInstanceId: string;
      sequence: string;
      step: string;
      artifactIds: string[];
      commit: string | null;
    },
  ) {
    const local = await this.local(commandId),
      attempt = await this.current(local);
    await mutate(
      this.options.http,
      `${this.key(commandId)}:checkpoint:${input.sequence}`,
      `/v2/machine/attempts/${attempt.id}/checkpoint`,
      'checkpoint',
      input,
    );
    return this.current(local);
  }
  private async stopCommand(command: Command) {
    return this.store.transaction(async () => {
      const current = await this.storedCommand(command.id);
      if (
        !same(current.payload, command.payload) ||
        current.type !== command.type ||
        current.ticketId !== command.ticketId
      )
        throw new Error('COMMAND_CHANGED');
      const target = command.payload.attemptId;
      const local = (await this.store.all<BridgeRecord>()).find((record) => record.attemptId === target);
      if (!local || command.ticketId !== local.command.ticketId) throw new Error('OWNED_ATTEMPT_REQUIRED');
      const attempt = await this.current(local);
      const record = await this.options.journal.byInstance(attempt.processInstanceId);
      if (!record) throw new Error('PROCESS_UNKNOWN');
      await this.ackTicket(command.id, 'received');
      const reason = command.type as 'pause' | 'cancel';
      if (local.stopReason && local.stopReason !== reason) throw new Error('STOP_REASON_CONFLICT');
      local.stopReason = reason;
      await this.store.put(this.key(local.command.id), local);
      if (await this.options.journal.pinRetirement(record)) {
        await this.retire(local.command.id);
      } else {
        const observation = await this.options.journal.observe(record);
        if (observation === 'unknown') throw new Error('PROCESS_UNKNOWN');
        if (observation === 'running') {
          const ready = await this.options.journal.ready(record);
          if (!ready) throw new Error('PROCESS_UNKNOWN');
          process.kill(-ready.processGroupId, 'SIGTERM');
          await this.launcher.wait(record);
        }
        await this.reportStopped(local.command.id, reason);
      }
      await this.ackTicket(command.id, 'completed');
    });
  }
  async retire(commandId: string) {
    const local = await this.local(commandId);
    const record = await this.options.journal.byInstance(local.input.processInstanceId);
    if (!record) throw new Error('UNKNOWN_LAUNCH');
    return this.options.journal.retirePinReference(record);
  }
  async wait(commandId: string) {
    const local = await this.local(commandId);
    const record = await this.options.journal.byInstance(local.input.processInstanceId);
    if (!record) throw new Error('UNKNOWN_LAUNCH');
    await this.launcher.wait(record);
  }
  async close() {
    await this.launcher.close();
    await this.store.close();
  }
}
