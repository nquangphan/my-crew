import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BlobHandle, BlobStore, Id, Sha256 } from './contracts.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const generation =
  /^[1-9][0-9]*(\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i;
export type StorageFault = (
  point: 'after-stage-sync' | 'after-publish' | 'before-ready-commit',
) => Promise<void>;
export type StorageIntent = {
  key: string;
  stageKey: string;
  ownershipNonce: Id;
  kind: 'upload' | 'orphan_derivative';
  attachmentId: Id;
  extractionId: Id | null;
  generation: string;
  sha256: Sha256;
  byteLength: number;
};
async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export async function syncDirectory(path: string): Promise<void> {
  const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
function validKey(key: string): boolean {
  const bits = key.split('/');
  const last = bits.at(-1) ?? '';
  if (bits[0] === 'uploads')
    return (
      bits.length === 3 &&
      uuid.test(bits[1] ?? '') &&
      (last === 'original' || (last.startsWith('stage.') && generation.test(last.slice(6))))
    );
  if (bits[0] === 'derivatives')
    return (
      bits.length === 4 &&
      uuid.test(bits[1] ?? '') &&
      uuid.test(bits[2] ?? '') &&
      (uuid.test(last) || (last.startsWith('stage.') && generation.test(last.slice(6))))
    );
  return false;
}
export async function noSymlinkComponents(root: string, path: string): Promise<void> {
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('STORAGE_PATH_INVALID');
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('STORAGE_SYMLINK');
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const st = await lstat(current);
    if (st.isSymbolicLink()) throw new Error('STORAGE_SYMLINK');
  }
}
export async function readPrivateJson(root: string, path: string): Promise<Record<string, unknown>> {
  await noSymlinkComponents(root, path);
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await fd.stat();
    if (!st.isFile() || st.size > 16384 || (st.mode & 0o077) !== 0) throw new Error('STORAGE_MARKER_INVALID');
    return JSON.parse(await fd.readFile('utf8')) as Record<string, unknown>;
  } finally {
    await fd.close();
  }
}
export async function writePrivateJson(root: string, path: string, value: unknown): Promise<void> {
  await noSymlinkComponents(root, dirname(path));
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  await syncDirectory(dirname(path));
}
async function ensureDirectory(root: string, path: string): Promise<void> {
  await noSymlinkComponents(root, dirname(path));
  try {
    await mkdir(path, { mode: 0o700 });
    await syncDirectory(dirname(path));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  await noSymlinkComponents(root, path);
  if (!(await lstat(path)).isDirectory()) throw new Error('STORAGE_DIRECTORY_INVALID');
}
export async function prepareOwnedUpload(root: string, attachmentId: Id, nonce?: Id): Promise<string> {
  if (!uuid.test(attachmentId) || (nonce !== undefined && !uuid.test(nonce)))
    throw new Error('STORAGE_INPUT_INVALID');
  return ownedDirectory(root, join(root, 'uploads', attachmentId), 'upload', attachmentId, nonce);
}
async function ownedDirectory(
  root: string,
  dir: string,
  kind: 'upload' | 'derivative',
  id: Id,
  expectedNonce?: Id,
): Promise<string> {
  await ensureDirectory(root, dir);
  const marker = join(dir, '.owner.json');
  let metadata: Record<string, unknown>;
  try {
    metadata = await readPrivateJson(root, marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const nonce = expectedNonce ?? randomUUID();
    try {
      await writePrivateJson(root, marker, { kind, id, nonce });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    metadata = await readPrivateJson(root, marker);
  }
  if (
    metadata.kind !== kind ||
    metadata.id !== id ||
    typeof metadata.nonce !== 'string' ||
    !uuid.test(metadata.nonce) ||
    (expectedNonce !== undefined && metadata.nonce !== expectedNonce)
  )
    throw new Error('STORAGE_OWNERSHIP_MISMATCH');
  return metadata.nonce;
}
async function digest(path: string): Promise<{ sha256: string; byteLength: number }> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash('sha256');
  let byteLength = 0;
  try {
    if (!(await fd.stat()).isFile()) throw new Error('STORAGE_FILE_INVALID');
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      byteLength += bytesRead;
    }
  } finally {
    await fd.close();
  }
  return { sha256: hash.digest('hex'), byteLength };
}
export async function renameOwnedStage(
  stageKey: string,
  finalKey: string,
  expected: { attachmentId: Id; generation: string; sha256: Sha256; byteLength: number },
  root: string,
): Promise<void> {
  if (
    !validKey(stageKey) ||
    !validKey(finalKey) ||
    !sha.test(expected.sha256) ||
    !uuid.test(expected.attachmentId) ||
    !generation.test(expected.generation) ||
    stageKey.split('/')[1] !== expected.attachmentId ||
    basename(stageKey) !== `stage.${expected.generation}` ||
    basename(finalKey).startsWith('stage.')
  )
    throw new Error('STORAGE_KEY_INVALID');
  const stage = join(root, stageKey),
    final = join(root, finalKey);
  if (dirname(stage) !== dirname(final)) throw new Error('STORAGE_CROSS_DIRECTORY');
  await noSymlinkComponents(root, stage);
  const intent = await readPrivateJson(root, join(dirname(stage), `.intent.${basename(stage)}.json`));
  const owner = await readPrivateJson(root, join(dirname(stage), '.owner.json'));
  if (
    intent.stageKey !== stageKey ||
    intent.key !== finalKey ||
    intent.sha256 !== expected.sha256 ||
    intent.byteLength !== expected.byteLength ||
    intent.ownershipNonce !== owner.nonce
  )
    throw new Error('STORAGE_OWNERSHIP_MISMATCH');
  const stageData = await digest(stage);
  if (stageData.sha256 !== expected.sha256 || stageData.byteLength !== expected.byteLength)
    throw new Error('STORAGE_STAGE_MISMATCH');
  try {
    await link(stage, final);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await noSymlinkComponents(root, final);
    const [a, b] = await Promise.all([lstat(stage), lstat(final)]);
    if (a.dev !== b.dev || a.ino !== b.ino) throw new Error('STORAGE_DESTINATION_CONFLICT');
    const existing = await digest(final);
    if (existing.sha256 !== expected.sha256 || existing.byteLength !== expected.byteLength)
      throw new Error('STORAGE_DESTINATION_CONFLICT');
  }
  // Publish is exclusive. A crash before unlink preserves the same inode for replay.
  await syncDirectory(dirname(final));
  await unlink(stage);
  await syncDirectory(dirname(stage));
}
export async function createFileBlobStore(input: {
  root: string;
  fault?: StorageFault;
  persistIntent?: (intent: StorageIntent) => Promise<void>;
}): Promise<BlobStore> {
  const root = resolve(input.root);
  if (!isAbsolute(input.root) || root !== input.root) throw new Error('STORAGE_ROOT_INVALID');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await realpath(root)) !== root) throw new Error('STORAGE_ROOT_SYMLINK');
  const rootStat = await lstat(root);
  if ((rootStat.mode & 0o077) !== 0) throw new Error('STORAGE_ROOT_NOT_PRIVATE');
  for (const dir of ['uploads', 'derivatives']) {
    await ensureDirectory(root, join(root, dir));
    await syncDirectory(join(root, dir));
  }
  await syncDirectory(root);
  // Startup proves exclusive hard link and required directory/file flush on this filesystem.
  const probe = join(root, `.capability.${randomUUID()}`),
    target = `${probe}.published`;
  try {
    const fd = await open(probe, 'wx', 0o600);
    try {
      await fd.writeFile('durability');
      await fd.sync();
    } finally {
      await fd.close();
    }
    await link(probe, target);
    await syncDirectory(root);
  } finally {
    for (const path of [probe, target]) await unlinkIfPresent(path);
    await syncDirectory(root);
  }
  const fault = input.fault ?? (async () => {});
  async function write(
    key: string,
    stageKey: string,
    attachmentId: Id,
    extractionId: Id | null,
    bytes: number,
    expectedSha: Sha256,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<BlobHandle> {
    if (
      !validKey(key) ||
      !validKey(stageKey) ||
      !uuid.test(attachmentId) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      !sha.test(expectedSha)
    )
      throw new Error('STORAGE_INPUT_INVALID');
    const stage = join(root, stageKey),
      dir = dirname(stage);
    const kind = extractionId ? 'derivative' : 'upload';
    if (extractionId && !input.persistIntent) throw new Error('STORAGE_INTENT_NOT_CONFIGURED');
    if (extractionId) await ensureDirectory(root, dirname(dir));
    const nonce = await ownedDirectory(root, dir, kind, extractionId ?? attachmentId);
    const intent: StorageIntent = {
      key,
      stageKey,
      attachmentId,
      extractionId,
      ownershipNonce: nonce,
      kind: extractionId ? 'orphan_derivative' : 'upload',
      generation: basename(stageKey).slice(6),
      sha256: expectedSha,
      byteLength: bytes,
    };
    // The local durable intent is always retained. Production derivative callers also
    // journal it through persistIntent before bytes; upload reservation is already durable.
    await writePrivateJson(root, join(dir, `.intent.${basename(stageKey)}.json`), intent);
    await input.persistIntent?.(intent);
    signal.throwIfAborted();
    const fd = await open(
      stage,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const hash = createHash('sha256');
    let count = 0;
    let closed = false;
    try {
      for await (const chunk of source) {
        if (signal.aborted) throw new Error('UPLOAD_ABORTED');
        if (!(chunk instanceof Uint8Array)) throw new Error('UPLOAD_CHUNK_INVALID');
        count += chunk.byteLength;
        if (!Number.isSafeInteger(count) || count > bytes) throw new Error('UPLOAD_TOO_LARGE');
        hash.update(chunk);
        for (let start = 0; start < chunk.byteLength; start += 64 * 1024) {
          if (signal.aborted) throw new Error('UPLOAD_ABORTED');
          await fd.writeFile(chunk.subarray(start, start + 64 * 1024));
        }
      }
      if (signal.aborted) throw new Error('UPLOAD_ABORTED');
      if (count !== bytes || hash.digest('hex') !== expectedSha) throw new Error('UPLOAD_DIGEST_MISMATCH');
      await fd.sync();
      await fd.close();
      closed = true;
      await syncDirectory(dir);
      await fault('after-stage-sync');
      if (signal.aborted) throw new Error('UPLOAD_ABORTED');
      await renameOwnedStage(
        stageKey,
        key,
        { attachmentId, generation: basename(stageKey).slice(6), sha256: expectedSha, byteLength: bytes },
        root,
      );
      await fault('after-publish');
      return { key, sha256: expectedSha, byteLength: bytes };
    } finally {
      if (!closed) await fd.close();
    }
  }
  const store: BlobStore = {
    receive(i, body, signal) {
      if (!uuid.test(i.attachmentId) || !generation.test(i.generation))
        return Promise.reject(new Error('STORAGE_INPUT_INVALID'));
      const base = `uploads/${i.attachmentId}`;
      return write(
        `${base}/original`,
        `${base}/stage.${i.generation}`,
        i.attachmentId,
        null,
        i.expectedBytes,
        i.expectedSha256,
        body,
        signal,
      );
    },
    publishDerivative(i, body, signal) {
      if (
        ![i.attachmentId, i.extractionId, i.derivativeId].every((v) => uuid.test(v)) ||
        !/^[1-9][0-9]*$/.test(i.generation)
      )
        return Promise.reject(new Error('STORAGE_INPUT_INVALID'));
      const base = `derivatives/${i.attachmentId}/${i.extractionId}`;
      return write(
        `${base}/${i.derivativeId}`,
        `${base}/stage.${i.generation}.${i.derivativeId}`,
        i.attachmentId,
        i.extractionId,
        i.expectedBytes,
        i.expectedSha256,
        body,
        signal,
      );
    },
    async verify(blob) {
      if (
        !validKey(blob.key) ||
        !sha.test(blob.sha256) ||
        !Number.isSafeInteger(blob.byteLength) ||
        blob.byteLength < 0
      )
        throw new Error('STORAGE_KEY_INVALID');
      const path = join(root, blob.key);
      try {
        await noSymlinkComponents(root, path);
        const got = await digest(path);
        return got.sha256 === blob.sha256 && got.byteLength === blob.byteLength ? 'present' : 'corrupt';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
        throw error;
      }
    },
    async open(blob) {
      if ((await store.verify(blob)) !== 'present') throw new Error('STORAGE_BLOB_UNAVAILABLE');
      // Open immediately; return a bounded iterator over this exact descriptor.
      const fd = await open(join(root, blob.key), constants.O_RDONLY | constants.O_NOFOLLOW);
      return (async function* () {
        try {
          for await (const chunk of fd.readableWebStream({ autoClose: false })) yield chunk;
        } finally {
          await fd.close();
        }
      })();
    },
    async removeOwned(i) {
      if (!validKey(i.key) || !uuid.test(i.ownershipNonce)) throw new Error('STORAGE_KEY_INVALID');
      const path = join(root, i.key),
        dir = dirname(path);
      const metadata = await readPrivateJson(root, join(dir, '.owner.json'));
      if (metadata.nonce !== i.ownershipNonce) throw new Error('STORAGE_OWNERSHIP_MISMATCH');
      await noSymlinkComponents(root, dir);
      try {
        const st = await lstat(path);
        if (st.isSymbolicLink() || !st.isFile()) throw new Error('STORAGE_SYMLINK');
        await unlink(path);
        await syncDirectory(dir);
        return 'removed';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
        throw error;
      }
    },
  };
  return store;
}
