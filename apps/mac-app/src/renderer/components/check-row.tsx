import type { CheckResult, CheckStatus } from '@crew/mac';
import type { ReactNode } from 'react';
import { Lozenge, type Tone } from './ui';

const LABEL: Record<CheckStatus, string> = { ok: 'ĐẠT', warn: 'CẢNH BÁO', fail: 'LỖI' };
const TONE: Record<CheckStatus, Tone> = { ok: 'ok', warn: 'warn', fail: 'bad' };

/** Một dòng kết quả doctor: nhãn trạng thái, tiêu đề, chi tiết, gợi ý và nút hành động (nếu có). */
export function CheckRow({ result, action }: { result: CheckResult; action?: ReactNode }) {
  return (
    <li className="check-row">
      <Lozenge tone={TONE[result.status]}>{LABEL[result.status]}</Lozenge>
      <div className="check-body">
        <div className="check-title">{result.title}</div>
        {result.detail && <div className="muted">{result.detail}</div>}
        {result.hint && <div className="check-hint">Gợi ý: {result.hint}</div>}
      </div>
      {action && <div className="check-action">{action}</div>}
    </li>
  );
}
