import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setCsrfToken } from '../lib/api-client';

/** Viewport width the `matchMedia` shim answers for; tests may change it. */
export const viewport = { width: 1440 };

function matches(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  if (min) return viewport.width >= Number(min[1]);
  if (query.includes('prefers-color-scheme: dark')) return false;
  return false;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Radix measures and captures pointers; jsdom has neither.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverShim as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
window.scrollTo = () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCsrfToken(null);
  viewport.width = 1440;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
