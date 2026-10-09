import type { ReactNode } from 'react';
import { Notice } from './ui';

export interface StepFeedback {
  ok: boolean;
  message: string;
}

/** Khung một bước của wizard: tiêu đề, mô tả, nội dung (ô nhập), thông báo kết quả và hàng nút. */
export function WizardStep({
  title,
  description,
  children,
  feedback,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  feedback?: StepFeedback | null;
  actions?: ReactNode;
}) {
  return (
    <section className="wizard-card" aria-label={title}>
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      {children}
      {feedback && (
        <div role={feedback.ok ? 'status' : 'alert'}>
          <Notice tone={feedback.ok ? 'ok' : 'bad'}>
            <span className="pre-wrap">{feedback.message}</span>
          </Notice>
        </div>
      )}
      {actions && <div className="actions">{actions}</div>}
    </section>
  );
}
