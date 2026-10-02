import { randomUUID } from 'node:crypto';
import { access, open, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalJson, hash, syncDirectory } from '../journal/atomic-records.ts';
import type { ProjectionPin, Runtime, SourcePin } from '../workflows/pins.ts';
import type { WorkflowRegistry } from '../workflows/registry.ts';
import { classifyOrigin, type InventoryEvidence, type Surface } from './inventory.ts';
import { ISOLATION_POLICY_VERSION } from './policy.ts';
import { IsolationWorkspace } from './workspace.ts';
export type PreflightInput = {
  runtime: Runtime;
  source: SourcePin;
  projection: ProjectionPin;
  workspace: string;
  attemptHome: string;
};
export type PreflightResult = {
  status: 'PASS' | 'UNVERIFIED' | 'FAIL';
  evidence: InventoryEvidence;
  blockers: string[];
};
type Options = {
  root: string;
  registry: WorkflowRegistry;
  executables?: Partial<Record<'claude' | 'codex', string>>;
};
async function discoveryInput(home: string, messages: unknown[]): Promise<string> {
  const path = join(home, `discovery-${randomUUID()}.jsonl`);
  const fd = await open(path, 'wx', 0o400);
  try {
    await fd.writeFile(`${messages.map((m) => JSON.stringify(m)).join('\n')}\n`);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await syncDirectory(home);
  return path;
}
function jsonLines(output: string): unknown[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export async function createIsolationPreflight(options: Options) {
  const executables = Object.freeze({ ...options.executables });
  const service = await IsolationWorkspace.open(options.root, options.registry, Object.values(executables));
  const preflight = async (input: PreflightInput): Promise<PreflightResult> => {
    input = structuredClone(input);
    const evidence: InventoryEvidence = {
      formatVersion: 1,
      runtime: input.runtime,
      source: structuredClone(input.source),
      projection: structuredClone(input.projection),
      workspace: input.workspace,
      attemptHome: input.attemptHome,
      os: { platform: platform(), release: release(), arch: arch() },
      productionEnabled: false,
      policyVersion: ISOLATION_POLICY_VERSION,
      commands: [],
      entries: [],
      projectionEntries: [],
      exclusions: [],
      surfaces: [],
      discovery: null,
      origins: [],
      blockers: [],
      sha256: '',
    };
    const add = (surface: string, status: Surface['status'], measured: boolean, reason: string) =>
      evidence.surfaces.push({ surface, status, measured, reason });
    try {
      if (input.runtime !== input.projection.runtime) throw new Error('RUNTIME_PIN_MISMATCH');
      await service.withPrepared(
        input.workspace,
        input.attemptHome,
        input.source,
        input.projection,
        async ({ record, projectionRoot, projectionEntries }) => {
          evidence.entries = record.entries;
          evidence.exclusions = record.exclusions;
          evidence.projectionEntries = projectionEntries;
          add(
            'pins-and-workspace',
            'PASS',
            true,
            'registry bytes, owned identity and frozen workspace/Git inventory reverified',
          );
          const scope = { workspace: input.workspace, attemptHome: input.attemptHome, projectionRoot };
          const checkCommand = (command: InventoryEvidence['commands'][number]) => {
            if (!command.receipt) throw new Error('PROCESS_CLOSURE_UNVERIFIED');
            if (command.error === 'DISCOVERY_STDIN_CHANGED') throw new Error('DISCOVERY_STDIN_CHANGED');
          };
          const selectedEntry = projectionEntries.find(
            (e) => e.type === 'file' && e.path.endsWith('SKILL.md') && e.bytes < 32000,
          );
          if (selectedEntry) {
            const e = await service.measure(
              record.attemptId,
              input.workspace,
              '/bin/cat',
              [join(projectionRoot, selectedEntry.path)],
              scope,
            );
            evidence.commands.push(e);
            checkCommand(e);
            add(
              'shell-selected-projection-read',
              e.receipt?.exitCode === 0 && hash(e.output) === selectedEntry.sha256 ? 'PASS' : 'UNVERIFIED',
              true,
              'selected audited bytes compared with registry manifest; not Skill invocation',
            );
          } else
            add(
              'shell-selected-projection-read',
              'UNVERIFIED',
              false,
              'selected readable skill fixture unavailable',
            );
          const probeId = randomUUID(),
            allowed = join(input.attemptHome, `canary-${probeId}`),
            forbidden = join(dirname(input.workspace), 'excluded', `canary-${probeId}`);
          const alias = join(input.attemptHome, `alias-${probeId}`),
            text = `CREW_OWNED_CANARY_${probeId}`;
          await writeFile(allowed, text, { flag: 'wx', mode: 0o600 });
          await writeFile(forbidden, text, { flag: 'wx', mode: 0o600 });
          await symlink(forbidden, alias);
          const packs = (await readdir(join(input.workspace, '.git/objects/pack'))).filter((name) =>
            /^pack-[0-9a-f]{40}\.pack$/.test(name),
          );
          if (packs.length !== 1) throw new Error('GIT_PACK_INVENTORY_CHANGED');
          const probes = [
            ['shell-selected-owned-read', allowed, true],
            ['shell-absolute-other-source-denial', forbidden, false],
            ['shell-symlink-other-source-denial', alias, false],
            ['shell-dotdot-other-source-denial', `${input.attemptHome}/../excluded/canary-${probeId}`, false],
            ['shell-common-dir-denial', join(input.workspace, '.git/config'), false],
            ['shell-git-objectdb-denial', join(input.workspace, '.git/objects/pack', packs[0]), false],
          ] as const;
          let shellWorks = false;
          for (const [surface, path, expected] of probes) {
            const e = await service.measure(record.attemptId, input.workspace, '/bin/cat', [path], scope);
            evidence.commands.push(e);
            checkCommand(e);
            const observed = e.receipt?.exitCode === 0 && e.output === text;
            if (expected) {
              shellWorks = observed;
              add(
                surface,
                observed ? 'PASS' : 'UNVERIFIED',
                true,
                observed ? 'owned canary read with nofork receipt' : 'sandbox command unavailable',
              );
            } else {
              const escaped = e.receipt?.exitCode === 0 || e.output.includes(text);
              const denied =
                shellWorks &&
                !!e.receipt &&
                e.receipt.exitCode !== 0 &&
                /Operation not permitted|Permission denied/.test(e.output);
              add(
                surface,
                escaped ? 'FAIL' : denied ? 'PASS' : 'UNVERIFIED',
                true,
                escaped
                  ? 'cross-boundary read observed'
                  : denied
                    ? 'kernel data read denied'
                    : 'denial not established',
              );
            }
          }
          // These are pure fixture files. Remove only when every referencing child has a genuine receipt.
          if (evidence.commands.every((e) => e.receipt?.treeEmpty && !e.receipt.forkObserved)) {
            await unlink(alias);
            await unlink(allowed);
            await unlink(forbidden);
          }
          if (input.runtime === 'api') {
            add(
              'api-artifact-inventory',
              'PASS',
              true,
              'verified audited adapter projection; no provider or model request',
            );
          } else {
            const executable = executables[input.runtime];
            if (
              !executable ||
              !(await access(executable).then(
                () => true,
                () => false,
              ))
            )
              add('runtime-discovery', 'UNVERIFIED', false, 'RUNTIME_EXECUTABLE_NOT_BOUND_OR_MISSING');
            else {
              const version = await service.measure(
                record.attemptId,
                input.workspace,
                executable,
                ['--version'],
                scope,
              );
              evidence.commands.push(version);
              checkCommand(version);
              if (version.receipt?.exitCode !== 0)
                add('runtime-version', 'UNVERIFIED', true, 'runtime unavailable within sandbox');
              else {
                add('runtime-version', 'PASS', true, version.output.trim());
                if (input.runtime === 'claude') {
                  const command = await service.measure(
                    record.attemptId,
                    input.workspace,
                    executable,
                    [
                      '--setting-sources',
                      '',
                      '--settings',
                      '{}',
                      '--strict-mcp-config',
                      '--mcp-config',
                      '{"mcpServers":{}}',
                      '--plugin-dir',
                      projectionRoot,
                      'plugin',
                      'list',
                      '--json',
                    ],
                    {
                      ...scope,
                      environment: ['DISABLE_AUTOUPDATER=1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'],
                    },
                  );
                  evidence.commands.push(command);
                  checkCommand(command);
                  evidence.discovery = { kind: 'installed-plugin-cli-only', output: command.output };
                  if (command.receipt?.exitCode === 0) {
                    let plugins: unknown;
                    try {
                      plugins = JSON.parse(command.output);
                    } catch {
                      plugins = null;
                    }
                    if (Array.isArray(plugins))
                      for (const plugin of plugins) {
                        if (typeof plugin?.installPath === 'string')
                          evidence.origins.push(
                            await classifyOrigin(
                              plugin.installPath,
                              'claude-plugin',
                              projectionRoot,
                              input.attemptHome,
                            ),
                          );
                        else
                          evidence.origins.push({
                            path: '<unrecognized-plugin>',
                            kind: 'claude-plugin',
                            classification: 'unverified',
                            sha256: null,
                          });
                      }
                    add(
                      'plugin-origin-inventory',
                      evidence.origins.some((o) => o.classification === 'blocked')
                        ? 'FAIL'
                        : evidence.origins.length &&
                            evidence.origins.every((o) => o.classification === 'selected')
                          ? 'PASS'
                          : 'UNVERIFIED',
                      true,
                      'CLI plugin origins compared with verified selected projection; hooks/invoke untested',
                    );
                  }
                  const stdin = await discoveryInput(input.attemptHome, [
                    {
                      type: 'control_request',
                      request_id: 'crew-preflight-initialize',
                      request: { subtype: 'initialize' },
                    },
                  ]);
                  const initialize = await service.measure(
                    record.attemptId,
                    input.workspace,
                    executable,
                    [
                      '--print',
                      '--input-format',
                      'stream-json',
                      '--output-format',
                      'stream-json',
                      '--verbose',
                      '--no-session-persistence',
                      '--permission-prompts',
                      'none',
                      '--setting-sources',
                      '',
                      '--settings',
                      '{}',
                      '--strict-mcp-config',
                      '--mcp-config',
                      '{"mcpServers":{}}',
                      '--plugin-dir',
                      projectionRoot,
                    ],
                    {
                      ...scope,
                      stdin,
                      environment: ['DISABLE_AUTOUPDATER=1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'],
                    },
                  );
                  evidence.commands.push(initialize);
                  checkCommand(initialize);
                  evidence.discovery = { plugins: command.output, initialize: jsonLines(initialize.output) };
                  if (initialize.receipt) await unlink(stdin);
                  add(
                    'runtime-discovery',
                    'UNVERIFIED',
                    true,
                    'CLI plugin list does not certify loaded skills/hooks/MCP or native invocation',
                  );
                } else {
                  const stdin = await discoveryInput(input.attemptHome, [
                    {
                      id: 1,
                      method: 'initialize',
                      params: {
                        clientInfo: { name: 'crew_isolation_probe', version: '1' },
                        capabilities: { experimentalApi: true },
                      },
                    },
                    { method: 'initialized' },
                    { id: 2, method: 'skills/list', params: { cwds: [input.workspace], forceReload: true } },
                    { id: 3, method: 'hooks/list', params: { cwds: [input.workspace] } },
                    { id: 4, method: 'config/read', params: { cwd: input.workspace, includeLayers: true } },
                  ]);
                  const command = await service.measure(
                    record.attemptId,
                    input.workspace,
                    executable,
                    ['app-server', '--listen', 'stdio://'],
                    { ...scope, stdin },
                  );
                  evidence.commands.push(command);
                  checkCommand(command);
                  evidence.discovery = jsonLines(command.output);
                  for (const message of evidence.discovery as {
                    id?: number;
                    result?: { data?: { skills?: { path?: string }[] }[] };
                  }[]) {
                    if (message.id !== 2) continue;
                    for (const group of message.result?.data ?? [])
                      for (const skill of group.skills ?? []) {
                        if (typeof skill.path === 'string')
                          evidence.origins.push(
                            await classifyOrigin(
                              skill.path,
                              'codex-skill',
                              projectionRoot,
                              input.attemptHome,
                              input.workspace,
                            ),
                          );
                        else
                          evidence.origins.push({
                            path: '<unrecognized-skill>',
                            kind: 'codex-skill',
                            classification: 'unverified',
                            sha256: null,
                          });
                      }
                  }
                  if (evidence.origins.some((o) => o.classification === 'blocked'))
                    add('skill-origin-inventory', 'FAIL', true, 'CROSS_WORKFLOW_SOURCE');
                  add(
                    'runtime-discovery',
                    'UNVERIFIED',
                    true,
                    'bounded stdin discovery; incomplete responses or unmeasured invocation cannot certify runtime',
                  );
                  if (command.receipt) await unlink(stdin);
                }
              }
            }
          }
          await service.verify(input.workspace, input.attemptHome, input.source, input.projection);
        },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'PREFLIGHT_FAILED';
      add(
        'preflight-integrity',
        reason === 'PROCESS_CLOSURE_UNVERIFIED' ? 'UNVERIFIED' : 'FAIL',
        true,
        reason,
      );
    }
    for (const [surface, reason] of [
      ['native-Read', 'NATIVE_READ_UNVERIFIED'],
      ['native-Skill', 'NATIVE_SKILL_UNVERIFIED'],
      ['MCP-load-and-invoke', 'MCP_INVOKE_UNVERIFIED'],
      ['child-inheritance', 'CHILD_POLICY_UNVERIFIED'],
      ['whole-process-tree', 'FULL_TREE_PROOF_UNVERIFIED'],
      ['official-renderer-invoke', 'RENDERER_INVOKE_UNVERIFIED'],
    ])
      add(surface, 'UNVERIFIED', false, reason);
    evidence.blockers = [
      ...new Set(evidence.surfaces.filter((s) => s.status !== 'PASS').map((s) => s.reason)),
    ];
    evidence.sha256 = hash(canonicalJson(evidence));
    return {
      status: evidence.surfaces.some((s) => s.status === 'FAIL') ? 'FAIL' : 'UNVERIFIED',
      evidence,
      blockers: evidence.blockers,
    };
  };
  return Object.freeze({
    prepareWorkspace: service.prepareWorkspace.bind(service),
    preflightSourceIsolation: preflight,
    cleanup: service.cleanup.bind(service),
    close: service.close.bind(service),
  });
}
export async function preflightSourceIsolation(_input: PreflightInput): Promise<never> {
  throw new Error('ISOLATION_NOT_BOUND');
}
