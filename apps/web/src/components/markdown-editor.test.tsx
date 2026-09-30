import { Buffer } from 'node:buffer';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { MarkdownEditor } from './markdown-editor';

/** A controlled wrapper: `MarkdownEditor` itself holds no state, so tests need a parent that does. */
function Harness({ ticketId, initial = '' }: { ticketId?: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor label="Mô tả" value={value} onChange={setValue} ticketId={ticketId} />;
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

  it('ignores image paste entirely when no ticketId is given (e.g. the new-ticket dialog)', async () => {
    const calls = mockFetch([]);
    renderWithApp(<Harness initial="AB" />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    box.setSelectionRange(1, 1);
    pasteImage(box, new File(['x'], 'shot.png', { type: 'image/png' }));

    expect(box.value).toBe('AB');
    expect(calls).toHaveLength(0);
  });
});
