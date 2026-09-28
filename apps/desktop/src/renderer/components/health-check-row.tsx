import type { HealthCheckResult } from '@crew/shared';
import { StatusDot } from './ui';

export interface HealthCheckRowProps {
  result: HealthCheckResult;
  /** The fix of this row is running. */
  busy?: boolean;
  onFix?: (result: HealthCheckResult) => void;
}

/** One check: the status dot, the Vietnamese explanation and its one-click fix. */
export function HealthCheckRow({ result, busy, onFix }: HealthCheckRowProps) {
  const fix = result.status !== 'green' ? result.fix : undefined;
  return (
    <div
      className="flex items-start gap-3 border-b border-line2 px-4 py-3 last:border-b-0"
      data-check={result.id}
      data-status={result.status}
    >
      <div className="pt-1.5">
        <StatusDot status={result.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {result.title}
          {result.fixed && <span className="ml-2 text-xs font-normal text-ok">(đã tự sửa)</span>}
        </div>
        <div className="mt-0.5 break-words text-sm text-muted">{result.detail}</div>
      </div>
      {fix && onFix && (
        <button type="button" className="btn shrink-0" disabled={busy} onClick={() => onFix(result)}>
          {busy ? 'Đang sửa…' : fix.label}
        </button>
      )}
    </div>
  );
}
