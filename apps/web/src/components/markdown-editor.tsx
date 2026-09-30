import { useId, useState } from 'react';
import { cn } from '../lib/cn';
import { usePasteImage } from '../lib/paste-image';
import { MarkdownView } from './markdown-view';
import { Textarea } from './ui/field';

/**
 * Markdown textarea with a "Xem trước" tab that renders exactly what readers will see. `ticketId` (the
 * ticket's id or key) enables paste-to-upload of a clipboard image; omitted where no ticket exists yet
 * (e.g. the new-ticket dialog), paste falls back to plain text.
 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  rows = 6,
  autoFocus,
  ticketId,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  ticketId?: string;
}) {
  const [preview, setPreview] = useState(false);
  const id = useId();
  const { onPaste, error: pasteError } = usePasteImage({ ticketId, value, onChange });
  const tab = (active: boolean) =>
    cn(
      'min-h-11 border-b-2 px-1 text-[13px] xl:min-h-8',
      active ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted',
    );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-4">
        <label htmlFor={id} className="grow text-[13px] font-semibold text-muted">
          {label}
        </label>
        <button
          type="button"
          className={tab(!preview)}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Viết
        </button>
        <button
          type="button"
          className={tab(preview)}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Xem trước
        </button>
      </div>
      {preview ? (
        <div className="min-h-24 rounded border border-line2 p-2.5">
          {value.trim() ? (
            <MarkdownView source={value} />
          ) : (
            <p className="m-0 text-sm text-muted">Chưa có nội dung.</p>
          )}
        </div>
      ) : (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      )}
      {pasteError && (
        <p role="alert" className="m-0 text-xs text-bad">
          {pasteError}
        </p>
      )}
      <span className="text-xs text-muted">Hỗ trợ Markdown.</span>
    </div>
  );
}
