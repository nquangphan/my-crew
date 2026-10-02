import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayEventPump } from '../src/sync/event-pump.ts';
import { bridgeRoot } from './support/bridge-fixture.ts';

test('sync event pump persists only reconciled SSE cursor and polls after stream failure across reopen', async () => {
  const owned = await bridgeRoot();
  let failure = true,
    seen: string[] = [];
  const options = {
    stream: async function* (after: string) {
      seen.push(`stream:${after}`);
      if (failure) throw new Error('OFFLINE');
      yield '7';
    },
    read: async (route: string) => {
      seen.push(route);
      return { items: [{ cursor: '5' }], cursor: '5' };
    },
    reconcile: async () => {
      seen.push('reconcile');
    },
  };
  let pump = await GatewayEventPump.open(owned.root, options);
  try {
    await pump.once();
    assert(seen.includes('/v2/events?after=0&limit=50'));
    await pump.close();
    pump = await GatewayEventPump.open(owned.root, options);
    failure = false;
    await pump.once();
    assert(seen.includes('stream:5'));
    await pump.close();
    pump = await GatewayEventPump.open(owned.root, options);
    await pump.once();
    assert(seen.includes('stream:7'));
  } finally {
    await pump.close();
    await owned.cleanup();
  }
});
