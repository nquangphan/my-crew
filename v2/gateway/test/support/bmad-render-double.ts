import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

// Python json.dumps(ensure_ascii=False, sort_keys=True, separators=(",", ":")) for string trees.
function pythonCanonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${pythonCanonical(record[key])}`)
    .join(',')}}`;
}

async function markdownSources(directory: string, prefix = ''): Promise<Record<string, Buffer>> {
  const found: Record<string, Buffer> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(found, await markdownSources(join(directory, entry.name), name));
    else if (entry.name.endsWith('.md') && name !== 'SKILL.md')
      found[name] = await readFile(join(directory, entry.name));
  }
  return found;
}

export type RendererOutcome = { exitCode: number; stdout: string };

/**
 * Behaviour of `_bmad/scripts/render_skill.py` for token-free sources: identity from the absolute
 * project root, renderer bytes and source hashes; publish `{root}/_bmad/render/{skill}/{slug}-{root12}/{gen20}`;
 * an existing generation is compared byte-for-byte and never overwritten; prints the entry path.
 * `argv` starts at the `uv` executable of the official `uv run` invocation.
 */
export async function officialRender(argv: string[]): Promise<RendererOutcome> {
  const projectRoot = argv[argv.indexOf('--project-root') + 1];
  const skill = argv[argv.indexOf('--skill') + 1];
  const sources = await markdownSources(skill);
  if (!sources['workflow.md']) return { exitCode: 1, stdout: 'HALT: workflow.md missing\n' };
  const sourceSha256 = Object.fromEntries(
    Object.entries(sources).map(([name, body]) => [name, sha256(body)]),
  );
  const identity = {
    project_root: projectRoot,
    renderer_sha256: sha256(await readFile(join(projectRoot, '_bmad/scripts/render_skill.py'))),
    resolved_values: {},
    source_sha256: sourceSha256,
  };
  const rootHash = sha256(projectRoot).slice(0, 12);
  const slug = posix
    .basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const generationHash = sha256(pythonCanonical(identity)).slice(0, 20);
  const destination = `${projectRoot}/_bmad/render/${posix.basename(skill)}/${slug}-${rootHash}/${generationHash}`;
  const outputs: Record<string, Buffer> = { ...sources };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 1,
        skill: posix.basename(skill),
        project_root: projectRoot,
        project_slug: slug,
        root_hash: rootHash,
        generation_hash: generationHash,
        inputs: identity,
        outputs: sourceSha256,
      },
      null,
      2,
    )}\n`,
  );
  const published = { ...outputs, 'manifest.json': manifestBytes };
  const existing = await lstat(destination).catch(() => null);
  if (existing) {
    for (const [name, body] of Object.entries(published)) {
      const current = await readFile(join(destination, name)).catch(() => null);
      if (!current?.equals(body)) return { exitCode: 1, stdout: `HALT: ${destination} differs\n` };
    }
  } else {
    for (const [name, body] of Object.entries(published)) {
      await mkdir(posix.dirname(join(destination, name)), { recursive: true });
      await writeFile(join(destination, name), body, { flag: 'wx' });
    }
  }
  return { exitCode: 0, stdout: `read and follow ${destination}/workflow.md\n` };
}

/**
 * Entry point of a stand-in `uv` executable: requires the pinned interpreter in `UV_PYTHON`, as the
 * official `uv` would only find through it, then behaves like the official renderer.
 */
export async function fakeUvMain(expectedPython: string): Promise<void> {
  if (process.env.UV_PYTHON !== expectedPython) {
    process.stdout.write('error: No interpreter found for Python >=3.11 in managed installations\n');
    process.exitCode = 2;
    return;
  }
  const outcome = await officialRender([process.argv[1], ...process.argv.slice(2)]);
  process.stdout.write(outcome.stdout);
  process.exitCode = outcome.exitCode;
}
