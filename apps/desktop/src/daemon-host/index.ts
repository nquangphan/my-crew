import { crewHome } from '@crew/daemon';
import { type FromHost, type HostEventName, ToHost } from '@crew/shared';
import { HostService } from './host-service.js';
import { describeError } from './setup-ops.js';
import { testSeams } from './test-seams.js';

/**
 * Entry of the daemon host, an Electron utility process forked by the main process's supervisor. It talks
 * only over its parent MessagePort; a crash here is restarted with backoff by the supervisor.
 */
const port = process.parentPort;
const post = (message: FromHost) => port.postMessage(message);

const home = crewHome(process.env);
const service = new HostService({
  home,
  runtime: process.env.CREW_APP_EXECUTABLE ?? process.execPath,
  crewDocsSource: process.env.CREW_DOCS_SOURCE ?? '',
  appVersion: process.env.CREW_APP_VERSION ?? '0.0.0',
  env: process.env,
  emit: (name: HostEventName, payload: unknown) => post({ kind: 'event', name, payload }),
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
process.on('uncaughtException', (error) => {
  service.activity.logger('error', 'daemon host crashed', { error: error.stack ?? error.message });
  // Exit non-zero: the supervisor restarts the host (and the daemon) with backoff.
  void shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  service.activity.logger('warn', 'unhandled rejection', { error: String(reason) });
});

post({ kind: 'ready' });
