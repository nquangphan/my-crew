import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireGateway = createRequire("/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/gateway/package.json");
const tarStream = pathToFileURL(requireGateway.resolve('tar-stream')).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'tar-stream') return { url: tarStream, shortCircuit: true };
  return nextResolve(specifier, context);
}
