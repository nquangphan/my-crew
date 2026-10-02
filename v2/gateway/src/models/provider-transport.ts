import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import type { ApiProviderConfig } from './contracts.ts';
import type { CredentialBroker, SecretTransport } from './credential-broker.ts';
import type { CurrentCredentialResolver } from './current-credential-resolver.ts';
import { type ProbeResponse, parseProtocol, parseStream, validateEndpoint } from './probe.ts';
export function assertPublicAddress(address: string): void {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      throw new Error('SSRF_DENIED');
  } else if (isIP(address) === 6) {
    // Admit only global unicast; special/mapped/transition/documentation ranges fail closed.
    const parts = address.split(':');
    const first = Number.parseInt(parts[0] ?? '', 16),
      second = Number.parseInt(parts[1] || '0', 16);
    if (
      !Number.isFinite(first) ||
      first < 0x2000 ||
      first > 0x3fff ||
      (first === 0x2001 && (second < 0x200 || second === 0xdb8)) ||
      first === 0x2002 ||
      first === 0x3fff
    )
      throw new Error('SSRF_DENIED');
  } else throw new Error('SSRF_DENIED');
}
export function buildProbeRequest(provider: ApiProviderConfig, model: string): unknown {
  validateEndpoint(provider);
  if (!provider.models.some((m) => m.id === model)) throw new Error('MODEL_NOT_CONFIGURED');
  const tool = {
    name: 'crew_probe_echo',
    description: 'Echo fixture only',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string', enum: ['fixture'] } },
      required: ['value'],
      additionalProperties: false,
    },
  };
  return provider.protocol === 'responses'
    ? {
        model,
        input: 'Reply fixture or call crew_probe_echo with value fixture.',
        max_output_tokens: 128,
        tools: [{ type: 'function', ...tool }],
        stream: false,
      }
    : {
        model,
        messages: [{ role: 'user', content: 'Reply fixture or call crew_probe_echo with value fixture.' }],
        max_completion_tokens: 128,
        tools: [{ type: 'function', function: tool }],
        stream: false,
      };
}
/** Each request resolves/checks all answers and pins the socket lookup to one allowed IP. */
async function send(
  provider: ApiProviderConfig,
  model: string,
  body: unknown,
  credential: Buffer,
  signal: AbortSignal,
  assertCurrent?: () => Promise<void>,
): Promise<ProbeResponse> {
  const base = validateEndpoint(provider),
    url = new URL(base.href);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${provider.protocol === 'responses' ? 'responses' : 'chat/completions'}`;
  const hostname = url.hostname.replaceAll(/[[\]]/g, '');
  const answers =
    base.protocol === 'http:'
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  if (!answers.length) throw new Error('SSRF_DENIED');
  if (base.protocol === 'https:') for (const a of answers) assertPublicAddress(a.address);
  const pinned = answers[0],
    payload = Buffer.from(JSON.stringify(body));
  if (!pinned) throw new Error('SSRF_DENIED');
  try {
    await assertCurrent?.();
    signal.throwIfAborted();
    return await new Promise<ProbeResponse>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            Authorization: `Bearer ${credential.toString('utf8')}`,
          },
          lookup: pinnedLookup(pinned),
        },
        (res) => {
          res.setTimeout(3000, () => req.destroy(new Error('TRANSIENT')));
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1048576) req.destroy(new Error('RESPONSE_TOO_LARGE'));
            else chunks.push(chunk);
          });
          res.on('aborted', () => reject(new Error('TRANSIENT')));
          res.on('error', () => reject(new Error('TRANSIENT')));
          res.on('end', () => {
            const status = res.statusCode ?? 500;
            if (status < 200 || status >= 300) {
              resolve({
                status,
                body: null,
                retryAfter:
                  typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : null,
                streamed: false,
              });
              return;
            }
            try {
              const text = Buffer.concat(chunks).toString('utf8'),
                streamed = String(res.headers['content-type']).startsWith('text/event-stream'),
                parsed = streamed ? parseStream(provider.protocol, text, model) : JSON.parse(text);
              parseProtocol(provider.protocol, parsed, model);
              resolve({ status, body: parsed, retryAfter: null, streamed });
            } catch (error) {
              reject(
                error instanceof Error &&
                  ['MODEL_MISMATCH', 'TOOL_PROTOCOL', 'PROTOCOL', 'STREAM_PROTOCOL'].includes(error.message)
                  ? error
                  : new Error('PROTOCOL'),
              );
            }
          });
        },
      );
      req.setTimeout(3000, () => req.destroy(new Error('TRANSIENT')));
      req.on('error', (error) =>
        reject(new Error(error.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : 'TRANSIENT')),
      );
      req.end(payload);
    });
  } finally {
    payload.fill(0);
  }
}
/** Compose deliver into CredentialBroker's trusted list before using call(). One call in flight. */
export class PinnedProviderTransport {
  private readonly provider: ApiProviderConfig;
  private pending: {
    model: string;
    body: unknown;
    signal: AbortSignal;
    response: ProbeResponse | null;
    assertCurrent?: () => Promise<void>;
  } | null = null;
  readonly deliver: SecretTransport;
  constructor(provider: ApiProviderConfig) {
    this.provider = structuredClone(provider);
    this.deliver = async (channel: Readable) => {
      const operation = this.pending;
      if (!operation) throw new Error('TRANSPORT_NOT_PINNED');
      const chunks: Buffer[] = [];
      let count = 0;
      try {
        for await (const value of channel) {
          const chunk = Buffer.from(value);
          count += chunk.length;
          if (count > 8192) {
            chunk.fill(0);
            throw new Error('CREDENTIAL_INVALID');
          }
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        try {
          operation.response = await send(
            this.provider,
            operation.model,
            operation.body,
            bytes,
            operation.signal,
            operation.assertCurrent,
          );
        } finally {
          bytes.fill(0);
        }
      } finally {
        for (const chunk of chunks) chunk.fill(0);
      }
    };
  }
  /** Current server-bound path for composition. Explicit-ref call below is a low-level trusted port. */
  async callCurrent(
    model: string,
    broker: CredentialBroker,
    resolver: CurrentCredentialResolver,
    configRevision: number,
    signal: AbortSignal,
  ): Promise<ProbeResponse> {
    const current = await resolver.resolve(this.provider, configRevision, signal);
    return this.call(model, broker, current.credentialRef, signal, current.assertCurrent);
  }
  async call(
    model: string,
    broker: CredentialBroker,
    credentialRef: string,
    signal: AbortSignal,
    assertCurrent?: () => Promise<void>,
  ): Promise<ProbeResponse> {
    if (this.pending) throw new Error('TRANSPORT_BUSY');
    const operation = {
      model,
      body: buildProbeRequest(this.provider, model),
      signal,
      assertCurrent,
      response: null as ProbeResponse | null,
    };
    this.pending = operation;
    try {
      await broker.withSecret(credentialRef, this.deliver);
      await assertCurrent?.();
      signal.throwIfAborted();
      if (!operation.response) throw new Error('TRANSIENT');
      return operation.response;
    } finally {
      this.pending = null;
    }
  }
}
export function pinnedLookup(address: {
  address: string;
  family: number;
}): import('node:net').LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}
