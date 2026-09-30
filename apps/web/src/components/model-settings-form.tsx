import {
  type BudgetSettings,
  type Complexity,
  Effort,
  type ModelSettings,
  ResourceSettings,
  SelectableModel,
} from '@crew/shared';
import { Field, Input, Select } from './ui/field';

const COMPLEXITY: { key: Complexity; label: string }[] = [
  { key: 'trivial', label: 'Rất nhỏ (trivial)' },
  { key: 'small', label: 'Nhỏ (small)' },
  { key: 'medium', label: 'Vừa (medium)' },
  { key: 'large', label: 'Lớn (large)' },
];

/** Problems of a parsed setting as Vietnamese lines: `field: message`. */
export function issuesOf(
  result:
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  labels: Record<string, string> = {},
): string[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    const label = labels[path] ?? labels[String(issue.path[0] ?? '')] ?? path;
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}

/**
 * The model allowlist and the complexity → model/effort map. Sonnet is always allowed (docs work runs on it)
 * and Fable is not offered at all: both are owner decisions the server enforces too.
 */
export function ModelSettingsForm({
  value,
  onChange,
}: {
  value: ModelSettings;
  onChange: (value: ModelSettings) => void;
}) {
  const toggle = (model: SelectableModel, allowed: boolean) =>
    onChange({
      ...value,
      allow: allowed ? [...new Set([...value.allow, model])] : value.allow.filter((item) => item !== model),
    });
  const setChoice = (level: Complexity, patch: Partial<ModelSettings['complexityMap'][Complexity]>) =>
    onChange({
      ...value,
      complexityMap: { ...value.complexityMap, [level]: { ...value.complexityMap[level], ...patch } },
    });
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold text-muted">Model được phép</legend>
        {SelectableModel.options.map((model) => (
          <label key={model} className="inline-flex min-h-11 items-center gap-1.5 text-sm xl:min-h-8">
            <input
              type="checkbox"
              className="size-4 accent-[var(--blue)]"
              checked={value.allow.includes(model)}
              disabled={model === 'sonnet'}
              onChange={(e) => toggle(model, e.target.checked)}
            />
            {model}
            {model === 'sonnet' && (
              <span className="text-xs text-muted">(luôn bật: docs chạy trên sonnet)</span>
            )}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        {COMPLEXITY.map(({ key, label }) => (
          <div key={key} className="grid grid-cols-2 gap-2">
            <Field label={`${label}: model`}>
              <Select
                value={value.complexityMap[key].model}
                onChange={(e) => setChoice(key, { model: e.target.value as SelectableModel })}
              >
                {SelectableModel.options.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`${label}: effort`}>
              <Select
                value={value.complexityMap[key].effort}
                onChange={(e) => setChoice(key, { effort: e.target.value as Effort })}
              >
                {Effort.options.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ))}
      </div>
      <p className="m-0 text-xs text-muted">
        PM đánh giá độ phức tạp của mỗi subtask dev và QC; model của lượt chạy lấy từ bảng này. Docs luôn chạy
        trên sonnet và Fable không bao giờ được dùng (quyết định của chủ dự án), bảng này không đổi được.
      </p>
    </div>
  );
}

const number = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

export interface ResourceDraft {
  maxConcurrentJobs: string;
  minFreeMemGb: string;
  maxLoadPerCpu: string;
}

export const resourceDraft = (value: ResourceSettings): ResourceDraft => ({
  maxConcurrentJobs: String(value.maxConcurrentJobs),
  minFreeMemGb: String(value.minFreeMemGb),
  maxLoadPerCpu: String(value.maxLoadPerCpu),
});

export function parseResourceDraft(draft: ResourceDraft) {
  return ResourceSettings.safeParse({
    maxConcurrentJobs: number(draft.maxConcurrentJobs),
    minFreeMemGb: number(draft.minFreeMemGb),
    maxLoadPerCpu: number(draft.maxLoadPerCpu),
  });
}

export const RESOURCE_LABELS = {
  maxConcurrentJobs: 'Số job chạy cùng lúc',
  minFreeMemGb: 'RAM trống tối thiểu (GB)',
  maxLoadPerCpu: 'Tải tối đa mỗi CPU',
};

/** A machine's job slots and the memory and load limits above which it starts no job. */
export function ResourceSettingsForm({
  value,
  onChange,
}: {
  value: ResourceDraft;
  onChange: (value: ResourceDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(RESOURCE_LABELS) as (keyof ResourceDraft)[]).map((field) => (
          <Field key={field} label={RESOURCE_LABELS[field]}>
            <Input
              type="number"
              inputMode="decimal"
              value={value[field]}
              onChange={(e) => onChange({ ...value, [field]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <p className="m-0 text-xs text-muted">
        Máy chạy tối đa min(số job, nửa số CPU) job; không nhận job mới khi RAM trống thấp hơn hoặc tải cao
        hơn giới hạn.
      </p>
    </div>
  );
}

/** The cost cap of one agent run; empty means no cap. */
export function BudgetSettingsForm({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="Chi phí tối đa mỗi lượt chạy (USD)"
      hint="Để trống: không giới hạn. Ngân sách cây ticket và ngày nằm trong cài đặt dự án."
    >
      <Input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export const budgetOf = (text: string): BudgetSettings => ({
  perJobUsd: text.trim() === '' ? null : number(text),
});
