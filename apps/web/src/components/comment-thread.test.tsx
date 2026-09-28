import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
});
