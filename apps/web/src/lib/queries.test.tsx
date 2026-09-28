import type { Ticket } from '@crew/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ticket } from '../test/fixtures';
import { testQueryClient } from '../test/render';
import { keys, useTransition } from './queries';

describe('useTransition (board drag)', () => {
  it('moves the card at once and snaps it back when the API refuses with REPORT_REQUIRED', async () => {
    const t = ticket({ key: 'SHOP-3', status: 'in_review' });
    const queryClient = testQueryClient();
    const listKey = keys.ticketList({ projectId: 'p1' });
    queryClient.setQueryData<Ticket[]>(listKey, [t]);
    let respond: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            const body = url.includes('/transition')
              ? {
                  status: 409,
                  text: JSON.stringify({ error: { code: 'REPORT_REQUIRED', message: 'needs a report' } }),
                }
              : { status: 200, text: JSON.stringify({ items: [t], nextCursor: null }) };
            const send = () => resolve(new Response(body.text, { status: body.status }));
            if (url.includes('/transition')) respond = send;
            else send();
          }),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTransition(), { wrapper });

    let error: unknown;
    act(() => {
      result.current.mutate({ ticket: t, to: 'done' }, { onError: (e) => (error = e) });
    });
    // While the request is in flight the card already sits in the target column.
    await waitFor(() => expect(queryClient.getQueryData<Ticket[]>(listKey)?.[0]?.status).toBe('done'));
    await waitFor(() => expect(respond).toBeDefined());
    act(() => respond?.());
    await waitFor(() => expect(queryClient.getQueryData<Ticket[]>(listKey)?.[0]?.status).toBe('in_review'));
    await waitFor(() => expect(error).toBeDefined());
    expect((error as { code: string }).code).toBe('REPORT_REQUIRED');
  });
});
