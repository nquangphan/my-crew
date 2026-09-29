import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../lib/api-client';
import { comment } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { CommentComposer, CommentList } from './comment-thread';

describe('comment thread', () => {
  it('posts a comment with the CSRF token and clears the box', async () => {
    setCsrfToken('csrf-123');
    const calls = mockFetch([
      [
        'POST /v1/tickets/SHOP-7/comments',
        (call) => ({
          status: 201,
          body: comment({
            authorKind: 'owner',
            authorRole: null,
            body: String((call.body as { body: string }).body),
          }),
        }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<CommentComposer ticketKey="SHOP-7" label="Trả lời" />);

    const box = await screen.findByRole('textbox', { name: 'Trả lời' });
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    await user.type(box, 'Chỉ Postgres.');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));

    await waitFor(() => expect(box).toHaveValue(''));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/v1/tickets/SHOP-7/comments');
    expect(post?.headers['x-csrf-token']).toBe('csrf-123');
    expect(post?.body).toEqual({ body: 'Chỉ Postgres.' });
  });

  it('keeps the text and shows the error when the post fails', async () => {
    mockFetch([
      [
        'POST /v1/tickets/SHOP-7/comments',
        () => ({ status: 409, body: { error: { code: 'TICKET_CLOSED', message: 'closed' } } }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<CommentComposer ticketKey="SHOP-7" />);
    const box = await screen.findByRole('textbox', { name: 'Thêm bình luận' });
    await user.type(box, 'Xin chào');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket đã đóng.');
    expect(box).toHaveValue('Xin chào');
  });

  it('names owner, agent role and system authors', async () => {
    renderWithApp(
      <CommentList
        comments={[
          comment({ authorKind: 'owner', authorRole: null, body: 'Của tôi' }),
          comment({ authorKind: 'agent', authorRole: 'qc', body: 'Của QC' }),
          comment({ authorKind: 'system', authorRole: null, body: 'Hệ thống nói' }),
        ]}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Bình luận' });
    expect(list).toHaveTextContent('Bạn');
    expect(list).toHaveTextContent('QC agent');
    expect(list).toHaveTextContent('Hệ thống');
  });

  it('suggests @pm when the owner types @, and Enter picks it', async () => {
    const calls = mockFetch([
      [
        'POST /v1/tickets/SHOP-7/comments',
        (call) => ({
          status: 201,
          body: comment({
            authorKind: 'owner',
            authorRole: null,
            body: String((call.body as { body: string }).body),
            mentions: ['pm'],
          }),
        }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<CommentComposer ticketKey="SHOP-7" canCallPm />);
    const box = await screen.findByRole('textbox', { name: 'Thêm bình luận' });

    await user.type(box, 'Nhờ @');
    const option = screen.getByRole('option', { name: /@pm/ });
    expect(option).toHaveTextContent('gọi PM của cây ticket');
    expect(box).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    await user.type(box, 'p{Enter}');
    expect(box).toHaveValue('Nhờ @pm ');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    await user.type(box, 'đánh giá lại');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ body: 'Nhờ @pm đánh giá lại' });
  });

  it('picks @pm with a click, hides the suggestion on Escape, and never suggests where no PM can be called', async () => {
    const user = userEvent.setup();
    const view = renderWithApp(<CommentComposer ticketKey="SHOP-7" canCallPm />);
    const box = await screen.findByRole('textbox', { name: 'Thêm bình luận' });
    await user.type(box, '@');
    await user.click(screen.getByRole('option', { name: /@pm/ }));
    expect(box).toHaveValue('@pm ');

    await user.type(box, 'và @');
    expect(screen.getByRole('option', { name: /@pm/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    // A mail address is not a tag.
    await user.type(box, ' a@');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    view.unmount();

    renderWithApp(<CommentComposer ticketKey="AST-1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Thêm bình luận' }), '@');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('explains a refused @pm in Vietnamese', async () => {
    mockFetch([
      [
        'POST /v1/tickets/AST-1/comments',
        () => ({ status: 400, body: { error: { code: 'PM_NOT_AVAILABLE', message: 'no pm_task' } } }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<CommentComposer ticketKey="AST-1" />);
    const box = await screen.findByRole('textbox', { name: 'Thêm bình luận' });
    await user.type(box, '@pm xem giúp');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không gọi được PM: ticket này không thuộc PM task nào đang mở. Bỏ @pm để gửi bình luận thường.',
    );
    expect(box).toHaveValue('@pm xem giúp');
  });

  it('marks owner comments that called the PM and opens the pm_task from the mark', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithApp(
      <CommentList
        pmTaskKey="SHOP-3"
        onOpenTicket={onOpen}
        comments={[
          comment({ authorKind: 'owner', authorRole: null, body: '@pm xem giúp', mentions: ['pm'] }),
          comment({ authorKind: 'owner', authorRole: null, body: 'Bình luận thường' }),
        ]}
      />,
    );
    const items = within(await screen.findByRole('list', { name: 'Bình luận' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Đã gọi PM');
    expect(items[1]).not.toHaveTextContent('Đã gọi PM');
    await user.click(within(items[0] as HTMLElement).getByRole('button', { name: 'Xem SHOP-3' }));
    expect(onOpen).toHaveBeenCalledWith('SHOP-3');
  });
});
