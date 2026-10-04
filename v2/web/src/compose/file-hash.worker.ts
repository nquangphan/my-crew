/**
 * Dedicated worker entry: hashes one File per message and posts the hex SHA-256 or an error code back.
 * Messages are handled one at a time, so at most one file's bytes are held at once.
 */
import { answerHashRequest, type HashRequest } from './file-hash.ts';

type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<HashRequest>) => void): void;
  postMessage(message: unknown): void;
};

const scope = self as unknown as WorkerScope;
let queue: Promise<void> = Promise.resolve();

scope.addEventListener('message', (event) => {
  const request = event.data;
  queue = queue.then(async () => scope.postMessage(await answerHashRequest(request)));
});
