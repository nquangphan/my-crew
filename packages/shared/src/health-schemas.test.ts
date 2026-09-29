import { describe, expect, it } from 'vitest';
import { HealthFixId } from './health-schemas.js';

describe('HealthFixId', () => {
  it.each([
    'restart-daemon',
    'refresh-inventory:VISINOTE',
    'mcp-disable:VISINOTE:MCP_DOCKER',
    'mcp-disable:VISINOTE:plugin:engineering:atlassian',
    'mcp-disable:VISINOTE:plugin:engineering:google calendar',
    'mcp-install:WEB:playwright',
  ])('accepts %s', (id) => {
    expect(HealthFixId.safeParse(id).success).toBe(true);
  });

  it.each([
    'Restart',
    'mcp-disable:VISI NOTE:x',
    'mcp-disable:VISINOTE:',
    'mcp-disable:VISINOTE:bad\nname',
    `mcp-disable:VISINOTE:${'x'.repeat(201)}`,
  ])('rejects %j', (id) => {
    expect(HealthFixId.safeParse(id).success).toBe(false);
  });
});
