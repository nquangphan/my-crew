import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/render';
import { ApiRequestError, api, onUnauthorized, setCsrfToken, toQueryString } from './api-client';

afterEach(() => onUnauthorized(null));

describe('api client', () => {
  it('sends the CSRF token on writes only', async () => {
    setCsrfToken('tok');
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [] } })],
      [
        'POST /v1/tickets/SHOP-1/transition',
        () => ({ status: 409, body: { error: { code: 'ILLEGAL_TRANSITION', message: 'no' } } }),
      ],
    ]);
    await api.listProjects();
    await expect(api.transition('SHOP-1', 'done')).rejects.toMatchObject({
      status: 409,
      code: 'ILLEGAL_TRANSITION',
    });
    expect(calls[0]?.headers['x-csrf-token']).toBeUndefined();
    expect(calls[1]?.headers['x-csrf-token']).toBe('tok');
  });

  it('falls back to the CSRF cookie when the session has not been read yet', async () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the test plants the CSRF cookie the API would set
    document.cookie = 'crew_csrf=from-cookie';
    const calls = mockFetch([['POST /v1/auth/logout', () => ({ status: 204 })]]);
    await api.logout();
    expect(calls[0]?.headers['x-csrf-token']).toBe('from-cookie');
    // biome-ignore lint/suspicious/noDocumentCookie: removes the planted cookie
    document.cookie = 'crew_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('reports a 401 to the global handler, except for the session probe', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockFetch([
      [
        'GET /v1/auth/session',
        () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'login required' } } }),
      ],
      [
        'GET /v1/machines',
        () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'login required' } } }),
      ],
    ]);
    await expect(api.session()).rejects.toBeInstanceOf(ApiRequestError);
    expect(handler).not.toHaveBeenCalled();
    await expect(api.listMachines()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects responses that break the shared contract', async () => {
    mockFetch([['GET /v1/projects', () => ({ body: { items: [{ id: 1 }] } })]]);
    await expect(api.listProjects()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('follows every page of a ticket list', async () => {
    const calls = mockFetch([
      [
        'GET /v1/tickets',
        (call) => ({
          body: call.path.includes('cursor=c2')
            ? { items: [], nextCursor: null }
            : { items: [], nextCursor: 'c2' },
        }),
      ],
    ]);
    await api.listTickets({ status: ['todo', 'triage'] });
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/tickets?status=todo%2Ctriage&limit=100',
      '/v1/tickets?status=todo%2Ctriage&limit=100&cursor=c2',
    ]);
    expect(toQueryString({ a: '', b: undefined, c: [] })).toBe('');
  });
});
