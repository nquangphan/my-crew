/** `?raw` imports: text files inlined by Vitest and by the esbuild bundle (see build.mjs). */
declare module '*?raw' {
  const content: string;
  export default content;
}

/** Replaced with the package version by the esbuild bundle. */
declare const __CREW_DOCS_VERSION__: string | undefined;
