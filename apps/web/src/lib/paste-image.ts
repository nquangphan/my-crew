import { AttachmentMimeType } from '@crew/shared';
import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './format';
import { useUploadAttachment } from './queries';

let uploadSeq = 0;

/** The first image file in a paste's clipboard items, or `null` when the paste has no image. */
function imageFileFrom(items: DataTransferItemList | undefined | null): File | null {
  if (!items) return null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

/** Base64 content of a file, without the `data:...;base64,` prefix `readAsDataURL` adds. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('không đọc được ảnh'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('không đọc được ảnh'));
    reader.readAsDataURL(file);
  });
}

/**
 * Paste-to-upload shared by the ticket description editor (`MarkdownEditor`) and the comment composer:
 * pasting an image from the clipboard uploads it via `POST /v1/tickets/:id/attachments` (CREW2PS-2) and
 * inserts `![...](url)` at the caret, showing a placeholder while the upload runs. Pasting anything else is
 * left alone (default paste behavior). `ticketId` omitted (e.g. the new-ticket dialog, before the ticket
 * exists) disables paste-to-upload entirely.
 */
export function usePasteImage({
  ticketId,
  value,
  onChange,
}: {
  ticketId: string | undefined;
  value: string;
  onChange: (value: string) => void;
}): { onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void; error: string | null } {
  const upload = useUploadAttachment(ticketId ?? '');
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!ticketId) return;
      const file = imageFileFrom(event.clipboardData.items);
      if (!file) return;
      event.preventDefault();

      const mime = AttachmentMimeType.safeParse(file.type);
      if (!mime.success) {
        setError('Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP.');
        return;
      }
      setError(null);

      const target = event.currentTarget;
      const start = target.selectionStart ?? valueRef.current.length;
      const end = target.selectionEnd ?? start;
      uploadSeq += 1;
      const placeholder = `![Đang tải ảnh...](uploading:${uploadSeq})`;
      onChange(`${valueRef.current.slice(0, start)}${placeholder}${valueRef.current.slice(end)}`);

      void (async () => {
        try {
          const content = await fileToBase64(file);
          const attachment = await upload.mutateAsync({
            filename: file.name || 'pasted-image',
            mimeType: mime.data,
            content,
          });
          const markdown = `![ảnh](${attachment.url})`;
          onChange(
            valueRef.current.includes(placeholder)
              ? valueRef.current.replace(placeholder, markdown)
              : valueRef.current,
          );
        } catch (err) {
          onChange(valueRef.current.replace(placeholder, ''));
          setError(errorMessage(err));
        }
      })();
    },
    [ticketId, upload, onChange],
  );

  return { onPaste, error };
}
