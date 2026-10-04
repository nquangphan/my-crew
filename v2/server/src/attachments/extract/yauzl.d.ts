declare module 'yauzl' {
  import type { Readable } from 'node:stream';
  export type Entry = {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    crc32: number;
    relativeOffsetOfLocalHeader: number;
  };
  export interface ZipFile {
    readEntry(): void;
    close(): void;
    on(event: 'entry', handler: (entry: Entry) => void): this;
    on(event: 'error', handler: (error: Error) => void): this;
    on(event: 'end', handler: () => void): this;
    openReadStream(entry: Entry, cb: (error: Error | null, stream: Readable) => void): void;
  }
  export function fromBuffer(
    buffer: Buffer,
    options: {
      lazyEntries: boolean;
      autoClose: boolean;
      validateEntrySizes: boolean;
      strictFileNames: boolean;
    },
    cb: (error: Error | null, zip: ZipFile) => void,
  ): void;
}
