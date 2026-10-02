import type { Runtime, Workflow, WorkflowStatus } from '../host/status.ts';
import type { ProbeResult, SourceConfig } from './contracts.ts';
import type { ModelProber } from './probe.ts';
export type InventoryPorts = {
  machineId: string;
  prober: ModelProber;
  catalogue: (runtime: Exclude<Runtime, 'api'>) => Promise<string[]>;
};
/** No cached entitlement, quota, readiness, certificate or owner model-list inference. */
export class ModelInventory {
  private readonly ports: InventoryPorts;
  constructor(ports: InventoryPorts) {
    this.ports = ports;
  }
  async collectInventory(
    config: SourceConfig,
    workflows: Record<Workflow, WorkflowStatus>,
  ): Promise<ProbeResult[]> {
    const entries: ProbeResult[] = [];
    for (const runtime of ['claude', 'codex', 'api'] as const) {
      if (!config.enabled[runtime]) continue;
      const models: { providerId: string; modelId: string }[] = [];
      if (runtime === 'api')
        for (const p of config.apiProviders)
          for (const m of p.models) models.push({ providerId: p.id, modelId: m.id });
      else {
        let catalogue: string[] = [];
        try {
          catalogue = await this.ports.catalogue(runtime);
        } catch {
          /* absent is unverified */
        }
        for (const id of new Set(catalogue)) models.push({ providerId: runtime, modelId: id });
      }
      for (const workflow of ['bmad', 'superpowers'] as const) {
        const status = workflows[workflow],
          source = status.source.installed,
          slot = status.projections[runtime],
          projection = slot.installed;
        if (
          status.source.state !== 'current' ||
          slot.state !== 'current' ||
          !source ||
          !projection ||
          source.name !== workflow ||
          projection.runtime !== runtime ||
          projection.sourceTreeSha256 !== source.sourceTreeSha256
        )
          continue;
        for (const model of models)
          entries.push(
            await this.ports.prober.probeModel(
              { machineId: this.ports.machineId, runtime, ...model },
              { source, projection },
              'offline',
            ),
          );
      }
    }
    return entries;
  }
}
