import { canonicalJson } from '../journal/canonical.ts';
import type { Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type {
  BundleState,
  CatalogueProjection,
  CatalogueVerdict,
  GatewayApplied,
  InstallReportResponse,
  ProjectionPin,
  ProjectionSlotStatus,
  SlotStatus,
  SourcePin,
  WorkflowCatalogue,
  WorkflowInventory,
} from './contracts.ts';
import { runtimes, workflows } from './contracts.ts';
import { definitionMatches, officialRelease, readGatewayApplied, readGatewayConfig } from './service.ts';

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

function verdict<T>(desired: T | null, installed: T | null, state: BundleState): CatalogueVerdict {
  if (!desired) return 'not_desired';
  if (state === 'error') return 'error';
  if (state === 'installing') return 'installing';
  if (state === 'missing' || !installed) return 'not_installed';
  return state === 'current' && same(installed, desired) ? 'match' : 'mismatch';
}
const missing = <T>(): SlotStatus<T> => ({
  state: 'missing',
  installed: null,
  lastError: null,
  observedAt: null,
});

/**
 * Owner read of what is installed per workflow/runtime next to what is desired now. Each slot is compared
 * with the current desired pins, never with appliedConfigRevision, so a later desired change shows old pins
 * as mismatch. A stored definition is returned only when it is provably tied to the exact desired pins.
 */
export async function readWorkflowCatalogue(tx: Tx, machineId: Id): Promise<WorkflowCatalogue> {
  const [machine] = await tx`select id from machines where id=${machineId}`;
  if (!machine) throw new ApiError('NOT_FOUND', 404, 'Yêu cầu cổng máy không còn hợp lệ');
  const config = await readGatewayConfig(tx, machineId);
  const applied: GatewayApplied | null = await readGatewayApplied(tx, machineId);
  const [last] =
    await tx`select r.id,r.config_revision,r.response,r.received_at from gateway_applied a join gateway_install_reports r on r.id=a.latest_report_id where a.machine_id=${machineId}`;
  const reported: WorkflowInventory | undefined = applied?.workflows;
  const result = {} as WorkflowCatalogue['workflows'];
  const official = {} as WorkflowCatalogue['official'];
  for (const workflow of workflows) {
    official[workflow] = officialRelease(workflow);
    const desired = config?.desired[workflow] ?? null;
    const status = reported?.[workflow];
    const source = status?.source ?? missing<SourcePin>();
    const desiredSource = desired?.source ?? null;
    const projections = {} as Record<(typeof runtimes)[number], CatalogueProjection>;
    for (const runtime of runtimes) {
      const slot = status?.projections[runtime] ?? (missing<ProjectionPin>() as ProjectionSlotStatus);
      const pin = desired?.projections[runtime] ?? null;
      const trusted =
        slot.definition && desiredSource && definitionMatches(slot, desiredSource, pin, source.installed);
      projections[runtime] = {
        desired: pin,
        installed: slot.installed,
        state: slot.state,
        verdict: verdict(pin, slot.installed, slot.state),
        definition: trusted ? (slot.definition ?? null) : null,
        lastError: slot.lastError,
        observedAt: slot.observedAt,
      };
    }
    result[workflow] = {
      source: {
        desired: desiredSource,
        installed: source.installed,
        state: source.state,
        verdict: verdict(desiredSource, source.installed, source.state),
        versionMismatch:
          !!desiredSource && !!source.installed && desiredSource.version !== source.installed.version,
        lastError: source.lastError,
        observedAt: source.observedAt,
      },
      projections,
    };
  }
  return {
    machineId,
    desiredConfigRevision: config?.revision ?? null,
    appliedConfigRevision: applied?.revision ?? null,
    latestReport: last
      ? {
          reportId: last.id as Id,
          configRevision: Number(last.config_revision),
          accepted: (last.response as InstallReportResponse).accepted,
          receivedAt: (last.received_at as Date).toISOString(),
        }
      : null,
    official,
    workflows: result,
  };
}
