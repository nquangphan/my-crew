/** Where a command writes; tests capture it, the bin writes to the process streams. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** The hook's stdin (pre-push ref lines); empty when there is none. */
  readStdin(): Promise<string>;
}

/** Bad arguments or an environment problem (exit 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const EXIT = { ok: 0, violations: 1, usage: 2, notInitialized: 3 } as const;
