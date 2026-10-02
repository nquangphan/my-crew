import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { ModelProofVerifier, ProbeResult } from '../../src/models/contracts.ts';
import { hash } from '../../src/models/helpers.ts';
/** Fake provider protocol evidence only, never a native isolation/live capability certificate. */
export async function modelObserverFixture(expected: () => ProbeResult) {
  const capabilityToken = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += String(chunk);
      if (body.length > 32000) {
        res.writeHead(413).end();
        return;
      }
    }
    if (req.url !== '/fixture/probe' || req.headers['x-fixture-observer'] !== capabilityToken) {
      res.writeHead(403).end();
      return;
    }
    if (hash(JSON.parse(body)) !== hash(expected())) {
      res.writeHead(409).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        context: expected().context,
        evidenceDigest: expected().evidenceDigest,
        protocol: 'fake',
        textWorked: true,
        toolWorked: true,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const verifier: ModelProofVerifier = {
    verify: async (_tx, probe) => {
      const r = await fetch(`http://127.0.0.1:${address.port}/fixture/probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fixture-observer': capabilityToken },
        body: JSON.stringify(probe),
      });
      if (r.status !== 200) return { status: 'unverified', capabilities: [] };
      const result = (await r.json()) as {
        context: unknown;
        evidenceDigest: string;
        textWorked: boolean;
        toolWorked: boolean;
      };
      return hash(result.context) === hash(probe.context) &&
        result.evidenceDigest === probe.evidenceDigest &&
        result.textWorked &&
        result.toolWorked
        ? { status: 'pass', capabilities: ['text', 'tools'] }
        : { status: 'unverified', capabilities: [] };
    },
  };
  return {
    verifier,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
