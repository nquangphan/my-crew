import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../db/client.js';
import { importFromGithub, type SigningKey } from '../services/runtime-service.js';

export const RUNTIME_IMPORT_INTERVAL_MS = 60 * 60 * 1000;
/** The first import waits a little after start, so a restart loop never hammers GitHub. */
const FIRST_IMPORT_DELAY_MS = 60 * 1000;

/**
 * Imports new `runtime-v*` GitHub releases hourly (CI publishes there, so it needs no credential for this
 * server). Each import tells the machines through `runtime.published`. Returns a stop function.
 */
export function startRuntimeImport(
  db: Executor,
  options: { repo: string; keys: readonly SigningKey[] },
  log: FastifyBaseLogger,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await importFromGithub(db, options);
      if (result.imported.length > 0 || result.skipped.length > 0) {
        log.info({ imported: result.imported, skipped: result.skipped }, 'runtime import');
      }
    } catch (error) {
      log.warn({ err: error, repo: options.repo }, 'runtime import failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), FIRST_IMPORT_DELAY_MS);
  const timer = setInterval(() => void run(), RUNTIME_IMPORT_INTERVAL_MS);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
