import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { NewTicketDialog } from './new-ticket-dialog';

function pasteImage(box: HTMLElement, file: File) {
  fireEvent.paste(box, {
    clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
  });
}

const PROJECTS_ROUTE: [string, () => { status: number; body: unknown }] = [
  'GET /v1/projects',
  () => ({ status: 200, body: { items: [] } }),
];

const DRAFT_UPLOAD_ROUTE: [string, () => { status: number; body: unknown }] = [
  'POST /v1/attachments',
  () => ({
    status: 201,
    body: { id: 'd1', url: '/v1/attachments/d1', mimeType: 'image/png', sizeBytes: 10 },
  }),
];

describe('NewTicketDialog paste-to-upload', () => {
  it('pastes an image into "Mô tả", blocks "Tạo" while uploading, and sends the resolved link', async () => {
    const newTicket = ticket({ key: 'SHOP-9', title: 'Có ảnh' });
    const calls = mockFetch([
      PROJECTS_ROUTE,
      DRAFT_UPLOAD_ROUTE,
      ['POST /v1/tickets', () => ({ status: 201, body: newTicket })],
    ]);
    const user = userEvent.setup();
    renderWithApp(<NewTicketDialog open onOpenChange={() => {}} />);

    await user.type(await screen.findByRole('textbox', { name: 'Tiêu đề' }), 'Có ảnh');
    const box = screen.getByRole('textbox', { name: 'Mô tả' }) as HTMLTextAreaElement;
    box.setSelectionRange(0, 0);
    pasteImage(box, new File(['fake-bytes'], 'shot.png', { type: 'image/png' }));

    // Placeholder inserted at the caret, and "Tạo" is disabled the instant the upload starts.
    expect(box.value).toMatch(/^!\[Đang tải ảnh\.\.\.\]\(uploading:\d+\)$/);
    expect(screen.getByRole('button', { name: 'Đang tải ảnh…' })).toBeDisabled();

    await waitFor(() => expect(box.value).toBe('![ảnh](/v1/attachments/d1)'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Tạo' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/tickets')).toBe(true),
    );
    const createCall = calls.find((c) => c.method === 'POST' && c.path === '/v1/tickets');
    const body = createCall?.body as { description: string };
    expect(body.description).toBe('![ảnh](/v1/attachments/d1)');
    expect(body.description).not.toContain('uploading:');
  });

  it('shows a Vietnamese error for an unsupported mime and never calls the attachment API', async () => {
    const calls = mockFetch([PROJECTS_ROUTE]);
    renderWithApp(<NewTicketDialog open onOpenChange={() => {}} />);
    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    pasteImage(box, new File(['x'], 'anim.bmp', { type: 'image/bmp' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP.');
    expect(box.value).toBe('');
    expect(calls.some((c) => c.path === '/v1/attachments')).toBe(false);
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeEnabled();
  });

  it('does not submit while an image is still uploading, even if the form submit event fires directly', async () => {
    const calls = mockFetch([PROJECTS_ROUTE, DRAFT_UPLOAD_ROUTE]);
    const user = userEvent.setup();
    renderWithApp(<NewTicketDialog open onOpenChange={() => {}} />);

    await user.type(await screen.findByRole('textbox', { name: 'Tiêu đề' }), 'Đang tải');
    const box = screen.getByRole('textbox', { name: 'Mô tả' }) as HTMLTextAreaElement;
    pasteImage(box, new File(['fake-bytes'], 'shot.png', { type: 'image/png' }));
    expect(screen.getByRole('button', { name: 'Đang tải ảnh…' })).toBeDisabled();

    // Bypass the disabled button and submit the form directly: the handler itself must still refuse.
    fireEvent.submit(screen.getByRole('form', { name: 'Tạo ticket' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/tickets')).toBe(false);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo' })).toBeEnabled());
  });

  it('"Tạo thêm" keeps the dialog open, resets the form, and still accepts a paste for the next ticket', async () => {
    let ticketCount = 0;
    const calls = mockFetch([
      PROJECTS_ROUTE,
      DRAFT_UPLOAD_ROUTE,
      [
        'POST /v1/tickets',
        () => {
          ticketCount += 1;
          return { status: 201, body: ticket({ key: `SHOP-${ticketCount}` }) };
        },
      ],
    ]);
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithApp(<NewTicketDialog open onOpenChange={onOpenChange} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Tạo thêm' }));
    await user.type(screen.getByRole('textbox', { name: 'Tiêu đề' }), 'Ticket một');
    await user.click(screen.getByRole('button', { name: 'Tạo' }));

    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/tickets')).toHaveLength(1),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Tiêu đề' })).toHaveValue(''));

    const box = (await screen.findByRole('textbox', { name: 'Mô tả' })) as HTMLTextAreaElement;
    pasteImage(box, new File(['fake-bytes-2'], 'shot2.png', { type: 'image/png' }));
    await waitFor(() => expect(box.value).toBe('![ảnh](/v1/attachments/d1)'));
  });
});
