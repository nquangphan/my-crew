import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Workflow, WorkflowStatus } from '../host/status.ts';
import { AtomicRecords, canonicalJson, hash } from '../journal/atomic-records.ts';
import type { HttpOperationJournal } from '../journal/http-operations.ts';
import type {
  ModelAppliedBody,
  ModelInventoryBody,
  ModelReportEnvelope,
  ProbeResult,
  SourceConfig,
} from './contracts.ts';
export type ReporterPorts = {
  getDesired: () => Promise<SourceConfig | null>;
  currentBoot: () => { bootId: string; bootGeneration: string } | null;
};
type Report = {
  formatVersion: 1;
  kind: 'inventory' | 'applied';
  envelope: ModelReportEnvelope<ModelInventoryBody | ModelAppliedBody>;
};
export class ModelReporter {
  private readonly store: AtomicRecords;
  private readonly http: HttpOperationJournal;
  private readonly ports: ReporterPorts;
  private desired: SourceConfig | null = null;
  private constructor(store: AtomicRecords, http: HttpOperationJournal, ports: ReporterPorts) {
    this.store = store;
    this.http = http;
    this.ports = ports;
  }
  static async open(root: string, http: HttpOperationJournal, ports: ReporterPorts): Promise<ModelReporter> {
    return new ModelReporter(await AtomicRecords.open(join(root, 'model-reports')), http, ports);
  }
  async reconnect(
    workflows: Record<Workflow, WorkflowStatus>,
    collect: (config: SourceConfig, workflows: Record<Workflow, WorkflowStatus>) => Promise<ProbeResult[]>,
  ): Promise<string> {
    this.desired = await this.ports.getDesired();
    if (!this.desired) throw new Error('MODEL_CONFIG_NOT_CONFIGURED');
    const snapshot = structuredClone(this.desired);
    const entries = await collect(snapshot, workflows);
    // A subsequent desired GET is required on the next reconnect; no owner-session revision.
    return this.sendInventory({ entries });
  }
  async sendInventory(body: ModelInventoryBody): Promise<string> {
    const config = this.desired;
    if (!config) throw new Error('MODEL_CONFIG_NOT_CONFIGURED');
    for (const entry of body.entries) {
      if (!config.enabled[entry.key.runtime]) throw new Error('SOURCE_DISABLED');
      if (
        entry.key.runtime === 'api' &&
        !config.apiProviders.some(
          (p) => p.id === entry.key.providerId && p.models.some((m) => m.id === entry.key.modelId),
        )
      )
        throw new Error('MODEL_NOT_CONFIGURED');
    }
    return this.send('inventory', body);
  }
  async sendApplied(body: ModelAppliedBody): Promise<string> {
    const inventory = await this.store.get<Report>(body.inventoryReportId),
      boot = this.ports.currentBoot();
    if (
      inventory?.kind !== 'inventory' ||
      inventory.envelope.configRevision !== this.desired?.revision ||
      inventory.envelope.bootId !== boot?.bootId ||
      inventory.envelope.bootGeneration !== boot.bootGeneration ||
      hash(canonicalJson(inventory.envelope.body)) !== body.observationDigest
    )
      throw new Error('INVENTORY_MISMATCH');
    for (const runtime of ['claude', 'codex', 'api'] as const) {
      if (!this.desired.enabled[runtime] && body.sourceStatus[runtime].state !== 'disabled')
        throw new Error('SOURCE_DISABLED');
      if (this.desired.enabled[runtime] && body.sourceStatus[runtime].state === 'disabled')
        throw new Error('APPLIED_MISMATCH');
    }
    // Caller supplies measured source observation; this reporter never synthesizes ready.
    return this.send('applied', body);
  }
  private async send(kind: Report['kind'], body: ModelInventoryBody | ModelAppliedBody): Promise<string> {
    const boot = this.ports.currentBoot(),
      revision = this.desired?.revision;
    if (!boot || !/^[1-9][0-9]*$/.test(boot.bootGeneration) || !revision)
      throw new Error('BOOT_NOT_CONFIGURED');
    const id = await this.store.transaction(async () => {
      const counterId = `sequence:${boot.bootId}:${boot.bootGeneration}`;
      const old = await this.store.get<{ formatVersion: 1; sequence: string }>(counterId);
      const sequence = (BigInt(old?.sequence ?? '0') + 1n).toString();
      // Counter first: a crash can skip a value but can never reuse an allocated sequence.
      await this.store.put(counterId, { formatVersion: 1, sequence });
      const reportId = randomUUID(),
        envelope = {
          reportId,
          ...boot,
          sequence,
          configRevision: revision,
          body: JSON.parse(canonicalJson(body)),
        };
      await this.store.put(reportId, { formatVersion: 1, kind, envelope });
      return reportId;
    });
    return this.replay(id);
  }
  async replay(id: string): Promise<string> {
    const report = await this.store.get<Report>(id);
    if (!report) throw new Error('UNKNOWN_MODEL_REPORT');
    await this.http.prepare({
      operationId: id,
      method: 'POST',
      route: `/v2/machine/models/${report.kind}`,
      phase: `model-${report.kind}`,
      canonicalBody: report.envelope,
    });
    const response = await this.http.replay(id);
    if (response.status < 200 || response.status >= 300) throw new Error('MODEL_REPORT_REJECTED');
    const body = response.body as { reportId?: unknown; accepted?: unknown };
    if (body?.reportId !== id || body.accepted !== true) throw new Error('MODEL_REPORT_INVALID');
    return id;
  }
  close(): Promise<void> {
    return this.store.close();
  }
}
