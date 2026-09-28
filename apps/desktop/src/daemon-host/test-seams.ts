import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { SkillInventory } from '@crew/shared';

/**
 * Test mode (`CREW_DESKTOP_TEST_MODE=1`, set only by the Electron E2E suite): the Claude SDK calls that need
 * a real subscription (the haiku login probe and the inventory probe) are replaced by local stand-ins
 * driven by files in the test's crew home. Everything else (API, git, hooks, config, daemon) stays real.
 */
export interface TestSeams {
  query: typeof sdkQuery;
  probe: (input: { cwd: string }) => Promise<SkillInventory>;
}

/** Present in the test crew home: the login probe fails as if the owner logged out of Claude. */
export const TEST_LOGGED_OUT_FILE = '.test-claude-logged-out';
/** Optional JSON inventory the fake probe returns. */
export const TEST_INVENTORY_FILE = '.test-inventory.json';

const DEFAULT_INVENTORY: SkillInventory = {
  skills: [{ name: 'crew-test:scout', source: 'plugin', description: 'Skill giả lập của bộ test' }],
  mcpServers: [],
};

export function testSeams(home: string): TestSeams {
  const query = (() => {
    const loggedOut = existsSync(join(home, TEST_LOGGED_OUT_FILE));
    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: '2.1.283' };
      yield loggedOut
        ? {
            type: 'result',
            subtype: 'success',
            is_error: true,
            total_cost_usd: 0,
            result: 'Not logged in · Please run /login',
          }
        : { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, result: 'ok' };
    })();
    return Object.assign(iterator, {
      initializationResult: async () => ({ account: { subscriptionType: 'Claude Max (thử nghiệm)' } }),
      close: () => {},
    });
  }) as unknown as typeof sdkQuery;

  const probe = async () => {
    const file = join(home, TEST_INVENTORY_FILE);
    if (!existsSync(file)) return DEFAULT_INVENTORY;
    return SkillInventory.parse(JSON.parse(readFileSync(file, 'utf8')));
  };
  return { query, probe };
}
