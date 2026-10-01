// thread-stream 4.2.0 still references the alias removed by @types/node 26.
// Keep library checking on and restore only that compatibility alias.
import 'node:worker_threads';

declare module 'worker_threads' {
  export type TransferListItem = Transferable;
}
