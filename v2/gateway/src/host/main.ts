import { GatewayHost } from './gateway-host.ts';

const host = new GatewayHost(process.argv[2]);
await host.start();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void host.stop({ drain: true }).then(
      () => {
        process.exitCode = 0;
      },
      (error) => {
        console.error(error);
        process.exitCode = 1;
      },
    );
  });
