import { Buffer } from 'node:buffer';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { MarkdownEditor } from './markdown-editor';

/** A controlled wrapper: `MarkdownEditor` itself holds no state, so tests need a parent that does. */
function Harness({
  ticketId,
  draftAttachments,
  initial = '',
  onUploadingChange,
}: {
  ticketId?: string;
  draftAttachments?: boolean;
  initial?: string;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      label="Mô tả"
      value={value}
      onChange={setValue}
      ticketId={ticketId}
      draftAttachments={draftAttachments}
      onUploadingChange={onUploadingChange}
    />
  );
}

function pasteImage(box: HTMLElement, file: File) {
  fireEvent.paste(box, {
    clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
  });
}

function pasteText(box: HTMLElement, text: string) {
  fireEvent.paste(box, {
    clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    // jsdom does not perform the browser's default paste itself; this only stands in for its `getData`.
    getData: () => text,
  });
}

describe('MarkdownEditor paste-to-upload', () => {
  it('uploads a pasted image and inserts the markdown link at the caret', async () => {
    const calls = mockFetch([
      [
        'POST /v1/tickets/TICKET-1/attachments',
        () => ({
          status: 201,
          body: { id: 'a1', url: '/v1/attachments/a1', mimeType: 'image/png', sizeBytes: 10 },
        }),
      ],
    ]);
    renderWithApp(<Harness ticketId="TICKET-1" initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);

    const file = new File(['fake-bytes'], 'shot.png', { type: 'image/png' });
    pasteImage(box, file);

    expect(box.value).toMatch(/^A!\[Đang tải ảnh\.\.\.\]\(uploading:\d+\)B$/);

    await waitFor(() => expect(box.value).toBe('A![ảnh](/v1/attachments/a1)B'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/v1/tickets/TICKET-1/attachments');
    expect(post?.body).toEqual({
      filename: 'shot.png',
      mimeType: 'image/png',
      content: Buffer.from('fake-bytes').toString('base64'),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Xem trước' }));
    const img = screen.getByRole('img', { name: 'ảnh' });
    expect(img).toHaveAttribute('src', '/v1/attachments/a1');
  });

  it('shows a Vietnamese error and drops the placeholder when the server refuses the upload', async () => {
    mockFetch([
      [
        'POST /v1/tickets/TICKET-1/attachments',
        () => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'quá 10MB' } } }),
      ],
    ]);
    renderWithApp(<Harness ticketId="TICKET-1" initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteImage(box, new File(['x'], 'big.png', { type: 'image/png' }));

    await waitFor(() => expect(box.value).toBe('AB'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dữ liệu không hợp lệ.');
  });

  it('shows a clear size message (not the generic one) when the pasted image is over 10MB', async () => {
    mockFetch([
      [
        'POST /v1/tickets/TICKET-1/attachments',
        () => ({
          status: 413,
          body: { error: { code: 'ATTACHMENT_TOO_LARGE', message: 'ảnh vượt quá 10MB' } },
        }),
      ],
    ]);
    renderWithApp(<Harness ticketId="TICKET-1" initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteImage(box, new File(['x'], 'huge.png', { type: 'image/png' }));

    await waitFor(() => expect(box.value).toBe('AB'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ảnh vượt quá giới hạn 10MB, hãy chọn ảnh nhỏ hơn.',
    );
  });

  it('rejects an unsupported image mime before uploading, without touching the content', async () => {
    const calls = mockFetch([]);
    renderWithApp(<Harness ticketId="TICKET-1" initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteImage(box, new File(['x'], 'anim.bmp', { type: 'image/bmp' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP.');
    expect(box.value).toBe('AB');
    expect(calls).toHaveLength(0);
  });

  it('leaves a non-image paste untouched: no upload, no error, content unaffected', async () => {
    const calls = mockFetch([]);
    renderWithApp(<Harness ticketId="TICKET-1" initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteText(box, 'plain text');

    expect(box.value).toBe('AB');
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores image paste entirely when no ticketId and no draftAttachments mode', async () => {
    const calls = mockFetch([]);
    renderWithApp(<Harness initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteImage(box, new File(['x'], 'shot.png', { type: 'image/png' }));

    expect(box.value).toBe('AB');
    expect(calls).toHaveLength(0);
  });

  it('uploads via the draft endpoint when draftAttachments is set and no ticketId is given', async () => {
    const calls = mockFetch([
      [
        'POST /v1/attachments',
        () => ({
          status: 201,
          body: { id: 'd1', url: '/v1/attachments/d1', mimeType: 'image/png', sizeBytes: 10 },
        }),
      ],
    ]);
    const uploadingStates: boolean[] = [];
    renderWithApp(
      <Harness
        draftAttachments
        initial="AB"
        onUploadingChange={(uploading) => uploadingStates.push(uploading)}
      />,
    );
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);

    const file = new File(['fake-bytes'], 'shot.png', { type: 'image/png' });
    pasteImage(box, file);

    expect(box.value).toMatch(/^A!\[Đang tải ảnh\.\.\.\]\(uploading:\d+\)B$/);
    expect(uploadingStates.at(-1)).toBe(true);

    await waitFor(() => expect(box.value).toBe('A![ảnh](/v1/attachments/d1)B'));
    await waitFor(() => expect(uploadingStates.at(-1)).toBe(false));

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/v1/attachments');
    expect(post?.body).toEqual({
      filename: 'shot.png',
      mimeType: 'image/png',
      content: Buffer.from('fake-bytes').toString('base64'),
    });
  });
});
