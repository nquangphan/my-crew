// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, routeFromHash } from '../../src/renderer/app';

const invoke = vi.fn(async () => ({ ok: true, result: { version: '0.1.0', platform: 'darwin' } }));

beforeEach(() => {
  window.location.hash = '';
  (window as unknown as { crew: unknown }).crew = { invoke, on: () => () => undefined };
});
afterEach(() => {
  cleanup();
  invoke.mockClear();
});

it('hiện thanh bên, màn hình đầu và phiên bản từ app:info', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Sức khỏe' })).toBeTruthy();
  await waitFor(() => expect(screen.getByText('Phiên bản 0.1.0')).toBeTruthy());
  expect(invoke).toHaveBeenCalledWith('app:info');
});

it('bấm mục thanh bên đổi màn hình và hash', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Log' }));
  expect(screen.getByRole('heading', { name: 'Log' })).toBeTruthy();
  expect(window.location.hash).toBe('#/logs');
});

it('hash lạ về màn hình đầu', () => {
  expect(routeFromHash('#/khong-co')).toBe('health');
  expect(routeFromHash('#/setup?x=1')).toBe('setup');
});
