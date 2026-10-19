import { describe, expect, it } from 'vitest';
import * as lib from '../src/index.js';

describe('@crew/mac thư viện', () => {
  it('export đủ hàm app cần', () => {
    for (const name of [
      'setup',
      'doctor',
      'uninstall',
      'scanUninstallBlockers',
      'configureStatus',
      'setStatusSecret',
      'addStatusRepo',
      'removeStatusRepo',
      'listStatusRepos',
      'readStatusConfig',
      'sendStatus',
      'listTargets',
      'addTarget',
      'scanCheckouts',
      'readJobsAgent',
      'stopRun',
      'listProcesses',
      'readCwds',
      'isAgentPrint',
      'isClaudePrint',
      'readManifest',
      'macPaths',
      'forbiddenRootReason',
      'createMacContext',
      'workflowCheck',
      'runtimesCommand',
      'runtimesStatus',
      'keychainHasKey',
      'runtimePaths',
      'SetupError',
    ]) {
      expect(typeof (lib as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(lib.SSHD_LABEL).toBe('com.2p.crew-mac-sshd');
    expect(lib.DEFAULT_PORT).toBe(2222);
  });

  it('createMacContext dùng cliPath được truyền, không dùng đường dẫn của chính module', () => {
    const ctx = lib.createMacContext({
      env: { HOME: '/tmp/h', USER: 'u' },
      out: () => {},
      cliPath: '/tmp/h/.crew/app/crew-mac/dist/cli.js',
    });
    expect(ctx.cliPath).toBe('/tmp/h/.crew/app/crew-mac/dist/cli.js');
    expect(ctx.home).toBe('/tmp/h');
  });
});
