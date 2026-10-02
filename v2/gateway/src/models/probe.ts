import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isIP } from 'node:net';
import { release } from 'node:os';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import type { ApiProviderConfig, Capability } from './contracts.ts';
export function validateEndpoint(p: ApiProviderConfig): URL {
  let u: URL;
  try {
    u = new URL(p.endpoint);
  } catch {
    throw new Error('ENDPOINT_INVALID');
  }
  if (u.href !== p.endpoint || u.username || u.password || u.search || u.hash)
    throw new Error('ENDPOINT_INVALID');
  if (u.protocol === 'http:') {
    if (
      !p.localHttp ||
      !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      !u.port ||
      Number(u.port) < 1 ||
      Number(u.port) > 65535 ||
      p.localHttp.allowedOrigin !== u.origin
    )
      throw new Error('ENDPOINT_INVALID');
  } else if (
    u.protocol !== 'https:' ||
    p.localHttp ||
    isIP(u.hostname.replaceAll(/[[\]]/g, '')) ||
    u.hostname === 'localhost' ||
    u.hostname.endsWith('.localhost') ||
    u.hostname.endsWith('.local')
  )
    throw new Error('ENDPOINT_INVALID');
  if (!p.models.length || new Set(p.models.map((m) => m.id)).size !== p.models.length)
    throw new Error('MODEL_LIST_INVALID');
  return u;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROTOCOL');
  return value as Record<string, unknown>;
}
function tool(name: unknown, args: unknown, id: unknown, seen: Set<string>): void {
  if (name !== 'crew_probe_echo' || typeof args !== 'string' || typeof id !== 'string' || !id || seen.has(id))
    throw new Error('TOOL_PROTOCOL');
  seen.add(id);
  try {
    const a = object(JSON.parse(args));
    if (a.value !== 'fixture' || Object.keys(a).length !== 1) throw new Error();
  } catch {
    throw new Error('TOOL_PROTOCOL');
  }
}
/** Shape evidence only. Tools require correlated local execution and follow-up before live PASS. */
export function parseProtocol(
  protocol: 'responses' | 'chat-completions',
  value: unknown,
  modelId: string,
): Capability[] {
  const o = object(value),
    result = new Set<Capability>(),
    seen = new Set<string>();
  if (o.model !== modelId) throw new Error('MODEL_MISMATCH');
  if (protocol === 'responses') {
    if (o.status !== 'completed' || !Array.isArray(o.output)) throw new Error('PROTOCOL');
    for (const value of o.output) {
      const item = object(value);
      if (item.type === 'function_call') {
        tool(item.name, item.arguments, item.call_id, seen);
        result.add('tools');
      } else if (item.type === 'message') {
        if (!Array.isArray(item.content)) throw new Error('PROTOCOL');
        for (const part of item.content) {
          const content = object(part);
          if (content.type !== 'output_text' || typeof content.text !== 'string' || !content.text.length)
            throw new Error('PROTOCOL');
          result.add('text');
        }
      } else throw new Error('PROTOCOL');
    }
  } else {
    if (!Array.isArray(o.choices) || o.choices.length !== 1) throw new Error('PROTOCOL');
    const choice = object(o.choices[0]),
      message = object(choice.message);
    if (message.role !== 'assistant' || !['stop', 'tool_calls'].includes(String(choice.finish_reason)))
      throw new Error('PROTOCOL');
    if (typeof message.content === 'string' && message.content.length) result.add('text');
    if (message.tool_calls !== undefined) {
      if (
        !Array.isArray(message.tool_calls) ||
        !message.tool_calls.length ||
        choice.finish_reason !== 'tool_calls'
      )
        throw new Error('TOOL_PROTOCOL');
      for (const value of message.tool_calls) {
        const call = object(value),
          fn = object(call.function);
        if (call.type !== 'function') throw new Error('TOOL_PROTOCOL');
        tool(fn.name, fn.arguments, call.id, seen);
        result.add('tools');
      }
    }
  }
  if (!result.size) throw new Error('PROTOCOL');
  return [...result];
}

import type { ModelKey, Pair, ProbeContext, ProbeResult } from './contracts.ts';
export type ProbeResponse = {
  status: number;
  body: unknown;
  retryAfter: string | null;
  streamed: boolean;
  toolExecution?: { callId: string; resultCallId: string; value: string };
  imageObserved?: boolean;
};
export type ProbePorts = {
  context: (key: ModelKey, pair: Pair) => Promise<{ context: ProbeContext; version: string | null } | null>;
  provider: (key: ModelKey) => ApiProviderConfig | null;
  offline?: (key: ModelKey, signal: AbortSignal) => Promise<ProbeResponse>;
  authorizedLive?: {
    authorize: (key: ModelKey, context: ProbeContext) => Promise<boolean>;
    call: (key: ModelKey, signal: AbortSignal) => Promise<ProbeResponse>;
  };
  deadlineMs?: number;
};
export class ModelProber {
  private readonly ports: ProbePorts;
  private readonly cooldown = new Map<string, number>();
  constructor(ports: ProbePorts) {
    this.ports = ports;
  }
  async probeModel(key: ModelKey, pair: Pair, mode: 'offline' | 'authorized-live'): Promise<ProbeResult> {
    const observedAt = new Date().toISOString();
    const missing: ProbeContext = {
      sourceTreeSha256: pair.source.sourceTreeSha256,
      projectionManifestSha256: pair.projection.manifestSha256,
      projectionTreeSha256: pair.projection.treeSha256,
      derivationSha256: hash(canonicalJson(pair.projection.derivation)),
      binarySha256: '0'.repeat(64),
      policySha256: pair.projection.derivation.policySha256,
      osVersion: release(),
    };
    let observation: Awaited<ReturnType<ProbePorts['context']>> = null;
    try {
      observation = await this.ports.context(key, pair);
    } catch {
      /* unavailable observation */
    }
    const context = observation?.context ?? missing;
    const result = (
      status: ProbeResult['status'],
      capabilities: Capability[],
      errorCode: string | null,
    ): ProbeResult => ({
      key,
      context,
      observedAt,
      status,
      capabilities,
      errorCode,
      runtimeVersion: observation?.version ?? null,
      evidenceDigest: hash(canonicalJson({ key, context, status, capabilities, errorCode })),
    });
    if (!observation)
      return result('unverified', [], key.runtime === 'api' ? 'BINARY_UNVERIFIED' : 'CLI_ABSENT');
    if (
      pair.projection.runtime !== key.runtime ||
      pair.projection.sourceTreeSha256 !== pair.source.sourceTreeSha256 ||
      context.sourceTreeSha256 !== pair.source.sourceTreeSha256 ||
      context.projectionManifestSha256 !== pair.projection.manifestSha256 ||
      context.projectionTreeSha256 !== pair.projection.treeSha256 ||
      context.derivationSha256 !== hash(canonicalJson(pair.projection.derivation)) ||
      context.policySha256 !== pair.projection.derivation.policySha256 ||
      !/^[0-9a-f]{64}$/.test(context.binarySha256) ||
      context.binarySha256 === '0'.repeat(64)
    )
      return result('unverified', [], 'CONTEXT_MISMATCH');
    const provider = this.ports.provider(key);
    if (
      key.runtime === 'api' &&
      (!provider || provider.id !== key.providerId || !provider.models.some((m) => m.id === key.modelId))
    )
      return result('unverified', [], 'MODEL_NOT_CONFIGURED');
    if (provider) {
      try {
        validateEndpoint(provider);
      } catch {
        return result('fail', [], 'ENDPOINT_INVALID');
      }
    }
    if (mode === 'authorized-live') {
      try {
        if (!this.ports.authorizedLive || !(await this.ports.authorizedLive.authorize(key, context)))
          return result('unverified', [], 'LIVE_NOT_AUTHORIZED');
      } catch {
        return result('unverified', [], 'LIVE_NOT_AUTHORIZED');
      }
    }
    const call = mode === 'offline' ? this.ports.offline : this.ports.authorizedLive?.call;
    if (!call || key.runtime !== 'api')
      return result(
        'unverified',
        [],
        key.runtime === 'api' ? 'OFFLINE_UNVERIFIED' : 'ISOLATED_AUTH_UNVERIFIED',
      );
    const identity = canonicalJson(key);
    if ((this.cooldown.get(identity) ?? 0) > performance.now()) return result('unverified', [], 'BACKOFF');
    const controller = new AbortController(),
      deadline = Math.min(30000, Math.max(1, this.ports.deadlineMs ?? 10000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        call(key, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('TRANSIENT'));
          }, deadline);
        }),
      ]);
      if (response.status === 401 || response.status === 403) return result('fail', [], 'AUTH');
      if (response.status === 429) {
        const raw = response.retryAfter ?? '1',
          numeric = Number(raw),
          seconds = Number.isFinite(numeric) ? numeric : Math.max(0, (Date.parse(raw) - Date.now()) / 1000);
        this.cooldown.set(
          identity,
          performance.now() +
            Math.min(300000, Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : 1000)),
        );
        return result('fail', [], 'QUOTA');
      }
      if (response.status >= 500 || response.status < 200) return result('unverified', [], 'TRANSIENT');
      if (response.status >= 300) return result('fail', [], 'PROTOCOL');
      const bodyText = canonicalJson(response.body);
      if (Buffer.byteLength(bodyText) > 1048576) return result('fail', [], 'RESPONSE_TOO_LARGE');
      if (!provider) return result('unverified', [], 'MODEL_NOT_CONFIGURED');
      const parsed = parseProtocol(provider.protocol, response.body, key.modelId);
      if (mode === 'offline') return result('unverified', [], 'OFFLINE_UNVERIFIED');
      if (parsed.includes('tools')) {
        const tool = response.toolExecution;
        const wire = response.body as {
          output?: { call_id?: string }[];
          choices?: { message: { tool_calls?: { id: string }[] } }[];
        };
        const ids =
          provider.protocol === 'responses'
            ? wire.output?.filter((x) => x.call_id).map((x) => x.call_id)
            : wire.choices?.[0]?.message.tool_calls?.map((x) => x.id);
        if (
          !tool ||
          ids?.length !== 1 ||
          ids[0] !== tool.callId ||
          tool.callId !== tool.resultCallId ||
          tool.value !== 'fixture'
        )
          return result('fail', [], 'TOOL_PROTOCOL');
      }
      if (response.streamed) parsed.push('stream');
      if (
        response.imageObserved &&
        provider.models.find((m) => m.id === key.modelId)?.declared.includes('vision')
      )
        parsed.push('vision');
      return result('pass', [...new Set(parsed)], null);
    } catch (error) {
      const code =
        error instanceof Error &&
        [
          'MODEL_MISMATCH',
          'TOOL_PROTOCOL',
          'PROTOCOL',
          'STREAM_PROTOCOL',
          'VISION_UNSUPPORTED',
          'RESPONSE_TOO_LARGE',
          'SSRF_DENIED',
        ].includes(error.message)
          ? error.message
          : 'TRANSIENT';
      return result(code === 'TRANSIENT' ? 'unverified' : 'fail', [], code);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
/** Reads bytes without running a CLI or discovering owner HOME credentials. */
export async function executableContext(
  path: string,
  pair: Pair,
): Promise<{ context: ProbeContext; version: null } | null> {
  let fd: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024 || !(stat.mode & 0o111)) return null;
    const bytes = await fd.readFile();
    return {
      version: null,
      context: {
        sourceTreeSha256: pair.source.sourceTreeSha256,
        projectionManifestSha256: pair.projection.manifestSha256,
        projectionTreeSha256: pair.projection.treeSha256,
        derivationSha256: hash(canonicalJson(pair.projection.derivation)),
        binarySha256: hash(bytes),
        policySha256: pair.projection.derivation.policySha256,
        osVersion: release(),
      },
    };
  } catch {
    return null;
  } finally {
    await fd?.close();
  }
}
export function parseStream(
  protocol: 'responses' | 'chat-completions',
  text: string,
  modelId: string,
): unknown {
  if (Buffer.byteLength(text) > 1048576 || !text.endsWith('\n\n')) throw new Error('STREAM_PROTOCOL');
  let completed: unknown;
  let done = false,
    model: string | undefined,
    content = '',
    finish: string | null = null;
  const calls = new Map<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  >();
  for (const frame of text.replaceAll('\r\n', '\n').split('\n\n').filter(Boolean)) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    if (done) throw new Error('STREAM_PROTOCOL');
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    let o: Record<string, unknown>;
    try {
      o = object(JSON.parse(data));
    } catch {
      throw new Error('STREAM_PROTOCOL');
    }
    if (protocol === 'responses') {
      if (o.type === 'response.completed') {
        if (completed) throw new Error('STREAM_PROTOCOL');
        completed = o.response;
        done = true;
      } else if (typeof o.type !== 'string' || !o.type.startsWith('response.'))
        throw new Error('STREAM_PROTOCOL');
    } else {
      if (o.model !== modelId || (model && model !== o.model)) throw new Error('MODEL_MISMATCH');
      model = String(o.model);
      if (!Array.isArray(o.choices) || o.choices.length !== 1) throw new Error('STREAM_PROTOCOL');
      const choice = object(o.choices[0]),
        delta = object(choice.delta);
      if (choice.index !== 0 || finish) throw new Error('STREAM_PROTOCOL');
      if (delta.content !== undefined) {
        if (typeof delta.content !== 'string') throw new Error('STREAM_PROTOCOL');
        content += delta.content;
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) throw new Error('STREAM_PROTOCOL');
        for (const part of delta.tool_calls) {
          const p = object(part);
          if (!Number.isSafeInteger(p.index) || Number(p.index) < 0 || Number(p.index) > 8)
            throw new Error('TOOL_PROTOCOL');
          const index = Number(p.index),
            call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } },
            fn = p.function === undefined ? {} : object(p.function);
          if (p.id !== undefined) {
            if (call.id || typeof p.id !== 'string') throw new Error('TOOL_PROTOCOL');
            call.id = p.id;
          }
          if (p.type !== undefined && p.type !== 'function') throw new Error('TOOL_PROTOCOL');
          for (const k of ['name', 'arguments'] as const)
            if (fn[k] !== undefined) {
              if (typeof fn[k] !== 'string') throw new Error('TOOL_PROTOCOL');
              call.function[k] += fn[k];
            }
          calls.set(index, call);
        }
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined)
        finish = String(choice.finish_reason);
    }
  }
  if (!done) throw new Error('STREAM_PROTOCOL');
  const value =
    protocol === 'responses'
      ? completed
      : {
          model,
          choices: [
            {
              finish_reason: finish,
              message: {
                role: 'assistant',
                content,
                ...(calls.size ? { tool_calls: [...calls.values()] } : {}),
              },
            },
          ],
        };
  parseProtocol(protocol, value, modelId);
  return value;
}
