export type Runtime = 'claude' | 'codex' | 'api';
export type Model = {
  id: string;
  machineId: string;
  runtime: Runtime;
  available: boolean;
  capabilities: string[];
};
export type Selection = {
  machineId: string;
  required: string[];
  enabled: Record<Runtime, boolean>;
  desiredRevision: number;
  appliedRevision: number;
};
export function eligibleModels(models: Model[], policy: Selection): Model[] {
  if (policy.desiredRevision !== policy.appliedRevision) return [];
  return models.filter(
    (m) =>
      m.machineId === policy.machineId &&
      m.available &&
      policy.enabled[m.runtime] &&
      policy.required.every((c) => m.capabilities.includes(c)),
  );
}
