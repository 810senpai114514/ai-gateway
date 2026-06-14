import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayConfig } from '../types';
import { isObject, readHeader } from '../utils';

type CachedPayload = string | Buffer;
type CachedHeaderValue = string | number | string[];

interface CachedIdempotencyResponse {
  statusCode: number;
  headers: Record<string, CachedHeaderValue>;
  payload: CachedPayload;
}

interface PendingIdempotencyEntry {
  state: 'pending';
  requestHash: string;
  expiresAt: number;
  promise: Promise<CachedIdempotencyResponse | undefined>;
  resolve: (response: CachedIdempotencyResponse | undefined) => void;
}

interface CompletedIdempotencyEntry {
  state: 'completed';
  requestHash: string;
  expiresAt: number;
  response: CachedIdempotencyResponse;
}

type IdempotencyEntry = PendingIdempotencyEntry | CompletedIdempotencyEntry;

interface IdempotencyRequestContext {
  key: string;
  requestHash: string;
  servedFromCache: boolean;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const requestContexts = new WeakMap<FastifyRequest, IdempotencyRequestContext>();

const routeSensitiveHeaders = [
  'authorization',
  'x-api-key',
  'x-target-provider',
  'x-target-providers',
  'x-target-model',
  'x-auth-user-id',
  'x-auth-tenant-id',
  'x-auth-sub',
  'x-auth-organization-id',
  'x-auth-plan'
];

const hopByHopHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'date',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export function createGatewayIdempotencyPreHandler(config: GatewayConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isIdempotencyEligible(request, config)) {
      return;
    }

    const key = readIdempotencyKey(request, config);
    if (!key) {
      return;
    }

    const requestHash = hashIdempotencyRequest(request, config);
    return handleMemoryIdempotencyPrecheck(request, reply, config, key, requestHash);
  };
}

async function handleMemoryIdempotencyPrecheck(
  request: FastifyRequest,
  reply: FastifyReply,
  config: GatewayConfig,
  key: string,
  requestHash: string
) {
  const now = Date.now();
  pruneIdempotencyStore(config, now);
  const existing = idempotencyStore.get(key);

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      return sendIdempotencyConflict(reply);
    }

    if (existing.state === 'completed') {
      requestContexts.set(request, {
        key,
        requestHash,
        servedFromCache: true
      });
      return sendCachedResponse(reply, existing.response);
    }

    const response = await existing.promise;
    if (response) {
      requestContexts.set(request, {
        key,
        requestHash,
        servedFromCache: true
      });
      return sendCachedResponse(reply, response);
    }

    return reply
      .code(409)
      .header('x-gateway-idempotency-status', 'not-cacheable')
      .send({
        error: {
          message: 'Original request did not produce a cacheable idempotency response.',
          code: 'idempotency_response_not_cacheable'
        }
      });
  }

  if (existing) {
    idempotencyStore.delete(key);
  }

  const pending = createPendingEntry(requestHash, now + config.idempotency.ttlMs);
  idempotencyStore.set(key, pending);
  requestContexts.set(request, {
    key,
    requestHash,
    servedFromCache: false
  });
  pruneIdempotencyStore(config, now);
}

export function registerGatewayIdempotencyHooks(
  fastify: FastifyInstance,
  config: GatewayConfig
): void {
  fastify.addHook('onSend', async (request, reply, payload) => {
    const context = requestContexts.get(request);
    if (!context || context.servedFromCache) {
      return payload;
    }

    const entry = idempotencyStore.get(context.key);
    if (!entry || entry.state !== 'pending' || entry.requestHash !== context.requestHash) {
      return payload;
    }

    const cached = buildCachedResponse(reply, payload, config);
    if (!cached) {
      idempotencyStore.delete(context.key);
      entry.resolve(undefined);
      return payload;
    }

    const completed: CompletedIdempotencyEntry = {
      state: 'completed',
      requestHash: entry.requestHash,
      expiresAt: entry.expiresAt,
      response: cached
    };
    idempotencyStore.set(context.key, completed);
    reply.header('x-gateway-idempotency-status', 'stored');
    entry.resolve(cached);
    return payload;
  });
}

export function resetGatewayIdempotencyForTests(): void {
  idempotencyStore.clear();
}

function isIdempotencyEligible(request: FastifyRequest, config: GatewayConfig): boolean {
  if (!config.idempotency?.enabled) {
    return false;
  }

  if (request.method.toUpperCase() !== 'POST') {
    return false;
  }

  const path = request.url.split('?')[0] || '';
  return path.startsWith('/v1/') || path.startsWith('/v1beta/');
}

function readIdempotencyKey(request: FastifyRequest, config: GatewayConfig): string | undefined {
  const headerName = config.idempotency.headerName.trim().toLowerCase();
  if (!headerName) {
    return undefined;
  }

  const value = readHeader(request.headers[headerName]);
  const normalized = value?.trim();
  return normalized || undefined;
}

function createPendingEntry(requestHash: string, expiresAt: number): PendingIdempotencyEntry {
  let resolve!: (response: CachedIdempotencyResponse | undefined) => void;
  const promise = new Promise<CachedIdempotencyResponse | undefined>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    state: 'pending',
    requestHash,
    expiresAt,
    promise,
    resolve
  };
}

function sendCachedResponse(reply: FastifyReply, response: CachedIdempotencyResponse) {
  for (const [name, value] of Object.entries(response.headers)) {
    reply.header(name, value);
  }

  return reply
    .code(response.statusCode)
    .header('x-gateway-idempotency-status', 'replayed')
    .send(Buffer.isBuffer(response.payload) ? Buffer.from(response.payload) : response.payload);
}

function sendIdempotencyConflict(reply: FastifyReply) {
  return reply
    .code(409)
    .header('x-gateway-idempotency-status', 'conflict')
    .send({
      error: {
        message: 'Idempotency key was reused with a different request.',
        code: 'idempotency_key_conflict'
      }
    });
}

function buildCachedResponse(
  reply: FastifyReply,
  payload: unknown,
  config: GatewayConfig
): CachedIdempotencyResponse | undefined {
  if (!isCacheableStatus(reply.statusCode, config)) {
    return undefined;
  }

  if (isEventStreamResponse(reply)) {
    return undefined;
  }

  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    return undefined;
  }

  return {
    statusCode: reply.statusCode,
    headers: sanitizeCachedHeaders(reply.getHeaders()),
    payload: Buffer.isBuffer(payload) ? Buffer.from(payload) : payload
  };
}

function isCacheableStatus(statusCode: number, config: GatewayConfig): boolean {
  if (statusCode >= 200 && statusCode < 300) {
    return true;
  }

  return config.idempotency.cacheErrorResponses && statusCode >= 400 && statusCode < 500;
}

function isEventStreamResponse(reply: FastifyReply): boolean {
  const contentType = String(reply.getHeader('content-type') || '').toLowerCase();
  return contentType.includes('text/event-stream');
}

function sanitizeCachedHeaders(headers: Record<string, unknown>): Record<string, CachedHeaderValue> {
  const cached: Record<string, CachedHeaderValue> = {};

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (hopByHopHeaders.has(name) || name === 'x-gateway-idempotency-status') {
      continue;
    }

    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      cached[name] = rawValue;
    } else if (
      Array.isArray(rawValue) &&
      rawValue.every((item): item is string => typeof item === 'string')
    ) {
      cached[name] = rawValue;
    }
  }

  return cached;
}

function pruneIdempotencyStore(config: GatewayConfig, now: number): void {
  for (const [key, entry] of idempotencyStore) {
    if (entry.expiresAt <= now) {
      idempotencyStore.delete(key);
      if (entry.state === 'pending') {
        entry.resolve(undefined);
      }
    }
  }

  while (idempotencyStore.size > config.idempotency.maxEntries) {
    const oldestCompleted = Array.from(idempotencyStore.entries()).find(
      ([, entry]) => entry.state === 'completed'
    );
    const [key, entry] = oldestCompleted || idempotencyStore.entries().next().value || [];
    if (!key || !entry) {
      return;
    }

    idempotencyStore.delete(key);
    if (entry.state === 'pending') {
      entry.resolve(undefined);
    }
  }
}

function hashIdempotencyRequest(request: FastifyRequest, config: GatewayConfig): string {
  const hash = createHash('sha256');
  hash.update(request.method.toUpperCase());
  hash.update('\n');
  hash.update(request.url);
  hash.update('\n');
  hash.update(config.idempotency.headerName.trim().toLowerCase());
  hash.update('\n');
  hash.update(stableStringify(selectFingerprintHeaders(request)));
  hash.update('\n');
  hash.update(stableStringify(request.body));
  return hash.digest('hex');
}

function selectFingerprintHeaders(request: FastifyRequest): Record<string, string | string[]> {
  const selected: Record<string, string | string[]> = {};
  for (const headerName of routeSensitiveHeaders) {
    const value = request.headers[headerName];
    if (typeof value === 'string') {
      selected[headerName] = value;
    } else if (Array.isArray(value)) {
      selected[headerName] = value.map(String);
    }
  }

  return selected;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStable);
  }

  if (!isObject(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortStable(value[key]);
  }
  return sorted;
}
