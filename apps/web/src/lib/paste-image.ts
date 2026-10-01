import { AttachmentMimeType } from '@crew/shared';
import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './format';
import { useUploadAttachment, useUploadDraftAttachment } from './queries';

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
 * pasting an image from the clipboard uploads it and inserts `![...](url)` at the caret, showing a
 * placeholder while the upload runs. Pasting anything else is left alone (default paste behavior).
 *
 * `ticketId` set uploads via `POST /v1/tickets/:id/attachments` (CREW2PS-2) — the existing ticket
 * description/comment case. `ticketId` omitted with `draft: true` (the new-ticket dialog, before the ticket
 * exists) uploads via the draft endpoint `POST /v1/attachments` instead (CREW2PS-52/-54); the server claims
 * the draft image into the new ticket once its description references the returned `url`. `ticketId`
 * omitted and `draft` falsy (default) disables paste-to-upload entirely — paste does nothing.
 *
 * `uploading` is `true` while at least one paste's upload is in flight; callers that can submit the text
 * elsewhere (e.g. creating the ticket) should block submission while it is `true`, so the submitted value
 * never contains an unresolved `uploading:` placeholder.
 */
export function usePasteImage({
  ticketId,
  draft = false,
  value,
  onChange,
}: {
  ticketId: string | undefined;
  draft?: boolean;
  value: string;
  onChange: (value: string) => void;
}): {
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  error: string | null;
  uploading: boolean;
} {
  const ticketUpload = useUploadAttachment(ticketId ?? '');
  const draftUpload = useUploadDraftAttachment();
  const enabled = Boolean(ticketId) || draft;
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!enabled) return;
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
      setPendingCount((n) => n + 1);

      void (async () => {
        try {
          const content = await fileToBase64(file);
          const body = { filename: file.name || 'pasted-image', mimeType: mime.data, content };
          const attachment = ticketId
            ? await ticketUpload.mutateAsync(body)
            : await draftUpload.mutateAsync(body);
          const markdown = `![ảnh](${attachment.url})`;
          onChange(
            valueRef.current.includes(placeholder)
              ? valueRef.current.replace(placeholder, markdown)
              : valueRef.current,
          );
        } catch (err) {
          onChange(valueRef.current.replace(placeholder, ''));
          setError(errorMessage(err));
        } finally {
          setPendingCount((n) => n - 1);
        }
      })();
    },
    [enabled, ticketId, ticketUpload, draftUpload, onChange],
  );

  return { onPaste, error, uploading: pendingCount > 0 };
}
