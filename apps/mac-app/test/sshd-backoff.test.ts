import { expect, it } from 'vitest';
import { nextDelayMs, STABLE_RESET_MS } from '../src/main/sshd/backoff.js';

it('backoff 1s → 60s', () => {
  expect([0, 1, 2, 5, 6, 10].map((n) => nextDelayMs(n))).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
});

it('chạy ổn 5 phút thì coi là ổn định', () => {
  expect(STABLE_RESET_MS).toBe(5 * 60_000);
});
