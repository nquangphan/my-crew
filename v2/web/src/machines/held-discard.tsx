/**
 * “Bỏ yêu cầu cũ”: the way out of an unconfirmed onboarding request that keeps failing. The owner confirms
 * the duplicate risk, then the caller drops the held operation and keeps the typed fields for a new key.
 */
import { type CSSProperties, useState } from 'react';

const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.4rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export function DiscardHeld({
  warning,
  disabled,
  onDiscard,
}: {
  warning: string;
  disabled: boolean;
  onDiscard: () => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button type="button" style={buttonStyle} disabled={disabled} onClick={() => setConfirming(true)}>
        Bỏ yêu cầu cũ
      </button>
    );
  return (
    <div role="alertdialog" aria-label="Xác nhận bỏ yêu cầu cũ" style={{ display: 'grid', gap: '0.5rem' }}>
      <p style={{ margin: 0 }}>{warning}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={disabled}
          onClick={async () => {
            setConfirming(false);
            await onDiscard();
          }}
        >
          Vẫn bỏ yêu cầu cũ
        </button>
        <button type="button" style={buttonStyle} onClick={() => setConfirming(false)}>
          Giữ lại
        </button>
      </div>
    </div>
  );
}
