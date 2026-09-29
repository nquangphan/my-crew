import { type ModelSettings, type ResourceSettings, type ResourcesView, SelectableModel } from '@crew/shared';

/** Fable is not offered: it is not used at all (owner decision). */
const MODELS = SelectableModel.options;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const COMPLEXITY: { key: keyof ModelSettings['complexityMap']; label: string }[] = [
  { key: 'trivial', label: 'Rất nhỏ' },
  { key: 'small', label: 'Nhỏ' },
  { key: 'medium', label: 'Vừa' },
  { key: 'large', label: 'Lớn' },
];

export interface ResourceDraft {
  resources: ResourceSettings;
  models: ModelSettings;
}

export interface ResourceFormProps {
  view: ResourcesView;
  draft: ResourceDraft;
  onChange: (draft: ResourceDraft) => void;
}

/** Max concurrent jobs, min free RAM, load limit, the model allowlist and the complexity map. */
export function ResourceForm({ view, draft, onChange }: ResourceFormProps) {
  const setResources = (patch: Partial<ResourceSettings>) =>
    onChange({ ...draft, resources: { ...draft.resources, ...patch } });
  const number = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));
  const toggleModel = (model: (typeof MODELS)[number], allowed: boolean) => {
    const allow = allowed
      ? [...new Set([...draft.models.allow, model])]
      : draft.models.allow.filter((m) => m !== model);
    onChange({ ...draft, models: { ...draft.models, allow } });
  };
  const setChoice = (
    key: keyof ModelSettings['complexityMap'],
    patch: Partial<ModelSettings['complexityMap']['small']>,
  ) =>
    onChange({
      ...draft,
      models: {
        ...draft.models,
        complexityMap: {
          ...draft.models.complexityMap,
          [key]: { ...draft.models.complexityMap[key], ...patch },
        },
      },
    });

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Tài nguyên</h2>
          <button
            type="button"
            className="btn text-xs"
            onClick={() => onChange({ ...draft, resources: view.suggested })}
          >
            Dùng gợi ý theo máy ({view.machine.cpus} CPU, {view.machine.totalMemGb} GB RAM)
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="label">Số job chạy cùng lúc</span>
            <input
              className="input"
              type="number"
              min={1}
              max={64}
              value={Number.isNaN(draft.resources.maxConcurrentJobs) ? '' : draft.resources.maxConcurrentJobs}
              onChange={(e) => setResources({ maxConcurrentJobs: number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label">RAM trống tối thiểu (GB)</span>
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={Number.isNaN(draft.resources.minFreeMemGb) ? '' : draft.resources.minFreeMemGb}
              onChange={(e) => setResources({ minFreeMemGb: number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label">Tải tối đa mỗi CPU</span>
            <input
              className="input"
              type="number"
              min={0.1}
              step={0.1}
              value={Number.isNaN(draft.resources.maxLoadPerCpu) ? '' : draft.resources.maxLoadPerCpu}
              onChange={(e) => setResources({ maxLoadPerCpu: number(e.target.value) })}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          Máy chạy tối đa min(số job, nửa số CPU) job; không nhận job mới khi RAM trống thấp hơn hoặc tải cao
          hơn giới hạn.
        </p>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Model được phép</h2>
        <div className="flex gap-4">
          {MODELS.map((model) => (
            <label key={model} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--blue)]"
                checked={draft.models.allow.includes(model)}
                disabled={model === 'sonnet'}
                onChange={(e) => toggleModel(model, e.target.checked)}
              />
              {model}
              {model === 'sonnet' && (
                <span className="text-xs text-muted">(bắt buộc: docs chạy trên sonnet)</span>
              )}
            </label>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Độ phức tạp → model</h2>
        <div className="grid grid-cols-4 gap-3">
          {COMPLEXITY.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <span className="label">{label}</span>
              <select
                className="input"
                aria-label={`Model cho độ phức tạp ${label}`}
                value={draft.models.complexityMap[key].model}
                onChange={(e) => setChoice(key, { model: e.target.value as (typeof MODELS)[number] })}
              >
                {MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <select
                className="input"
                aria-label={`Effort cho độ phức tạp ${label}`}
                value={draft.models.complexityMap[key].effort}
                onChange={(e) => setChoice(key, { effort: e.target.value as (typeof EFFORTS)[number] })}
              >
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A problem that blocks saving, or null. */
export function resourceDraftError(draft: ResourceDraft): string | null {
  const { maxConcurrentJobs, minFreeMemGb, maxLoadPerCpu } = draft.resources;
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1 || maxConcurrentJobs > 64) {
    return 'Số job chạy cùng lúc phải là số nguyên từ 1 đến 64.';
  }
  if (!Number.isFinite(minFreeMemGb) || minFreeMemGb < 0) return 'RAM trống tối thiểu phải từ 0 GB trở lên.';
  if (!Number.isFinite(maxLoadPerCpu) || maxLoadPerCpu <= 0) return 'Tải tối đa mỗi CPU phải lớn hơn 0.';
  if (!draft.models.allow.includes('sonnet')) return 'sonnet phải luôn được cho phép.';
  const blocked = Object.values(draft.models.complexityMap).find(
    (choice) => !draft.models.allow.includes(choice.model),
  );
  if (blocked) return `Model ${blocked.model} trong bảng độ phức tạp chưa được cho phép.`;
  return null;
}
