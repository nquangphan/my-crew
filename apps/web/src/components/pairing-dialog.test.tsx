import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { PairingDialog } from './pairing-dialog';

describe('PairingDialog', () => {
  it('confirms the TOTP, then shows the single-use code once', async () => {
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
    await user.type(await screen.findByLabelText('Mã xác thực (TOTP)'), '123456');
    await user.click(screen.getByRole('button', { name: 'Tạo mã ghép' }));
    expect(await screen.findByRole('status', { name: 'Mã ghép máy' })).toHaveTextContent('ABCD-EFGH-IJKL');
    expect(calls[0]?.body).toEqual({ code: '123456' });
  });
});
