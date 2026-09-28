import type { ReactNode } from 'react';
import { ErrorBox } from './ui';

export const WIZARD_STEPS = [
  { id: 'server', title: 'Server' },
  { id: 'pairing', title: 'Ghép máy' },
  { id: 'claude', title: 'Claude' },
  { id: 'projects', title: 'Project và thư mục' },
  { id: 'hooks', title: 'Docs và hook' },
  { id: 'resources', title: 'Tài nguyên và model' },
  { id: 'finish', title: 'Hoàn tất' },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

export interface WizardStepProps {
  step: WizardStepId;
  description: ReactNode;
  children: ReactNode;
  /** The step validated; "Tiếp" is enabled. */
  canNext: boolean;
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  busy?: boolean;
  error?: string | null;
}

/** The frame of one setup step: the step list, the step body, and Back / Next that validate first. */
export function WizardStep({
  step,
  description,
  children,
  canNext,
  onNext,
  onBack,
  nextLabel,
  busy,
  error,
}: WizardStepProps) {
  const index = WIZARD_STEPS.findIndex((item) => item.id === step);
  return (
    <div className="mx-auto flex max-w-4xl gap-8 p-8">
      <ol className="w-48 shrink-0 space-y-1 pt-1 text-sm">
        {WIZARD_STEPS.map((item, i) => (
          <li
            key={item.id}
            className={`flex items-center gap-2 rounded px-2 py-1.5 ${i === index ? 'bg-accent-bg font-semibold text-accent-ink' : i < index ? 'text-ink' : 'text-muted'}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i < index ? 'bg-ok text-white' : i === index ? 'bg-accent text-white' : 'bg-gray-bg'}`}
            >
              {i < index ? '✓' : i + 1}
            </span>
            {item.title}
          </li>
        ))}
      </ol>
      <section className="card min-w-0 flex-1 p-6" data-step={step}>
        <h1 className="text-lg font-semibold">
          Bước {index + 1}: {WIZARD_STEPS[index]?.title}
        </h1>
        <div className="mt-1 mb-5 text-sm text-muted">{description}</div>
        <div className="space-y-4">{children}</div>
        <div className="mt-6 space-y-3">
          <ErrorBox message={error ?? null} />
          <div className="flex justify-between">
            {onBack ? (
              <button type="button" className="btn" onClick={onBack} disabled={busy}>
                Quay lại
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="btn btn-primary" onClick={onNext} disabled={!canNext || busy}>
              {nextLabel ?? 'Tiếp'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
