import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { PairingDialog } from './pairing-dialog';

describe('PairingDialog', () => {
  it('creates the code with a confirm click (no code field), then shows it once', async () => {
    const calls = mockFetch([
      [
        'POST /v1/machines/pairing-codes',
        () => ({
          status: 201,
          body: { pairingCode: 'ABCD-EFGH-IJKL', expiresAt: new Date(Date.now() + 600_000).toISOString() },
        }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<PairingDialog open onOpenChange={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'Tạo mã ghép' });
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(confirm);
    expect(await screen.findByRole('status', { name: 'Mã ghép máy' })).toHaveTextContent('ABCD-EFGH-IJKL');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
  });

  it('keeps the dialog open with the error when the request fails', async () => {
    mockFetch([
      [
        'POST /v1/machines/pairing-codes',
        () => ({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'rate limit exceeded' } } }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<PairingDialog open onOpenChange={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Tạo mã ghép' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Thử quá nhiều lần, hãy đợi một chút.');
    expect(screen.getByRole('button', { name: 'Tạo mã ghép' })).toBeEnabled();
  });
});
