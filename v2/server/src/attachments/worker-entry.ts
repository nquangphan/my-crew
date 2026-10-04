import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { diagnosticMain } from './worker-diagnostic.ts';
import { validateWorkerInput, workerError } from './worker-protocol.ts';

async function main(): Promise<void> {
  const mode = process.argv.slice(2);
  if (mode.length !== 2 || mode[0] !== '--mode' || !['diagnostic', 'extract'].includes(mode[1] ?? ''))
    throw workerError('WORKER_MODE_INVALID');
  const request = await open('/input/request.json', constants.O_RDONLY | constants.O_NOFOLLOW);
  let input: ReturnType<typeof validateWorkerInput>;
  try {
    if ((await request.stat()).size > 65536) throw workerError('WORKER_INPUT_INVALID');
    input = validateWorkerInput(JSON.parse(await request.readFile('utf8')));
  } finally {
    await request.close();
  }
  const original = await open('/input/original', constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await original.stat();
    if (!st.isFile() || st.size > 25 * 1024 * 1024) throw workerError('WORKER_ORIGINAL_INVALID');
    const hash = createHash('sha256');
    for await (const chunk of original.createReadStream({ autoClose: false, highWaterMark: 65536 }))
      hash.update(chunk);
    if (hash.digest('hex') !== input.original.sha256) throw workerError('WORKER_ORIGINAL_INVALID');
  } finally {
    await original.close();
  }
  if (mode[1] === 'extract') {
    const fd = await open('/input/original', constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = await fd.readFile();
      if (
        bytes.length > 25 * 1024 * 1024 ||
        createHash('sha256').update(bytes).digest('hex') !== input.original.sha256
      )
        throw workerError('WORKER_ORIGINAL_INVALID');
      const { extractToFrames } = await import('./extract/index.ts');
      await extractToFrames(input, bytes, process.stdout);
    } finally {
      await fd.close();
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(await diagnosticMain())}\n`);
}
main().catch(() => {
  process.stderr.write('WORKER_FAILED\n');
  process.exitCode = 1;
});
