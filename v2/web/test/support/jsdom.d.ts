/** Minimal typing for the test-only `jsdom` dependency (the package ships no types). */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & typeof globalThis;
  }
}
