/**
 * Test-only DOM: one jsdom window exposed as browser globals for React Testing Library, plus the `.tsx`
 * loader. Call `installDom()` before importing React components.
 */
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

let close: (() => void) | null = null;

/** Installs the DOM once; returns a disposer that closes the window so the test process can exit. */
export function installDom(): () => void {
  if (close) return close;
  register('./tsx-loader.ts', import.meta.url);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/crew-v2/' });
  const window = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => window[key],
    });
  }
  for (const key of ['window', 'document', 'navigator'])
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  close = () => dom.window.close();
  return close;
}
