import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  AtomicRecords,
  canonicalJson,
  hash,
  privateDirectory,
  syncDirectory,
} from '../journal/atomic-records.ts';
import { type OwnedIdentity, OwnedOperations } from '../workflows/operations.ts';
import { type ManifestEntry, type ProjectionPin, type SourcePin, same } from '../workflows/pins.ts';
import { WorkflowRegistry } from '../workflows/registry.ts';
import {
  auditWorkspace,
  type CommandEvidence,
  contained,
  fileDigest,
  type InventoryEntry,
} from './inventory.ts';
import { isolationPolicy, policyIdentity } from './policy.ts';

const HOME_CONFIG = Object.freeze({
  'codex/config.toml': 'cli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n',
  'claude/settings.json': '{}\n',
});

export type IsolatedWorkspace = {
  formatVersion: 1;
  attemptId: string;
  operationId: string;
  identity: OwnedIdentity;
  workspace: string;
  attemptHome: string;
  source: SourcePin;
  projection: ProjectionPin;
  ownerCommit: string;
  ownerCheckout: string;
  commonDir: string;
  exclusions: InventoryEntry[];
  entries: InventoryEntry[];
  state: 'preparing' | 'prepared' | 'retained' | 'deleted';
  commands: string[];
  gitInventorySha256: string;
  commitInput?: { path: string; device: number; inode: number; ownerUid: number; sha256: string };
  productionEnabled: false;
};
type CommandRecord = {
  formatVersion: 1;
  kind: 'isolation-command';
  attemptId: string;
  identity: OwnedIdentity | null;
  state: 'reserved' | 'pending' | 'complete' | 'unknown' | 'deleted';
  evidence: CommandEvidence;
};
export class IsolationWorkspace {
  private readonly registry: WorkflowRegistry;
  private readonly store: AtomicRecords;
  private readonly operations: OwnedOperations;
  private readonly executableTargets: readonly string[];
  readonly root: string;
  private constructor(
    root: string,
    registry: WorkflowRegistry,
    store: AtomicRecords,
    operations: OwnedOperations,
    executableTargets: readonly string[],
  ) {
    this.root = root;
    this.registry = registry;
    this.store = store;
    this.operations = operations;
    this.executableTargets = Object.freeze([...executableTargets]);
  }
  static async open(
    root: string,
    registry: WorkflowRegistry,
    executablePaths: readonly string[] = [],
  ): Promise<IsolationWorkspace> {
    if (!(registry instanceof WorkflowRegistry)) throw new Error('TRUSTED_REGISTRY_REQUIRED');
    await privateDirectory(root);
    const store = await AtomicRecords.open(join(root, 'journal'));
    try {
      const targets: string[] = [];
      for (const path of executablePaths) {
        const target = await realpath(path).catch(() => null);
        if (target) targets.push(target);
      }
      return new IsolationWorkspace(
        root,
        registry,
        store,
        await OwnedOperations.open(join(root, 'operations'), store),
        targets,
      );
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  private key(attemptId: string): string {
    return `isolation-workspace-${hash(attemptId)}`;
  }
  async get(attemptId: string): Promise<IsolatedWorkspace | null> {
    return this.store.get(this.key(attemptId));
  }
  async commands(attemptId: string): Promise<CommandEvidence[]> {
    const records = await this.store.all<CommandRecord>();
    return records
      .filter((r) => r.kind === 'isolation-command' && r.attemptId === attemptId)
      .map((r) => r.evidence);
  }
  /** Only the bound preflight implementation uses this executor; it conveys no launch authority. */
  async measure(
    attemptId: string,
    cwd: string,
    executable: string,
    args: string[],
    scope: {
      workspace: string;
      attemptHome: string;
      projectionRoot: string;
      extraRead?: string[];
      extraWrite?: string[];
      environment?: string[];
      stdin?: string;
    },
  ): Promise<CommandEvidence> {
    const binary = await realpath(executable);
    const stat = await lstat(binary);
    if (!stat.isFile()) throw new Error('INVALID_EXECUTABLE');
    const id = randomUUID(),
      stage = join(this.operations.root, 'stages', id);
    let policy = isolationPolicy({ ...scope, executable: binary, operationRoot: stage });
    // Preparation-only Git grants are derived by this module, never by the public preflight input.
    for (const p of scope.extraRead ?? []) policy += `\n(allow file-read* (subpath ${JSON.stringify(p)}))`;
    for (const p of scope.extraWrite ?? []) policy += `\n(allow file-write* (subpath ${JSON.stringify(p)}))`;
    const policyFile = join(stage, 'sandbox.sb');
    let stdin: CommandEvidence['stdin'];
    if (scope.stdin) {
      if (!contained(scope.attemptHome, scope.stdin) || (await realpath(scope.stdin)) !== scope.stdin)
        throw new Error('UNSAFE_DISCOVERY_STDIN');
      const s = await lstat(scope.stdin);
      if (
        !s.isFile() ||
        s.nlink !== 1 ||
        s.uid !== process.getuid?.() ||
        s.size > 32768 ||
        (s.mode & 0o777) !== 0o400
      )
        throw new Error('UNSAFE_DISCOVERY_STDIN');
      const body = await readFile(scope.stdin, 'utf8');
      stdin = { path: scope.stdin, device: s.dev, inode: s.ino, ownerUid: s.uid, sha256: hash(body), body };
    }
    const command = stdin
      ? [
          '/bin/sh',
          '-c',
          'exec "$@" < "$CREW_ISOLATION_DISCOVERY_INPUT"',
          'crew-isolation-discovery',
          binary,
          ...args,
        ]
      : [binary, ...args];
    const argv = [
      '/usr/bin/env',
      `HOME=${scope.attemptHome}`,
      `CLAUDE_CONFIG_DIR=${join(scope.attemptHome, 'claude')}`,
      `CODEX_HOME=${join(scope.attemptHome, 'codex')}`,
      `TMPDIR=${join(scope.attemptHome, 'tmp')}`,
      `CLAUDE_CODE_TMPDIR=${join(scope.attemptHome, 'tmp')}`,
      `XDG_CACHE_HOME=${join(scope.attemptHome, 'cache')}`,
      `XDG_CONFIG_HOME=${join(scope.attemptHome, 'config')}`,
      `XDG_DATA_HOME=${join(scope.attemptHome, 'data')}`,
      ...(scope.environment ?? []),
      ...(stdin ? [`CREW_ISOLATION_DISCOVERY_INPUT=${stdin.path}`] : []),
      '/usr/bin/sandbox-exec',
      '-f',
      policyFile,
      ...command,
    ];
    const evidence: CommandEvidence = {
      operationId: id,
      argv,
      executable: binary,
      executableSha256: hash(await readFile(binary)),
      policySha256: policyIdentity(policy),
      policy,
      stageIdentity: null,
      output: '',
      receipt: null,
      error: null,
      numericPidStart: 'unavailable-in-reviewed-receipt',
    };
    if (stdin) evidence.stdin = stdin;
    const record: CommandRecord = {
      formatVersion: 1,
      kind: 'isolation-command',
      attemptId,
      identity: null,
      state: 'reserved',
      evidence,
    };
    await this.store.put(`command-${id}`, record);
    try {
      const identity = await this.operations.create(id);
      record.identity = identity;
      evidence.stageIdentity = identity;
      record.state = 'pending';
      await this.store.put(`command-${id}`, record);
      for (const name of ['home', 'tmp']) await mkdir(join(stage, name), { mode: 0o700 });
      await writeFile(policyFile, policy, { mode: 0o600 });
      evidence.receipt = await this.operations.execute(id, identity, cwd, argv, 10);
      evidence.output = await readFile(join(stage, 'execution.log'), 'utf8');
      if (evidence.output.length > 2 * 1024 * 1024) throw new Error('INVENTORY_OUTPUT_LIMIT');
      if (stdin) {
        const s = await lstat(stdin.path);
        if (
          s.dev !== stdin.device ||
          s.ino !== stdin.inode ||
          s.uid !== stdin.ownerUid ||
          s.nlink !== 1 ||
          (await fileDigest(stdin.path)) !== stdin.sha256
        )
          throw new Error('DISCOVERY_STDIN_CHANGED');
      }
      await this.store.put(`command-${id}`, { ...record, state: 'complete', evidence });
      await this.operations.remove('stages', id, identity);
      await this.store.put(`command-${id}`, { ...record, state: 'deleted', evidence });
    } catch (error) {
      evidence.error = error instanceof Error ? error.message : 'MEASUREMENT_FAILED';
      await this.store.put(`command-${id}`, {
        ...record,
        state: evidence.receipt ? 'complete' : 'unknown',
        evidence,
      });
    }
    return evidence;
  }
  async prepareWorkspace(
    ownerCheckout: string,
    attemptId: string,
    inputSource: SourcePin,
    inputProjection: ProjectionPin,
  ): Promise<IsolatedWorkspace> {
    return this.store.transaction(async () => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(attemptId)) throw new Error('INVALID_ATTEMPT_ID');
      if (await this.get(attemptId)) throw new Error('ATTEMPT_ALREADY_RESERVED');
      if ((await realpath(ownerCheckout)) !== resolve(ownerCheckout)) throw new Error('OWNER_CHECKOUT_ALIAS');
      const source = structuredClone(inputSource),
        projection = structuredClone(inputProjection);
      const selected = await this.registry.resolve(source, projection);
      if (
        contained(ownerCheckout, this.root) ||
        contained(this.root, ownerCheckout) ||
        contained(ownerCheckout, selected.projectionRoot)
      )
        throw new Error('ISOLATION_ROOT_OVERLAP');
      const operationId = randomUUID();
      await this.store.put(this.key(attemptId), {
        formatVersion: 1,
        state: 'preparing',
        attemptId,
        operationId,
        source,
        projection,
      });
      await this.registry.retain(`isolation:${attemptId}`, source, projection);
      const identity = await this.operations.create(operationId),
        base = join(this.operations.root, 'stages', operationId);
      const workspace = join(base, 'workspace'),
        attemptHome = join(base, 'home');
      for (const p of [
        'home/claude',
        'home/codex',
        'home/hooks',
        'home/template',
        'home/tmp',
        'home/cache',
        'home/config',
        'home/data',
        'tmp',
        'excluded',
      ])
        await mkdir(join(base, p), { recursive: true, mode: 0o700 });
      for (const [path, bytes] of Object.entries(HOME_CONFIG))
        await writeFile(join(attemptHome, path), bytes, { flag: 'wx', mode: 0o600 });
      const record: IsolatedWorkspace = {
        formatVersion: 1,
        attemptId,
        operationId,
        identity,
        workspace,
        attemptHome,
        source,
        projection,
        ownerCommit: '',
        ownerCheckout,
        commonDir: '',
        exclusions: [],
        entries: [],
        state: 'preparing',
        commands: [],
        gitInventorySha256: '',
        productionEnabled: false,
      };
      await this.store.put(this.key(attemptId), record);
      const git = async (args: string[], extraRead: string[] = [ownerCheckout]): Promise<string> => {
        const e = await this.measure(
          attemptId,
          base,
          '/Library/Developer/CommandLineTools/usr/bin/git',
          ['-c', `core.hooksPath=${join(attemptHome, 'hooks')}`, '-c', 'core.fsmonitor=false', ...args],
          {
            workspace: base,
            attemptHome,
            projectionRoot: selected.projectionRoot,
            extraRead: [
              ...extraRead,
              '/Applications/Xcode.app/Contents/Developer',
              '/Library/Developer/CommandLineTools',
            ],
            extraWrite: [base],
            environment: [
              'GIT_CONFIG_NOSYSTEM=1',
              'GIT_CONFIG_GLOBAL=/dev/null',
              'GIT_TERMINAL_PROMPT=0',
              'GIT_OPTIONAL_LOCKS=0',
              `GIT_TEMPLATE_DIR=${join(attemptHome, 'template')}`,
            ],
          },
        );
        record.commands.push(e.operationId);
        await this.store.put(this.key(attemptId), record);
        if (e.receipt?.exitCode !== 0 || e.error)
          throw new Error(`GIT_MEASUREMENT_FAILED:${e.error ?? e.receipt?.exitCode}`);
        return e.output.trim();
      };
      try {
        // Common-dir discovery may point outside a worktree. This command only resolves its path.
        record.commonDir = await git([
          '-C',
          ownerCheckout,
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ]);
        if (
          !record.commonDir.startsWith('/') ||
          [...record.commonDir].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
          throw new Error('INVALID_GIT_COMMON_DIR');
        const reads = [ownerCheckout, record.commonDir];
        record.ownerCommit = await git(
          ['-C', ownerCheckout, 'rev-parse', '--verify', 'HEAD^{commit}'],
          reads,
        );
        if (!/^[0-9a-f]{40}$/.test(record.ownerCommit)) throw new Error('INVALID_OWNER_COMMIT');
        await git(['init', '--template', join(attemptHome, 'template'), workspace], []);
        const inputPath = join(base, 'commit-input');
        const inputBytes = `${record.ownerCommit}\n`;
        const fd = await open(inputPath, 'wx', 0o400);
        try {
          await fd.writeFile(inputBytes);
          await fd.sync();
          const s = await fd.stat();
          record.commitInput = {
            path: inputPath,
            device: s.dev,
            inode: s.ino,
            ownerUid: s.uid,
            sha256: hash(inputBytes),
          };
        } finally {
          await fd.close();
        }
        await syncDirectory(base);
        await this.store.put(this.key(attemptId), record);
        const packOutput = join(base, `export-${randomUUID()}.pack`);
        await this.store.put(`pack-intent-${operationId}`, {
          formatVersion: 1,
          attemptId,
          operationId,
          parent: identity,
          path: packOutput,
          maximumBytes: 64 * 1024 * 1024,
        });
        const packed = await this.measure(
          attemptId,
          base,
          '/bin/sh',
          [
            '-c',
            'ulimit -S -f 65536 && set -C && exec "$@" < "$CREW_ISOLATION_COMMIT_INPUT" > "$CREW_ISOLATION_PACK_OUTPUT"',
            'crew-isolation-pack',
            '/Library/Developer/CommandLineTools/usr/bin/git',
            '-c',
            `core.hooksPath=${join(attemptHome, 'hooks')}`,
            '-c',
            'core.fsmonitor=false',
            '-C',
            ownerCheckout,
            'pack-objects',
            '--stdout',
            '--revs',
            '--quiet',
            '--threads=1',
          ],
          {
            workspace: base,
            attemptHome,
            projectionRoot: selected.projectionRoot,
            extraRead: [...reads, '/Library/Developer/CommandLineTools'],
            extraWrite: [base],
            environment: [
              'GIT_CONFIG_NOSYSTEM=1',
              'GIT_CONFIG_GLOBAL=/dev/null',
              'GIT_TERMINAL_PROMPT=0',
              'GIT_OPTIONAL_LOCKS=0',
              `CREW_ISOLATION_COMMIT_INPUT=${inputPath}`,
              `CREW_ISOLATION_PACK_OUTPUT=${packOutput}`,
            ],
          },
        );
        record.commands.push(packed.operationId);
        await this.store.put(this.key(attemptId), record);
        if (packed.receipt?.exitCode !== 0 || packed.error || packed.output !== '')
          throw new Error('GIT_PACK_EXPORT_FAILED');
        const inputStat = await lstat(inputPath);
        if (
          inputStat.dev !== record.commitInput.device ||
          inputStat.ino !== record.commitInput.inode ||
          inputStat.uid !== record.commitInput.ownerUid ||
          inputStat.nlink !== 1 ||
          hash(await readFile(inputPath)) !== record.commitInput.sha256
        )
          throw new Error('COMMIT_INPUT_CHANGED');
        const packStat = await lstat(packOutput);
        if (
          !packStat.isFile() ||
          packStat.isSymbolicLink() ||
          packStat.nlink !== 1 ||
          packStat.uid !== process.getuid?.() ||
          packStat.size < 32 ||
          packStat.size > 64 * 1024 * 1024
        )
          throw new Error('INVALID_OWNED_PACK');
        const packBytes = await readFile(packOutput);
        const packHash = createHash('sha1').update(packBytes.subarray(0, -20)).digest('hex');
        if (
          packBytes.subarray(0, 4).toString() !== 'PACK' ||
          packBytes.readUInt32BE(4) !== 2 ||
          packBytes.subarray(-20).toString('hex') !== packHash
        )
          throw new Error('PACK_CHECKSUM_MISMATCH');
        await this.store.put(`pack-receipt-${operationId}`, {
          formatVersion: 1,
          attemptId,
          path: packOutput,
          device: packStat.dev,
          inode: packStat.ino,
          ownerUid: packStat.uid,
          bytes: packStat.size,
          sha256: hash(packBytes),
          sha1: packHash,
          command: packed.operationId,
        });
        const packPath = join(workspace, `.git/objects/pack/pack-${packHash}.pack`);
        await rename(packOutput, packPath);
        const indexed = await git(['index-pack', '--strict', '--threads=1', packPath], []);
        if (indexed !== packHash) throw new Error('PACK_INDEX_MISMATCH');
        await git(['-C', workspace, 'update-ref', 'HEAD', record.ownerCommit], []);
        await git(['-C', workspace, 'checkout', '--detach', '--force', record.ownerCommit], reads);
        const actual = await git(['-C', workspace, 'rev-parse', '--verify', 'HEAD^{commit}'], []);
        const common = await git(
          ['-C', workspace, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
          [],
        );
        if (
          actual !== record.ownerCommit ||
          common !== join(workspace, '.git') ||
          (await realpath(common)) !== common
        )
          throw new Error('CLONE_IDENTITY_MISMATCH');
        const ownerTree = await git(
          ['-C', ownerCheckout, 'rev-parse', `${record.ownerCommit}^{tree}`],
          reads,
        );
        if ((await git(['-C', workspace, 'rev-parse', 'HEAD^{tree}'], [])) !== ownerTree)
          throw new Error('CLONE_TREE_MISMATCH');
        if (await git(['-C', workspace, 'status', '--porcelain', '--untracked-files=all'], []))
          throw new Error('CLONE_NOT_CLEAN');
        const before = await auditWorkspace(workspace);
        if (before.blockers.length) throw new Error(before.blockers.join(';'));
        record.exclusions = before.entries.filter((e) => e.classification === 'discovery');
        const excludedRoots: string[] = [];
        for (const entry of record.exclusions) {
          if (excludedRoots.some((p) => entry.path.startsWith(`${p}/`))) continue;
          const target = join(base, 'excluded', entry.path);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await rename(join(workspace, entry.path), target);
          excludedRoots.push(entry.path);
        }
        if (projection.runtime === 'codex') {
          if (projection.derivation.layoutSchema !== 'superpowers-codex-native-skills-v1')
            throw new Error('NATIVE_DISCOVERY_GEOMETRY_UNVERIFIED');
          await mkdir(join(workspace, '.agents'), { mode: 0o700 });
          await symlink(join(selected.projectionRoot, '.agents/skills'), join(workspace, '.agents/skills'));
        }
        const after = await auditWorkspace(
          workspace,
          projection.runtime === 'codex'
            ? { path: '.agents/skills', target: join(selected.projectionRoot, '.agents/skills') }
            : undefined,
        );
        if (after.blockers.length) throw new Error(after.blockers.join(';'));
        record.entries = after.entries;
        record.state = 'prepared';
        const gitInventory = await auditWorkspace(join(workspace, '.git'));
        if (
          gitInventory.blockers.length ||
          gitInventory.entries.some((e) => ['objects/info/alternates', 'commondir'].includes(e.path))
        )
          throw new Error('CLONE_METADATA_ALIAS');
        record.gitInventorySha256 = hash(canonicalJson(gitInventory.entries));
        await this.registry.resolve(source, projection);
        await this.store.put(this.key(attemptId), record);
        return structuredClone(record);
      } catch (error) {
        record.state = 'retained';
        await this.store.put(this.key(attemptId), record);
        throw error;
      }
    });
  }
  async verify(
    workspace: string,
    attemptHome: string,
    source: SourcePin,
    projection: ProjectionPin,
  ): Promise<{ record: IsolatedWorkspace; projectionRoot: string; projectionEntries: ManifestEntry[] }> {
    const records = await this.store.all<IsolatedWorkspace>();
    const record = records.find(
      (r) => r.workspace === workspace && r.attemptHome === attemptHome && r.state === 'prepared',
    );
    if (!record || !same(record.source, source) || !same(record.projection, projection))
      throw new Error('WORKSPACE_BINDING_MISMATCH');
    if (
      (await this.commands(record.attemptId)).some(
        (c) => !c.receipt || c.receipt.forkObserved || !c.receipt.treeEmpty,
      )
    )
      throw new Error('PROCESS_CLOSURE_UNVERIFIED');
    const identity = await this.operations.attest('stages', record.operationId, record.operationId);
    if (identity.device !== record.identity.device || identity.inode !== record.identity.inode)
      throw new Error('WORKSPACE_IDENTITY_MISMATCH');
    if ((await realpath(workspace)) !== workspace || (await realpath(attemptHome)) !== attemptHome)
      throw new Error('WORKSPACE_ALIAS');
    const selected = await this.registry.resolve(source, projection);
    const homeInventory = await auditWorkspace(attemptHome, undefined, this.executableTargets);
    if (homeInventory.blockers.length) throw new Error('CROSS_WORKFLOW_SOURCE');
    for (const [path, bytes] of Object.entries(HOME_CONFIG))
      if ((await fileDigest(join(attemptHome, path))) !== hash(bytes))
        throw new Error('PRIVATE_CONFIG_CHANGED');
    const gitInventory = await auditWorkspace(join(workspace, '.git'));
    if (
      gitInventory.blockers.length ||
      hash(canonicalJson(gitInventory.entries)) !== record.gitInventorySha256
    )
      throw new Error('GIT_METADATA_CHANGED');
    const audit = await auditWorkspace(
      workspace,
      projection.runtime === 'codex'
        ? { path: '.agents/skills', target: join(selected.projectionRoot, '.agents/skills') }
        : undefined,
    );
    if (audit.blockers.length) throw new Error('CROSS_WORKFLOW_SOURCE');
    if (canonicalJson(audit.entries) !== canonicalJson(record.entries))
      throw new Error('WORKSPACE_BYTES_CHANGED');
    return {
      record,
      projectionRoot: selected.projectionRoot,
      projectionEntries: selected.manifest.projection,
    };
  }
  withPrepared<T>(
    workspace: string,
    attemptHome: string,
    source: SourcePin,
    projection: ProjectionPin,
    action: (verified: {
      record: IsolatedWorkspace;
      projectionRoot: string;
      projectionEntries: ManifestEntry[];
    }) => Promise<T>,
  ): Promise<T> {
    // Fixed order: isolation transaction -> registry read; registry never calls back into isolation.
    return this.store.transaction(async () =>
      action(await this.verify(workspace, attemptHome, source, projection)),
    );
  }
  async cleanup(attemptId: string): Promise<'deleted' | 'retained'> {
    return this.store.transaction(async () => {
      const record = await this.get(attemptId);
      if (!record?.identity) return 'retained';
      if (record.state === 'deleted') return 'deleted';
      const commands = await this.commands(attemptId);
      if (commands.some((c) => !c.receipt || c.receipt.forkObserved || !c.receipt.treeEmpty))
        return 'retained';
      await this.operations.remove('stages', record.operationId, record.identity);
      await this.registry.release(`isolation:${attemptId}`, record.source, record.projection);
      await this.store.put(this.key(attemptId), { ...record, state: 'deleted' });
      return 'deleted';
    });
  }
  async close(): Promise<void> {
    await this.store.close();
  }
}
export async function prepareWorkspace(
  _ownerCheckout: string,
  _attemptId: string,
  _source: SourcePin,
  _projection: ProjectionPin,
): Promise<never> {
  throw new Error('ISOLATION_NOT_BOUND');
}
