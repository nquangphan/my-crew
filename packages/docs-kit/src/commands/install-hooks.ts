import { InstallError, installHooks } from '../hook-installer.js';
import { EXIT, type Io, UsageError } from './io.js';

export interface InstallHooksArgs {
  cwd: string;
  runtime: string;
  bundle: string;
}

/** `crew-docs install-hooks [--runtime <abs>] [--bundle <abs>]`. */
export function installHooksCommand(args: InstallHooksArgs, io: Io): number {
  try {
    const result = installHooks(args);
    io.out(`hooks: ${result.kind}`);
    io.out(`runtime: ${args.runtime}`);
    io.out(`bundle: ${args.bundle}`);
    if (result.changed.length === 0) io.out('unchanged (already installed)');
    for (const path of result.changed) io.out(`updated ${path}`);
    for (const note of result.notes) io.err(`note: ${note}`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof InstallError) throw new UsageError(error.message);
    throw error;
  }
}
