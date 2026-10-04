import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { WorkflowDefinition } from '../assistant/workflow-manifest.ts';
import type {
  GatewayCommand,
  GatewayConfig,
  InstallReport,
  Inventory,
  ReadTransport,
  ReportedInventory,
} from '../commands/contracts.ts';
import { mutate } from '../commands/http-client.ts';
import type { ProjectionPin, SlotStatus, SourcePin } from '../host/status.ts';
import { AtomicRecords, canonicalJson } from '../journal/atomic-records.ts';
import type { HttpOperationJournal } from '../journal/http-operations.ts';
import { fetchSource } from '../workflows/fetch.ts';
import type { ProjectionAudit, WorkflowRegistry } from '../workflows/registry.ts';

const names = ['bmad', 'superpowers'] as const;
const runtimes = ['claude', 'codex', 'api'] as const;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const slot = <T>(installed: T | null = null): SlotStatus<T> => ({
  state: installed ? 'current' : 'missing',
  installed,
  lastError: null,
  observedAt: installed ? new Date().toISOString() : null,
});
const empty = (): Inventory =>
  Object.fromEntries(
    names.map((name) => [
      name,
      { source: slot(), projections: Object.fromEntries(runtimes.map((r) => [r, slot()])) },
    ]),
  ) as Inventory;
type SyncRecord = {
  formatVersion: 1;
  command: GatewayCommand;
  report: InstallReport | null;
  completion: { ok: boolean; code?: string } | null;
  done: boolean;
  attempts: number;
  retryAt: number;
};
export type SyncOptions = {
  machineId: string;
  bootId: string;
  bootGeneration: string;
  registry: WorkflowRegistry;
  http: HttpOperationJournal;
  read: ReadTransport;
  recipes: ProjectionAudit[];
  /** Derives the workflow definition of an installed projection; absent means reports carry none. */
  definitions?: {
    loadDefinition(source: SourcePin, projection: ProjectionPin): Promise<WorkflowDefinition>;
  };
  archive?: (source: SourcePin) => Promise<Readable>;
  now?: () => number;
  random?: () => number;
  reconcileHost?: () => Promise<void>;
};
export class GatewaySync {
  private readonly store: AtomicRecords;
  private readonly options: SyncOptions;
  private constructor(store: AtomicRecords, options: SyncOptions) {
    this.store = store;
    this.options = options;
  }
  static async open(root: string, options: SyncOptions): Promise<GatewaySync> {
    return new GatewaySync(await AtomicRecords.open(join(root, 'workflow-sync')), options);
  }
  private key(id: string) {
    return `${this.options.machineId}:${id}`;
  }
  async reconcile(): Promise<void> {
    await this.store.transaction(async () => {
      const desired = (await this.options.read('/v2/gateway/config')) as
        | GatewayConfig
        | { desiredConfig: null };
      const cursor = await this.store.get<{ formatVersion: 1; cursor: string }>('cursor');
      let after = cursor?.cursor ?? '0';
      for (;;) {
        const page = (await this.options.read(`/v2/gateway/commands?after=${after}&limit=50`)) as {
          items: GatewayCommand[];
          nextCursor: string;
        };
        for (const command of page.items) {
          if (command.machineId !== this.options.machineId) throw new Error('COMMAND_SCOPE_MISMATCH');
          // Other namespaces (for example sync_models) have their own typed consumer.
          if (!['sync_workflows', 'probe', 'reconcile_host'].includes(command.type)) continue;
          const key = this.key(command.id),
            old = await this.store.get<SyncRecord>(key);
          if (!old)
            await this.store.put(key, {
              formatVersion: 1,
              command,
              report: null,
              completion: null,
              done: command.state === 'completed',
              attempts: 0,
              retryAt: 0,
            });
          else if (!same(old.command.payload, command.payload) || old.command.type !== command.type)
            throw new Error('COMMAND_CONFLICT');
        }
        await this.store.put('cursor', { formatVersion: 1, cursor: page.nextCursor });
        if (page.items.length < 50 || page.nextCursor === after) break;
        after = page.nextCursor;
      }
      for (const record of await this.store.all<SyncRecord>()) {
        if (!record.command || record.done) continue;
        await this.process(record, 'revision' in desired ? desired : null);
      }
    });
  }
  private async complete(record: SyncRecord, result: { ok: boolean; code?: string }) {
    record.completion ??= result;
    await this.store.put(this.key(record.command.id), record);
    await mutate(
      this.options.http,
      `${this.key(record.command.id)}:completed`,
      `/v2/gateway/commands/${record.command.id}/ack`,
      'gateway-completed',
      { phase: 'completed', result: record.completion },
    );
    record.done = true;
    await this.store.put(this.key(record.command.id), record);
  }
  // Definition lookup is additive: only an explicit "unavailable" (for example BMAD outside claude) is
  // skipped. Any other failure is an integrity problem and must surface instead of being swallowed.
  private async definition(source: SourcePin, pin: ProjectionPin): Promise<WorkflowDefinition | null> {
    if (!this.options.definitions) return null;
    try {
      return await this.options.definitions.loadDefinition(source, pin);
    } catch (error) {
      if ((error as Error)?.message === 'WORKFLOW_DEFINITION_UNAVAILABLE') return null;
      throw error;
    }
  }
  private async process(record: SyncRecord, config: GatewayConfig | null) {
    if (record.completion) return this.complete(record, record.completion);
    if ((this.options.now ?? Date.now)() < record.retryAt) return;
    await mutate(
      this.options.http,
      `${this.key(record.command.id)}:received`,
      `/v2/gateway/commands/${record.command.id}/ack`,
      'gateway-received',
      { phase: 'received' },
    );
    if (record.command.type !== 'sync_workflows') {
      if (record.command.type === 'reconcile_host') {
        if (!this.options.reconcileHost)
          return this.complete(record, { ok: false, code: 'RECONCILE_NOT_CONFIGURED' });
        await this.options.reconcileHost();
      }
      return this.complete(record, { ok: true });
    }
    if (!record.report) {
      const requestedRevision = record.command.payload.configRevision;
      if (typeof requestedRevision !== 'number' || !Number.isSafeInteger(requestedRevision))
        throw new Error('INVALID_CONFIG_REVISION');
      // Separate GETs can expose a command newer than this desired snapshot.
      if (!config || config.revision < requestedRevision) return;
      if (config.revision > requestedRevision)
        return this.complete(record, { ok: false, code: 'SUPERSEDED' });
      const results: ReportedInventory = empty();
      for (const name of names) {
        const desired = config.desired[name];
        try {
          const current = await this.options.registry.current(name);
          if (!current || !same(current, desired.source))
            await this.options.registry.installSource(
              desired.source,
              this.options.archive
                ? await this.options.archive(desired.source)
                : Readable.from([await fetchSource(desired.source)]),
            );
          await this.options.registry.verifySource(desired.source);
          results[name].source = slot(desired.source);
        } catch {
          results[name].source = {
            ...slot<SourcePin>(),
            state: 'error',
            lastError: { code: 'SOURCE_INSTALL_FAILED', message: 'Không cài được nguồn đã ghim' },
          };
          continue;
        }
        for (const runtime of runtimes) {
          const pin = desired.projections[runtime];
          if (!pin) continue;
          try {
            try {
              await this.options.registry.resolve(desired.source, pin);
            } catch {
              const audit = this.options.recipes.find(
                (a) =>
                  a.runtime === runtime &&
                  a.sourceTreeSha256 === desired.source.sourceTreeSha256 &&
                  same(a.expected, pin),
              );
              if (!audit) throw new Error('PROJECTION_UNAVAILABLE');
              const built = await this.options.registry.deriveProjection(
                desired.source,
                runtime,
                audit.recipe,
              );
              if (!same(built, pin)) throw new Error('PROJECTION_MISMATCH');
            }
            results[name].projections[runtime] = slot(pin);
            let definition: WorkflowDefinition | null;
            try {
              definition = await this.definition(desired.source, pin);
            } catch (error) {
              const code = (error as Error)?.message;
              results[name].projections[runtime] = {
                ...slot(),
                state: 'error',
                lastError: {
                  code: 'DEFINITION_FAILED',
                  message: `Không tạo được definition workflow (${/^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'UNKNOWN'})`,
                },
              };
              continue;
            }
            if (definition) results[name].projections[runtime].definition = definition;
          } catch {
            results[name].projections[runtime] = {
              ...slot(),
              state: 'error',
              lastError: { code: 'PROJECTION_INSTALL_FAILED', message: 'Không cài được projection đã ghim' },
            };
          }
        }
      }
      record.report = {
        reportId: randomUUID(),
        bootId: this.options.bootId,
        bootGeneration: this.options.bootGeneration,
        configRevision: config.revision,
        reportedAt: new Date().toISOString(),
        results,
      };
      await this.store.put(this.key(record.command.id), record);
    }
    const report = record.report;
    let response: { accepted: boolean; appliedRevision: number };
    try {
      response = await mutate(
        this.options.http,
        `report:${report.reportId}`,
        '/v2/gateway/install-reports',
        'install-report',
        report,
      );
    } catch (error) {
      if ((error as Error).message === 'CONFIG_REVISION_CONFLICT')
        return this.complete(record, { ok: false, code: 'SUPERSEDED' });
      if (
        (error as Error).message === 'BOOT_RETIRED' &&
        (report.bootId !== this.options.bootId || report.bootGeneration !== this.options.bootGeneration)
      ) {
        // The old operation/body/key remains immutable. Only a confirmed retired-boot response
        // permits a new logical observation under the newly composed boot on the next pass.
        record.report = null;
        record.retryAt = 0;
        await this.store.put(this.key(record.command.id), record);
        return;
      }

      throw error;
    }
    // Re-read desired after replay; a historical accepted response cannot complete a newer config.
    const current = (await this.options.read('/v2/gateway/config')) as
      | GatewayConfig
      | { desiredConfig: null };
    if (('revision' in current ? current.revision : null) !== report.configRevision)
      return this.complete(record, { ok: false, code: 'SUPERSEDED' });
    if (response.accepted && response.appliedRevision === report.configRevision)
      return this.complete(record, { ok: true });
    record.report = null;
    record.attempts++;
    const random = Math.max(0, Math.min(1, (this.options.random ?? Math.random)()));
    record.retryAt =
      (this.options.now ?? Date.now)() +
      Math.min(60000, 1000 * 2 ** Math.min(record.attempts - 1, 6)) * (0.75 + random * 0.5);
    await this.store.put(this.key(record.command.id), record);
  }
  close() {
    return this.store.close();
  }
}
