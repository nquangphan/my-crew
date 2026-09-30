import { useState } from 'react';
import { invoke } from '../lib/ipc';

export interface FolderPickerProps {
  value: string | null;
  onPick: (path: string) => void;
  label?: string;
  disabled?: boolean;
}

/** The native folder dialog (the only way to browse this machine's folders); the caller decides where it goes. */
export function FolderPicker({ value, onPick, label = 'Chọn thư mục…', disabled }: FolderPickerProps) {
  const [picking, setPicking] = useState(false);
  const pick = async () => {
    setPicking(true);
    try {
      const { path } = await invoke('folder.pick', {});
      if (path) onPick(path);
    } finally {
      setPicking(false);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button type="button" className="btn shrink-0" onClick={pick} disabled={disabled || picking}>
        {label}
      </button>
      <span
        className={`truncate font-mono text-xs ${value ? 'text-ink' : 'text-muted'}`}
        title={value ?? undefined}
      >
        {value ?? 'chưa chọn thư mục'}
      </span>
    </div>
  );
}
