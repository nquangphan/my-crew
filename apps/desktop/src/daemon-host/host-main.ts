import { crewHome, setPromptsDir } from '@crew/daemon';
import { type FromHost, type HostEventName, ToHost } from '@crew/shared';
import { HostService } from './host-service.js';
import { describeError } from './setup-ops.js';
import { testSeams } from './test-seams.js';

export interface HostHandlers {
  crash: (error: Error) => void;
  rejection: (reason: unknown) => void;
}

/**
 * The daemon host itself, loaded by the entry (`index.ts`) once its crash handlers are installed. It talks only
 * over its parent MessagePort and reports ready before any disk or repo work; a crash is restarted with backoff
 * by the supervisor. Returns the handlers that replace the entry's minimal ones.
 */
export function runHost(promptsDir: string): HostHandlers {
  const port = process.parentPort;
  const post = (message: FromHost) => port.postMessage(message);

  // The role prompts ship beside the entry (electron.vite.config.ts copies them); the bundled daemon code sits
  // in a chunk elsewhere, so point the planner at them explicitly.
  setPromptsDir(promptsDir);

  const home = crewHome(process.env);
  const service = new HostService({
    home,
    runtime: process.env.CREW_APP_EXECUTABLE ?? process.execPath,
    crewDocsSource: process.env.CREW_DOCS_SOURCE ?? '',
    appVersion: process.env.CREW_APP_VERSION ?? '0.0.0',
    env: process.env,
    emit: (name: HostEventName, payload: unknown) => post({ kind: 'event', name, payload }),
    log: (entry) => post({ kind: 'log', entry: { ...entry, fields: entry.fields ?? {} } }),
    ...(process.env.CREW_DESKTOP_TEST_MODE === '1' ? { seams: testSeams(home) } : {}),
  });

  port.on('message', (event: Electron.MessageEvent) => {
    const parsed = ToHost.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === 'facts') {
      service.setFacts(message.facts);
      return;
    }
    service.handle(message.method, message.params).then(
      (result) => post({ kind: 'response', id: message.id, ok: true, result: result ?? null }),
      (error: unknown) =>
        post({
          kind: 'response',
          id: message.id,
          ok: false,
          error: { message: describeError(error), code: (error as { code?: string }).code },
        }),
    );
  });

  let stopping = false;
  async function shutdown(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    await service.shutdown().catch(() => undefined);
    process.exit(code);
  }
  process.on('SIGTERM', () => void shutdown(0));

  post({ kind: 'ready' });
  void service.start();

  return {
    crash: (error) => {
      service.activity.logger('error', 'daemon host crashed', { error: error.stack ?? error.message });
      service.host.log('error', 'uncaught-exception', { error: error.stack ?? error.message });
      // Exit non-zero: the supervisor restarts the host (and the daemon) with backoff.
      void shutdown(1);
    },
    rejection: (reason) => {
      service.activity.logger('warn', 'unhandled rejection', { error: String(reason) });
      service.host.log('error', 'unhandled-rejection', {
        error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
      });
    },
  };
}
