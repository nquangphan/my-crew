/**
 * Test-only: `installDom()` keeps Node's own `Event`/`CustomEvent` globals, which jsdom's `dispatchEvent`
 * rejects. Radix dialogs dispatch `new CustomEvent(...)` on DOM nodes, so component tests that open a Radix
 * dialog bind these constructors to the jsdom window. Call after `installDom()`. Despite the `use` prefix
 * this is not a React hook (call sites carry a biome-ignore); the name is shared with `docs-space-dom.test.ts`.
 */
export function useDomEventConstructors(): void {
  const window = globalThis.window as unknown as Record<string, unknown>;
  for (const key of ['Event', 'CustomEvent'])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
